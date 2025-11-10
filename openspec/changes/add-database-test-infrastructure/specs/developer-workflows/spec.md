# Developer Workflows Spec Deltas

## ADDED Requirements

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
