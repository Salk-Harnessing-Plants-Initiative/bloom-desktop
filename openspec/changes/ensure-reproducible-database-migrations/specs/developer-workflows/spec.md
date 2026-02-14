# Spec Delta: Developer Workflows - Database Migration Verification

This spec delta adds requirements for database upgrade, migration verification, and reset workflows.

## ADDED Requirements

### Requirement: Database Upgrade Command

The system SHALL provide a database upgrade script that migrates existing databases to be migration-compatible while preserving all data.

#### Scenario: Upgrade database created via db push

- **GIVEN** a developer has a database created via `prisma db push` (no `_prisma_migrations` table)
- **WHEN** they run `npm run db:upgrade`
- **THEN** the system SHALL backup the database file
- **AND** SHALL detect the current schema version by inspecting table columns
- **AND** SHALL create the `_prisma_migrations` table with records for already-applied migrations
- **AND** SHALL run `prisma migrate deploy` to apply any remaining migrations
- **AND** all existing data SHALL be preserved

#### Scenario: Upgrade database from schema v1 (init)

- **GIVEN** a database with schema v1 (has `accession_id` in PlantAccessionMappings, no `genotype_id`)
- **WHEN** they run `npm run db:upgrade`
- **THEN** the system SHALL insert record for `20251028040530_init` migration
- **AND** SHALL apply `20251125180403_add_genotype_id_to_plant_mappings` migration
- **AND** SHALL apply `20260211195433_cleanup_accession_fields` migration
- **AND** existing data SHALL be preserved with appropriate column mappings

#### Scenario: Upgrade bloom-desktop-pilot database

- **GIVEN** a database from the bloom-desktop-pilot application
- **WHEN** they run `npm run db:upgrade`
- **THEN** the system SHALL detect the pilot database schema (equivalent to v1)
- **AND** SHALL insert record for `20251028040530_init` migration
- **AND** SHALL apply all subsequent migrations
- **AND** all existing pilot data (scientists, phenotypers, experiments, scans, images) SHALL be preserved

#### Scenario: Upgrade database from schema v2 (add_genotype_id)

- **GIVEN** a database with schema v2 (has `genotype_id` in PlantAccessionMappings)
- **WHEN** they run `npm run db:upgrade`
- **THEN** the system SHALL insert records for init and add_genotype_id migrations
- **AND** SHALL apply `20260211195433_cleanup_accession_fields` migration
- **AND** existing data SHALL be preserved with `genotype_id` values migrated to `accession_name`

#### Scenario: Upgrade database that is already current

- **GIVEN** a database that already has `_prisma_migrations` table with all migrations applied
- **WHEN** they run `npm run db:upgrade`
- **THEN** the system SHALL detect no upgrade is needed
- **AND** SHALL output a message indicating database is up to date

#### Scenario: Upgrade fails and data is preserved

- **GIVEN** an upgrade operation fails partway through
- **WHEN** the error is detected
- **THEN** the system SHALL NOT corrupt the original database
- **AND** SHALL output instructions to restore from backup

### Requirement: Migration Verification in CI

The CI pipeline SHALL verify that Prisma migrations produce a schema equivalent to `prisma db push`.

#### Scenario: Migrations produce correct schema

- **GIVEN** a PR is submitted with database-related changes
- **WHEN** the CI migration verification job runs
- **THEN** the system SHALL create a database using `prisma migrate deploy`
- **AND** SHALL create a database using `prisma db push`
- **AND** SHALL compare the SQLite schemas (excluding `_prisma_migrations` table)
- **AND** SHALL pass if schemas are equivalent

#### Scenario: Migrations are out of sync with schema

- **GIVEN** migration files do not produce the same schema as `schema.prisma`
- **WHEN** the CI migration verification job runs
- **THEN** the system SHALL fail the job
- **AND** SHALL output the schema differences
- **AND** SHALL provide guidance to run `npx prisma migrate dev` to fix

### Requirement: Database Upgrade Testing

The database upgrade functionality SHALL be thoroughly tested with automated tests.

#### Scenario: Unit tests verify schema detection

- **GIVEN** the schema detection utility
- **WHEN** unit tests are run via `npm run test:unit`
- **THEN** the tests SHALL verify detection of v1 schema (init/pilot)
- **AND** SHALL verify detection of v2 schema (add_genotype_id)
- **AND** SHALL verify detection of v3 schema (current)
- **AND** SHALL verify detection of already-migrated databases
- **AND** SHALL achieve 100% code coverage of detection logic

#### Scenario: Integration tests verify upgrade paths

- **GIVEN** test fixture databases for each schema version
- **WHEN** integration tests are run via `npm run test:db-upgrade`
- **THEN** the tests SHALL verify v1 → v3 upgrade preserves all data
- **AND** SHALL verify v2 → v3 upgrade preserves all data
- **AND** SHALL verify pilot → v3 upgrade preserves all data
- **AND** SHALL verify backup file is created before modifications
- **AND** SHALL verify data integrity after upgrade (record counts, foreign keys)

#### Scenario: CI runs upgrade tests

- **GIVEN** a PR is submitted
- **WHEN** CI runs
- **THEN** the database upgrade integration tests SHALL be executed
- **AND** the PR SHALL fail if any upgrade test fails

### Requirement: Database Reset Command

The system SHALL provide npm scripts to reset the development database using migrations.

#### Scenario: Developer resets database after schema changes

- **GIVEN** a developer has pulled schema changes from another branch
- **AND** their local database has schema incompatibilities
- **WHEN** they run `npm run prisma:reset`
- **THEN** the system SHALL delete the existing development database
- **AND** SHALL create a new database using `prisma migrate deploy`
- **AND** the new database SHALL have the current schema

#### Scenario: Developer resets database with seed data

- **GIVEN** a developer wants a fresh database with test data
- **WHEN** they run `npm run prisma:reset:seed`
- **THEN** the system SHALL reset the database (as above)
- **AND** SHALL run the seed script to populate test data

#### Scenario: Developer runs reset on Windows

- **GIVEN** a developer is using Windows
- **WHEN** they run `npm run prisma:reset`
- **THEN** the system SHALL use Windows-compatible file deletion
- **AND** the reset SHALL complete successfully

## MODIFIED Requirements

### Requirement: Database Migration Command (MODIFIED)

The system SHALL provide a `/database-migration` command that documents Prisma migration workflows, **including database reset procedures**.

#### Scenario: Developer needs to upgrade database with data (ADDED)

- **GIVEN** a developer has a database with valuable data that needs schema updates
- **WHEN** they invoke `/database-migration` command
- **THEN** the command SHALL document `npm run db:upgrade` command
- **AND** SHALL explain that upgrade preserves existing data
- **AND** SHALL explain that upgrade creates a backup before modifying
- **AND** SHALL document the schema versions the upgrade script handles

#### Scenario: Developer needs to reset database (ADDED)

- **GIVEN** a developer wants a fresh database (data loss acceptable)
- **WHEN** they invoke `/database-migration` command
- **THEN** the command SHALL document `npm run prisma:reset` command
- **AND** SHALL explain when reset is appropriate (development, testing)
- **AND** SHALL warn that reset deletes all local data
- **AND** SHALL document `npm run prisma:reset:seed` for including test data

#### Scenario: Developer troubleshoots migration failure (ADDED)

- **GIVEN** `prisma migrate deploy` fails with "database schema is not empty"
- **WHEN** developer consults `/database-migration` command
- **THEN** the command SHALL explain this error means database lacks migration history
- **AND** SHALL recommend using `npm run prisma:reset` to start fresh
- **AND** SHALL note this is common for databases created with `prisma db push`
