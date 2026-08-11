## MODIFIED Requirements

### Requirement: Test Cleanup and Isolation

The system SHALL ensure E2E tests clean up resources and do not interfere with each other, including proper process termination verification for both the main Electron process and its direct children, plus (for a child that looks like it may itself relaunch as a further process) that child's own children.

#### Scenario: App closes after test

- **GIVEN** an E2E test has completed (afterEach hook)
- **WHEN** cleanup runs
- **THEN** the Electron app SHALL be closed via `closeElectronApp()` helper
- **AND** the helper SHALL wait for the Electron main process to fully terminate
- **AND** the helper SHALL timeout after 5 seconds if the main process doesn't exit gracefully

#### Scenario: Descendant processes are snapshotted before the main process exits

- **GIVEN** an E2E test's Electron instance has spawned descendant processes (Electron Helper processes, and the Python `bloom-hardware` subprocess, which may itself run as a further child process rather than in-process)
- **WHEN** `closeElectronApp()` begins cleanup
- **THEN** the helper SHALL enumerate every direct child PID of the main process, together with each child's process name, **before** requesting the main process to close
- **AND** for any direct child whose process name indicates it may itself relaunch as a further process (e.g. `bloom-hardware`), the helper SHALL also enumerate that child's own children
- **AND** the helper SHALL NOT enumerate further descendants of a direct child that does not match that pattern (e.g. Electron's own Helper/GPU processes), since this code has no detailed knowledge of Electron's internal process relationships

#### Scenario: Descendant processes are terminated after the main process's own teardown completes, even if that teardown threw an error

- **GIVEN** the main process's own close/teardown has been attempted, whether it completed normally or threw an error
- **WHEN** cleanup proceeds
- **THEN** every previously-snapshotted descendant PID that is still running SHALL be force-killed immediately, with no grace period
- **AND** this SHALL happen unconditionally, independent of whether the main process's own teardown succeeded or threw

#### Scenario: Descendant kill skips a PID whose current process no longer matches the snapshot

- **GIVEN** a previously-snapshotted descendant PID is still reported as running
- **WHEN** the cleanup helper re-reads that PID's current process name immediately before killing it
- **THEN** the helper SHALL compare the current name against the name recorded at snapshot time
- **AND** the helper SHALL NOT kill that PID if the current name no longer matches (for example, because the PID was recycled by the operating system for an unrelated process in the interim)

#### Scenario: Descendant kill does not fail the test suite on an already-exited process

- **GIVEN** a previously-snapshotted descendant PID has already exited on its own between snapshot and kill
- **WHEN** the cleanup helper attempts to kill it
- **THEN** the resulting error SHALL be caught and ignored
- **AND** cleanup SHALL proceed to the remaining descendants and complete without failing the test suite

#### Scenario: Process termination verified before next test

- **GIVEN** an E2E test has completed its afterEach cleanup
- **WHEN** the next test's beforeEach hook runs
- **THEN** no Electron main process or descendant processes from the previous test SHALL be running
- **AND** the new Electron instance SHALL launch within the 60-second timeout

#### Scenario: Test database deleted after test

- **GIVEN** an E2E test has completed (afterEach hook)
- **WHEN** cleanup runs
- **THEN** the test database file at the configured path SHALL be deleted

#### Scenario: Test database directory created if missing

- **GIVEN** the test database directory does not exist
- **WHEN** beforeEach hook runs
- **THEN** the directory SHALL be created recursively

#### Scenario: Stuck main process force killed

- **GIVEN** the Electron main process fails to exit gracefully within 5 seconds
- **WHEN** the cleanup timeout is reached
- **THEN** the main process SHALL be forcefully terminated (SIGKILL)
- **AND** cleanup SHALL proceed without failing the test suite

### Requirement: CI Integration for E2E Tests

The system SHALL execute E2E tests in CI across Linux, macOS, and Windows platforms, sharded to bound how many sequential Electron-app launches accumulate within any single Playwright worker process.

#### Scenario: CI job builds webpack before E2E tests

- **GIVEN** a PR workflow is triggered
- **WHEN** the E2E test job runs
- **THEN** webpack dev build SHALL be created before Playwright tests execute

#### Scenario: CI job starts webpack dev server

- **GIVEN** webpack build is complete
- **WHEN** E2E tests need to run
- **THEN** webpack dev server SHALL be started in background before tests and stopped after completion

#### Scenario: CI job uploads failure artifacts without name collisions across shards

- **GIVEN** an E2E test fails in CI, and the `test-e2e-dev` job runs as 4 shards per OS
- **WHEN** the test job completes
- **THEN** Playwright traces, screenshots, and videos SHALL be uploaded as GitHub Actions artifacts with 7-day retention
- **AND** the artifact name SHALL include both the OS and the shard index, so that two shards on the same OS failing in the same run do not collide on artifact name

#### Scenario: E2E tests run on all platforms

- **GIVEN** a PR workflow is triggered
- **WHEN** E2E test jobs execute
- **THEN** tests SHALL run on ubuntu-latest, macos-latest, and windows-latest runners, each split into 4 shards
