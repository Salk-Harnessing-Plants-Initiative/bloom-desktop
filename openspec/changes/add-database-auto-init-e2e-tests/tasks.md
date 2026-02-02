# Tasks: Add Database Auto-Initialization E2E Tests

## TDD Approach

This implementation follows Test-Driven Development:
1. Write failing tests first
2. Verify tests fail for the right reason (the feature works but isn't being tested)
3. Tests should pass once properly wired up

---

## Phase 1: Create E2E Test File and Utilities

### 1.1 Create test file structure

- [x] 1.1.1 Create `tests/e2e/database-auto-init.e2e.ts`
- [x] 1.1.2 Set up test utilities for database state manipulation

### 1.2 Create utility functions

- [x] 1.2.1 `createDatabaseWithTestData()` - Creates DB with schema and test Scientist
- [x] 1.2.2 `createCorruptedDatabase()` - Creates file with invalid content
- [x] 1.2.3 `verifyDatabaseTables()` - Checks all 7 tables exist using sqlite3 CLI
- [x] 1.2.4 `cleanupTestDatabase()` - Removes test DB and any backup/corrupted files

---

## Phase 2: Write E2E Tests for Each Scenario

### 2.1 Fresh install scenario

- [x] 2.1.1 Test: App creates database when none exists
- [x] 2.1.2 Verify: All 7 tables created
- [x] 2.1.3 Verify: App window displays without errors

### 2.2 Existing database scenario

- [x] 2.2.1 Test: App preserves existing database with current schema
- [x] 2.2.2 Verify: Pre-existing data is still accessible

### 2.3 Data persistence scenario

- [x] 2.3.1 Test: User data survives app restart
- [x] 2.3.2 Setup: Create DB with Scientist record before app launch
- [x] 2.3.3 Verify: Scientist appears on Scientists page

### 2.4 Corrupted database scenario

- [x] 2.4.1 Test: Corrupted database is preserved and new one created
- [x] 2.4.2 Verify: `.corrupted.{timestamp}` file exists
- [x] 2.4.3 Verify: New database has correct schema
- [x] 2.4.4 Verify: App window displays without errors

### 2.5 Empty database scenario

- [x] 2.5.1 Test: Empty file gets schema applied
- [x] 2.5.2 Verify: All 7 tables created from empty file

---

## Phase 3: Integration and Validation

### 3.1 Run tests locally

- [ ] 3.1.1 Run: `npm run test:e2e -- database-auto-init`
- [ ] 3.1.2 Verify all tests pass
- [ ] 3.1.3 Fix any issues found

### 3.2 OpenSpec validation

- [x] 3.2.1 Run: `npx openspec validate add-database-auto-init-e2e-tests --strict`
- [x] 3.2.2 Fix any validation errors

### 3.3 CI verification

- [ ] 3.3.1 Push changes
- [ ] 3.3.2 Verify CI passes with new E2E tests
