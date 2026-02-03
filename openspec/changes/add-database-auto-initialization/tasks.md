# Tasks: Add Safe Database Auto-Initialization

## TDD Approach

This implementation follows Test-Driven Development:

1. Write failing tests first
2. Implement minimum code to pass tests
3. Refactor while keeping tests green

---

## Phase 1: Write Failing Unit Tests

### 1.1 Create test file structure

- [x] 1.1.1 Create `tests/unit/database-auto-init.test.ts`
- [x] 1.1.2 Set up test fixtures for different database states

### 1.2 Write tests for database state detection

- [x] 1.2.1 Test: `detectDatabaseState` returns `'missing'` when file doesn't exist
- [x] 1.2.2 Test: `detectDatabaseState` returns `'empty'` when file exists but has no tables
- [x] 1.2.3 Test: `detectDatabaseState` returns `'current'` when schema is up-to-date
- [x] 1.2.4 Test: `detectDatabaseState` returns `'needs_migration'` when schema is outdated
- [x] 1.2.5 Test: `detectDatabaseState` returns `'corrupted'` when file is not valid SQLite

### 1.3 Write tests for initialization actions

- [x] 1.3.1 Test: Fresh database is created when state is `'missing'`
- [x] 1.3.2 Test: Schema is applied when state is `'empty'`
- [x] 1.3.3 Test: No changes made when state is `'current'`
- [x] 1.3.4 Test: Migrations applied when state is `'needs_migration'`
- [x] 1.3.5 Test: Corrupted file is preserved and new database created

### 1.4 Write tests for safety features

- [x] 1.4.1 Test: Backup created before migration
- [x] 1.4.2 Test: Backup file name includes timestamp
- [x] 1.4.3 Test: Rollback occurs on migration failure
- [x] 1.4.4 Test: Existing user data is preserved after migration
- [x] 1.4.5 Test: Corrupted file renamed with `.corrupted.{timestamp}` suffix

### 1.5 Write tests for schema validation

- [x] 1.5.1 Test: `validateSchema` returns true when all tables exist
- [x] 1.5.2 Test: `validateSchema` returns false when tables are missing
- [x] 1.5.3 Test: All expected tables are checked (Phenotyper, Scientist, etc.)

---

## Phase 2: Implement Database State Detection

### 2.1 Add detection functions to database.ts

- [x] 2.1.1 Implement `detectDatabaseState(dbPath: string): Promise<DatabaseState>`
- [x] 2.1.2 Add type `DatabaseState = 'missing' | 'empty' | 'current' | 'needs_migration' | 'corrupted'`
- [x] 2.1.3 Implement SQLite table query helper (using sqlite3 CLI)
- [x] 2.1.4 Implement corruption detection (check SQLite header magic bytes)

### 2.2 Verify tests pass

- [x] 2.2.1 Run detection tests: `npm test -- database-auto-init --grep "detectDatabaseState"`
- [x] 2.2.2 Fix any failing tests

---

## Phase 3: Implement Safe Initialization

### 3.1 Add initialization logic

- [x] 3.1.1 Create `initializeDatabaseSchema(dbPath: string, state: DatabaseState): Promise<void>`
- [x] 3.1.2 Implement case: `'missing'` - create new database with schema
- [x] 3.1.3 Implement case: `'empty'` - apply schema to existing empty file
- [x] 3.1.4 Implement case: `'current'` - no action, log status
- [x] 3.1.5 Implement case: `'needs_migration'` - apply pending migrations
- [x] 3.1.6 Implement case: `'corrupted'` - preserve and create new

### 3.2 Use Prisma for schema management

- [x] 3.2.1 Research: Use `prisma db push` programmatically via child_process
- [x] 3.2.2 Implement schema application using `npx prisma db push --skip-generate --accept-data-loss`
- [x] 3.2.3 Handle Prisma client regeneration if needed (skip-generate flag)

### 3.3 Verify tests pass

- [x] 3.3.1 Run initialization tests: `npm test -- database-auto-init --grep "initialization"`
- [x] 3.3.2 Fix any failing tests

---

## Phase 4: Implement Safety Features

### 4.1 Add backup functionality

- [x] 4.1.1 Implement `createDatabaseBackup(dbPath: string): Promise<string>` (returns backup path)
- [x] 4.1.2 Generate backup filename with ISO timestamp
- [x] 4.1.3 Verify backup integrity after creation

### 4.2 Add rollback functionality

- [x] 4.2.1 Implement `rollbackFromBackup(dbPath: string, backupPath: string): Promise<void>`
- [x] 4.2.2 Wrap migration in try/catch with rollback
- [x] 4.2.3 Clean up backup on successful migration (optional, configurable)

### 4.3 Add corrupted file handling

- [x] 4.3.1 Implement file rename with `.corrupted.{timestamp}` suffix
- [x] 4.3.2 Log warning about corrupted file location

### 4.4 Verify tests pass

- [x] 4.4.1 Run safety tests: `npm test -- database-auto-init --grep "safety"`
- [x] 4.4.2 Fix any failing tests

---

## Phase 5: Implement Schema Validation

### 5.1 Add validation functions

- [x] 5.1.1 Implement `validateSchema(dbPath: string): Promise<ValidationResult>`
- [x] 5.1.2 Define expected tables list from Prisma schema
- [x] 5.1.3 Check each table exists
- [x] 5.1.4 Return detailed results (missing tables, etc.)

### 5.2 Verify tests pass

- [x] 5.2.1 Run validation tests: `npm test -- database-auto-init --grep "validateSchema"`
- [x] 5.2.2 Fix any failing tests

---

## Phase 6: Integrate with App Startup

### 6.1 Update main.ts

- [x] 6.1.1 Call auto-initialization via new `initializeDatabaseAsync()` function
- [x] 6.1.2 Handle initialization errors gracefully
- [x] 6.1.3 Show user-friendly error dialog if initialization fails
- [x] 6.1.4 Add appropriate console logging

### 6.2 Update initializeDatabase function

- [x] 6.2.1 Create `initializeDatabaseAsync()` that calls detection and initialization internally
- [x] 6.2.2 Ensure backward compatibility (existing `initializeDatabase()` still works)

---

## Phase 7: Integration Testing

### 7.1 Manual testing scenarios

- [x] 7.1.1 Test: Delete ~/.bloom/dev.db, start app, verify database created
- [x] 7.1.2 Test: Create empty ~/.bloom/dev.db (touch), start app, verify schema applied
- [x] 7.1.3 Test: Use existing database with data, verify data preserved
- [x] 7.1.4 Test: Corrupt database file, verify preserved and new one created

Note: Manual testing scenarios are now covered by E2E tests in add-database-auto-init-e2e-tests proposal.

### 7.2 E2E test updates

- [x] 7.2.1 Verify existing E2E tests still pass
- [x] 7.2.2 Add E2E test for fresh install scenario (covered by add-database-auto-init-e2e-tests)

---

## Phase 8: Documentation and Cleanup

### 8.1 Code cleanup

- [x] 8.1.1 Run linter: `npm run lint`
- [x] 8.1.2 Run formatter: `npm run format`
- [x] 8.1.3 Review and clean up any TODO comments (none found in database.ts)

### 8.2 Update logging

- [x] 8.2.1 Ensure all initialization steps are logged
- [x] 8.2.2 Add timing information to logs
- [x] 8.2.3 Use consistent log format `[Database]` prefix

---

## Phase 9: Packaged App Support

### 9.1 Handle packaged app context

- [x] 9.1.1 Add `app.isPackaged` check to `applySchema` function
- [x] 9.1.2 Skip Prisma CLI execution in packaged apps (would fail with ENOTDIR)
- [x] 9.1.3 Log informational message about external migration requirement
- [x] 9.1.4 Update spec to document packaged vs development behavior

### 9.2 Update documentation

- [x] 9.2.1 Update spec with "Development vs Packaged Mode" section
- [x] 9.2.2 Add scenario for packaged app fresh install
- [x] 9.2.3 Document why packaged apps skip auto-init (asar archive limitation)

---

## Phase 10: Validation

### 10.1 OpenSpec validation

- [x] 10.1.1 Run `npx openspec validate add-database-auto-initialization --strict`
- [x] 10.1.2 Fix any validation errors

### 10.2 Full test suite

- [x] 10.2.1 Run unit test suite: `npm run test:unit -- database-auto-init`
- [x] 10.2.2 Run TypeScript check: `npx tsc --noEmit`
- [x] 10.2.3 Verify all tests pass (20/20 passing)
- [ ] 10.2.4 Verify CI packaged app test passes
