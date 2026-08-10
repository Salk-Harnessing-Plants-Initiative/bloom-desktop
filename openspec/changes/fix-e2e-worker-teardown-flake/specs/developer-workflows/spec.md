## ADDED Requirements

### Requirement: CI E2E Test Sharding

The `test-e2e-dev` job in `pr-checks.yml` SHALL split its E2E test suite across 4 Playwright shards per operating system, using `--shard=N/4`, so that no single Playwright worker process (which the `e2e-testing` capability requires to run with `workers: 1`) accumulates more than roughly a quarter of the suite's sequential Electron-app launches before the worker process exits. This bounds the worst-case impact of any resource accumulation (memory, file handles, orphaned descendant processes) across a long-running worker, independent of and in addition to the descendant-process cleanup fix in the `e2e-testing` capability.

#### Scenario: E2E suite runs as 4 shards per OS

- **GIVEN** the `test-e2e-dev` job's matrix includes `os: [ubuntu-latest, macos-latest, windows-latest]`
- **WHEN** the job matrix is evaluated
- **THEN** it SHALL also include a `shard` dimension of `[1, 2, 3, 4]`
- **AND** each resulting job SHALL invoke Playwright with `--shard=<shard>/4`

#### Scenario: Each shard remains within the existing job timeout

- **GIVEN** the `test-e2e-dev` job's existing `timeout-minutes: 90` bound (see "CI Job Timeout Bounds")
- **WHEN** a shard runs roughly a quarter of the 264-test suite
- **THEN** its expected duration (a few minutes to ~15 minutes under typical conditions) remains well inside the 90-minute bound, preserving headroom even for a degraded run

#### Scenario: Shard configuration is enforced by a regression test

- **GIVEN** a developer edits `.github/workflows/pr-checks.yml`
- **WHEN** the edit removes the `shard` matrix dimension from `test-e2e-dev`, or changes the shard count without updating the corresponding `--shard=N/M` invocation
- **THEN** `tests/unit/pr-checks-workflow.test.ts` fails, surfacing the mismatch before it reaches CI
