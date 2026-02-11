## 1. Unit Tests (TDD - Write First)

- [ ] 1.1 Create `tests/unit/database-async.test.ts` with tests for:
  - [ ] 1.1.1 `queryTablesWithCli` returns tables without blocking event loop
  - [ ] 1.1.2 `queryTablesWithCli` handles missing sqlite3 CLI gracefully
  - [ ] 1.1.3 `queryTablesWithCli` handles malformed database gracefully
  - [ ] 1.1.4 `applySchema` completes without blocking event loop
  - [ ] 1.1.5 `applySchema` handles prisma CLI failure gracefully
  - [ ] 1.1.6 `applySchema` skips in packaged mode (existing behavior preserved)

- [ ] 1.2 Create `tests/unit/components/AppReadyState.test.tsx` with tests for:
  - [ ] 1.2.1 App shows loading indicator when database not ready
  - [ ] 1.2.2 App renders main content after database:ready event
  - [ ] 1.2.3 App shows error message on database:error event
  - [ ] 1.2.4 Loading state is accessible (proper ARIA attributes)

## 2. Implementation - Database Async (Phase 1)

- [ ] 2.1 Create async exec helper in `src/main/database.ts`:
  - [ ] 2.1.1 Add `execAsync` wrapper using `child_process.exec` with promisify
  - [ ] 2.1.2 Add proper error handling and timeout support

- [ ] 2.2 Update `queryTablesWithCli()` in `src/main/database.ts`:
  - [ ] 2.2.1 Replace `execSync` with `execAsync`
  - [ ] 2.2.2 Preserve existing error handling behavior
  - [ ] 2.2.3 Add timeout to prevent hanging on slow systems

- [ ] 2.3 Update `applySchema()` in `src/main/database.ts`:
  - [ ] 2.3.1 Replace `execSync` with `execAsync`
  - [ ] 2.3.2 Preserve packaged app early-return behavior
  - [ ] 2.3.3 Add timeout for prisma CLI (30 seconds)
  - [ ] 2.3.4 Improve error messages for CLI failures

## 3. Implementation - App Readiness (Phase 2)

- [ ] 3.1 Update `src/main/preload.ts`:
  - [ ] 3.1.1 Add `onDatabaseReady(callback)` to preload API
  - [ ] 3.1.2 Add `onDatabaseError(callback)` to preload API
  - [ ] 3.1.3 Add cleanup function to remove listeners

- [ ] 3.2 Update `src/renderer/App.tsx`:
  - [ ] 3.2.1 Add `isDatabaseReady` state (default: false)
  - [ ] 3.2.2 Add `databaseError` state for error messages
  - [ ] 3.2.3 Listen for database:ready on mount
  - [ ] 3.2.4 Show loading spinner while not ready
  - [ ] 3.2.5 Show error UI if database:error received
  - [ ] 3.2.6 Add `data-testid="app-ready"` when fully loaded

## 4. Implementation - E2E Test Updates (Phase 3)

- [ ] 4.1 Create `tests/e2e/helpers/app-ready.ts`:
  - [ ] 4.1.1 Add `waitForAppReady(window, timeout)` helper
  - [ ] 4.1.2 Wait for `[data-testid="app-ready"]` element
  - [ ] 4.1.3 Add descriptive error message on timeout

- [ ] 4.2 Update E2E test launch helpers:
  - [ ] 4.2.1 Update `accession-excel-upload.e2e.ts` to use `waitForAppReady`
  - [ ] 4.2.2 Update `accessions-management.e2e.ts` to use `waitForAppReady`
  - [ ] 4.2.3 Update `scientists-management.e2e.ts` to use `waitForAppReady`
  - [ ] 4.2.4 Update `phenotypers-management.e2e.ts` to use `waitForAppReady`
  - [ ] 4.2.5 Update `experiments-management.e2e.ts` to use `waitForAppReady`
  - [ ] 4.2.6 Update `experiment-accession-indicator.e2e.ts` to use `waitForAppReady`
  - [ ] 4.2.7 Update `plant-barcode-validation.e2e.ts` to use `waitForAppReady`
  - [ ] 4.2.8 Update `app-launch.e2e.ts` to use `waitForAppReady`
  - [ ] 4.2.9 Update `renderer-database-ipc.e2e.ts` to use `waitForAppReady`
  - [ ] 4.2.10 Update `machine-config-fetch-scanners.e2e.ts` to use `waitForAppReady`
  - [ ] 4.2.11 Update `database-auto-init.e2e.ts` to use `waitForAppReady`

## 5. Verification

- [ ] 5.1 Run unit tests locally: `npm run test:unit`
- [ ] 5.2 Run E2E tests locally: `npm run test:e2e`
- [ ] 5.3 Verify app startup feels responsive (no visible freeze)
- [ ] 5.4 Push and verify CI passes all E2E tests
- [ ] 5.5 Test packaged app still works correctly

## 6. Documentation

- [ ] 6.1 Update memory file with async patterns learned
- [ ] 6.2 Add inline comments explaining why async is required
