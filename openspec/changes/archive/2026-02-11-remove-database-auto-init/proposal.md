# Remove Database Auto-Initialization Feature

## Why

The database auto-initialization feature was based on incorrect assumptions and has created technical debt across the codebase. This proposal removes the feature while preserving the necessary E2E test compatibility.

### Feature Analysis

| Context                       | Auto-Init Works? | Notes                                             |
| ----------------------------- | ---------------- | ------------------------------------------------- |
| Development (`npm run start`) | ✅ Yes           | Only context where it works                       |
| E2E Tests                     | ❌ No            | Causes hangs with blocking external process calls |
| **Packaged App (Production)** | ❌ No            | Explicitly skipped (`app.isPackaged`)             |

**Conclusion**: The feature only benefits developers, not end users. The complexity cost outweighs the benefit.

### Root Cause Analysis of E2E Test Failures

Based on git history analysis (commits 6467c72 → daaba62):

1. **Primary Cause: Database Auto-Init Blocking Calls**
   - `ensureDatabaseReady()` calls external processes via `execSync` (blocking)
   - `sqlite3` CLI for state detection
   - `npx prisma migrate deploy` for schema application
   - On Ubuntu CI with xvfb-run, these calls can hang indefinitely
   - This blocks the main process event loop, causing Playwright timeouts

2. **Secondary Issue: Playwright Remote Debugging Connection**
   - When `ensureDatabaseReady()` is skipped in E2E mode, app initializes too fast
   - Playwright uses `--remote-debugging-port=0` to connect to Electron
   - Fast initialization prevents Playwright from establishing the debugger connection
   - `electron.launch()` hangs for 60 seconds waiting for the connection
   - **Solution**: 100ms delay gives Playwright time to connect (confirmed by testing)

3. **Separate Issue: Machine Configuration Redirect**
   - Home.tsx redirects to `/machine-config` when `~/.bloom/.env` doesn't exist
   - This affects which page loads, but does NOT cause timeouts
   - Tests that expect Home page need `~/.bloom/.env` to exist

## What Changes

### 1. Remove Database Auto-Init Feature (DONE)

- ✅ Removed `ensureDatabaseReady()`, `detectDatabaseState()`, `initializeDatabaseSchema()`, `validateSchema()`, `createDatabaseBackup()`, `rollbackFromBackup()`, `handleCorruptedDatabase()` from `database.ts`
- ✅ Simplified `initializeDatabaseAsync()` - removed auto-schema setup
- ✅ Removed `tests/e2e/database-auto-init.e2e.ts`
- ✅ Removed `tests/unit/database-auto-init.test.ts`

### 2. Preserve E2E Test Compatibility (DONE)

- ✅ Keep 100ms delay when `E2E_TEST=true` for Playwright debugging connection
- ✅ Add `createTestBloomConfig()` helper to create `~/.bloom/.env` for tests
- ✅ Update all E2E tests to use the new helper

### 3. Update Documentation (DONE)

- ✅ Updated `.claude/commands/ci-debug.md` with correct Machine Configuration section
- ✅ Deleted incorrect Serena memory: `e2e-ci-failure-debugging`
- ✅ Updated `specs/e2e-testing/spec.md` with correct requirements

## Impact

- **Simplification**: Removed ~400 lines of auto-init code
- **Reliability**: E2E tests pass because blocking calls are removed
- **Clarity**: Documentation now correctly explains the root causes
- **Affected specs**: `e2e-testing`
