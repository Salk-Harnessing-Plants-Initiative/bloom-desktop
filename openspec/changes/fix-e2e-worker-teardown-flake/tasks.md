## 1. Descendant-process cleanup fix

Commit as one unit (1.1-1.10) — 1.1-1.7 are intentionally failing tests, not independently mergeable.

- [x] 1.1 Write `tests/unit/electron-cleanup.test.ts`: spawn a synthetic process tree matching the real flat fan-out (one root `node -e` process with 2 direct children, representing Electron Helper + the Python subprocess — not a deep chain). Snapshot the children's `{pid, name}` while the root is alive. Assert all 3 PIDs are running and the snapshot recorded the correct 2 child PIDs with names. This test SHALL fail at this point because the snapshot function does not exist yet.
- [x] 1.2 In the same file, add the **production-order** case: with the snapshot already taken (from 1.1), kill the root process, _then_ call the new (not-yet-implemented) descendant-kill function against the pre-snapshotted `{pid, name}` list, and assert both former children are no longer running. This test SHALL fail (function undefined / not implemented).
- [x] 1.3 Add a case for a descendant PID that already exited on its own between snapshot and kill — assert the kill step does not throw/reject and does not affect the other still-running descendant. This test SHALL fail for the same reason as 1.2.
- [x] 1.4 Add a case for the PID-recycle name-mismatch-skip logic: with a still-running descendant, stub/override the "read current process name" step so it returns a different name than the one recorded at snapshot time, and assert the kill step does NOT kill that PID (the process is still running afterward) while still handling any other, matching descendants normally. This is the deterministically-testable part of the PID-reuse mitigation (the name-comparison logic itself, not the OS-level race that would trigger it in production — see `design.md` Decision 1's "What's testable versus what isn't"). This test SHALL fail for the same reason as 1.2.
- [x] 1.5 Add a case for a root PID with zero descendants (snapshot returns an empty list) — assert the kill step resolves without error. This test SHALL fail for the same reason.
- [x] 1.6 Add a case for the standalone kill function's resilience to an upstream rejection: call it after a root-kill helper that itself rejects, and assert the kill function still runs and kills the pre-snapshotted descendants. This test SHALL fail for the same reason.
- [x] 1.7 Add two **end-to-end wiring** cases against the real, exported `closeElectronApp()` itself (not the standalone snapshot/kill functions in isolation — this is what closes the round-3 finding that 1.1-1.6 alone can't catch a wiring mistake inside `closeElectronApp()`):
  - a stub `electronApp` object (`{ process: () => ({ pid: <syntheticRootPid> }), close: () => Promise.reject(new Error('boom')) }`) passed into the real `closeElectronApp()`: assert it resolves (doesn't throw) and the synthetic descendants are dead afterward, proving the kill call survives a real thrown `close()`.
  - the same stub approach but with a normally-resolving `close()`, and the snapshot step forced to fail (via a test-only mock/injection point on the snapshot function): assert `close()` and the process-exit wait still ran (the synthetic root process is dead afterward) despite the snapshot failure, proving a snapshot error can't skip main-process teardown.
    Both cases SHALL fail at this point since `closeElectronApp()` doesn't yet call either new function.
- [x] 1.8 Implement in `tests/e2e/helpers/electron-cleanup.ts`:
  - `snapshotDescendants(pid)`: on macOS/Linux, run `ps -eo pid,ppid,comm` (skip the header row), filter to direct children of `pid`, recording `{pid, name}`; on Windows, run `Get-CimInstance Win32_Process -Filter "ParentProcessId=<pid>"` projecting `ProcessId, Name` via `execFile('powershell.exe', [...])` with argument arrays. Wrap the whole function body in its own try/catch: on any error, log a warning (if verbose) and return `[]` — this function must never throw.
  - `killDescendants(descendants)`: batch-re-verify all still-running (`isProcessRunning`) descendants' current names in a single query (one `ps -eo pid,comm` call filtered locally to the snapshotted PIDs, or one `Get-CimInstance ... -Filter "ProcessId=X or ProcessId=Y"` — not one call per PID), skip any whose current name no longer matches its snapshotted name, and `process.kill(pid, 'SIGKILL')` (cross-platform, no `taskkill`/`execFile` needed for the kill itself) the rest. Catch and ignore errors per PID, isolated so one failure doesn't block the rest — this function must never throw.
  - Run `npm run test:unit` (the full unscoped suite) and confirm 1.1-1.6 now pass.
- [x] 1.9 Wire into `closeElectronApp()` per the control-flow shape in `design.md` Decision 1:
  - call `snapshotDescendants(pid)` in its own try/catch, immediately after capturing `pid`, before `electronApp.close()` — separate from, and preceding, the existing try/catch around `electronApp.close()`/`waitForProcessExit()` (which is otherwise unchanged).
  - call `killDescendants(descendants)` unconditionally, after both of the above, alongside the existing unconditional `sleep(500)` — so it always runs whether or not the main-process teardown or the snapshot threw.
    Re-run `npm run test:unit` (full suite) and confirm 1.7's two end-to-end cases now pass, with no regression elsewhere.
- [x] 1.10 Run `npm run lint` and `npx tsc --noEmit` (or the project's typecheck command) on the modified/new files.

## 2. CI E2E sharding

Commit as one unit (2.1-2.4).

- [x] 2.1 Extend `tests/unit/pr-checks-workflow.test.ts`'s `WorkflowFile` interface (currently only types `concurrency` and `jobs: Record<string, {'timeout-minutes'?: number}>`) to also type `strategy: { matrix?: Record<string, unknown> }` and `steps: Array<{ run?: string; with?: Record<string, unknown>; [k: string]: unknown }>` on job entries. Run `npx tsc --noEmit` on this file immediately to confirm the interface change alone typechecks, before writing any assertions against it.
- [x] 2.2 Add a new `describe` block asserting: the `test-e2e-dev` job's `strategy.matrix` includes `shard: [1, 2, 3, 4]`; the Playwright invocation step(s) for that job pass `--shard=${{ matrix.shard }}/4`; and the `Upload Playwright test results` step's artifact `name` includes both `${{ matrix.os }}` and `${{ matrix.shard }}` (not just `matrix.os`). These tests SHALL fail at this point since the workflow file hasn't changed yet.
- [x] 2.3 Edit `.github/workflows/pr-checks.yml`:
  - add `shard: [1, 2, 3, 4]` to `test-e2e-dev`'s `strategy.matrix`
  - append `-- --shard=${{ matrix.shard }}/4` (or the npm-script-appropriate equivalent) to both the Linux (`xvfb-run ... npm run test:e2e`) and macOS/Windows (`npm run test:e2e`) invocations
  - change the `Upload Playwright test results` step's artifact `name` from `playwright-results-${{ matrix.os }}` to `playwright-results-${{ matrix.os }}-${{ matrix.shard }}`
  - Re-run 2.2 and confirm it passes.
- [x] 2.4 Run `npx js-yaml .github/workflows/pr-checks.yml` (or equivalent) to confirm the edited workflow file still parses as valid YAML.

## 3. Spec and validation

- [x] 3.1 Run `openspec validate fix-e2e-worker-teardown-flake --strict` and resolve any issues.

## 4. Manual CI verification (not automatable in a unit test — treat as a hard gate, not optional)

This change is NOT complete until this section is done — green unit tests alone are not sufficient evidence, per the same evidence-based standard issue #323 itself used (it compared multiple runs before drawing conclusions, not one). Note also that this section cannot exercise two of the behaviors added above: the unconditional-kill-despite-a-thrown-close() path and the PID-recycle name-check are validated only by the unit tests in section 1 (see `design.md` Decision 1's "Known coverage gaps") — a normal CI run isn't expected to naturally trigger either rare condition.

- [ ] 4.1 Push the branch and open the PR; confirm the `test-e2e-dev` job now runs as 12 jobs (3 OS × 4 shards) instead of 3, and that each shard completes well inside the 90-minute timeout, with no artifact-upload name-collision errors even when multiple shards on the same OS fail.
- [ ] 4.2 For each of the 3 OSes, inspect **at least 2 separate runs** (e.g., the initial push and one re-run, mirroring issue #323's own "Run 1 / Run 2 re-run, same commit" practice) and record, inline in this file or the PR description, the specific job-run URLs together with two _separately tracked_ metrics — do not blend them into one range: (a) the count of orphaned `bloom-hardware`/`Electron Helper` processes reported by the runner's "Cleaning up orphan processes" step, and (b) the count of `Worker teardown timeout` events in the full job log.

  Baseline from issue #323, cited precisely (do not attach numbers to runs that don't report them, and don't overstate precision on a truncated log excerpt):
  - PR #320 run `93291576164` (died 42m43s) and run `93310374389` (died 51m51s): each died from a teardown-timeout event (that's why the run died), but the issue does not report an explicit orphan count for either — do not cite an orphan number against these two run IDs.
  - A third, later PR #320 occurrence, described only in prose in the issue's follow-up comment with **no job-run URL given**: 8 separate teardown-timeout events and 3 `bloom-hardware` orphans (both figures explicitly stated in the comment's prose, not just read off the log excerpt).
  - PR #321 run `93292557225`: passed cleanly, 0 teardown-timeout events (inferred from "passed cleanly," not an explicit count), and 6 `bloom-hardware` orphans (explicitly confirmed via the comment's prose comparison "6, vs. 3 on PR #320's failing run") plus at least 1 `Electron Helper` orphan (this second figure is read off a log excerpt truncated with `...` and has no corroborating prose total — treat it as a lower bound, not a settled count, and don't rely on its exact value for anything).

- [ ] 4.3 Confirm both metrics from 4.2 are at or near zero across the inspected runs for all three OSes before checking this task off. Note that for Linux/Windows, where issue #323 never observed the bug in the first place, "near zero" mainly confirms the new platform-specific code (Windows `Get-CimInstance` enumeration, in particular — it has no automated unit-test CI coverage per `design.md`'s "Known coverage gaps") runs without erroring, not that the fix measurably reduced a flake rate that was never observed there. If either metric is still nonzero on macOS specifically, treat as a new finding — link the run URL and open a follow-up rather than closing this out as fixed.
