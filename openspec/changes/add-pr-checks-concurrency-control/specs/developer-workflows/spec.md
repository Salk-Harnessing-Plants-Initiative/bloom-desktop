## ADDED Requirements

### Requirement: CI Concurrency Control

The `pr-checks.yml` workflow SHALL declare a top-level `concurrency` group keyed by workflow name and ref, so that redundant runs for the same branch or pull request do not run their full job matrix (including the macOS/Windows-matrixed jobs) in parallel. `cancel-in-progress` SHALL be `true` for `pull_request` events and `false` for `push` events, so that a new commit pushed during PR review cancels the now-stale run for the previous commit, while a burst of pushes directly to `main` queues sequentially instead of running concurrently — eliminating runner contention in all cases. For pushes to `main` spaced far enough apart that no more than one run is ever waiting, this also preserves each commit's completed CI result rather than discarding it. This is a preference, not an absolute guarantee: GitHub Actions concurrency groups hold only one pending run by default, so a third (or later) push to `main` arriving while an earlier push's run is still queued will silently evict that queued run before it starts — runner contention is still avoided (the evicted run never consumes a runner), but that commit will not have a completed CI record.

#### Scenario: A new push to an open PR cancels the previous commit's run

- **GIVEN** a pull request has an in-progress `pr-checks.yml` run for its current head commit
- **WHEN** the author pushes a new commit to the same PR branch
- **THEN** the in-progress run for the superseded commit is cancelled
- **AND** a new run starts for the latest commit

#### Scenario: Concurrent pushes to main queue instead of running in parallel

- **GIVEN** a `pr-checks.yml` run is already in progress for a push to `main`
- **WHEN** a second commit is pushed to `main` before the first run finishes
- **THEN** the second run's jobs do not start executing until the first run completes
- **AND** the first run is NOT cancelled — it runs to completion and reports its own pass/fail result

#### Scenario: A third overlapping push to main can evict a still-pending run

- **GIVEN** a `pr-checks.yml` run is in progress for a push to `main`, and a second push's run is already queued (pending, not yet started) behind it
- **WHEN** a third commit is pushed to `main` before the first run finishes
- **THEN** the second push's still-pending run is cancelled and replaced by the third push's run, per GitHub Actions' default concurrency queue depth of one pending run
- **AND** no additional runner capacity is consumed by the evicted run (it never started), so runner contention is still avoided even though the second commit does not get a completed CI record
- **AND** this scenario is not covered by an automated or manual verification task — it is a documented, accepted limitation of the underlying GitHub Actions behavior (see `design.md`), not independently reproduced in this change's test plan

#### Scenario: Runs for different branches never contend with each other

- **GIVEN** `pr-checks.yml` runs are in progress for two different pull requests (or a pull request and a `main` push)
- **WHEN** both trigger around the same time
- **THEN** each runs independently and neither queues behind nor cancels the other, because their concurrency group keys differ by ref

#### Scenario: The concurrency configuration is enforced by a regression test

- **GIVEN** a developer edits `.github/workflows/pr-checks.yml`
- **WHEN** the edit removes or weakens the `concurrency` block (e.g. drops `cancel-in-progress` or changes the `group` key)
- **THEN** `tests/unit/pr-checks-workflow.test.ts` fails, surfacing the regression before it reaches CI

### Requirement: CI Job Timeout Bounds

The `test-integration`, `test-e2e-dev`, `test-make`, and `test-make-windows` jobs in `pr-checks.yml` SHALL each declare an explicit `timeout-minutes` value, set with headroom above their observed typical duration. Because CI Concurrency Control queues `push`-to-`main` runs behind each other rather than running them in parallel, a hung job can now delay the start of a subsequently-queued `main` commit's entire CI run, not just its own — previously, independent parallel runs meant a hang only affected its own push. Without an explicit bound, that delay could extend up to GitHub's 6-hour per-job default.

#### Scenario: A hung job is terminated instead of blocking the queue indefinitely

- **GIVEN** a `test-e2e-dev` job hangs (for example, its background dev-server process never exits)
- **WHEN** the job's `timeout-minutes` value is reached
- **THEN** GitHub Actions terminates the job and marks the run as timed out
- **AND** a subsequent push to `main` queued behind it is no longer blocked by an indefinite hang once that run concludes (by timeout, rather than never)

#### Scenario: Timeout values leave headroom for normal runs

- **GIVEN** `test-integration`, `test-e2e-dev`, `test-make`, and `test-make-windows` have observed typical durations of roughly 2-4 minutes, 24-34 minutes (with a real non-hung outlier at 46 minutes), 4-6 minutes, and 11 minutes respectively (see `design.md` for the underlying data and its caveats)
- **WHEN** each job runs normally
- **THEN** its configured `timeout-minutes` (15, 90, 20, and 30 respectively) is above the observed range, including the worst real data point found for `test-e2e-dev`
- **AND** a normal run is never falsely terminated for running long

#### Scenario: Timeout values are enforced by the same regression test

- **GIVEN** a developer edits `.github/workflows/pr-checks.yml`
- **WHEN** the edit removes the `timeout-minutes` key from any of the four affected jobs
- **THEN** `tests/unit/pr-checks-workflow.test.ts` fails, surfacing the regression before it reaches CI
