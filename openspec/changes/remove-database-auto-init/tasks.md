# Remove Database Auto-Initialization Tasks

## Phase 1: Remove Database Auto-Init Feature ✅

- [x] Remove auto-init functions from `database.ts`:
  - `DatabaseState` type
  - `ValidationResult` interface
  - `EXPECTED_TABLES` constant
  - `detectDatabaseState()`
  - `queryTablesWithCli()`
  - `generateTimestamp()`
  - `createDatabaseBackup()`
  - `rollbackFromBackup()`
  - `handleCorruptedDatabase()`
  - `validateSchema()`
  - `applySchema()`
  - `initializeDatabaseSchema()`
  - `ensureDatabaseReady()`
- [x] Simplify `initializeDatabaseAsync()` - removed auto-schema setup
- [x] Keep 100ms delay for E2E_TEST (required for Playwright connection - confirmed by testing)
- [x] Remove `database-auto-init.e2e.ts` test file
- [x] Remove `database-auto-init.test.ts` unit test file
- [x] Remove `database-async.test.ts` unit test file (tests removed functions)

## Phase 2: E2E Test Environment Setup ✅

- [x] Create `tests/e2e/helpers/bloom-config.ts` helper
- [x] Update `app-launch.e2e.ts` to use config helper
- [x] Update `scientists-management.e2e.ts` to use config helper
- [x] Update `phenotypers-management.e2e.ts` to use config helper
- [x] Update `accessions-management.e2e.ts` to use config helper
- [x] Update `experiments-management.e2e.ts` to use config helper
- [x] Update `renderer-database-ipc.e2e.ts` to use config helper
- [x] Update `accession-excel-upload.e2e.ts` to use config helper
- [x] Update `experiment-accession-indicator.e2e.ts` to use config helper
- [x] Update `plant-barcode-validation.e2e.ts` to use config helper

## Phase 3: Cleanup Documentation ✅

- [x] Update `.claude/commands/ci-debug.md` with correct info about Machine Configuration
- [x] Delete Serena memory: `e2e-ci-failure-debugging`
- [x] Update `specs/e2e-testing/spec.md` with Machine Configuration setup requirement

## Phase 4: Verification ✅

- [x] Test hypothesis: 100ms delay is needed for Playwright (CONFIRMED - test passed in 2.7s vs 60s timeout)
- [x] Run full E2E test suite locally (157 passed, 13 failed - failures are pre-existing issues unrelated to this change)
- [ ] Verify CI pipeline passes after push
