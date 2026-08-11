## Context

Two threads write to the same `sys.stdout` file descriptor while a camera stream is active:

- The main thread (`run_ipc_loop()`), sequentially processing one command at a time — including `connect`, `disconnect`, `configure`, `capture`, `detect_cameras`, none of which are blocked while streaming is active.
- `streaming_worker()`, a daemon thread started by `start_stream` and stopped by `stop_stream`, emitting a `FRAME:` line ~5 times/second while active.

The first draft of this change scoped the fix to `ipc_handler.py`'s four `send_*` helpers. Code review correctly identified that this misses real writers: `ipc_handler.py`'s own `detect_cameras()` has two bare `print(...)` calls, and `python/hardware/camera.py`, `camera_mock.py`, `daq.py`, `daq_mock.py`, `scanner.py` all write `STATUS:`/`ERROR:`/`WARNING:` lines directly via bare `print(..., flush=True)` — every one of them reachable from the main thread concurrently with an active streaming thread (e.g. calling `disconnect` then `connect` again while a stream from a previous `start_stream` call is still running constructs a fresh `MockCamera`, whose `__init__` calls `_load_test_images()`, which can print `WARNING:`/plain-text lines). This design covers the corrected, complete fix, including two further gaps a second review round caught (stderr conflation, PyInstaller packaging).

## Goals / Non-Goals

**Goals:**

- Guarantee that every line written to **stdout** from within the shared `ipc_handler.py` process — not just the four original helpers — is written as one uninterrupted unit, regardless of thread, call site, or payload size.
- Keep the primitive minimal: one lock, one low-level writer function, reused everywhere it's needed.
- Guarantee the lock releases even if the underlying write raises, so a single failed write can't deadlock all subsequent protocol messages.
- Prove the fix with tests that fail reliably against the old code and pass reliably against the new code — no flaky sleep-and-hope timing, and no test-harness deadlock risk of its own.
- Work correctly in the actual packaged (PyInstaller) app, not just dev-mode `ts-node` execution.

**Non-Goals:**

- Changing the wire protocol (still line-delimited, still the same prefixes).
- Reducing `FRAME:` payload size, chunking large messages, or switching transports. Considered and rejected — see Alternatives.
- Locking `__main__`-block prints in `camera.py`/`camera_mock.py`, and the helper functions reachable _only_ from that block (`run_camera_capture()`/`run_mock_camera_capture()`, and — transitively, since nothing else calls them — `grab_frames()`'s `TRIGGER_CAMERA` print and `parallel_imwrite()`'s `IMAGE_PATH` print). That whole call graph only runs via the `python camera.py <output_dir> <settings>` standalone-script invocation, a separate, single-threaded process with no streaming thread ever present. (`ipc_handler.py` only ever calls `grab_frame()`, singular, never this batch path.)
- Locking `scanner.py`'s **stderr** writes (see "Decision: stderr is out of scope" below) or `ipc_handler.py`'s seven module-import-time `print()` calls (see "Decision: import-time prints are out of scope" below).
- Revisiting issue #40's finding (`_scanner_instance`/`is_scanning` cross-thread access). That's a different shared resource (in-memory state, not stdout) and remains correctly un-locked per that investigation.
- Node-side defensive logging of unrecognized lines — tracked separately as `add-unrecognized-protocol-line-warning`, since it's independent hardening, not part of this bug's root-cause fix.

## Decision: one shared primitive — `protocol_io.write_line()` — not four separate locks or four separate modules re-implementing locking

`python/protocol_io.py` is a new, dependency-free module:

```python
import threading

_stdout_lock = threading.Lock()

def write_line(text: str) -> None:
    """Write one line to stdout, serialized against every other caller."""
    with _stdout_lock:
        print(text, flush=True)
```

`ipc_handler.py`'s `send_status`/`send_error`/`send_data`/`send_frame` keep their existing signatures and behavior (including `send_error`'s `tag_request` parameter and `send_data`/`send_error`'s use of `_current_request_id` for correlation — both stay in `ipc_handler.py`, since request-id correlation is specific to its command-dispatch loop, not a stdout-serialization concern) but call `protocol_io.write_line(...)` instead of `print(...)` directly. Every other bare `print(...)` call site identified above (in `detect_cameras()` and the five `hardware/*.py` files) is replaced with an equivalent `write_line(...)` call, preserving the exact existing message text and prefix — **except** the two categories of exclusion below, both found during a second review round.

Using the `with` statement (rather than manual `acquire()`/`release()`) guarantees the lock releases even if `print()` raises — e.g. a `BrokenPipeError` if the Electron parent process has already exited. Without this, one failed write would leave `_stdout_lock` permanently held, deadlocking every subsequent protocol message — a strictly worse failure than the bug being fixed.

## Decision: stderr is out of scope

`scanner.py` has six `print(..., file=sys.stderr, flush=True)` call sites (not the two originally noted — a second review pass found four more). `write_line()` unconditionally writes to **stdout**. Routing these through it would silently redirect scanner's stderr diagnostics onto stdout — a real, unintended behavior change (Node's `PythonProcess` treats stderr as raw diagnostic output via a completely separate `process.stderr.on('data', ...)` handler, distinct from parsed `STATUS:`/`DATA:`/`ERROR:` stdout protocol lines). It's also unnecessary: stdout and stderr are separate OS-level pipes/file descriptors on the Node side, so a stderr write can never interleave with a stdout `FRAME:` write regardless of locking — there's no race to fix here. `scanner.py`'s six stderr `print()` calls are explicitly left as bare `print(..., file=sys.stderr, flush=True)`, unchanged.

## Decision: import-time prints are out of scope

`ipc_handler.py` has seven bare `print(...)` calls that execute once, at module import time (the `STATUS:sys.path=...`, `STATUS:Successfully imported...`, and similar diagnostic lines in the `try`/`except ImportError` blocks around lines 49–115), before `run_ipc_loop()` starts and before any thread other than the main thread exists. No concurrent writer can exist at that point in the process's lifetime, so these are safe to leave as bare `print()` calls — locking them would be inert, not incorrect, but it would blur the fix's actual scope for no benefit.

`hardware/daq.py` has one bare `print(...)` at its own module import time too (`"STATUS:NI-DAQmx not available, DAQ control disabled"`, only reached if the optional `nidaqmx` package isn't installed) — the same "no concurrent writer exists yet" reasoning applies to it. Unlike `ipc_handler.py`'s seven, this one **was** routed through `write_line()` rather than left bare. That's an intentional asymmetry, not an oversight: `ipc_handler.py`'s import-time prints are called out explicitly as an exemption because leaving them bare keeps this fix's diff minimally invasive to a large, central file; `daq.py` is small enough that routing its one import-time print keeps the whole file internally consistent (every print in it goes through `write_line()`, no footnoted exception to remember) at zero cost, since — as stated above — locking an import-time print is inert either way, never wrong.

## Decision: `protocol_io` must be registered in `main.spec`'s `hiddenimports`

A second review pass found that `python/main.spec` (the PyInstaller build spec) hand-enumerates `hardware.camera`, `python.hardware.camera`, and their siblings in `hiddenimports`, with a comment explaining this exists _because_ PyInstaller's static analysis doesn't reliably discover modules imported only inside a `try`/`except ImportError` fallback block — exactly the pattern this fix uses for `protocol_io`. Without adding `protocol_io` and `python.protocol_io` to that same list, the fix could pass every CI test (all of which run against dev-mode `ts-node`/`pytest`, never the actual PyInstaller-bundled executable) and still fail at runtime in the packaged app with an `ImportError` the first time a camera command runs. This is a required task, not an optional cleanup — see `tasks.md` section 3.

## Decision: import pattern matches the codebase's existing dual-path convention

`protocol_io.py` has no dependency on `ipc_handler.py` or any `hardware/*.py` module (avoiding any circular-import risk, since `ipc_handler.py` already imports `hardware.camera`/`hardware.camera_mock` etc. at module load). Both `ipc_handler.py` and the `hardware/*.py` modules import it the same way `ipc_handler.py` already imports `hardware.camera`, mirroring the codebase's existing bundled-vs-dev fallback idiom:

```python
try:
    from protocol_io import write_line  # PyInstaller-bundled path (python/ is a pathex root)
except ImportError:
    from python.protocol_io import write_line  # Development/test path
```

This sidesteps any ambiguity about relative imports crossing the `hardware/` package boundary under a frozen PyInstaller build — it copies a pattern already proven to work in this exact codebase, rather than inventing new import mechanics. (Verified: `python/main.spec`'s `pathex=['.', './python']` is exactly what makes a bare top-level `protocol_io` module resolvable this way, mirroring how `hardware/` itself is discoverable as a top-level package.)

## Decision: `stop_stream`'s existing `_streaming_lock` is untouched — `_stdout_lock` is a new, separate lock

`stop_stream` holds `_streaming_lock` for the duration of `_streaming_thread.join(timeout=2.0)`:

```python
with _streaming_lock:
    _streaming_active.clear()
    if _streaming_thread is not None:
        _streaming_thread.join(timeout=2.0)   # blocks here, holding _streaming_lock
```

Reusing `_streaming_lock` as the stdout lock would not cause a true unrecoverable deadlock (the `join()` has a timeout), but it would force every `stop_stream` call made while streaming is active to eat the full 2-second timeout — because the worker thread's final `send_status("Streaming worker stopped")` would block on the lock `stop_stream` itself holds, so the thread could never finish exiting, `join()` would time out, and `stop_stream` would then set `_streaming_thread = None` while the real OS thread is still alive and about to acquire the lock. That's a real correctness bug (a "stopped" response while the thread is still running) even without a permanent hang. Keeping `_stdout_lock` completely independent of `_streaming_lock` avoids this: `_stdout_lock` only ever guards "one write in flight," is held only for the duration of a single `write_line()` call, and is never held across a blocking `.join()`.

## Decision: deterministic reproduction via an instrumented stdout, with an explicit, timeout-guarded handshake

The real race depends on OS pipe buffer size and scheduler timing landing a context switch inside a specific multi-syscall write — not something a unit test should rely on hitting by chance, and pytest's `capsys` fixture (used elsewhere in `test_camera_streaming.py`) already substitutes `sys.stdout` itself, so this test uses `monkeypatch.setattr(sys, "stdout", fake)` directly instead of `capsys`.

Test structure:

1. A fake stdout's `write()` records every chunk, tagged with the calling thread, into a shared ordered log. When writing a payload over a size threshold (simulating a `FRAME:` line too large for one atomic write), it splits into two writes: after the first chunk, it sets a `threading.Event` (`gap_open`) signaling "I've paused mid-message," then blocks on a second `threading.Event` (`resume`) with a bounded timeout (e.g. 2s) before writing the remainder.
2. The test's **main thread acts as the orchestrator**: it starts thread A (`write_line(large_payload)`), waits on `gap_open` (bounded, and the test asserts this wait actually returned `True` rather than timing out — a miscalibrated size threshold that never triggers the split would otherwise let the test degrade into silently not exercising the race at all and still pass), dispatches thread B (`write_line(small_payload)`), and — critically — sets `resume` **immediately after dispatching thread B**, not after B completes.
3. This ordering matters and is deadlock-free by construction: `write_line()`'s pause happens _inside_ the `with _stdout_lock:` block (since the pause lives in the fake stdout's `write()`, called by `print()`, called while the lock is held), so thread A holds `_stdout_lock` for the entire pause. Once the fix exists, thread B's `write_line()` call blocks purely on lock acquisition the instant it's dispatched — it never touches the shared log or does anything else the orchestrator needs to wait for. So releasing `resume` right after dispatching B (rather than waiting for B to "finish," which would never happen while B is blocked on the lock A holds) is not just a convenient shortcut — it's the only correct order, and works regardless of exact OS thread-scheduling.
4. Join both threads (with timeouts) and reconstruct the concatenated output. Assert it splits into exactly two complete, correctly-prefixed, newline-terminated lines, in either order.

**Red (no lock):** against current code, B's `write_line()`-equivalent call has nothing to block on, so it always writes immediately — landing inside A's open gap every time. Deterministically fails.

**Green (with lock):** B's call now blocks on `_stdout_lock` until A's `write_line()` call (gap included) fully completes. Deterministically passes.

A separate test targets the "hardware-module diagnostic line" scenario the fix's expanded scope exists for: thread B constructs a real `MockCamera` (forcing its `_load_test_images()` warning path) instead of calling a synthetic payload directly — proving the _actual_ routed call sites, not just the four original helpers, are covered by the same serialization. This test needed one more piece of synchronization the other two don't: `MockCamera(settings)`'s constructor does real filesystem work (checking whether `TEST_IMAGES_DIR` exists) before it ever calls `write_line()`, unlike the other two tests where thread B's entire body _is_ the `write_line()` call. Releasing thread A immediately after dispatching thread B (as the other two tests do) isn't reliable here — thread A's own tiny remaining write can complete before thread B has even been scheduled once, silently turning the "race" into two writes that never overlap, passing regardless of whether the lock exists. (This was caught empirically during review: the test passed even with the lock deliberately removed.) The fix is a third synchronization primitive, `write_entered`, set by the fake stdout on every entry to `write()`: the test clears it after dispatching thread B, then waits on it (bounded, e.g. 0.5s) before releasing thread A. This is safe in both directions — when the lock is in place, thread B blocks acquiring `_stdout_lock` and never reaches the fake's `write()` at all, so the wait always times out harmlessly and thread A releases as before; when the lock is absent, thread B's write is unblocked and reaches the fake almost immediately, so the wait returns early with high confidence that the race window has genuinely been hit. Re-verified by manually stripping the lock and confirming all three interleaving tests fail deterministically across repeated runs, then restoring it and confirming all four tests pass deterministically across repeated runs.

A third, non-synthetic test exercises the deadlock-avoidance property directly: start real streaming with the mock camera, and use an event-based hook (monkeypatching `send_frame` to set a `threading.Event` immediately before calling the real one) so `stop_stream()` is dispatched right as the streaming worker begins a frame write, rather than just "shortly after start," which would almost always land during the worker's `time.sleep()` between frames (most of its 200ms period). This meaningfully improves on "shortly after start," but — unlike the fake-stdout harness's `gap_open`/`resume` handshake — it does not force the worker to pause mid-write, so it's biased toward catching the race rather than mathematically guaranteed to. The assertion itself (`stop_stream` returns success, well under the 2s join timeout) is still a meaningful regression test for the `_stdout_lock`/`_streaming_lock` deadlock class even on the runs where it lands just after the write instead of during it.

## Known Limitations

- **SIGTERM/process kill while `_stdout_lock` is held mid-write.** If the OS kills the process while a `write_line()` call is in progress, the write is simply abandoned along with the rest of the process state — not a deadlock (nothing survives to deadlock on), but also not graceful. Considered acceptable: the same is true of any in-flight I/O in this process today, and this fix doesn't change that exposure.
- **The race-condition unit tests (`test_protocol_io.py`) run on Linux only in CI.** `Test - Python` (which runs these tests) is not platform-matrixed, unlike `Test - Integration` (which now passes on macOS/Windows/Ubuntu and _would_ have caught this exact regression, just less directly — via the compiled executable's real IPC/camera behavior rather than these specific unit-level lock assertions). Matrixing `Test - Python` to all three platforms is a larger, repo-wide CI cost/time tradeoff decision affecting every future PR, not something this bug-fix PR should decide unilaterally — noted here as a candidate follow-up.

## Alternatives Considered

- **Give `FRAME:` its own file descriptor / channel**, separate from command responses. Would also solve the interleaving but is a much larger protocol change (new fd plumbing through `spawn()`'s `stdio` array, `PythonProcess`/`CameraProcess` reading a second stream) for a problem a single lock already solves completely. Rejected as disproportionate.
- **Reduce `FRAME:` payload size** (lower JPEG quality/resolution) to fit more writes in one atomic syscall. Doesn't eliminate the race, just narrows the window. Rejected: doesn't fix the actual defect.
- **Queue-based single-writer thread.** Strictly more machinery than a `Lock` for the same guarantee, given there are only two writer contexts today (main thread, streaming thread). Rejected as over-engineering for the current architecture; revisit if a third concurrent writer is ever added.
- **A lock per module** (each of `camera.py`, `daq.py`, etc. gets its own). Doesn't work: the interleaving happens on the shared OS-level file descriptor, not per-module state — two different locks guarding the same fd from different modules provide no mutual exclusion between them. Rejected; a single shared lock is required.
- **Route `scanner.py`'s stderr writes through `write_line()` too, "for consistency."** Rejected after the second review round: stderr and stdout are different OS pipes that cannot interleave with each other, so there is no bug to fix there, and doing so would change which fd scanner's diagnostics land on — an unintended, unnecessary behavior change.
