## Why

`Test - E2E Dev Build` intermittently fails deep into the suite (275+ tests in) with `Worker teardown timeout of 60000ms exceeded`, poisoning every subsequent test in that worker with `Cannot read properties of undefined (reading 'waitForLoadState')` until Playwright starts a fresh worker ([issue #323](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/323)).

Issue #323's own root-causing (a direct A/B comparison between a failing run and a passing run with no overlapping code changes) ruled out any specific PR's changes and pointed at resource accumulation — orphaned Electron Helper and Python (`bloom-hardware`) subprocesses — across the 264 sequential E2E tests run in the single Playwright worker the project's testing strategy requires. Following that lead into the code: `closeElectronApp()`/`waitForProcessExit()` in `tests/e2e/helpers/electron-cleanup.ts` only tracks and force-kills the **main** Electron process PID, never its descendants — a structural gap that plausibly explains the runner's own orphan-cleanup step finding 3+ leftover `bloom-hardware`/`Electron Helper` processes per run.

Worth being precise about what's established versus inferred: the issue's own evidence shows orphan counts on a *passing* run (6+) exceeding a *failing* run (3), so orphan accumulation alone doesn't cleanly predict which run crosses the 60s timeout — this change closes a real, independently-verifiable structural gap (main-process-only cleanup) rather than a proven single root cause, and its actual effect is measured in `tasks.md` section 4 against CI evidence, not asserted here.

## What Changes

1. Fix `closeElectronApp()` in `tests/e2e/helpers/electron-cleanup.ts` to snapshot and force-kill the **direct child processes** of the main Electron PID (Electron Helper, the Python `bloom-hardware` subprocess), not just the main PID itself — see `design.md` Decision 1 for the snapshot-before/kill-after ordering, the exception isolation between the new snapshot step and the existing main-process teardown, the cross-platform kill mechanism, and the PID-recycle guard.
2. Add Playwright's built-in `--shard=N/M` to the `test-e2e-dev` job in `.github/workflows/pr-checks.yml`, splitting the 264-test suite into 4 shards per OS (each shard still running with `workers: 1`, preserving the existing single-worker-per-Electron-instance constraint), and update the job's artifact-upload name to include the shard index (avoiding a name collision once multiple jobs per OS exist). This is a defensive bound, not a fix for the cascade mechanism itself — see "Residual gap" below.
3. Update the `e2e-testing` spec's "Test Cleanup and Isolation" requirement to require descendant-process termination (including the snapshot ordering, the unconditional-even-on-error kill, and the PID-recycle guard) and to cover the per-shard artifact-naming behavior under "CI Integration for E2E Tests".
4. Add a "CI E2E Test Sharding" requirement to the `developer-workflows` spec documenting the shard configuration.

`playwright.config.ts`'s `workers: 1` / `fullyParallel: false` are unchanged — sharding parallelizes across CI jobs, not within a worker.

## Residual gap (not fixed by this change)

Neither the descendant-cleanup fix nor sharding eliminates the *cascade* mechanism itself: if a teardown timeout occurs for any other reason inside a shard, the same `undefined`-reference poisoning of subsequent tests in that shard would still happen. This change reduces the frequency (fix 1) and blast radius (fix 2) of the reported symptom; it is not a guarantee the symptom can never recur. Given issue #323's own framing ("not blocking any specific PR... worth root-causing since it costs wasted CI time"), this is treated as an acceptable, evidence-measured mitigation rather than a claimed complete fix.

## Impact

- Affected specs: `e2e-testing` (MODIFIED), `developer-workflows` (ADDED)
- Affected code:
  - `tests/e2e/helpers/electron-cleanup.ts` — descendant-process snapshot/kill logic
  - `tests/unit/electron-cleanup.test.ts` (new) — unit tests for the snapshot/kill logic against a synthetic process tree, exercised in the actual production call order, including the main-teardown-throws case
  - `.github/workflows/pr-checks.yml` — `test-e2e-dev` job shard matrix and per-shard artifact-upload name
  - `tests/unit/pr-checks-workflow.test.ts` — `WorkflowFile` interface extended to type `strategy.matrix` and `steps`, plus new assertions for the shard matrix and artifact name
- Known gaps, called out rather than silently assumed covered (full detail in `design.md` Decision 1's "Known coverage gaps"): (1) the project's unit-test CI job runs on `ubuntu-latest` only, so the Windows/macOS branches of the descendant-enumeration logic have no automated CI coverage beyond the real E2E job itself — validated only via the manual multi-OS log inspection in `tasks.md` section 4; (2) the unconditional-kill-despite-a-thrown-`close()` path and the PID-recycle name-check are both validated only by synthetic unit tests (or, for the OS-level PID-reuse race itself, only by design reasoning) — neither is something a normal CI run is expected to naturally exercise, since both guard against conditions that are rare by construction
- CI cost: sharding takes `test-e2e-dev` from 3 concurrent jobs to 12 (3 OS × 4 shard), a real (roughly 4x, before accounting for shorter per-shard duration) increase in CI compute minutes for this job, accepted as a tradeoff against the wasted-CI-time cost of the flake itself (see `design.md` Decision 2)
- Not affected: `playwright.config.ts` (worker count), any test's `beforeEach`/`afterEach` call sites (they already call `closeElectronApp()`; the fix is internal to the helper)
