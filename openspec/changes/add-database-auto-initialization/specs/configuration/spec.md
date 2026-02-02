# Spec Delta: Configuration - Database Auto-Initialization

This spec delta adds safe automatic database initialization for "out of the box" experience.

## ADDED Requirements

### Requirement: Database Auto-Initialization on Startup

The application SHALL automatically initialize the database schema on startup if needed, ensuring the app works immediately after installation without manual CLI commands.

#### Scenario: Fresh install with no database file

- **GIVEN** the application is starting for the first time
- **AND** no database file exists at the configured location
- **WHEN** database initialization runs
- **THEN** the database file SHALL be created
- **AND** all tables from the Prisma schema SHALL be created
- **AND** the app SHALL proceed to normal startup
- **AND** console logs SHALL indicate "Database created and initialized"

#### Scenario: Database file exists but is empty (no tables)

- **GIVEN** a database file exists at the configured location
- **AND** the file contains no tables (empty SQLite database)
- **WHEN** database initialization runs
- **THEN** all tables from the Prisma schema SHALL be created
- **AND** the app SHALL proceed to normal startup
- **AND** console logs SHALL indicate "Database schema initialized"

#### Scenario: Database exists with current schema

- **GIVEN** a database file exists with all required tables
- **AND** the schema matches the current Prisma schema version
- **WHEN** database initialization runs
- **THEN** no schema changes SHALL be made
- **AND** the app SHALL proceed to normal startup immediately
- **AND** console logs SHALL indicate "Database schema is current"

#### Scenario: Database exists with outdated schema (pending migrations)

- **GIVEN** a database file exists with tables and data
- **AND** the schema is from an older version (pending migrations exist)
- **WHEN** database initialization runs
- **THEN** a backup of the database SHALL be created before migration
- **AND** pending migrations SHALL be applied in order
- **AND** existing data SHALL be preserved
- **AND** console logs SHALL indicate "Applied N migrations"
- **AND** the app SHALL proceed to normal startup

#### Scenario: Database exists with user data

- **GIVEN** a database file exists with user data (scans, experiments, etc.)
- **WHEN** database initialization runs
- **THEN** existing data SHALL NOT be deleted or modified
- **AND** only additive schema changes (new tables, new columns) SHALL be applied
- **AND** the app SHALL preserve all user data

### Requirement: Database Initialization Safety

The application SHALL prioritize data safety during database initialization, never deleting user data and providing recovery options if something goes wrong.

#### Scenario: Backup created before migration

- **GIVEN** a database exists with data
- **AND** schema migrations need to be applied
- **WHEN** migration starts
- **THEN** a backup file SHALL be created at `{db_path}.backup.{timestamp}`
- **AND** the backup SHALL be a complete copy of the database
- **AND** migration SHALL only proceed after backup is verified

#### Scenario: Migration failure triggers rollback

- **GIVEN** a database migration is in progress
- **WHEN** the migration fails (SQL error, constraint violation, etc.)
- **THEN** the database SHALL be restored from the backup
- **AND** an error message SHALL be logged with details
- **AND** the app SHALL show user-friendly error: "Database migration failed. Your data has been preserved."

#### Scenario: Corrupted database detected

- **GIVEN** a database file exists
- **AND** the file is corrupted (not a valid SQLite database)
- **WHEN** database initialization runs
- **THEN** the corrupted file SHALL be renamed to `{db_path}.corrupted.{timestamp}`
- **AND** a new database SHALL be created
- **AND** a warning SHALL be logged: "Corrupted database found and preserved. A new database was created."

### Requirement: Database Initialization Feedback

The application SHALL provide clear feedback about database initialization status to help users and developers understand what's happening.

#### Scenario: Initialization status logged

- **GIVEN** the application is starting
- **WHEN** database initialization runs
- **THEN** console logs SHALL include:
  - Database path being used
  - Current state (new, empty, current, needs migration)
  - Actions taken (created, migrated, none)
  - Time taken for initialization

#### Scenario: Database error surfaced to user

- **GIVEN** database initialization fails
- **AND** the error cannot be automatically recovered
- **WHEN** the user tries to use the app
- **THEN** a user-friendly error message SHALL be displayed
- **AND** the error SHALL include suggested actions (check permissions, contact support)
- **AND** technical details SHALL be available in logs

### Requirement: Schema Validation

The application SHALL validate that the database schema matches the expected structure after initialization.

#### Scenario: Schema validation passes

- **GIVEN** database initialization has completed
- **WHEN** schema validation runs
- **THEN** all expected tables SHALL exist
- **AND** table structures SHALL match Prisma schema
- **AND** the app SHALL proceed normally

#### Scenario: Schema validation fails

- **GIVEN** database initialization has completed
- **AND** the schema doesn't match expected structure
- **WHEN** schema validation runs
- **THEN** an error SHALL be logged with details of mismatches
- **AND** the app SHALL attempt to fix minor issues automatically
- **AND** for major issues, user SHALL be notified with recovery steps

## Technical Notes

### Detection Logic

```typescript
// Pseudo-code for initialization detection
async function detectDatabaseState(dbPath: string): Promise<DatabaseState> {
  if (!fs.existsSync(dbPath)) {
    return 'missing';
  }

  try {
    const tables = await queryTables(dbPath);
    if (tables.length === 0) {
      return 'empty';
    }

    const hasPendingMigrations = await checkMigrations(dbPath);
    if (hasPendingMigrations) {
      return 'needs_migration';
    }

    return 'current';
  } catch (error) {
    if (isCorruptedError(error)) {
      return 'corrupted';
    }
    throw error;
  }
}
```

### Migration Strategy

Using Prisma's built-in migration engine:

```typescript
// For development/simple cases: prisma db push
// For production with migrations: prisma migrate deploy

// The app will use db push for SQLite since it's embedded
// and migrations are applied automatically
```

### Backup Location

```
~/.bloom/
  ├── dev.db                           # Active database
  ├── dev.db.backup.2026-01-31T14-30-00  # Backup before migration
  └── dev.db.corrupted.2026-01-31T14-30-00  # Preserved corrupted file
```

### Expected Tables (from Prisma schema)

- `Phenotyper`
- `Scientist`
- `Experiment`
- `Accessions`
- `PlantAccessionMappings`
- `Scan`
- `Image`
- `_prisma_migrations` (Prisma internal)
