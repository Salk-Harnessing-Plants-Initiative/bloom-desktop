# configuration Specification

## Purpose

TBD - created by archiving change add-database-auto-initialization. Update Purpose after archive.

## Requirements

### Requirement: Database Auto-Initialization on Startup

The application SHALL automatically initialize the database schema on startup if needed, ensuring the app works immediately after installation without manual CLI commands in development mode. In packaged (production) mode, the application SHALL detect database state but defer schema creation to external tooling.

#### Scenario: Fresh install with no database file (Development Mode)

- **GIVEN** the application is starting in development mode (not packaged)
- **AND** no database file exists at the configured location
- **WHEN** database initialization runs
- **THEN** the database file SHALL be created
- **AND** all tables from the Prisma schema SHALL be created via `prisma db push`
- **AND** the app SHALL proceed to normal startup
- **AND** console logs SHALL indicate "Database created and initialized"

#### Scenario: Fresh install with no database file (Packaged Mode)

- **GIVEN** the application is starting as a packaged Electron app
- **AND** no database file exists at the configured location
- **WHEN** database initialization runs
- **THEN** the app SHALL log "Packaged app detected - schema must be applied externally"
- **AND** the app SHALL NOT attempt to run Prisma CLI commands
- **AND** schema validation SHALL fail with clear error message
- **AND** the recommended workflow is to run `prisma migrate deploy` BEFORE first app launch

#### Scenario: Packaged app with pre-initialized database

- **GIVEN** the application is a packaged Electron app
- **AND** the database schema was applied externally via `prisma migrate deploy`
- **AND** all expected tables exist at `~/.bloom/data/bloom.db`
- **WHEN** the packaged app starts
- **THEN** database state SHALL be detected as "current"
- **AND** schema validation SHALL pass
- **AND** the app SHALL proceed to normal startup
- **AND** all database operations SHALL work correctly

#### Scenario: Database file exists but is empty (no tables)

- **GIVEN** a database file exists at the configured location
- **AND** the file contains no tables (empty SQLite database)
- **WHEN** database initialization runs in development mode
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
- **WHEN** database initialization runs in development mode
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
- **AND** a new database SHALL be created (in development mode)
- **AND** a warning SHALL be logged: "Corrupted database found and preserved. A new database was created."

### Requirement: Database Initialization Feedback

The application SHALL provide clear feedback about database initialization status to help users and developers understand what's happening.

#### Scenario: Initialization status logged

- **GIVEN** the application is starting
- **WHEN** database initialization runs
- **THEN** console logs SHALL include:
  - Database path being used
  - Current state (new, empty, current, needs migration)
  - Whether running in packaged or development mode
  - Actions taken (created, migrated, skipped, none)
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
- **AND** the app SHALL attempt to fix minor issues automatically (development mode only)
- **AND** for major issues, user SHALL be notified with recovery steps

### Requirement: Scans Directory Auto-creation

The application SHALL automatically create the scans directory when saving configuration, eliminating the need for manual directory creation.

#### Scenario: Auto-create scans directory on save

- **GIVEN** user has configured scans directory to `/home/user/.bloom/dev-scans`
- **AND** the directory does not exist
- **AND** the parent directory `/home/user/.bloom` exists and is writable
- **WHEN** user saves configuration
- **THEN** the application SHALL create the directory `/home/user/.bloom/dev-scans`
- **AND** configuration SHALL be saved successfully
- **AND** no validation error SHALL be shown

#### Scenario: Auto-create nested scans directory

- **GIVEN** user has configured scans directory to `/mnt/scanner-data/scans`
- **AND** the directory does not exist
- **AND** parent directories `/mnt/scanner-data` do not exist
- **AND** the root `/mnt` is writable
- **WHEN** user saves configuration
- **THEN** the application SHALL create all parent directories recursively
- **AND** the scans directory SHALL be created
- **AND** configuration SHALL be saved successfully

#### Scenario: Fail gracefully when parent not writable

- **GIVEN** user has configured scans directory to `/root/scans`
- **AND** the directory does not exist
- **AND** the parent directory `/root` is not writable by the application
- **WHEN** user attempts to save configuration
- **THEN** validation SHALL fail with error "Cannot create directory - parent is not writable: /root"
- **AND** configuration SHALL NOT be saved
- **AND** no directory SHALL be created

#### Scenario: Succeed with existing writable directory

- **GIVEN** user has configured scans directory to `/home/user/.bloom/scans`
- **AND** the directory already exists
- **AND** the directory is writable
- **WHEN** user saves configuration
- **THEN** validation SHALL pass
- **AND** configuration SHALL be saved successfully
- **AND** no new directory SHALL be created

### Requirement: Improved Validation Error Messages

The application SHALL provide clear, actionable error messages when scans directory cannot be created.

#### Scenario: Clear error for non-writable parent

- **GIVEN** directory creation fails due to parent permissions
- **WHEN** validation error is shown
- **THEN** error message SHALL include parent directory path
- **AND** error message SHALL indicate parent is not writable
- **AND** format SHALL be "Cannot create directory - parent is not writable: {parent_path}"

#### Scenario: Clear error for invalid path

- **GIVEN** directory path is invalid or malformed
- **WHEN** validation runs
- **THEN** error message SHALL indicate the specific issue
- **AND** error message SHALL guide user to fix the path

### Requirement: Development Environment Paths

The application SHALL use consistent path structure for development mode, keeping all development data under `~/.bloom/` separate from production data.

#### Scenario: Development database location

- **GIVEN** the application is running in development mode (`NODE_ENV=development`)
- **AND** no `BLOOM_DATABASE_URL` environment variable is set
- **WHEN** the database is initialized
- **THEN** the database SHALL be located at `~/.bloom/dev.db`
- **AND** the path SHALL NOT be in the project directory

#### Scenario: Development scans directory default

- **GIVEN** the application is running in development mode
- **AND** no saved configuration exists
- **WHEN** configuration defaults are loaded
- **THEN** the scans directory SHALL default to `~/.bloom/dev-scans`
- **AND** the path SHALL NOT conflict with production scans at `~/.bloom/scans`

#### Scenario: Production paths unchanged

- **GIVEN** the application is running in production mode
- **WHEN** paths are determined
- **THEN** database SHALL be at `~/.bloom/data/bloom.db`
- **AND** scans directory SHALL default to `~/.bloom/scans`
- **AND** behavior SHALL be identical to previous versions

### Requirement: Scans Directory Validation

The application SHALL validate that the configured scans directory exists and is writable before allowing the configuration to be saved.

#### Scenario: Writable directory validation success

- **GIVEN** user has configured scans directory to `/mnt/scanner-data`
- **AND** the directory exists
- **AND** the directory is writable by the application
- **WHEN** user attempts to save configuration
- **THEN** validation SHALL pass
- **AND** configuration SHALL be saved successfully

#### Scenario: Non-existent directory validation failure

- **GIVEN** user has configured scans directory to `/nonexistent/path`
- **AND** the directory does not exist
- **WHEN** user attempts to save configuration
- **THEN** validation SHALL fail with error "Directory does not exist or is not writable"
- **AND** configuration SHALL NOT be saved
- **AND** user SHALL be prompted to create the directory or choose a different path

#### Scenario: Non-writable directory validation failure

- **GIVEN** user has configured scans directory to `/root/scans`
- **AND** the directory exists
- **AND** the directory is not writable by the application user
- **WHEN** user attempts to save configuration
- **THEN** validation SHALL fail with error "Directory does not exist or is not writable"
- **AND** configuration SHALL NOT be saved
- **AND** user SHALL be prompted to fix permissions or choose a different path

### Requirement: Scans Directory UI Guidance

The Machine Configuration form SHALL provide clear guidance about the scans directory field to help administrators make informed decisions during scanner station setup.

#### Scenario: Help text displayed

- **GIVEN** user is on Machine Configuration page
- **WHEN** viewing the scans directory field
- **THEN** help text SHALL be displayed below the input field
- **AND** help text SHALL explain "Default: ~/.bloom/scans (same location as database)"
- **AND** help text SHALL include guidance "For large datasets, configure external storage (e.g., /mnt/scanner-data)"

#### Scenario: Default value pre-filled

- **GIVEN** user is configuring scanner for the first time
- **WHEN** Machine Configuration form loads
- **THEN** scans directory field SHALL be pre-filled with default value
- **AND** default SHALL be `~/.bloom/scans` in production
- **AND** default SHALL be `~/.bloom/dev-scans` in development

#### Scenario: Existing value preserved

- **GIVEN** user has previously configured scans directory to `/mnt/scanner-data`
- **WHEN** Machine Configuration form loads
- **THEN** scans directory field SHALL display `/mnt/scanner-data`
- **AND** help text SHALL still be visible for reference
