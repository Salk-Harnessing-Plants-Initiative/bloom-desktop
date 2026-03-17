## MODIFIED Requirements

### Requirement: Test Cleanup and Isolation

The system SHALL ensure E2E tests clean up resources and do not interfere with each other, including proper process termination verification.

#### Scenario: App closes after test

- **GIVEN** an E2E test has completed (afterEach hook)
- **WHEN** cleanup runs
- **THEN** the Electron app SHALL be closed via `closeElectronApp()` helper
- **AND** the helper SHALL wait for the Electron process to fully terminate
- **AND** the helper SHALL timeout after 5 seconds if process doesn't exit gracefully

#### Scenario: Process termination verified before next test

- **GIVEN** an E2E test has completed its afterEach cleanup
- **WHEN** the next test's beforeEach hook runs
- **THEN** no Electron processes from the previous test SHALL be running
- **AND** the new Electron instance SHALL launch within the 60-second timeout

#### Scenario: Test database deleted after test

- **GIVEN** an E2E test has completed (afterEach hook)
- **WHEN** cleanup runs
- **THEN** the test database file at the configured path SHALL be deleted

#### Scenario: Test database directory created if missing

- **GIVEN** the test database directory does not exist
- **WHEN** beforeEach hook runs
- **THEN** the directory SHALL be created recursively

#### Scenario: Stuck process force killed

- **GIVEN** an Electron process fails to exit gracefully within 5 seconds
- **WHEN** the cleanup timeout is reached
- **THEN** the process SHALL be forcefully terminated (SIGKILL)
- **AND** cleanup SHALL proceed without failing the test suite
