## Context

Issue #381 reported the GUI freezing on dev rig `pbiob-gh-04`, blocking GraviScan #182's attended task 4.4. It attributed the freeze to an Electron GPU-process SIGSEGV crash-loop on NVIDIA RTX A5000 + Wayland/XWayland, while explicitly flagging the causal link as unproven.

### Empirical record

All findings below were obtained on 2026-09-22 and are posted durably in #381 (comment `5785923318`), because the rig artifacts under `~/claude-hw-validation/gpu381/` are disposable and that machine's storage has failed before. Rig environment: Ubuntu 26.04, kernel `7.0.0-28-generic`, NVIDIA RTX A5000 on the **open** kernel module 595.84, GNOME session with `Xwayland :0` running, app launched under tmux with `DISPLAY=:0`, `WAYLAND_DISPLAY=wayland-0`, `ELECTRON_DISABLE_SANDBOX=1`.

**1. The GPU-process exits are NVIDIA driver segfaults — established.** `dmesg` names the faulting library and offset, correlating to the second with `/tmp/forge44.log`:

| dmesg kernel ts | wall clock | log entry                    | fault                                    |
| --------------- | ---------- | ---------------------------- | ---------------------------------------- |
| `1894656.21`    | 10:40:45   | `104049` `exit_code=139`     | `libnvidia-glcore.so.595.84` +`0x782717` |
| `1895315.56`    | 10:51:44   | `105148`/`105149` (512, 139) | `libnvidia-glcore.so.595.84` +`0x782717` |

Two more on a previous day (`1289774`, `1289997`) at the **identical** offset. All are `segfault at 10 ... error 4` — a user-mode read of address `0x10`, i.e. a null-pointer dereference in NVIDIA's userspace GL library, deterministic at a fixed offset. The GL path is **GLX** (`libGLX_nvidia.so.595.84` mapped, no `libEGL_nvidia`). `src/main/main.ts` already forces `GDK_BACKEND=x11`, and GLX exists only on X11, so #381's "force x11" candidate was already the de-facto state.

**2. "GPU crash ⇒ frozen window" — REFUTED.** A throwaway harness (standalone Electron run from the rig's own `node_modules/electron` — therefore the same 28.2.2 the app uses — with its own `userData`, so it neither touched `~/.bloom/.env` nor tripped the single-instance lock) rendered a `requestAnimationFrame` counter alongside a plain `setInterval` counter. Its GPU process was killed with `SIGSEGV` eight times, including a rapid double mimicking the real 10:51:48/49 pair:

| stage              | `raf`                                                                         | `tick`     | `gpu_compositing`     |
| ------------------ | ----------------------------------------------------------------------------- | ---------- | --------------------- |
| baseline           | advancing                                                                     | advancing  | `enabled`             |
| after crash #1     | 60 Hz                                                                         | advancing  | `enabled`             |
| crashes #2–5       | ~59/s sustained (measured as the delta between successive 1 s `tick` reports) | advancing  | → `disabled_software` |
| after rapid double | ~60/s sustained                                                               | advancing  | `disabled_software`   |
| end (8 crashes)    | `raf=12967`                                                                   | `tick=320` | `disabled_software`   |

Every kill produced `CHILD_GONE {"type":"GPU","reason":"crashed","exitCode":139}` and repainting never stopped. Electron 28.2.2 respawns the GPU process and, once crashes accumulate, degrades to software compositing and keeps painting. What the segfaults cost is hardware acceleration, silently — now tracked as **#383**.

_Caveat:_ an externally delivered `SIGSEGV` is not identical to a fault _inside_ `libnvidia-glcore`, which could additionally wedge DRM/GL state. The generic mechanism is refuted; that exact one is not fully excluded. The harness is preserved in #383/#381 rather than committed, since it needs NVIDIA hardware and a display and could never run in CI.

**3. A discarded measurement, recorded so it is not repeated.** An attempt to verify repaint remotely with `scrot` was invalidated by its own control: with a healthy 600×200 `xmessage` focused, `scrot -u` returned the same 2400×1600 pure-black image as it did for the app window. `XGetImage` on a redirected, GPU-rendered window is not a valid repaint test, and GNOME's compositor screenshot is `AccessDenied` over SSH. The valid substitute is the in-app `raf` counter of item 2, not an external screen capture.

**4. #381's central inference does not hold.** The issue concludes "it is not an application hang" from all-processes-`Sl+`, ~0% CPU, `load 0.01`. A **spin** burns CPU; a **block** burns none. A deadlock or a thread parked in a blocking syscall produces exactly that signature, so "not an app hang" was assumed, not established.

**5. Production rig exposure — explicit.** `graviscan-ms-7c56` is AMD Radeon Vega (Cezanne), `amdgpu` only, Ubuntu 25.04, kernel 6.14, no `nvidia-smi`, no `libnvidia-glcore`, zero matching segfaults. It cannot hit a null dereference in a library it lacks, which also argues against a blunt global `disableHardwareAcceleration()`.

**However, production IS exposed to the hypothesis below.** It runs the same code with five real V600s and the same synchronous `lsusb` call sites, on unattended multi-hour sessions — arguably more exposed than the dev rig. #381's criterion 3 is satisfied for the GPU fault and extended here to the replacement hypothesis.

**6. Electron API probes** (run against real Electron 28.2.2, Node 18.18.2, Chromium 120.0.6099.276):

- `ipcMain.handle` is an **own** property: `{writable: true, enumerable: true, configurable: true}`, absent from the prototype; `ipcMain` is neither frozen nor sealed. Assigning a delegating wrapper succeeded and intercepted a registration. Electron's duplicate-channel error still raised through the wrapper.
- `perf_hooks.monitorEventLoopDelay` works in the Electron main process and reports **nanoseconds**.
- Measured `appendFileSync` cost for one ~78-byte line, 200 samples after warm-up, on a Windows workstation: median **0.833 ms**, p95 1.057 ms, p99 1.165 ms, max 1.229 ms. So roughly **1 ms per breadcrumb, ~1.7 ms per risk-listed call** — not "microsecond-scale".

### The working hypothesis this change tests

The operator's actual observation is **"window painted normally, every click ignored."** In Chromium the _browser_ process — Electron `main` — receives OS input and routes it to the renderer, while the GPU/viz process composites independently. A blocked main-process event loop therefore yields precisely a window that looks normal, ignores all input, and shows ~0% CPU with every process sleeping. A GPU crash does not produce that.

The strongest candidate is `execFileSync('lsusb')` in `src/main/lsusb-detection.ts` (two calls, `timeout: 5000` each), reached from four synchronous `detectEpsonScanners()` call sites in `src/main/graviscan/scanner-handlers.ts`. Mapping those sites to channels actually reachable from the renderer:

| enclosing function            | channel                       | reachable from renderer?      |
| ----------------------------- | ----------------------------- | ----------------------------- |
| `runStartupScannerValidation` | `graviscan:validate-scanners` | No — dead code (#375)         |
| `detectScanners`              | `graviscan:detect-scanners`   | Yes                           |
| `validateConfig`              | `graviscan:validate-config`   | No renderer caller found      |
| `resetUsb`                    | `graviscan:reset-usb`         | **Yes, and operator-clicked** |

`graviscan:reset-usb` is the interesting one: reachable mid-session with no active-scan guard (#378), and in the exact wedge → power-cycle → retry sequence that was running when the freeze hit. PR #382's Decision 4 independently describes this path as "up to ~10s with the **main-process event loop fully blocked**… no IPC handler runs", and deliberately leaves all four sites synchronous as out of scope. `execFileSync`'s timeout kills with `SIGTERM` by default, which a process in uninterruptible USB I/O need not honour, so the block may exceed 5 s without bound.

Prior art worth noting: #86 (closed) was "sqlite3 CLI calls block main process during startup", and #187 (open) proposes async `fs` because synchronous I/O "blocks the event loop and freezes the UI". Main-loop blocking is a recognised defect class here, and the accepted remedy has been _make it async_. This change is deliberately instrument-first instead, because the culprit is not yet confirmed and the obvious conversion collides with PR #382.

Still open, and why instrumentation rather than a speculative fix: #381 reports no `D`-state process, but only _Electron_ processes were inspected — nobody looked for an `lsusb` child.

## Goals / Non-Goals

- **Goals:** a frozen or crashing app leaves durable, on-disk evidence naming the responsible channel or subsystem; the #381 hypothesis becomes decidable on the next occurrence; no change to IPC contracts, return values, or timing semantics.
- **Non-Goals:** as listed in `proposal.md`. That list is authoritative; it is not duplicated here.

## Decisions

### Decision 1: Intercept IPC with one decorator over `ipcMain.handle`

All 107 handlers use `ipcMain.handle` (no `ipcMain.on`, `sendSync`, `event.returnValue`, or `handleOnce` anywhere in `src/`), across three files: 37 at module scope in `main.ts`, 47 inside `registerDatabaseHandlers()`, 23 inside `registerGraviScanHandlers()`.

Installing the decorator before the first registration covers all 107: the database and GraviScan handlers register later inside `app.on('ready')`, the database module imports the same `ipcMain` singleton, and `registerGraviScanHandlers` receives it as a parameter. No imported module registers a handler as a load-time side effect, and `tsconfig` emits CommonJS via `ts-loader`, so `require()` calls stay in source position and statement order in `main.ts` is preserved exactly as written.

- _Alternatives:_ wrapping the three registration functions misses `main.ts`'s 37 module-scope registrations; per-handler wrapping is 107 edits that will rot.
- _Verified viable_ — see Empirical record item 6. `uninstall()` must restore a saved reference, since `handle` is an own property with nothing on the prototype to fall back to.
- _Constraint:_ the decorator must return resolved values verbatim and re-raise errors unchanged. It must also handle a synchronous throw and a non-promise return, both of which occur in this codebase.
- _Accepted deviation:_ an async wrapper adds frames to `error.stack`, which Electron serialises into the renderer-visible message. Messages are preserved; stacks gain frames.

### Decision 2: Event-loop lag probe, with its blind spots stated

A duration-only IPC watchdog cannot detect a synchronous block while it is happening, because the block delays the watchdog's own timer. `perf_hooks.monitorEventLoopDelay` is a native histogram with negligible cost.

Its accuracy was questioned in review, so it was measured directly in the Electron main process, blocking inside a callback and reading a fresh histogram:

| block   | reported max | ratio |
| ------- | ------------ | ----- |
| 150 ms  | 150.5 ms     | 1.00× |
| 600 ms  | 615.0 ms     | 0.98× |
| 1500 ms | 1500.5 ms    | 1.00× |
| 3000 ms | 3015.7 ms    | 0.99× |

A separate run with a real ~3.1 s blocking `execFileSync` reported 3145.73 ms against 3144 ms actual, and a wall-clock `setInterval` drift detector reported 3119 ms for the same block. Both instruments work; the histogram is accurate and needs no wall-clock companion, so only one is adopted.

Three properties must be documented rather than discovered:

1. The histogram reports **nanoseconds**. A 10⁶ conversion must be applied before comparison and before logging, or the probe either never fires or reports `1450000000`.
2. A block is reported only **after** it ends, since the sampler cannot run while the loop is blocked. A block that never ends before the process is killed produces no lag entry — which is what Decision 3 exists for.
3. A block during module evaluation at startup is **not** measurable as loop delay, because the loop has not begun idling. Early probe runs that appeared to under-report were measuring exactly this case.

Because a fully mocked histogram would let a missing or inverted unit conversion ship green, at least one test must block the loop for real and assert a millisecond-scale value.

### Decision 3: Per-invocation breadcrumbs for risk-listed channels

To diagnose a block that never ends, evidence must be on disk _before_ the blocking call is entered. The decorator writes a start breadcrumb, before its first `await`, and a matching end breadcrumb, for a **risk list** only. If the app is then killed mid-block, the unmatched start names the culprit.

Every breadcrumb carries a **per-invocation identifier**. Without one the mechanism breaks exactly when it matters: two concurrent invocations of one channel produce two starts and one end, and nothing says which is outstanding. Concurrent same-channel invocation is routine — scan images are read per row from the renderer, and scanner detection has two independent call sites. The in-flight registry is keyed by the same identifier, since keying by channel would let the first call to settle delete the other's record and report "nothing in flight" during a real freeze.

Breadcrumbing all 107 channels was rejected on volume: renderer polling generates a few calls per second, which would be tens of MB per day. The risk list holds only operator-initiated or known-blocking channels: `graviscan:detect-scanners`, `:validate-scanners`, `:validate-config`, `:reset-usb`, `:retry-scanner`, `:start-scan`, `:verify-plates`, `:upload-all-scans`, `:download-images`, `:parse-excel-file`, `:list-scan-files`, `:read-scan-image`, `db:scans:export`, `db:scans:upload`, `db:scans:uploadBatch`, `config:fetch-scanners`, `config:test-camera`, `scanner:scan`. The list lives in the watchdog module, which the requirement points at, so the archived spec has no dangling reference.

Writes are synchronous so evidence survives a kill. Two honest limits: `appendFileSync` does **not** `fsync`, so breadcrumbs survive `SIGKILL` (the page cache outlives the process) but **not** a power cycle or kernel panic — and holding the power button is a likely operator response to a frozen window, so the troubleshooting doc must say "use `kill -9`, not the power button". And the measured ~1 ms per write is real cost on the thread being diagnosed, which is why Decision 6 adds a circuit breaker.

### Decision 4: A new log sink, written synchronously throughout

`scan-logger.ts` is stream-based with no synchronous path, and its retention cleanup runs only in GraviScan mode and filters on the `graviscan-` prefix, so it would never prune diagnostics logs. A separate sink is therefore needed.

A review finding that an ESLint `no-restricted-imports` rule would forbid shared main-process code from importing `graviscan/*` was **checked and is false**: the rule matches the literal import specifier, so a `src/main/` file importing `'./graviscan/scan-logger'` lints clean. That is a latent gap in the project's architecture enforcement and deserves its own issue, but it is not a reason for this decision. The two reasons above are sufficient.

`src/main/diagnostics-log.ts` mirrors the proven parts of `scan-logger.ts` — `~/.bloom/logs/`, ISO-8601 UTC timestamps, daily rotation, retention, never throws — and differs in three ways: it runs in both scanner modes, it retains for 180 days to match the scan log (an asymmetry would make the two sinks uncorrelatable exactly when an incident is investigated months later), and **all** writes go through `appendFileSync`.

The single append path is a correction, not an optimisation. A buffered stream alongside a synchronous path can interleave mid-line and emit entries out of order, which would invalidate "the last unmatched start names the culprit". It also removes any dependence on `before-quit` flushing a stream, which is not guaranteed — `before-quit` ends with `app.exit(0)` without awaiting a flush, and never runs at all on `SIGKILL`. Volume is small by design, so the cost is affordable.

### Decision 5: Thresholds — allow-list plus per-channel values

Two channels block indefinitely **by design** and would be permanent false positives: `app:wait-until-ready` (resolves only when startup finishes) and `config:browse-directory` (awaits a human in a file dialog). Both are excluded from slow-call reporting.

Channels that are legitimately slow but bounded get per-channel thresholds, so a real regression still surfaces. Concrete values, derived from the existing timeouts in the code rather than invented:

| channel                                   | threshold  | basis                                                                                                 |
| ----------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- |
| `graviscan:reset-usb`                     | 90 000 ms  | ~50–70 s realistic: shutdown (5 s + 2 s per subprocess) + 5 s USB release + `initialize()` up to 45 s |
| `graviscan:start-scan`                    | 120 000 ms | `SPAWN_READY_TIMEOUT_MS` 45 s plus serial stale-subprocess shutdowns                                  |
| `scanner:scan`                            | 200 000 ms | `COMMAND_TIMEOUT_MS` is 180 s                                                                         |
| `graviscan:retry-scanner`                 | 300 000 ms | queues on `cycle-complete`; unbounded in principle (#366)                                             |
| `graviscan:verify-plates`                 | 300 000 ms | serial QR subprocess queue, no timeout                                                                |
| `graviscan:upload-all-scans`              | 600 000 ms | network uploads plus rclone, no timeout                                                               |
| `graviscan:download-images`               | 600 000 ms | network download loop                                                                                 |
| `db:scans:export`                         | 300 000 ms | bounded only by file count and destination speed                                                      |
| `db:scans:upload`, `db:scans:uploadBatch` | 600 000 ms | network, retry loop, N scans × M images                                                               |
| `graviscan:parse-excel-file`              | 60 000 ms  | CPU-bound synchronous parse                                                                           |
| everything else                           | 3 000 ms   | general default                                                                                       |

### Decision 6: Always-on, with an escape hatch and a self-protecting breadcrumb path

Diagnostics default to enabled, because a freeze that happens unattended is exactly the case that must not depend on someone having set a flag. `BLOOM_DIAGNOSTICS=0` disables everything; only the exact value `0` disables, so `false` or `off` will not silently half-work. Thresholds are tunable via `BLOOM_DIAG_IPC_WARN_MS` (default 3000), `BLOOM_DIAG_LOOP_LAG_WARN_MS` (default 1000), and `BLOOM_DIAG_LOG_RETENTION_DAYS` (default 180).

Because breadcrumbs write synchronously, a degraded disk could make the instrument a cause of blocking. If a synchronous write exceeds its bound or fails, the breadcrumb path disables itself for the rest of the run and records that it did. Slow-call reporting continues. This matters concretely: this project has an incident where a failing drive blocked I/O badly enough to prevent POST, and `graviscan:start-scan` is on the risk list.

All four variables are **launch-environment** only. They are read before `~/.bloom/.env` is hydrated, and only three keys from that file ever reach `process.env`. An operator who puts `BLOOM_DIAGNOSTICS=0` in `~/.bloom/.env` — the only config surface they manage on the rig — gets silence and no error. This is the same shape as the `GRAVISCAN_MOCK` dead-env-var gap already tracked in #325/#284/#204, so it must be documented explicitly rather than shipped as a fourth instance of a known trap.

### Decision 7: Observe unhandled errors without changing crash behaviour

Registering `process.on('uncaughtException')` **is** a behaviour change: Node exits on an uncaught exception only when no listener is attached, so a log-only listener turns a hard crash into a main process limping on in corrupted state — worse than the fault being diagnosed. `process.on('uncaughtExceptionMonitor')` logs and leaves default handling intact. `unhandledRejection` has no monitor variant, so its handler logs and then restores the default.

### Decision 8: Record no payloads, and redact what is recorded

The log exists to be read and shared, so it must never carry credentials. `config:fetch-scanners` — on the risk list — takes `bloom_scanner_password` and `bloom_anon_key` as arguments; `config:set` takes a full machine configuration including the Slack webhook URL; `config:get` returns `bloom_anon_key` unmasked. The watchdog therefore records only channel, invocation id, and duration.

Error text is constrained too. A rejected Supabase or `fetch` call can embed a URL carrying credentials, and `slack-notifier.ts` already logs `err.name` rather than `err.message` for exactly this reason. Logged error text is redacted (URL path, query, and user-info stripped; known secret values masked), non-`Error` rejection reasons are never serialised, and newlines in logged content are escaped so renderer-supplied text cannot forge a breadcrumb line and defeat the unmatched-start analysis.

Minidumps are a related exposure with a different remedy: they contain the process environment block, into which the Slack webhook URL is written, plus heap-resident configuration. `uploadToServer: false` keeps them local, but the natural next step of attaching `Crashpad/completed` to an issue would be a credential leak. The spec states that, and bounds the directory's growth.

### Decision 9: Run identity in the log

Each run writes `RUN-START`/`RUN-END` carrying pid, run id, app version, Electron/Chromium/Node versions, platform, scanner mode, and the thresholds in force. Three reasons: an unmatched breadcrumb from a killed process is otherwise indistinguishable from the live process's in the same daily file, and a restart right after a freeze is exactly when someone reads it; this change will be rebased over PR #382 and run on two rigs, so a log without build identity is misleading; and a reader cannot tell a quiet run from one with reporting effectively disabled unless the effective thresholds are recorded.

## Risks / Trade-offs

- **Log volume** → risk-listed breadcrumbs only, threshold-gated slow logging, daily rotation, 180-day retention, per-day byte cap, and rate-limiting of repeated identical entries.
- **~1 ms `appendFileSync` per breadcrumb on the main thread** → bounded to operator-initiated channels, with a circuit breaker for degraded disks. Measured, not assumed.
- **Decorator alters IPC semantics** → tests for verbatim resolution across all three real envelope shapes, unchanged rejections, synchronous throws, non-promise returns, forwarded arguments, and the preserved duplicate-registration error.
- **False-positive noise erodes trust** → allow-list plus per-channel thresholds; every entry carries channel, invocation id, and duration.
- **Monkey-patching an Electron singleton** → one install function, idempotent, with an uninstall; `handleOnce` is documented as an uninstrumented trip-wire.
- **Concurrent instances share one dated log file** → CI runs four E2E shards per OS, so concurrent appends and retention races must be tolerated rather than assumed away.
- **The hypothesis may be wrong** → accepted, and the point: the instrumentation names whatever the real culprit is.

## Non-Interference and Operator Scope

This change is deliberately developer-facing. It improves the _diagnosis_ of a freeze, not the operator's experience of one: a phenotyper still gets no feedback when the app stops responding, and reading this log requires SSH access. That widens a gap already tracked in #363 (no in-app log viewer; discovery requires SSH-ing to the rig and grepping), and it is accepted here rather than solved.

One asymmetry is worth recording. In the **renderer-blocked** case the main process is alive and could surface a native dialog; in the **main-blocked** case nothing in-process can help, by construction. Operator-facing surfacing is a non-goal of this change.

## Migration Plan

Additive. No schema, config-file, or IPC-contract change. Rollback is reverting the commit; `BLOOM_DIAGNOSTICS=0` also stops new output but is a shell/service-level variable, so it is not reachable for an operator launching the app from a desktop launcher, and it leaves existing files in place.

The only persisted state is `~/.bloom/logs/diagnostics-*.log` plus the crash-dump directory. After a revert these are pruned by nothing — the existing `cleanupOldLogs()` filters on the `graviscan-` prefix and runs only in GraviScan mode — so a revert should delete them manually.

Sequencing against PR #382: that PR touches `pr-checks.yml`, a `docs/superpowers/plans/` file, its own `openspec/changes/` directory, `src/main/graviscan/{register-handlers,scan-coordinator,scanner-handlers,scanner-subprocess,scanner-usb-refresh,session-handlers}.ts`, `src/main/lsusb-detection.ts`, `src/types/graviscan.ts`, and nine test files. This change touches `src/main/main.ts` and four new `src/main/` modules, so the file sets are disjoint, as are the spec capabilities (#382 deltas `scanning/` only). Because #382 rewrites `lsusb-detection.ts` and `scanner-handlers.ts`, this document cites symbols rather than line numbers, which would go stale on merge. Expect to rebase after #382 merges. Note #382 still owes its `/review-pr`, so its Decision 4 could still change.

Also check for overlap on `src/main/main.ts` against the other open PRs that touch it (#237 draft, #227 stale long-running branch), and note that #321 lands another ADDED delta in `ipc-reliability`, which needs ordering at archive time rather than merge time.

## Decided Questions

- **Does the attended reproduction gate merge?** No. #381 criterion 2 — surviving a ≥30 min session — is not achievable by a zero-behaviour-change diagnostic, so it remains #381's to satisfy. #381 stays open on merge, and merging must not be recorded as progress against criterion 2.
- **Should the four synchronous `detectEpsonScanners()` sites be converted straight after #382 merges?** No. Wait for the instrumentation to confirm them, so the fix is evidence-led rather than a second guess. Tracked as the natural follow-up to whatever the attended reproduction shows.
