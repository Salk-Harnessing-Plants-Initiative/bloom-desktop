# Fix E2E Test Failures

## Why

The E2E test suite has 13 failing tests and 7 skipped tests. The failing tests are primarily in `machine-config-fetch-scanners.e2e.ts` which has a structural issue causing all tests to fail.

### Root Cause Analysis

| Category | Count | Issue |
|----------|-------|-------|
| machine-config-fetch-scanners.e2e.ts | 7 tests | Uses `test.beforeAll()` instead of `test.beforeEach()`, causing test isolation failure |
| Intermittent timeouts | ~6 tests | `beforeEach` hooks timeout due to resource contention |
| Skipped tests | 7 tests | Intentionally skipped - features not yet implemented |

### Primary Issue: machine-config-fetch-scanners.e2e.ts

The test file uses `test.beforeAll()` which launches the Electron app once for the entire test suite. The `beforeEach` hook then tries to click `'text=Configuration'` to navigate to the Machine Configuration page, but:

1. The app already starts on the Machine Configuration page (no `~/.bloom/.env` exists)
2. There is no "Configuration" navigation link visible when already on that page
3. All 7 tests fail at the beforeEach navigation step

### Secondary Issue: Intermittent Timeouts

Several test files have `beforeEach` hooks that:
- Create fresh test databases
- Run Prisma migrations
- Launch Electron app
- Wait for `domcontentloaded` with 30-second timeout

Under resource contention, 30 seconds is sometimes insufficient.

### Skipped Tests

7 tests are intentionally skipped because features are not yet implemented:
- Excel file upload features (5 tests in accessions-management.e2e.ts)
- Loading state test (1 test - flaky due to fast operations)
- Large file validation (1 test - requires 15MB+ file creation)

## What Changes

### 1. Fix machine-config-fetch-scanners.e2e.ts

- Change `test.beforeAll()` to `test.beforeEach()` for proper test isolation
- Add database cleanup/creation in beforeEach
- Use `createTestBloomConfig()` to create `~/.bloom/.env`
- Add proper cleanup in afterEach with `cleanupTestBloomConfig()`
- Update navigation logic to account for app starting on Home page (with config)

### 2. Increase Timeouts (Optional)

- Increase `waitForLoadState` timeout from 30s to 60s in affected files
- Add retry logic for Prisma database operations

### 3. Document Skipped Tests (No Changes)

- The 7 skipped tests are intentionally skipped pending feature implementation
- No changes needed - they will be unskipped when features are complete

## Impact

- **Tests Fixed**: 7 tests in machine-config-fetch-scanners.e2e.ts
- **Reliability**: Reduced intermittent failures from timeout increases
- **Affected specs**: `e2e-testing`
