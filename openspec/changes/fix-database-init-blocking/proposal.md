# Fix Database Initialization Blocking Main Process

## Why

The database auto-initialization feature (added in commit `6467c72`) uses synchronous `execSync` calls that block the Electron main process event loop during startup. This causes:

1. **E2E test failures**: Tests timeout at 60 seconds because the UI doesn't render while main process is blocked
2. **Poor UX in development**: App appears frozen during the 1.5+ second Prisma CLI execution
3. **Minor prod impact**: Brief (~200-400ms) freeze during sqlite3 CLI calls

The tests revealed this architectural issue - blocking the main process event loop is an anti-pattern in Electron that breaks IPC communication and UI responsiveness.

## What Changes

### Phase 1: Non-blocking Database Initialization (Required)

Replace synchronous `execSync` calls with async `exec` using promises:

- **`src/main/database.ts`**:
  - `queryTablesWithCli()` - change to async exec for sqlite3 CLI
  - `applySchema()` - change to async exec for prisma CLI

### Phase 2: App Readiness Coordination (Required)

Add explicit app readiness signaling so renderer and tests know when database is ready:

- **`src/main/preload.ts`**:
  - Expose `onDatabaseReady` and `onDatabaseError` event listeners

- **`src/renderer/App.tsx`** (or new context):
  - Add `isDatabaseReady` state
  - Show loading indicator until database ready
  - Listen for `database:ready` event

### Phase 3: E2E Test Robustness (Required)

Update tests to properly wait for app readiness:

- **`tests/e2e/helpers/`**:
  - Add `waitForAppReady()` helper that waits for ready indicator
  - Update `launchElectronApp()` pattern across test files

## Impact

- **Affected specs**: `configuration` (database auto-initialization requirements unchanged, implementation improved)
- **Affected code**:
  - `src/main/database.ts` (2 functions)
  - `src/main/preload.ts` (add event listeners)
  - `src/renderer/App.tsx` (add ready state)
  - `tests/e2e/*.e2e.ts` (11 files - update launch pattern)

## Testing Strategy (TDD)

### Unit Tests (write first)

1. `tests/unit/database-async.test.ts`:
   - Test that `queryTablesWithCli` returns correct tables without blocking
   - Test that `applySchema` completes without blocking
   - Test error handling for failed CLI commands

2. `tests/unit/app-ready-state.test.tsx`:
   - Test that App shows loading state initially
   - Test that App renders main content after database:ready
   - Test that App shows error state on database:error

### E2E Tests (verify fix)

- All existing E2E tests should pass after fix
- Specifically `accession-excel-upload.e2e.ts` tests that currently timeout

## Related Issues

- GitHub Issue #86: Production sqlite3 blocking (tracks prod-specific aspect)
- PR #84: Machine Configuration feature (blocked by this issue)

## Acceptance Criteria

1. All `execSync` calls in database.ts replaced with async alternatives
2. Renderer shows loading state during database initialization
3. All E2E tests pass in CI (including `accession-excel-upload.e2e.ts`)
4. App startup feels responsive (no visible freeze)
5. Unit tests cover async database operations
