## Context

`tests/e2e/helpers/electron-cleanup.ts` was introduced in `fix-e2e-test-cleanup-race-condition` to fix a *different* problem: `electronApp.close()` returning before the main process fully exits. That fix polls `isProcessRunning(pid)` for the main PID and SIGKILLs it after 5s. It never looked at descendants because the race condition it was fixing was specifically about the main process. Issue #323 is a distinct failure mode in the same file: descendants of that main PID (Electron Helper, and the Python `bloom-hardware` subprocess spawned directly by `initializePythonProcess()`/`spawn()` in `app.on('ready', ...)` — confirmed a flat, one-level fan-out, not a deep process tree) are never tracked or killed at all, so they can outlive the test that spawned them.

This design has been through three review rounds. Round 1 caught a sequencing bug (Rejected approach 1). Round 2 caught three further issues in the round-1 fix (Rejected approach 2, the PID-reuse gap, the try/catch-placement gap) — all addressed. Round 3 caught that the round-2 fixes themselves left two gaps: the *new* snapshot call had no exception handling of its own, and the test added to prove the kill call survives a thrown main-teardown never actually exercised `closeElectronApp()`'s real control flow. Both are addressed below, along with a should-fix (batching the re-verification query) and disclosure of what's validated only by synthetic tests.

## Decision 1: Snapshot descendants (PID + name) while the main process is still alive; kill them unconditionally after, by PID+name match

**Rejected approach 1 (round 1): enumerate descendants after confirming the main process exited.** Doesn't work on either platform: POSIX reparents a dead parent's still-living children (to PID 1 or a subreaper) as part of that exit, so a `ps` snapshot taken afterward shows `ppid=1`, not `ppid=<mainPid>` — the descendant walk finds nothing. On Windows, `taskkill /PID <pid> /T /F` needs the target PID to still exist to identify its tree; if main was already force-killed, it fails with "process not found."

**Rejected approach 2 (round 2): use `taskkill`/an `execFile`-shelled command as the Windows-specific kill mechanism.** The existing, unchanged `waitForProcessExit()` force-kill fallback (`electron-cleanup.ts:103`, `process.kill(pid, 'SIGKILL')`) is not platform-gated and already relies on Node's documented Windows behavior: `SIGKILL` on Windows unconditionally terminates the target process via `TerminateProcess`, for any PID in the same session with normal permissions. The kill step is now identical on both platforms; the only genuine platform difference is *enumeration*.

**Corrected approach — control-flow shape (round 3 fix: exception isolation):**

```
closeElectronApp(electronApp, options):
  if !electronApp: return

  descendants = []
  try:
    pid = electronApp.process()?.pid
    if pid: descendants = snapshotDescendants(pid)   # own try/catch INSIDE snapshotDescendants; returns [] and logs a warning on any failure — never throws
  catch:
    # defensive only; snapshotDescendants should already have swallowed its own errors.
    # This outer catch exists so that even a bug in that swallowing can't propagate here.

  try:                                                 # EXISTING, UNCHANGED main-process teardown
    pid = electronApp.process()?.pid
    await electronApp.close()
    if pid: await waitForProcessExit(pid, timeout, verbose)
  catch (error):
    # EXISTING, UNCHANGED — logs a warning if verbose, continues

  await killDescendants(descendants, verbose)          # UNCONDITIONAL — runs whether the block above threw or not, and even if `descendants` is [] because the snapshot failed. killDescendants has its own per-PID try/catch and never throws.
  await sleep(500)                                     # EXISTING, UNCHANGED
```

This shape directly resolves the two round-3 findings:
- **Snapshot exception safety:** the snapshot's own try/catch is entirely separate from, and precedes, the existing main-process try/catch. A failure while enumerating descendants (spawn failure, missing `ps`/`powershell.exe`, permission error, malformed output) is caught *inside* `snapshotDescendants()` itself, logged, and degrades to `descendants = []` — it can no longer prevent `electronApp.close()` from being called. This is strictly no worse than the pre-existing main-process-only behavior in the failure case, and is the intended fix, not just documentation of intent.
- **Kill-call placement:** `killDescendants()` sits after both try/catch blocks, unconditionally, exactly as decided in round 2 — nothing here changes that; the fix above only isolates the *new* snapshot call, which round 2 had not yet placed correctly.

1. **Snapshot** (`snapshotDescendants(pid)`), called immediately after capturing `pid`, inside its own try/catch, before `electronApp.close()` — while the parent-child relationship is still queryable:
   - **macOS/Linux:** `ps -eo pid,ppid,comm` (skip the header row; both GNU ps and BSD-derived ps support `-e -o pid,ppid,comm`), filter to rows where `ppid` matches the main PID, recording `{pid, name}`.
   - **Windows:** `Get-CimInstance Win32_Process -Filter "ParentProcessId=<pid>"` projecting `ProcessId, Name`, via `execFile('powershell.exe', [...])` with argument arrays.
   - On any error (non-zero exit, empty/malformed output, `execFile` failure), catch it, log a warning, and return `[]`.
2. Proceed with the existing, unchanged main-process teardown (`electronApp.close()` → `waitForProcessExit()`).
3. **Kill** (`killDescendants(descendants)`), unconditional, after both of the above: for each `{pid, name}` still running (`isProcessRunning(pid)`), re-verify the current name and `process.kill(pid, 'SIGKILL')` if it still matches; skip (don't kill) if the name no longer matches (see "PID-reuse" below). Catch and ignore errors per PID, isolated so one failure doesn't block the rest.

**Batched re-verification (round 3 should-fix):** re-reading each descendant's current name individually before killing it would mean N separate `execFile` calls (one `powershell.exe`/`ps -p` invocation per descendant) in addition to the one snapshot call. Since the snapshot already has all the PIDs, the re-verification is instead done as a single batched query — `ps -eo pid,comm` filtered locally to the snapshotted PIDs (POSIX), or one `Get-CimInstance Win32_Process -Filter "ProcessId=X or ProcessId=Y"` (Windows) — one round-trip regardless of descendant count, rather than N+1 total spawns. This was assessed in round 3 as not a correctness issue (the per-PID version would have worked, just cost tens of extra milliseconds per test on Windows), but it's free to do better at equal implementation complexity, so it's adopted here.

**Why the name re-check matters (PID-reuse / TOCTOU):** the snapshot happens before `close()`; the kill happens after `waitForProcessExit()` resolves — a gap of up to several seconds. `isProcessRunning(pid)` only checks liveness at a PID number, not identity. Re-checking the process name immediately before killing closes the realistic case of this window (a different-named process now holding the PID) without needing to be airtight against a true same-name collision in the same instant, which is an accepted residual risk. Note this mitigation is itself non-atomic (liveness-check → name-check → kill are three separate operations, each a smaller TOCTOU window) — it narrows the original multi-second race to a sub-millisecond one, it does not eliminate the category entirely; accepted as a reasonable reduction, not a guarantee.

**What's testable versus what isn't (round 3 correction to round 2's framing):** true OS-level PID reuse — the kernel actually recycling a specific PID number within the snapshot-to-kill window — cannot be deterministically reproduced in a unit test and is not covered by one; it's mitigated by the design reasoning above, not verified by a test. This is different from, and should not be confused with, the **name-mismatch-skip logic itself** (given a live PID whose current name differs from its snapshotted name, skip killing it) — that comparison is ordinary application logic with no OS-race dependency, and *is* directly unit-testable by stubbing the name-read step to return a mismatched string against a real still-running synthetic process. Round 2's design notes incorrectly implied the whole behavior was untestable; `tasks.md` now includes a test for the testable part.

**Alternatives considered:**
- *`tree-kill` npm package* — handles snapshot+kill directly. Rejected to stay consistent with this file's existing hand-rolled, no-dependency style.
- *POSIX process-group kill (`process.kill(-pid, 'SIGKILL')`)* — only correct when the spawned process is its own group leader, which isn't guaranteed here. Rejected as unreliable.
- *Windows `taskkill /PID <pid> /T /F` run before `electronApp.close()`, as the sole Windows mechanism* — dodges the round-1 ordering bug, but keeps Windows and POSIX structurally different and doesn't compose as cleanly with the exception-isolation shape above. Rejected in favor of the uniform snapshot-before/kill-after shape.

**Verification:** `tests/unit/electron-cleanup.test.ts` covers, against a synthetic process tree (root `node -e` process with 2 direct children):
- snapshot-while-alive, then production-order kill (snapshot → kill root → kill descendants)
- a descendant that already exited on its own between snapshot and kill (no throw)
- a live descendant whose current name no longer matches its snapshotted name (skipped, not killed) — the testable part of the PID-reuse mitigation, per the correction above
- zero-descendants case
- **the actual `closeElectronApp()` function itself**, called with a stub `electronApp` object (`{ process: () => ({ pid }), close: () => Promise.reject(...) }`) rather than only the standalone snapshot/kill functions in isolation — asserting descendants are still killed when `close()` rejects. This closes the round-3 finding that testing the kill function directly (analogous-but-not-identical to a real throw) doesn't prove `closeElectronApp()`'s own try/catch boundary is wired correctly.
- the same stub-`electronApp` approach, but with the snapshot step forced to fail (via a test-only injection point/mock) and a normally-resolving `close()` — asserting `electronApp.close()`/`waitForProcessExit()` still run despite the snapshot failure, proving the exception-isolation shape above.

This is a fast, deterministic proxy — it does not by itself prove the real Electron+Python tree is fully cleaned up in CI (see `tasks.md` section 4), and it cannot deterministically reproduce true PID reuse (mitigated by design, not covered by a test, per the correction above).

**Known coverage gaps — disclosed explicitly rather than left implicit:**
1. The project's `test-unit` CI job (Vitest) runs on `ubuntu-latest` only. The Windows `Get-CimInstance` enumeration branch and macOS-specific `ps` behavior have no automated CI coverage from the unit test; they are only exercised for real by the actual `test-e2e-dev` job on those OSes, validated only via the manual log inspection in `tasks.md` section 4.
2. The unconditional-kill-despite-a-thrown-main-teardown behavior is validated only by the stub-based unit test above, never by real CI evidence — a genuine `electronApp.close()` throw is not something normal CI runs are expected to produce, so this path's real-world correctness rests on the unit test and code review, not observed CI behavior.
3. The PID-recycle name-check has no *CI* coverage at all (by construction — true PID reuse can't be forced), and only partial *unit-test* coverage (the name-mismatch-skip logic is tested; the OS-level race that triggers it in production is not). This is a residual-risk acceptance, consistent with items 1-2 above, not a new category of gap — but called out here explicitly rather than left implicit in Decision 1's prose alone.

## Decision 2: Shard count = 4

264 tests currently run in one 24–46 minute job per OS (see `developer-workflows` spec's "CI Job Timeout Bounds" requirement for the underlying duration data: 24-34 min typical, up to 46-51 min observed in a degraded run). Quartering the suite (`--shard=1/4` .. `4/4`) targets ~66 tests and ~6-13 minutes per shard in the typical case, comfortably inside the existing 90-minute `test-e2e-dev` timeout even if a shard hits several times its typical duration. This is a defensive bound, not the primary fix — see `proposal.md`'s "Residual gap" note for what it does and doesn't cover.

Playwright's `--shard` balances by test count across files (not just file count), so the existing uneven per-file test distribution (2 to 68 tests per file) does not require adding `@tag` annotations first.

4 was chosen over higher shard counts to bound the matrix job multiplication (`os` × `shard` = 3 × 4 = 12 concurrent jobs instead of 3) without excessively multiplying fixed per-job overhead (Node/Python/browser setup, ~2-3 min each) relative to the time saved. This is a real, non-trivial increase in CI compute minutes for this job (roughly 4x, before accounting for shorter per-shard duration) — accepted here because the job is already the largest single source of intermittent CI failures per issue #323, but noted explicitly since a recent related change (`add-pr-checks-concurrency-control`) was specifically about reducing runner contention/cost, and this change moves in the opposite direction for this one job. Applying sharding uniformly across all three OSes (rather than only `macos-latest`, where the issue's failures were actually observed) is a deliberate broadening: the single-worker-per-instance constraint and the underlying leak mechanism are not macOS-specific, so bounding worst-case accumulation on Linux/Windows too is consistent, but it is a judgment call beyond what issue #323 specifically evidenced.

## Decision 3: Per-shard artifact upload names

`pr-checks.yml`'s existing `Upload Playwright test results` step names its artifact `playwright-results-${{ matrix.os }}` (keyed only by OS). `actions/upload-artifact@v4` errors on duplicate artifact names within a single workflow run (no automatic merging, unlike v3). Once sharding adds a `shard` matrix dimension, two or more shards on the same OS can fail in the same run, and the second-to-report upload would fail with a name conflict. The artifact name is changed to `playwright-results-${{ matrix.os }}-${{ matrix.shard }}` as part of this change (see `tasks.md` 2.3).

## Verification approach for the CI config change

Unlike Decision 1, the shard matrix cannot be meaningfully unit-tested for *effect* (only for *shape*, via `tests/unit/pr-checks-workflow.test.ts`). Confidence that it actually reduces wall-clock time and caps accumulation comes from a real CI run on the PR branch, checked manually per `tasks.md` section 4 against the same evidence standard issue #323 itself used — multiple runs, the actual reported symptom, and citations precisely attributed to the run they actually came from (see `tasks.md` 4.2's note on tracking distinct metrics separately and not overstating precision on truncated log excerpts).
