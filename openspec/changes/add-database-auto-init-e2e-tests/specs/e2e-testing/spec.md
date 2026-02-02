# Spec Delta: E2E Testing - Database Auto-Initialization

This spec delta adds E2E test coverage for the database auto-initialization feature.

## ADDED Requirements

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
