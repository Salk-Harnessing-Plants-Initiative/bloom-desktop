## Context

`scan_worker.py`'s `run()` (lines 234-260) reads stdin one line at a time and only returns to `for line in sys.stdin` once the dispatched handler returns:

```python
for line in sys.stdin:
    ...
    if action == "scan":
        self._handle_scan(cmd)   # blocks for the whole batch
    elif action == "quit":
        break
```

`_handle_scan()` loops over every plate in the batch, checking a `_cancel_requested` flag between plates — but that flag can only be set by `_handle_cancel()`, which itself is only ever invoked from this same loop, so a `cancel`/`quit` command sent by the coordinator while `_handle_scan()` is running sits unread in the stdin pipe until the current plate's `_sane_scan()`/`_mock_scan()` call returns. `stopScanner()` (`scan-coordinator.ts:368-396`) sends `quit()` then force-kills via `SIGKILL` after a fixed 5000ms (`ScannerSubprocess.shutdown()`, `scanner-subprocess.ts:377-411`) — a grace period routine V600 scans commonly exceed. `_sane_scan()` (lines 398-541) writes the captured image directly to the final path:

```python
final_path = compose_output_path(output_path, et)
...
image.save(final_path, "TIFF", compression="tiff_lzw", tiffinfo=tiff_meta)
```

`_mock_scan()` duplicates this same direct-save pattern. A SIGKILL during `image.save()` can truncate this file, leaving invalid data at the exact filename a downstream pipeline expects for that timepoint.

**Confirmed during review**: the existing spec scenario "Scan worker handles cancel during active scan" is exercised only by `test_scan_worker.py::TestCancelMidCycle::test_cancel_mid_scan`, which calls `_handle_cancel()` directly as a mocked side effect rather than through stdin — it never exercises the real blocking-loop race described above, so it gives false confidence about cancel responsiveness. Separately, the cancel branch (`_handle_scan()`'s lines 274-286) emits at most one `scan-cancelled` event before breaking, not one per remaining unscanned plate as the spec's plural wording requires — also uncaught by that same test, since it never inspects emitted events. This proposal does not attempt to fix either underlying gap (see Non-Goals) but notes them rather than silently building on top of them unremarked; a future proposal addressing cancel responsiveness should account for both.

Separately, `scanOnce()`'s row-verification loop (`scan-coordinator.ts:826-875`) skips a row entirely when its promise resolved to `null` (`if (!result) continue;`). Two distinct code paths can produce a `null` result today, and — critically — **they are not equivalent**:

1. `onExit` fires (the subprocess exited/was killed) before `cycle-done`. **Nothing has logged or reported this case at all today.**
2. The per-row `rowTimeout` fires (`SCAN_ROW_TIMEOUT_MS` exceeded) — this branch **already** calls `scanLog()` and emits a `scan-error` event (`scan-coordinator.ts:782-796`) before resolving `null`.

Any fix to the silent-skip behavior must not conflate these two cases, or it will produce a redundant, confusing second log line for a row that was already fully diagnosed by the timeout branch.

**Correction from review (this superseded an earlier, wrong reading of case 1).** An earlier draft of this document attributed case 1 to "a mid-row `stopScanner()` call, most commonly from wedge auto-pause." That is not reachable. `stopScanner()` (`scan-coordinator.ts:389`) calls `sub.removeAllListeners()` **before** `await sub.shutdown()`, which strips the very `exit` listener the row promise registered. On the wedge-auto-pause path (`wiring.ts:285` → `stopScanner()`), the later SIGKILL therefore emits `exit` into a listener-less emitter and the row can only settle by burning the full 90-second `SCAN_ROW_TIMEOUT_MS`. Two consequences, both now fixed rather than documented around:

- The per-plate diagnostic never fired on the path it was designed for — the operator's output was identical to pre-change behaviour.
- Because `Promise.all` awaits every scanner's row, **each wedge auto-pause stalled the entire row for 90 seconds**, delaying every healthy scanner behind the wedged one.

So there are in fact **three** non-`done` ways a row can end, not two, and they need separate names: a spontaneous subprocess death (`exit` — crash, OOM-kill, `killAll()` on app quit), a deliberate coordinator stop (`stopped` — `stopScanner()`, overwhelmingly wedge auto-pause), and the row timeout (`timeout`). See Decision 2.

This gap was invisible to the test suite because `createMockSubprocess`'s `removeAllListeners` was `vi.fn().mockReturnThis()` — a no-op that kept listeners alive, letting tests settle rows through a path production cannot take. The mock now delegates to the real `EventEmitter` implementation.

## Goals / Non-Goals

- Goals:
  - A process termination during a plate's write can never leave a truncated or invalid file at that plate's final output path — only a stray temp file or a complete final file.
  - A row whose subprocess exited before `cycle-done`, outside of a full session cancel, is no longer silently swallowed — it produces a durable, attributable log line, without duplicating the timeout branch's existing diagnostic.
  - This change's own test run reconfirms #281 items 2/3 (already fixed by PR #357). Review established that item 2 is only partly closed by them — the queued-retry path is still unbounded — so #281 closes on what was delivered, with the remainder split out to #366 rather than implied fixed.
  - A stray `.tmp-*` file left behind by an interrupted write is never presented to the operator as if it were real scan data.
- Non-Goals:
  - Making `quit`/`cancel` interrupt mid-batch. See Context — the stdin-reading loop is synchronous and single-threaded; observing a command mid-batch would require moving stdin reads onto a separate thread with its own synchronization against the in-progress scan. That is a materially larger, separately-risky change, and it is not required here: once writes are atomic, the _timing_ of when `quit`/`cancel` is observed no longer affects data integrity, only how much wasted work happens before a stop takes effect (already an accepted cost — see the "5-second USB stagger" and other timing constraints already accepted elsewhere in this capability). The existing cancel-mid-scan test's reachability gap (see Context) is noted, not fixed, here — it is a pre-existing, separable correctness question about `cancel` responsiveness, not a data-integrity risk once writes are atomic.
  - Reconstructing the exact final filename for a `null`-result row to perform a real file-existence check. The coordinator only ever learns a plate's true final path (including the worker's own `_et_` save-time timestamp) from that plate's `scan-complete` event — which, by definition, never arrives for a `null`-resolved row. The existing spec is explicit that the coordinator "SHALL NOT assume the path it sent... is the path that was saved." Any attempt to guess would violate that invariant. The fix here is a log-only diagnostic, not a filesystem check.
  - Cleaning up leftover temp files from a genuinely interrupted write. Out of scope — see Decision 1's residual note.
  - Any change to `WedgeBanner`'s UI (tracked as issue #362, split out of #281 item 2 during this Tier 1 increment's scoping).
  - A renderer-visible, end-of-session count of unverified/skipped plates. See Risks — this is a real, named gap this change does not close, tracked as issue #363 instead of expanding this change's scope into renderer/session-state territory.

## Decisions

### Decision 1: Write-then-atomic-rename in the Python worker

Both `_sane_scan()` and `_mock_scan()` write the captured image to a temporary file in the **same directory** as the final output path (same-directory is required — `os.replace()` is only atomic within a single filesystem/volume), then call `os.replace(tmp_path, final_path)` only after `image.save()` on the temp path returns successfully. `os.replace()` is used instead of `os.rename()` because it succeeds unconditionally on both POSIX and Windows even if a file already exists at the destination (relevant for local Windows dev, even though the production rig is Linux) — this is tested directly (tasks.md 1.3a).

A small shared helper is introduced so both `_sane_scan()` and `_mock_scan()` — which currently duplicate the identical direct-save call — share one code path rather than each hand-rolling the temp-write logic. Signature: `_atomic_image_save(image, final_path, *save_args, **save_kwargs)` — using `*save_args` (not just `**save_kwargs`) because both current call sites pass the format as a **positional** argument (`image.save(final_path, "TIFF", compression=..., tiffinfo=...)`); the helper forwards `*save_args, **save_kwargs` to `image.save(tmp_path, *save_args, **save_kwargs)` unchanged, so call sites don't need to restructure their existing call shape.

Temp filenames use a `.tmp-` prefix plus a UUID (e.g. `.tmp-<uuid4>-<final_basename>`) so a leftover file from a genuinely interrupted write is unambiguously distinguishable from real output at a glance — unlike today's failure mode, where a corrupt file has the exact expected final name.

**A leftover `.tmp-*` file must not be treated as real output by the app itself.** `src/main/graviscan/image-handlers.ts`'s `listScanFiles()` filters candidate files by extension only (`path.extname(subName)`), which does not exclude a `.tmp-<uuid>-<name>.tif` file — its extension is still `.tif`. Without a fix, a stray temp file from a genuinely interrupted write would appear in the renderer's scan file browser indistinguishably from real data, defeating the "unambiguously distinguishable" claim above. **Fix, in scope**: `listScanFiles()` additionally excludes any filename starting with `.tmp-` (a one-line change, consistent with this change's own naming convention — see tasks.md 1.7).

**Residual, accepted limitation**: a leftover `.tmp-*` file from a truly interrupted write is not cleaned up by this change, and (per the fix above) is now also invisible to the app's own file listing — it will only ever be found via direct filesystem inspection. This is deliberate — adding a startup sweep or retention policy is speculative complexity not asked for by the issue; if stray temp files become a real operational nuisance on the rig, that is a separate, better-informed follow-up.

**`os.replace()` failure after a successful save.** If `image.save()` to the temp path succeeds but the subsequent `os.replace()` raises (e.g. a permissions error, or a lingering file handle on Windows), `_atomic_image_save()` does not catch this — the exception propagates up through `_scan_plate()`'s existing `try/except` in `_sane_scan()`'s per-attempt retry loop (`MAX_RETRIES` with backoff), exactly as any other scan failure already does today. No new error-handling path is needed: this failure mode was already structurally covered by the existing retry loop once `_atomic_image_save()` is a normal function call inside it. Tested explicitly (tasks.md 1.3b) rather than left as an unstated assumption.

### Decision 2: Log-only diagnostic for a `null` result caused by subprocess exit — NOT for a `null` result caused by row timeout

`scanOnce()`'s per-scanner promise construction (`scan-coordinator.ts:756-800`) is extended so each row promise resolves to a **discriminated** result instead of a bare `null`:

```ts
type RowOutcome =
  | { scannerId: string; outputPaths: {...}[] }   // cycle-done (success)
  | { scannerId: string; rowPlates: PlateConfig[]; reason: 'exit' }     // onExit fired
  | { scannerId: string; rowPlates: PlateConfig[]; reason: 'timeout' }; // rowTimeout fired
```

(`rowPlates` — the plates assigned to this scanner for this row — is already available in the enclosing loop and simply needs to be captured into the `onExit`/`rowTimeout` resolution instead of discarded.)

In the verification loop, a `reason: 'timeout'` entry is handled exactly as today (the `rowTimeout` branch's own `scanLog()` + `scan-error` already ran at the moment it fired — the verification loop does nothing further for it, avoiding a duplicate). A `reason: 'exit'` entry, when `this.cancelled` is `false`, now logs one line per expected plate via `scanLog()`:

```
[<scannerId>] Cycle <cycle>: row verification skipped for plate <plateIndex>: no completion signal received (subprocess exited mid-row) — output presence unknown
```

Cycle number (`this.currentCycle`, already in scope at this point in `scanOnce()`) is included because the session's live job-tracking (`session-handlers.ts`'s `jobs` map, keyed by `` `${scannerId}:${plateIndex}` `` with no cycle component) cannot otherwise disambiguate which cycle's occurrence of that plate this diagnostic refers to across a multi-day interval session — this log line is, in the exit case, the _only_ durable record that plate's outcome is unknown, so it must be self-sufficient to reconstruct later.

No `scan-error` event is emitted for the `reason: 'exit'` case (unlike the existing missing-file/zero-size branches a few lines below, and unlike the `reason: 'timeout'` case, both of which do emit `scan-error`). This is deliberate: emitting a synthetic `scan-error` here would feed back into `WedgeDetector`'s `scan-error` subscription for a scanner that, in the common case, was _already_ correctly auto-paused by that same detector — a second, coordinator-synthesized error for the same underlying wedge risks a confusing double-signal rather than new information.

**The per-iteration `!this.cancelled` guard was removed (correction from review).** An earlier draft claimed `this.cancelled` "is always `false` in practice" within the row-results loop and used that to justify leaving the branch untested. That reasoning was wrong: the loop `await`s `fs.promises.access`/`stat` (`scan-coordinator.ts:851,864`) **inside** the same `for (const result of results)` body, and each `await` yields to the event loop, letting the synchronous `cancelAll()` IPC handler run. With `results = [scanner-1 done, scanner-2 exit]`, a cancel landing during scanner-1's filesystem check suppressed scanner-2's diagnostic entirely — so whether a plate's unknown outcome was recorded depended on nothing more than its position in the array.

The outer `if (this.cancelled) break;` (`:815`) still handles the real case the guard was meant for: a cancel that arrives before the verification loop begins skips it wholesale. The only remaining way the flag flips mid-loop is a cancel arriving _after_ a row's outcome was already determined — and in that case the plate's outcome genuinely is unknown and deserves its line. The diagnostic emits no `scan-error`, so recording it on a session the operator then cancelled is harmless. A test now covers exactly this interleaving.

### Decision 3: Light regression coverage for #281 items 2/3

Add or confirm two small tests in `tests/unit/graviscan/scan-coordinator.test.ts`:

1. Two concurrent `addScanner()` calls for the same idle `scannerId` still produce exactly one subprocess (the `spawnInFlight` guard holds).
2. A spawn that never emits `ready` is bounded by `SPAWN_READY_TIMEOUT_MS` and reported via a `scanner-init-status: error` event, not an indefinite hang.

These re-confirm already-merged behavior (PR #357) rather than introduce new behavior — kept intentionally light, since `fix-graviscan-scanner-init-race`'s own test suite already covers this thoroughly. The purpose is narrow: this PR's own test run should demonstrate that #281's items 2/3 have not regressed, not re-derive full coverage of a different change. (It does not demonstrate #281 is closed in full — see Goals and #366.)

## Risks / Trade-offs

- Extra disk I/O for the temp-write + rename vs. a direct write — negligible relative to a multi-second SANE scan.
- Leftover `.tmp-*` files from a **SIGKILL** are not cleaned up (accepted, Decision 1) — a killed process runs no handler — but are now excluded from the app's own file listing, so they can't be mistaken for real data within the app. **Handled** failures (save error, rename error) now do clean up before propagating: review noted that `_sane_scan()` retries a failed plate up to `MAX_RETRIES` times with a fresh temp name each attempt, so leaking on a _handled_ error would strand up to five full-resolution TIFFs per plate — invisible, since the app hides the prefix, and unbounded across a multi-day run. The two in-repo precedents for this pattern (`cylinderscan/scan-metadata-json.ts:130-140`, `database-handlers.ts:1413-1421`) both clean up; diverging from them here was not justified.
- These temp files are **dotfiles**, so they are hidden from `ls`, shell globs, and Python's `glob.glob('*.tif')` as well as from the app. That is deliberate (it also shields any downstream pipeline that globs the scans directory) but it means "distinguishable at a glance" requires `ls -a`. Worth a line in the Tier 2 cutover runbook so a stray-file sweep is an operational step rather than a surprise.
- No disk-space check exists anywhere in the codebase, so nothing warns before the scans volume fills. Residual `.tmp-*` files are produced per _kill_, not per cycle, so the accumulation rate is bounded by how often scanners wedge — but it is unbounded over time.
- `os.replace()`'s atomicity guarantee depends on the temp and final paths sharing a filesystem/volume — guaranteed here since both are written to the same directory.
- `os.replace()` on Windows can raise `PermissionError` if a lingering file handle (e.g. antivirus/indexer, or a test that left a file open) holds the source or destination. This is a known-flaky-on-Windows-only area (already present in this test suite's pre-existing, unrelated `TestMockScanTiffMetadata` teardown failures) and does not affect the production rig (Linux). No retry logic is added for this in Windows local dev — not worth the complexity for a non-production environment.
- **Power loss vs. process kill.** `os.replace()` alone makes the rename atomic, not durable: without an `fsync` the rename can be journaled while the data blocks are not, leaving a zero-length file at the final path after a power cut. ext4's `auto_da_alloc` heuristic does not rescue this, since it fires on rename-over-an-existing-file and the `_et_`-stamped destination never pre-exists. The spec's guarantee was scoped to process termination, so this was not an overclaim — but "atomically renamed" reads stronger than that, and the target is an unattended multi-day rig, so the `fsync` is now done rather than documented around.
- **A scanner paused for the rest of a session is still entirely unlogged** (pre-existing, not introduced here). `stopScanner()` deletes the entry from `this.subprocesses`, and `scanOnce()` iterates that live map — so from the _next_ row group onward a paused scanner's plates produce no promise, no outcome, and no log line at all, not even a timeout. On a 24-hour session where a wedge pauses a scanner early and the banner is missed, that is the dominant silent-loss case, larger than the one this change closes. Belongs to #363 and is now named in its text rather than left implicit.
- **Named, accepted gap**: the log-only diagnostic (Decision 2) gives zero _live-session_ signal — no banner, no event — for a `reason: 'exit'` row outside the common wedge-auto-pause case (e.g. an unhandled Python exception, an OOM kill, or a manual `stopScanner()` call unrelated to a wedge). An operator could complete a multi-day session with several silently-missing plates and only discover it when reviewing logs afterward. This is a real limitation for a feature explicitly framed as data-loss-prevention, and is not fixed here — building a renderer-visible "N plates unverified this session" indicator would require touching session-state aggregation and renderer UI, which is out of scope for a change focused on the write-path/backend data-integrity fix. **Filed as issue #363** rather than silently accepted (matching this Tier 1 increment's established pattern of splitting out real-but-separable gaps, as already done for issue #362).

## Migration Plan

No data migration, schema change, or config change. Existing in-flight scans are unaffected — this is a pure code change to the write path, one filter-list exclusion, and a logging addition. Rollout is a normal PR merge; no rollback complexity beyond reverting the PR.
