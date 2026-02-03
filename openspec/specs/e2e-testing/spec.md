# e2e-testing Specification

## Purpose

TBD - created by archiving change add-e2e-testing-framework. Update Purpose after archive.

## Requirements

### Requirement: Playwright Framework Configuration

The system SHALL provide a Playwright configuration file that defines E2E test execution parameters for the Electron application.

#### Scenario: Playwright config defines test directory and patterns

- **GIVEN** the Playwright configuration file exists at `playwright.config.ts`
- **WHEN** tests are executed with `npx playwright test`
- **THEN** only files matching `**/*.e2e.ts` pattern in `tests/e2e/` directory SHALL be executed

#### Scenario: Playwright config enforces sequential execution

- **GIVEN** the Playwright configuration is loaded
- **WHEN** E2E tests are executed
- **THEN** tests SHALL run with 1 worker (sequential execution) to prevent Electron instance conflicts

#### Scenario: Playwright config captures failure artifacts

- **GIVEN** an E2E test fails
- **WHEN** the test completes
- **THEN** traces, screenshots, and videos SHALL be retained in `playwright-report/` and `test-results/` directories

#### Scenario: Playwright config sets appropriate timeouts

- **GIVEN** an E2E test is executing
- **WHEN** the test runs
- **THEN** the timeout SHALL be 60 seconds per test to accommodate Electron app startup time

### Requirement: E2E Environment Configuration

The system SHALL provide isolated environment configuration for E2E tests separate from development and production environments.

#### Scenario: E2E database uses isolated test path

- **GIVEN** the `.env.e2e` file exists
- **WHEN** E2E tests are executed
- **THEN** the `BLOOM_DATABASE_URL` SHALL point to `file:../tests/e2e/test.db` (relative to prisma/ directory)

#### Scenario: E2E environment loaded by Playwright

- **GIVEN** Playwright configuration loads environment variables
- **WHEN** `dotenv.config({ path: '.env.e2e' })` is executed
- **THEN** all variables from `.env.e2e` SHALL be available to test files

### Requirement: Electron App Launch Test

The system SHALL verify that the Electron application can launch successfully and create a visible window.

#### Scenario: Launch dev build with webpack

- **GIVEN** the webpack dev build exists at `.webpack/main/index.js`
- **WHEN** Electron is launched with `electron.launch({ args: ['.'] })`
- **THEN** the application SHALL start without errors and create a window

#### Scenario: Window title verification

- **GIVEN** the Electron app has launched
- **WHEN** the first window title is retrieved
- **THEN** the title SHALL contain "Bloom Desktop"

#### Scenario: Window visibility verification

- **GIVEN** the Electron app window has opened
- **WHEN** the `body` element is checked for visibility
- **THEN** the body SHALL be visible (rendered DOM content)

### Requirement: Database Initialization Test

The system SHALL verify that the database is initialized correctly during app startup in E2E test environment.

#### Scenario: Test database cleanup before test

- **GIVEN** a previous E2E test may have left a database file
- **WHEN** a new E2E test starts (beforeEach hook)
- **THEN** any existing test database file at `prisma/tests/e2e/test.db` SHALL be deleted

#### Scenario: Test database schema creation

- **GIVEN** the test database has been cleaned up
- **WHEN** `npx prisma db push --skip-generate` is executed in beforeEach
- **THEN** a new database file SHALL be created at `prisma/tests/e2e/test.db` with the correct schema

#### Scenario: App initializes database on startup

- **GIVEN** the Electron app has launched with E2E environment
- **WHEN** 3 seconds have elapsed for initialization
- **THEN** the database file at `prisma/tests/e2e/test.db` SHALL exist and be accessible

### Requirement: Page Content Rendering Test

The system SHALL verify that the React UI renders content successfully in the Electron window.

#### Scenario: Page loads with content

- **GIVEN** the Electron app window has opened
- **WHEN** the page reaches networkidle state (within 15 seconds)
- **THEN** the body element SHALL contain text content with length greater than 0

### Requirement: Webpack Build Automation

The system SHALL automate webpack build process for E2E test setup to ensure dev build artifacts exist.

#### Scenario: Build script creates webpack artifacts

- **GIVEN** webpack build artifacts do not exist
- **WHEN** `node scripts/build-webpack-dev.js` is executed
- **THEN** webpack SHALL compile both main and renderer configs and create `.webpack/` directory

#### Scenario: Build script skips if artifacts exist

- **GIVEN** webpack build artifacts already exist at `.webpack/main/index.js`
- **WHEN** the build script is executed
- **THEN** the build SHALL be skipped to save time

### Requirement: CI Integration for E2E Tests

The system SHALL execute E2E tests in CI across Linux, macOS, and Windows platforms.

#### Scenario: CI job builds webpack before E2E tests

- **GIVEN** a PR workflow is triggered
- **WHEN** the E2E test job runs
- **THEN** webpack dev build SHALL be created before Playwright tests execute

#### Scenario: CI job starts webpack dev server

- **GIVEN** webpack build is complete
- **WHEN** E2E tests need to run
- **THEN** webpack dev server SHALL be started in background before tests and stopped after completion

#### Scenario: CI job uploads failure artifacts

- **GIVEN** an E2E test fails in CI
- **WHEN** the test job completes
- **THEN** Playwright traces, screenshots, and videos SHALL be uploaded as GitHub Actions artifacts with 7-day retention

#### Scenario: E2E tests run on all platforms

- **GIVEN** a PR workflow is triggered
- **WHEN** E2E test jobs execute
- **THEN** tests SHALL run on ubuntu-latest, macos-latest, and windows-latest runners

### Requirement: npm Scripts for E2E Testing

The system SHALL provide npm scripts for executing E2E tests in different modes.

#### Scenario: Standard E2E test execution

- **GIVEN** the user runs `npm run test:e2e`
- **WHEN** the script executes
- **THEN** it SHALL build Python executable, build webpack, and run Playwright tests

#### Scenario: E2E test execution with UI

- **GIVEN** the user runs `npm run test:e2e:ui`
- **WHEN** the script executes
- **THEN** it SHALL build dependencies and launch Playwright UI mode for interactive debugging

#### Scenario: E2E test execution with debug mode

- **GIVEN** the user runs `npm run test:e2e:debug`
- **WHEN** the script executes
- **THEN** it SHALL build dependencies and launch Playwright debug mode with step-through capability

### Requirement: Test Cleanup and Isolation

The system SHALL ensure E2E tests clean up resources and do not interfere with each other.

#### Scenario: App closes after test

- **GIVEN** an E2E test has completed (afterEach hook)
- **WHEN** cleanup runs
- **THEN** the Electron app SHALL be closed via `electronApp.close()`

#### Scenario: Test database deleted after test

- **GIVEN** an E2E test has completed (afterEach hook)
- **WHEN** cleanup runs
- **THEN** the test database file at `prisma/tests/e2e/test.db` SHALL be deleted

#### Scenario: Test database directory created if missing

- **GIVEN** the test database directory does not exist
- **WHEN** beforeEach hook runs
- **THEN** the directory `prisma/tests/e2e/` SHALL be created recursively

### Requirement: Real-World Data E2E Testing

The E2E test suite SHALL include tests using real-world experiment data files to validate the accession upload workflow handles production data patterns.

#### Scenario: Upload real experiment Excel file

- **GIVEN** the test fixture `ARV1_Media_Pilot_Master_Data.xlsx` exists in `tests/fixtures/excel/`
- **WHEN** the E2E test uploads this file on the Accessions page
- **AND** maps the `Barcode` column to Plant ID
- **AND** maps the `Line` column to Genotype ID
- **THEN** the upload SHALL succeed
- **AND** an accession with name containing "ARV1_Media_Pilot_Master_Data" SHALL be created
- **AND** 20 plant-to-genotype mappings SHALL be associated with the accession

#### Scenario: Preview displays real data correctly

- **GIVEN** the user has uploaded `ARV1_Media_Pilot_Master_Data.xlsx`
- **WHEN** the preview table is displayed
- **THEN** the table SHALL show actual barcode values (e.g., "981T0FPX7B")
- **AND** the table SHALL show actual line values (e.g., "ARV1")
- **AND** empty cells SHALL display as empty (not "undefined" or "null")

#### Scenario: Column mapping with non-standard names

- **GIVEN** the uploaded Excel file has columns named `Barcode` and `Line` (not `PlantBarcode` and `GenotypeID`)
- **WHEN** the column selector dropdowns are populated
- **THEN** the dropdowns SHALL contain `Barcode` and `Line` as selectable options
- **AND** the user SHALL be able to map these columns successfully

### Requirement: Database Auto-Initialization E2E Tests

The E2E test suite SHALL include tests that verify the database auto-initialization feature works correctly across all database states.

#### Scenario: Fresh install creates database automatically

- **GIVEN** no database file exists at the configured path
- **WHEN** the Electron app is launched
- **THEN** the app SHALL create the database file automatically
- **AND** all 7 expected tables SHALL be created (Phenotyper, Scientist, Experiment, Accessions, PlantAccessionMappings, Scan, Image)
- **AND** the app window SHALL display without errors
- **AND** console logs SHALL indicate "Database created and initialized"

#### Scenario: Existing database with current schema is preserved

- **GIVEN** a database file exists with all required tables and test data
- **WHEN** the Electron app is launched
- **THEN** the existing database SHALL NOT be modified
- **AND** the test data SHALL still be accessible via the app
- **AND** console logs SHALL indicate "Database schema is current"

#### Scenario: Existing database with user data survives app restart

- **GIVEN** a database exists with a Scientist record (name: "Test Scientist")
- **WHEN** the Electron app is launched
- **AND** the Scientists page is navigated to
- **THEN** the "Test Scientist" record SHALL be visible in the list
- **AND** the data SHALL NOT be deleted or corrupted

#### Scenario: Corrupted database is handled gracefully

- **GIVEN** a database file exists but contains invalid content (not SQLite)
- **WHEN** the Electron app is launched
- **THEN** the corrupted file SHALL be renamed with `.corrupted.{timestamp}` suffix
- **AND** a new database SHALL be created with correct schema
- **AND** the app window SHALL display without errors
- **AND** console logs SHALL indicate "Corrupted database found and preserved"

#### Scenario: Empty database file has schema applied

- **GIVEN** an empty database file exists (0 bytes)
- **WHEN** the Electron app is launched
- **THEN** the schema SHALL be applied to the empty file
- **AND** all 7 expected tables SHALL be created
- **AND** the app window SHALL display without errors

### Requirement: E2E Test Database State Setup Utilities

The E2E test framework SHALL provide utilities to set up specific database states for testing auto-initialization scenarios.

#### Scenario: Utility creates database with test data

- **GIVEN** a test needs a pre-populated database
- **WHEN** the `createDatabaseWithTestData()` utility is called
- **THEN** a database SHALL be created with schema via `prisma db push`
- **AND** a test Scientist record SHALL be inserted

#### Scenario: Utility creates corrupted database file

- **GIVEN** a test needs a corrupted database
- **WHEN** the `createCorruptedDatabase()` utility is called
- **THEN** a file SHALL be created with invalid (non-SQLite) content

#### Scenario: Utility verifies database tables exist

- **GIVEN** a test needs to verify database initialization
- **WHEN** the `verifyDatabaseTables()` utility is called
- **THEN** it SHALL return true if all 7 expected tables exist
- **AND** it SHALL return false with details if any tables are missing
