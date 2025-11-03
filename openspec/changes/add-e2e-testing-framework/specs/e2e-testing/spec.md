# E2E Testing Specification (Delta)

## ADDED Requirements

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