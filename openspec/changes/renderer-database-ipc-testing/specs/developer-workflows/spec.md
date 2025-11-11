# Developer Workflows - Renderer Database IPC Testing

## ADDED Requirements

### Requirement: Renderer Database IPC Integration Testing

Developers SHALL be able to test database operations from the renderer process via IPC to verify the complete renderer → IPC → main → database path works correctly.

#### Scenario: Test database list operation from renderer

- **GIVEN** the Electron app is running with a test database
- **WHEN** test code executes `window.electron.database.scientists.list()` in the renderer
- **THEN** the IPC call SHALL be routed through the preload script
- **AND** the main process handler SHALL query the database
- **AND** the result SHALL be returned to the renderer
- **AND** the test SHALL verify the response format matches expectations

#### Scenario: Test database create operation from renderer

- **GIVEN** the Electron app is running with a test database
- **WHEN** test code executes `window.electron.database.scientists.create(data)` in the renderer
- **THEN** the IPC call SHALL create a record in the database
- **AND** the result SHALL be returned to the renderer
- **AND** the test SHALL verify the record exists in the database via direct query
- **AND** the returned data SHALL match the created record

#### Scenario: Test database read with relations from renderer

- **GIVEN** the database contains an experiment with related scientist
- **WHEN** test code executes `window.electron.database.experiments.list()` in the renderer
- **THEN** the response SHALL include the related scientist data
- **AND** the test SHALL verify the relation was loaded correctly
- **AND** SHALL verify no data is missing from the response

#### Scenario: Test database error handling from renderer

- **GIVEN** the Electron app is running
- **WHEN** test code executes an invalid database operation from renderer (missing required field)
- **THEN** the IPC handler SHALL return an error response
- **AND** the error SHALL be accessible in the renderer
- **AND** the test SHALL verify the error message is descriptive
- **AND** the app SHALL NOT crash

#### Scenario: Verify context isolation

- **GIVEN** the Electron app is running with context isolation enabled
- **WHEN** test code attempts to access main process APIs directly from renderer
- **THEN** the access SHALL be blocked
- **AND** only window.electron APIs SHALL be accessible
- **AND** the test SHALL verify no sensitive main process objects are exposed

#### Scenario: Test runs in CI

- **GIVEN** a pull request is created
- **WHEN** CI runs pr-checks workflow
- **THEN** the `test-renderer-database-ipc` job SHALL run on Linux
- **AND** SHALL use xvfb for headless execution
- **AND** SHALL test all database IPC handlers from renderer
- **AND** SHALL complete within 90 seconds
- **AND** SHALL fail the CI if any renderer IPC test fails

---

### Requirement: Comprehensive IPC Handler Coverage

All database IPC handlers SHALL be tested from the renderer process to ensure complete API coverage for UI development.

#### Scenario: Test all Scientists IPC handlers

- **GIVEN** the Electron app is running
- **WHEN** tests execute scientist operations from renderer
- **THEN** tests SHALL verify `db:scientists:list` works from renderer
- **AND** SHALL verify `db:scientists:create` works from renderer
- **AND** SHALL verify error handling for invalid scientist data

#### Scenario: Test all Phenotypers IPC handlers

- **GIVEN** the Electron app is running
- **WHEN** tests execute phenotyper operations from renderer
- **THEN** tests SHALL verify `db:phenotypers:list` works from renderer
- **AND** SHALL verify `db:phenotypers:create` works from renderer
- **AND** SHALL verify error handling for invalid phenotyper data

#### Scenario: Test all Accessions IPC handlers

- **GIVEN** the Electron app is running
- **WHEN** tests execute accession operations from renderer
- **THEN** tests SHALL verify `db:accessions:list` works from renderer
- **AND** SHALL verify `db:accessions:create` works from renderer
- **AND** SHALL verify error handling for invalid accession data

#### Scenario: Test all Experiments IPC handlers

- **GIVEN** the Electron app is running
- **WHEN** tests execute experiment operations from renderer
- **THEN** tests SHALL verify `db:experiments:list` works from renderer
- **AND** SHALL verify `db:experiments:get` works from renderer
- **AND** SHALL verify `db:experiments:create` works from renderer
- **AND** SHALL verify `db:experiments:update` works from renderer
- **AND** SHALL verify `db:experiments:delete` works from renderer
- **AND** SHALL verify relations (scientist, accession) are loaded correctly

#### Scenario: Test Scans IPC handlers with filters

- **GIVEN** the database contains multiple scans
- **WHEN** tests execute `db:scans:list` with filters from renderer
- **THEN** the response SHALL contain only scans matching the filters
- **AND** SHALL verify filtering by phenotyper_id works
- **AND** SHALL verify filtering by experiment_id works
- **AND** SHALL verify `db:scans:get` returns full scan with relations

---

### Requirement: Renderer Test Infrastructure

A reusable test infrastructure SHALL be provided for Playwright-based renderer IPC tests with database seeding and cleanup.

#### Scenario: Test setup creates isolated database

- **GIVEN** a renderer IPC test is about to run
- **WHEN** the test setup executes
- **THEN** a fresh test database SHALL be created
- **AND** Prisma schema SHALL be applied
- **AND** the Electron app SHALL be launched pointing to the test database
- **AND** the app SHALL initialize successfully

#### Scenario: Test teardown cleans up resources

- **GIVEN** a renderer IPC test has completed
- **WHEN** the test teardown executes
- **THEN** the Electron app SHALL be closed gracefully
- **AND** the test database file SHALL be deleted
- **AND** no resources SHALL be leaked

#### Scenario: Test can seed database for scenarios

- **GIVEN** a test requires pre-existing database records
- **WHEN** the test uses Prisma Client to seed data in beforeEach
- **THEN** the seed data SHALL be available to the renderer via IPC
- **AND** the test SHALL be able to verify operations on seeded data
- **AND** each test SHALL have isolated seed data (no cross-test pollution)

#### Scenario: Test can execute code in renderer context

- **GIVEN** a test needs to call IPC from renderer
- **WHEN** the test uses `window.evaluate(() => window.electron.database...)`
- **THEN** the code SHALL execute in the renderer process context
- **AND** SHALL have access to window.electron APIs
- **AND** SHALL NOT have access to Node.js or main process APIs
- **AND** SHALL return results to the test for assertions