## ADDED Requirements

### Requirement: Make-Based Packaging Artifact Verification

CI SHALL run `npm run make` and verify that electron-forge's maker stage produces installer artifacts, for each platform CI packages the app on.

#### Scenario: macOS maker artifacts produced

- **WHEN** the `test-make` CI job runs `npm run make` on `macos-latest`
- **THEN** at least one DMG or ZIP artifact exists under `out/make/` for the current platform/arch
- **AND** the artifact is non-trivially sized (not a zero-byte or truncated file from a crashed maker)
- **AND** the job fails if no such artifact is found

#### Scenario: Windows maker artifacts produced

- **WHEN** the `test-make-windows` CI job runs `npm run make` on `windows-latest`
- **THEN** at least one Squirrel installer artifact (`.exe` installer or `.nupkg`) exists under `out/make/` for the current platform/arch
- **AND** the artifact is non-trivially sized (not a zero-byte or truncated file from a crashed maker)
- **AND** the job fails if no such artifact is found

#### Scenario: Verified maker artifacts are retained for manual download

- **WHEN** the `test-make` or `test-make-windows` CI job's artifact-verification step passes
- **THEN** the verified `out/make/` artifacts are uploaded as a downloadable CI build artifact, scoped per-OS, with a retention period long enough for a human to download and manually test-install (not the 1-day retention used for the transient Python-executable artifact)
- **AND** artifacts are NOT uploaded if the verification step fails (a known-broken maker output is never offered for download)

### Requirement: Make-Based Packaged App Launch Verification

CI SHALL apply the database schema externally (matching the app's production deployment model — the packaged app never runs migrations itself), then launch the packaged application binary staged by `electron-forge make` (prior to installation) and verify that a window actually renders and the app's own database connection and IPC handlers actually work, for each platform CI packages the app on. A database-initialization log line alone SHALL NOT be treated as sufficient evidence that the app launched successfully, nor SHALL it be relied upon at all — log lines emitted early in startup can race with other consumers of the process's stdout and are not a reliable signal. Checking only that the externally-seeded database file still exists and has the expected schema SHALL NOT be treated as sufficient evidence either — because the schema is seeded before launch, that file would look identical whether the app's own database initialization succeeded, failed, or never ran at all; a real IPC round-trip through the running app is required to prove the app's own database code path actually executed successfully.

#### Scenario: Window renders and the app's database IPC works on macOS

- **WHEN** the `test-make` CI job applies the database schema externally, then launches the staged app binary via Playwright's Electron driver
- **THEN** a window becomes available (`firstWindow()` resolves) within the configured timeout
- **AND** a read-only database IPC call made through the running app's renderer succeeds (proving `registerDatabaseHandlers()` ran and the database connection works)
- **AND** the expected database tables still exist in the database file after launch
- **AND** the job fails if any of these checks does not pass

#### Scenario: Window renders and the app's database IPC works on Windows

- **WHEN** the `test-make-windows` CI job applies the database schema externally, then launches the staged app binary via Playwright's Electron driver
- **THEN** a window becomes available (`firstWindow()` resolves) within the configured timeout
- **AND** a read-only database IPC call made through the running app's renderer succeeds (proving `registerDatabaseHandlers()` ran and the database connection works)
- **AND** the expected database tables still exist in the database file after launch
- **AND** the job fails if any of these checks does not pass

#### Scenario: A broken database connection is detected, not masked by the pre-seeded file

- **GIVEN** the app's own database initialization fails after the schema has already been applied externally
- **WHEN** the verification runs
- **THEN** the read-only database IPC call fails (the handler is never registered, or the call resolves with a failure result)
- **AND** the job fails, even though the externally-seeded database file itself remains present and correctly structured

### Requirement: Packaged-App Database Symlink Resolution Has a Copy Fallback

Main-process code that links a dependency (e.g. the Prisma client) to a path required for Node module resolution outside the asar archive SHALL fall back to a real file/directory copy if symlink creation fails, rather than proceeding as if the link exists. Windows restricts unprivileged symlink creation (requires admin or Developer Mode) — the default state for most accounts — so code that only attempts a symlink and continues regardless of failure silently breaks on Windows.

#### Scenario: Symlink creation fails, module resolution still succeeds

- **GIVEN** `fs.symlinkSync()` throws when linking the Prisma client into `resources/node_modules/@prisma/client`
- **WHEN** database initialization runs
- **THEN** a real recursive copy is created at that path instead
- **AND** `require('@prisma/client/runtime/library.js')` resolves successfully
- **AND** database initialization does not fail because of the symlink failure

#### Scenario: Symlink creation succeeds, no redundant copy is made

- **GIVEN** `fs.symlinkSync()` succeeds
- **WHEN** database initialization runs
- **THEN** no fallback copy is attempted

## MODIFIED Requirements

### Requirement: Integration Testing Command

The system SHALL provide an `/integration-testing` command that documents all integration test types and their purposes.

#### Scenario: Developer runs IPC integration test

- **GIVEN** a developer wants to test IPC communication
- **WHEN** they invoke `/integration-testing` command
- **THEN** the command SHALL document `npm run test:ipc` command
- **AND** SHALL explain what IPC test verifies (TypeScript ↔ Python subprocess communication)

#### Scenario: Developer runs all integration tests

- **GIVEN** a developer wants to run all integration tests
- **WHEN** they consult `/integration-testing` command
- **THEN** the command SHALL list all integration test commands:
  - `test:ipc` for IPC communication
  - `test:camera` for camera streaming interface
  - `test:camera:connect` for camera connect/capture/configure/disconnect interface
  - `test:daq` for DAQ interface
  - `test:scanner` for scanner workflow
  - `test:scanner-database` for database persistence
  - `test:package` for packaged app verification

#### Scenario: Developer debugs failing integration test

- **GIVEN** an integration test is failing
- **WHEN** developer needs debugging guidance
- **THEN** the `/integration-testing` command SHALL document how to view Python subprocess logs
- **AND** SHALL document how to inspect IPC messages
- **AND** SHALL document how to inspect database state

#### Scenario: Developer distinguishes camera test scripts

- **GIVEN** a developer wants to test the camera interface
- **WHEN** they consult `/integration-testing` command
- **THEN** the command SHALL explain that `test:camera` exercises the streaming workflow and `test:camera:connect` exercises connect/capture/configure/disconnect
- **AND** SHALL NOT imply the two scripts are interchangeable or that one supersedes the other
