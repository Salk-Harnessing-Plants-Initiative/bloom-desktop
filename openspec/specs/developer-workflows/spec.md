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

The system SHALL provide a `/changelog` command that documents version tracking and changelog format.

#### Scenario: Developer adds changelog entry

- **GIVEN** a developer has completed a feature
- **WHEN** they invoke `/changelog` command
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
  - `test:camera` for camera interface
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
