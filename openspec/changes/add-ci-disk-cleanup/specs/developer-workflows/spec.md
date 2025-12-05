## ADDED Requirements

### Requirement: CI Disk Space Management

The CI workflow SHALL manage disk space to prevent `ENOSPC` (no space left on device) errors during test execution.

#### Scenario: Ubuntu runner frees disk space before E2E tests

- **GIVEN** the CI workflow is running on an Ubuntu runner
- **WHEN** the `test-e2e-dev` job starts on Linux
- **THEN** the job SHALL use `jlumbroso/free-disk-space@main` action to free disk space
- **AND** SHALL remove Android SDK, .NET, Haskell, Docker images, and swap storage
- **AND** SHALL preserve tool-cache (Node.js, Python) by setting `tool-cache: false`
- **AND** SHALL preserve large-packages (xvfb) by setting `large-packages: false`
- **AND** existing test behavior SHALL NOT be affected

#### Scenario: Ubuntu runner frees disk space before dev database tests

- **GIVEN** the CI workflow is running on an Ubuntu runner
- **WHEN** the `test-dev-database` job starts
- **THEN** the job SHALL use `jlumbroso/free-disk-space@main` action to free disk space
- **AND** SHALL remove Android SDK, .NET, Haskell, Docker images, and swap storage
- **AND** SHALL preserve tool-cache (Node.js, Python) by setting `tool-cache: false`
- **AND** SHALL preserve large-packages (xvfb) by setting `large-packages: false`
- **AND** existing test behavior SHALL NOT be affected

#### Scenario: Disk cleanup does not affect macOS or Windows runners

- **GIVEN** the CI workflow is running on macOS or Windows
- **WHEN** any test job starts
- **THEN** the job SHALL NOT run the disk cleanup action
- **AND** existing test behavior SHALL NOT be affected
