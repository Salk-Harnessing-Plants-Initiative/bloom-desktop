# developer-workflows Specification

## Purpose

TBD - created by archiving change add-claude-commands. Update Purpose after archive.
## Requirements
### Requirement: Linting and Formatting Command

The system SHALL provide a `/lint` command that documents all linting and formatting workflows for TypeScript and Python code.

#### Scenario: Developer runs lint command for guidance

- **GIVEN** a developer wants to lint their code
- **WHEN** they invoke `/lint` command in Claude
- **THEN** the command SHALL display TypeScript linting commands (`npm run lint`, `npm run format`)
- **AND** SHALL display Python linting commands (`uv run black`, `uv run ruff`, `uv run mypy`)
- **AND** SHALL provide troubleshooting guidance for common issues

#### Scenario: Command references correct configuration files

- **GIVEN** the `/lint` command documentation
- **WHEN** a developer needs to understand linting configuration
- **THEN** the command SHALL reference `.eslintrc.json` for ESLint configuration
- **AND** SHALL reference `.prettierrc.json` for Prettier configuration
- **AND** SHALL reference `pyproject.toml` for Python linting configuration

### Requirement: Test Coverage Command

The system SHALL provide a `/coverage` command that documents test coverage workflows for TypeScript, Python, integration, and E2E tests.

#### Scenario: Developer checks TypeScript coverage

- **GIVEN** a developer wants to check TypeScript test coverage
- **WHEN** they invoke `/coverage` command
- **THEN** the command SHALL document `npm run test:unit:coverage` command
- **AND** SHALL specify 50% minimum coverage threshold for TypeScript
- **AND** SHALL explain how to view HTML coverage reports

#### Scenario: Developer checks Python coverage

- **GIVEN** a developer wants to check Python test coverage
- **WHEN** they invoke `/coverage` command
- **THEN** the command SHALL document `npm run test:python` command
- **AND** SHALL specify 80% minimum coverage threshold for Python
- **AND** SHALL explain how coverage is enforced in CI

### Requirement: PR Description Template Command

The system SHALL provide a `/pr-description` command that provides a standardized PR template with testing checklists.

#### Scenario: Developer creates PR with template

- **GIVEN** a developer is ready to create a PR
- **WHEN** they invoke `/pr-description` command
- **THEN** the command SHALL provide a markdown template with Summary, Changes, Testing sections
- **AND** SHALL include TypeScript unit test checklist
- **AND** SHALL include Python unit test checklist
- **AND** SHALL include integration test checklist (IPC, camera, DAQ, scanner)
- **AND** SHALL include E2E test checklist
- **AND** SHALL include Python build verification step
- **AND** SHALL include database migration checklist (if applicable)

#### Scenario: Template includes GitHub CLI commands

- **GIVEN** the `/pr-description` command output
- **WHEN** a developer wants to create a PR via CLI
- **THEN** the command SHALL document `gh pr create` command examples
- **AND** SHALL document `gh pr edit` command examples

### Requirement: Code Review Checklist Command

The system SHALL provide a `/review-pr` command that provides a comprehensive code review checklist covering Electron, Python, and hardware concerns.

#### Scenario: Reviewer uses checklist for code review

- **GIVEN** a reviewer is reviewing a PR
- **WHEN** they invoke `/review-pr` command
- **THEN** the command SHALL provide code quality checklist (naming, types, error handling)
- **AND** SHALL provide architecture checklist (IPC patterns, subprocess management)
- **AND** SHALL provide Electron-specific checklist (ASAR packaging, resource paths)
- **AND** SHALL provide Python bundling checklist (PyInstaller hidden imports, metadata)
- **AND** SHALL provide hardware integration checklist (mock hardware, error handling)
- **AND** SHALL provide database migration checklist (schema changes, backwards compatibility)
- **AND** SHALL provide cross-platform compatibility checklist
- **AND** SHALL provide security checklist (path sanitization, subprocess security)

### Requirement: Changelog Command

The system SHALL provide a `/update-changelog` command that documents version tracking and changelog format.

#### Scenario: Developer adds changelog entry

- **GIVEN** a developer has completed a feature
- **WHEN** they invoke `/update-changelog` command
- **THEN** the command SHALL document standard changelog format (Added, Changed, Fixed, etc.)
- **AND** SHALL provide examples of good changelog entries
- **AND** SHALL document tracking of dependency versions (Electron, Python, Node.js)
- **AND** SHALL document tracking of hardware SDK versions (Basler Pylon, NI-DAQmx)

### Requirement: Hardware Testing Command

The system SHALL provide a `/hardware-testing` command that documents mock vs. real hardware testing workflows.

#### Scenario: Developer runs camera integration test

- **GIVEN** a developer wants to test camera integration
- **WHEN** they invoke `/hardware-testing` command
- **THEN** the command SHALL document `npm run test:camera` for mock camera testing
- **AND** SHALL explain when to use mock hardware (CI) vs. real hardware (local)
- **AND** SHALL document camera setup verification steps
- **AND** SHALL provide troubleshooting for camera connection issues

#### Scenario: Developer runs DAQ integration test

- **GIVEN** a developer wants to test DAQ integration
- **WHEN** they invoke `/hardware-testing` command
- **THEN** the command SHALL document `npm run test:daq` for mock DAQ testing
- **AND** SHALL explain NI-DAQmx setup requirements
- **AND** SHALL provide troubleshooting for DAQ device detection

#### Scenario: Developer runs full scanner workflow test

- **GIVEN** a developer wants to test complete scanner workflow
- **WHEN** they invoke `/hardware-testing` command
- **THEN** the command SHALL document `npm run test:scanner` for full mock workflow
- **AND** SHALL document `npm run test:scanner-database` for database integration testing

### Requirement: Python Bundling Command

The system SHALL provide a `/python-bundling` command that documents PyInstaller workflows and troubleshooting.

#### Scenario: Developer builds Python executable

- **GIVEN** a developer needs to build Python executable
- **WHEN** they invoke `/python-bundling` command
- **THEN** the command SHALL document `npm run build:python` command
- **AND** SHALL explain PyInstaller bundling process (main.spec, hiddenimports, datas)

#### Scenario: Developer troubleshoots module not found error

- **GIVEN** PyInstaller build fails with "Module not found" error
- **WHEN** developer consults `/python-bundling` command
- **THEN** the command SHALL provide troubleshooting steps for missing hidden imports
- **AND** SHALL explain how to add hidden imports to `python/main.spec`
- **AND** SHALL explain how to add package metadata with `copy_metadata()`

#### Scenario: Developer adds new Python dependency

- **GIVEN** a developer adds a new Python package
- **WHEN** they invoke `/python-bundling` command
- **THEN** the command SHALL document updating `pyproject.toml`
- **AND** SHALL document updating `python/main.spec` if package requires hidden imports
- **AND** SHALL reference `python/PYINSTALLER.md` for detailed guidance

### Requirement: Database Migration Command

The system SHALL provide a `/database-migration` command that documents Prisma migration workflows.

#### Scenario: Developer creates new migration

- **GIVEN** a developer has modified Prisma schema
- **WHEN** they invoke `/database-migration` command
- **THEN** the command SHALL document `npm run prisma:migrate` command
- **AND** SHALL explain migration naming conventions
- **AND** SHALL document testing migration in dev database

#### Scenario: Developer generates Prisma client

- **GIVEN** Prisma schema has changed
- **WHEN** developer needs to regenerate client
- **THEN** the `/database-migration` command SHALL document `npm run prisma:generate` command

#### Scenario: Developer views database with Prisma Studio

- **GIVEN** a developer wants to inspect database contents
- **WHEN** they invoke `/database-migration` command
- **THEN** the command SHALL document `npm run prisma:studio` command for dev database
- **AND** SHALL document `npm run studio:production` command for production database

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

### Requirement: Packaging Command

The system SHALL provide a `/packaging` command that documents Electron Forge packaging and distribution.

#### Scenario: Developer creates distributable package

- **GIVEN** a developer wants to create distributable
- **WHEN** they invoke `/packaging` command
- **THEN** the command SHALL document `npm run package` command
- **AND** SHALL provide packaging checklist (Python built, Prisma external to ASAR, migrations included)

#### Scenario: Developer creates platform-specific installer

- **GIVEN** a developer wants to create installer
- **WHEN** they invoke `/packaging` command
- **THEN** the command SHALL document `npm run make` command
- **AND** SHALL explain platform-specific packaging (macOS signing, Windows installer, Linux formats)

#### Scenario: Developer troubleshoots packaged app

- **GIVEN** packaged app fails to run
- **WHEN** developer consults `/packaging` command
- **THEN** the command SHALL provide troubleshooting for ASAR extraction issues
- **AND** SHALL provide troubleshooting for Python executable permissions
- **AND** SHALL provide troubleshooting for resource loading failures

### Requirement: E2E Testing Command

The system SHALL provide an `/e2e-testing` command that documents Playwright E2E testing workflows.

#### Scenario: Developer runs E2E tests

- **GIVEN** a developer wants to run E2E tests
- **WHEN** they invoke `/e2e-testing` command
- **THEN** the command SHALL document `npm run test:e2e` for standard execution
- **AND** SHALL document `npm run test:e2e:ui` for interactive mode
- **AND** SHALL document `npm run test:e2e:debug` for debug mode

#### Scenario: Developer writes new E2E test

- **GIVEN** a developer is writing new E2E test
- **WHEN** they consult `/e2e-testing` command
- **THEN** the command SHALL provide guidance on Electron-specific selectors
- **AND** SHALL explain database setup requirements
- **AND** SHALL explain hardware mock integration

#### Scenario: Developer debugs failing E2E test

- **GIVEN** an E2E test is failing
- **WHEN** developer needs debugging guidance
- **THEN** the `/e2e-testing` command SHALL document Playwright Inspector usage
- **AND** SHALL document how to view test artifacts (screenshots, traces)
- **AND** SHALL explain CI vs. local testing differences (headless vs. interactive)

### Requirement: Dev Mode Database Testing

Developers SHALL be able to test database initialization in development mode (electron-forge start) to catch environment-specific issues early.

#### Scenario: Developer runs dev mode database test

- **GIVEN** a developer wants to verify database initialization in dev mode
- **WHEN** they invoke `npm run test:dev:database`
- **THEN** the test SHALL launch the Electron app via electron-forge start
- **AND** SHALL monitor logs for database initialization success
- **AND** SHALL verify database created at `./prisma/dev.db`
- **AND** SHALL complete within 60 seconds
- **AND** SHALL provide clear pass/fail output

#### Scenario: Dev mode test detects initialization failure

- **GIVEN** database initialization fails in dev mode
- **WHEN** the test runs
- **THEN** the test SHALL detect the failure within 60 seconds
- **AND** SHALL display relevant error logs
- **AND** SHALL exit with non-zero code
- **AND** SHALL provide troubleshooting hints

#### Scenario: Dev mode test runs in CI

- **GIVEN** a pull request is created
- **WHEN** CI runs pr-checks workflow
- **THEN** the `test-dev-database` job SHALL run on Linux
- **AND** SHALL use xvfb for headless execution
- **AND** SHALL fail the CI if database initialization fails
- **AND** SHALL complete in 2-3 minutes

---

### Requirement: Packaged App Database Operations Testing

Developers SHALL be able to verify full CRUD database operations in packaged apps to ensure Prisma packaging works correctly.

#### Scenario: Developer runs full packaged database test

- **GIVEN** a developer has packaged the app with `npm run package`
- **WHEN** they invoke `npm run test:package:database`
- **THEN** the test SHALL launch the packaged Electron app
- **AND** SHALL verify database initialization
- **AND** SHALL verify all Prisma tables exist (Scientist, Phenotyper, Experiment, Accession, Scan, Image)
- **AND** SHALL verify database schema matches Prisma schema
- **AND** SHALL verify foreign key constraints are enabled
- **AND** SHALL complete within 30 seconds
- **AND** SHALL provide detailed output of verification steps

#### Scenario: Packaged test detects Prisma packaging issues

- **GIVEN** Prisma binary query engine is not correctly extracted from ASAR
- **WHEN** the packaged app test runs
- **THEN** the test SHALL detect the initialization failure
- **AND** SHALL display relevant error logs
- **AND** SHALL exit with non-zero code
- **AND** SHALL indicate Prisma packaging as likely cause

#### Scenario: Packaged test runs in CI

- **GIVEN** a pull request is created
- **WHEN** CI runs pr-checks workflow
- **THEN** the `test-package-database` job SHALL run on macOS
- **AND** SHALL package the app before testing
- **AND** SHALL verify full database operations
- **AND** SHALL fail the CI if database operations fail
- **AND** SHALL complete in 3-5 minutes

---

### Requirement: Database Test Utilities

Test scripts SHALL use reusable utilities for consistent log monitoring and database verification across all database tests.

#### Scenario: Log monitoring utility waits for pattern

- **GIVEN** an Electron app is launching
- **WHEN** test script calls `wait_for_log_pattern(pattern, timeout)`
- **THEN** the utility SHALL poll the log file for the pattern
- **AND** SHALL return success if pattern found within timeout
- **AND** SHALL return failure if timeout expires
- **AND** SHALL handle missing log files gracefully

#### Scenario: Database verification utility checks schema

- **GIVEN** a SQLite database file exists
- **WHEN** test script calls `verify_schema(db_path)`
- **THEN** the utility SHALL use SQLite CLI to introspect schema
- **AND** SHALL verify all expected tables exist
- **AND** SHALL verify foreign key constraints are enabled
- **AND** SHALL return clear error messages for mismatches

#### Scenario: Database verification utility counts records

- **GIVEN** a SQLite database with tables
- **WHEN** test script calls `verify_record_count(table, expected_count)`
- **THEN** the utility SHALL query the table with SQLite CLI
- **AND** SHALL compare actual count to expected count
- **AND** SHALL return success if counts match
- **AND** SHALL return clear error message if counts don't match

---

### Requirement: Database Handler Logging

Database IPC handlers SHALL log all CRUD operations in development mode to enable log-based test verification.

#### Scenario: Database handler logs create operation

- **GIVEN** the app is running in development mode (NODE_ENV !== 'production')
- **WHEN** a database create operation succeeds
- **THEN** the handler SHALL log `[DB:CREATE] <model>: {id} <key-field>`
- **AND** SHALL include the model name (e.g., Scientist, Experiment)
- **AND** SHALL include the created record's ID
- **AND** SHALL include a human-readable key field (e.g., email, name)

#### Scenario: Database handler logs read operation

- **GIVEN** the app is running in development mode
- **WHEN** a database list/read operation succeeds
- **THEN** the handler SHALL log `[DB:READ] <model>: count=<N>`
- **AND** SHALL include the model name
- **AND** SHALL include the count of records returned

#### Scenario: Database handler logs update operation

- **GIVEN** the app is running in development mode
- **WHEN** a database update operation succeeds
- **THEN** the handler SHALL log `[DB:UPDATE] <model>: {id}`
- **AND** SHALL include the model name
- **AND** SHALL include the updated record's ID

#### Scenario: Database handler logs delete operation

- **GIVEN** the app is running in development mode
- **WHEN** a database delete operation succeeds
- **THEN** the handler SHALL log `[DB:DELETE] <model>: {id}`
- **AND** SHALL include the model name
- **AND** SHALL include the deleted record's ID

#### Scenario: Database handler logging disabled in production

- **GIVEN** the app is running in production mode (NODE_ENV === 'production')
- **WHEN** any database operation occurs
- **THEN** the handler SHALL NOT log detailed operation information
- **AND** SHALL only log errors and critical issues

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

### Requirement: Project-Level MCP Configuration

The project SHALL provide a `.mcp.json` file at the repository root that configures MCP (Model Context Protocol) servers for Claude Code, enabling consistent AI-assisted development across all team members.

#### Scenario: Developer clones repository and gets MCP servers automatically

- **GIVEN** a developer clones the bloom-desktop repository
- **WHEN** they open Claude Code in the project directory
- **THEN** Claude Code SHALL automatically detect the `.mcp.json` configuration
- **AND** SHALL prompt for approval to use the project-scoped MCP servers on first use
- **AND** SHALL load the playwright MCP server for browser automation
- **AND** SHALL load the serena MCP server for semantic code navigation

#### Scenario: Playwright MCP server provides browser automation

- **GIVEN** the `.mcp.json` configures the playwright MCP server
- **WHEN** Claude Code loads the project configuration
- **THEN** browser automation tools SHALL be available (browser_navigate, browser_click, browser_snapshot, etc.)
- **AND** the server SHALL run via `npx @playwright/mcp@latest`
- **AND** no additional installation SHALL be required

#### Scenario: Serena MCP server provides semantic code navigation

- **GIVEN** the `.mcp.json` configures the serena MCP server
- **WHEN** Claude Code loads the project configuration
- **THEN** semantic code tools SHALL be available (find_symbol, get_symbols_overview, replace_symbol_body, etc.)
- **AND** the server SHALL use the current project directory as its context
- **AND** the server SHALL run via `uvx --from git+https://github.com/oraios/serena`

#### Scenario: MCP configuration uses portable paths

- **GIVEN** the `.mcp.json` file is checked into git
- **WHEN** different developers on different machines use the configuration
- **THEN** the serena MCP server SHALL use relative path "." for project root
- **AND** the configuration SHALL NOT contain machine-specific absolute paths
- **AND** the configuration SHALL work on Linux, macOS, and Windows

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

The `build-python`, `test-integration`, `test-e2e-dev`, `test-make`, and `test-make-windows` jobs in `pr-checks.yml` SHALL each declare an explicit `timeout-minutes` value, set with headroom above their observed typical duration. Because CI Concurrency Control queues `push`-to-`main` runs behind each other rather than running them in parallel, a hung job can now delay the start of a subsequently-queued `main` commit's entire CI run, not just its own — previously, independent parallel runs meant a hang only affected its own push. Without an explicit bound, that delay could extend up to GitHub's 6-hour per-job default. `build-python` is included because `test-integration`, `test-e2e-dev`, `test-make`, and `test-make-windows` all declare `needs: build-python`: an unbounded hang there would prevent all four downstream jobs from ever starting, regardless of their own timeout values, defeating the point of bounding them at all.

#### Scenario: A hung job is terminated instead of blocking the queue indefinitely

- **GIVEN** a `test-e2e-dev` job hangs (for example, its background dev-server process never exits)
- **WHEN** the job's `timeout-minutes` value is reached
- **THEN** GitHub Actions terminates the job and marks the run as timed out
- **AND** a subsequent push to `main` queued behind it is no longer blocked by an indefinite hang once that run concludes (by timeout, rather than never)

#### Scenario: A hung upstream build cannot bypass the downstream jobs' bounds

- **GIVEN** `test-integration`, `test-e2e-dev`, `test-make`, and `test-make-windows` all declare `needs: build-python`
- **WHEN** `build-python` hangs on a `push`-to-`main` run
- **THEN** `build-python`'s own `timeout-minutes` terminates it before GitHub's 6-hour default would otherwise apply
- **AND** none of the four downstream jobs are left waiting indefinitely on an upstream dependency that itself has no bound

#### Scenario: Timeout values leave headroom for normal runs

- **GIVEN** `build-python`, `test-integration`, `test-e2e-dev`, `test-make`, and `test-make-windows` have observed typical durations of roughly 1-2 minutes, 2-4 minutes, 24-34 minutes (with a real non-hung outlier at 46 minutes), 4-6 minutes, and 11 minutes respectively (see `design.md` for the underlying data and its caveats)
- **WHEN** each job runs normally
- **THEN** its configured `timeout-minutes` (10, 15, 90, 20, and 30 respectively) is above the observed range, including the worst real data point found for `test-e2e-dev`
- **AND** a normal run is never falsely terminated for running long

#### Scenario: Timeout values are enforced by the same regression test

- **GIVEN** a developer edits `.github/workflows/pr-checks.yml`
- **WHEN** the edit removes the `timeout-minutes` key from any of the five affected jobs, or adds one to a job outside this set
- **THEN** `tests/unit/pr-checks-workflow.test.ts` fails, surfacing the regression before it reaches CI

