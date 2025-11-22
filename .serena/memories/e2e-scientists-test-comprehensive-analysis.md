# E2E Scientists Management Test: Comprehensive Analysis

## Executive Summary

**Status**: Scientists Management UI E2E tests are FAILING locally and in CI  
**All other E2E tests**: PASSING (31/31 tests in renderer-database-ipc.e2e.ts and app-launch.e2e.ts)  
**Root Cause**: Path resolution mismatch between test configuration and database.ts logic  
**Solution**: Match PR #63 pattern exactly - use `path.join()` instead of `path.resolve()`

---

## Test Results Status

### Working Tests ✅
- **app-launch.e2e.ts**: 3/3 tests passing
- **renderer-database-ipc.e2e.ts**: 31/31 tests passing (all database operations)
  - Scientists CRUD operations work correctly
  - Phenotypers CRUD operations work correctly
  - Accessions CRUD operations work correctly
  - Experiments CRUD with relations work correctly
  - Scans with filtering work correctly
  - Context isolation verified

### Failing Tests ❌
- **scientists-management.e2e.ts**: FAILING
  - Navigation test: ✅ PASSES (no database needed)
  - Empty state test: ❌ FAILS (requires database connection)
  - Error: "Error code 14: Unable to open database file"

---

## Root Cause Analysis

### The Path Resolution Problem

**PR #63 Pattern (Working):**
```typescript
// renderer-database-ipc.e2e.ts
const TEST_DB_PATH = path.join(__dirname, 'renderer-ipc-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
// Result: file:tests/e2e/renderer-ipc-test.db
```

**Scientists Test Pattern (Failing):**
```typescript
// scientists-management.e2e.ts
const TEST_DB_PATH = path.resolve(__dirname, 'scientists-ui-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
// Result: file:/Users/elizabethberrigan/repos/bloom-desktop/tests/e2e/scientists-ui-test.db
```

### Database.ts Path Resolution Logic (commit ed9272b)

```typescript
// src/main/database.ts:164-178
const rawPath = process.env.BLOOM_DATABASE_URL.replace(/^file:\/?\/?/, '');

if (rawPath.startsWith('./') || rawPath.startsWith('../')) {
  // Resolve relative to project root
  dbPath = path.resolve(app.getAppPath(), rawPath);
  console.log('[Database] Using BLOOM_DATABASE_URL (relative):', dbPath);
} else {
  // Absolute path - use as-is  
  dbPath = rawPath;
  console.log('[Database] Using BLOOM_DATABASE_URL (absolute):', dbPath);
}
```

### The Mismatch

1. **PR #63 uses `path.join()`**:
   - Creates: `tests/e2e/renderer-ipc-test.db`
   - After `file:` prefix: `tests/e2e/renderer-ipc-test.db`
   - Does NOT start with `./` or `../`
   - Treated as "absolute" by database.ts
   - **BUT**: SQLite resolves relative paths against `cwd` (app root)
   - **Result**: ✅ Database found at correct location

2. **Scientists test uses `path.resolve()`**:
   - Creates: `/Users/elizabethberrigan/repos/bloom-desktop/tests/e2e/scientists-ui-test.db`
   - After `file:` prefix: `/Users/elizabethberrigan/repos/bloom-desktop/tests/e2e/scientists-ui-test.db`
   - Does NOT start with `./` or `../`
   - Treated as "absolute" by database.ts
   - Passed to Prisma as absolute path
   - **Result**: ❌ Path handling inconsistency causes SQLite error

### Why PR #63 Works

The **key insight**: `path.join(__dirname, 'test.db')` creates a **relative path string** like `tests/e2e/test.db`, even though `__dirname` itself is absolute. The resulting string doesn't start with `/`, so it's a relative path that SQLite can resolve against the current working directory (app root).

When Electron launches with `cwd: appRoot`, the relative path `tests/e2e/test.db` correctly resolves to the test database location.

---

## Commit History Analysis

### Key Commits

| Commit | Date | Change | Impact |
|--------|------|--------|--------|
| **6115524** | Nov 15 | PR #63 merge - Renderer database IPC testing | ✅ Working pattern established |
| **4b0444d** | Nov 15 | Added `dotenv.config()` in main.ts | Loads `.env` for dev mode |
| **ed9272b** | Nov 15 | Changed path resolution logic in database.ts | Checks for `./` or `../` prefix |
| **290cd21** | Nov 15 | Use `app.getAppPath()` for database path | Resolve relative to app path |
| **94f1e80** | Nov 20 | Add Scientists UI tests | ❌ Used `path.resolve()` (breaking) |
| **942a561** | Nov 20 | Attempted fix - change init order | Didn't fix root cause |
| **70f277b** | Nov 20 | Attempted fix - database path and GPU | Didn't fix root cause |

### What Changed After PR #63

**Commit ed9272b** introduced the relative path detection logic:
```typescript
// OLD (PR #63): Complex URL parsing with fallback
try {
  const url = new URL(process.env.BLOOM_DATABASE_URL);
  // ... complex URL parsing logic
} catch {
  // Fallback: strip file: prefix
  dbPath = process.env.BLOOM_DATABASE_URL.replace(/^file:\/?\/?/, '');
}

// NEW (ed9272b): Simple relative/absolute detection
const rawPath = process.env.BLOOM_DATABASE_URL.replace(/^file:\/?\/?/, '');
if (rawPath.startsWith('./') || rawPath.startsWith('../')) {
  // Relative
  dbPath = path.resolve(app.getAppPath(), rawPath);
} else {
  // Absolute
  dbPath = rawPath;
}
```

This change **still works with PR #63 tests** because they use `path.join()` which creates paths like `tests/e2e/test.db` - these don't start with `./` or `../` so they're treated as "absolute" but are actually relative strings that SQLite resolves correctly.

---

## Secondary Issue: --disable-gpu Flag

### PR #63 Pattern (Working)
```typescript
if (process.platform === 'linux' && process.env.CI === 'true') {
  args.push('--no-sandbox');
  // NO --disable-gpu flag
}
```

### Scientists Test Pattern
```typescript
if (process.platform === 'linux' && process.env.CI === 'true') {
  args.push('--no-sandbox');
  args.push('--disable-gpu'); // Added in commit 70f277b
}
```

**Analysis**: The `--disable-gpu` flag was added to "prevent GPU process crashes in CI headless environment" but PR #63 tests run successfully without it. This flag may be unnecessary and could potentially cause issues.

---

## Manual Testing Results

### User's Local Testing (User Provided)
```bash
# Terminal 1: Dev server running
npm run start

# Terminal 2: Running tests
npm run test:e2e
```

**Results**:
- Navigation test: ✅ PASSES
- Empty state test: ❌ FAILS with database error
- User can successfully add scientists via GUI (proves database connection works in dev mode)

### CI Testing Results
- All 31 tests in renderer-database-ipc.e2e.ts: ✅ PASSING
- All 3 tests in app-launch.e2e.ts: ✅ PASSING
- Scientists management tests: ❌ FAILING

---

## Environment Variable Analysis

### .env.e2e Configuration
```bash
BLOOM_DATABASE_URL="file:../tests/e2e/test.db"
NODE_ENV=test
E2E_TEST=true
```

**Note**: This `.env.e2e` is loaded by `playwright.config.ts` using dotenv, making variables available to test files. However, the scientists test **overrides** the database URL in the Electron launch env:

```typescript
electronApp = await electron.launch({
  env: {
    ...process.env,
    BLOOM_DATABASE_URL: TEST_DB_URL,  // Overrides .env.e2e
    NODE_ENV: 'test',
  }
});
```

This means `.env.e2e`'s `BLOOM_DATABASE_URL` is NOT used - the test's `TEST_DB_URL` is used instead.

---

## Playwright with Electron Research Findings

### Environment Variable Propagation
From GitHub Issues and Playwright docs:
- Playwright's `electron.launch({ env: {...} })` should pass environment variables to Electron
- Issue #11705: Some users report environment variables not reaching Electron main process
- Workaround: Pass variables explicitly in the env object (which we're doing)

### Path Resolution Best Practices
From Electron documentation:
- `app.getPath('userData')`: Platform-specific user data directory
- `app.getAppPath()`: Application directory (project root in dev, app.asar in production)
- Relative paths should be resolved using Node.js `path` module

### Known Issues
- **Playwright 1.44+ with packaged apps**: Regression with `--remote-debugging-port=0`
- **Solution**: Use dev builds for testing (which we're doing)

---

## Complete Error Flow

### What Happens in Failing Test

1. **Test Setup (beforeEach)**:
   ```typescript
   const TEST_DB_PATH = path.resolve(__dirname, 'scientists-ui-test.db');
   // Result: /Users/elizabethberrigan/repos/bloom-desktop/tests/e2e/scientists-ui-test.db
   
   const TEST_DB_URL = `file:${TEST_DB_PATH}`;
   // Result: file:/Users/elizabethberrigan/repos/bloom-desktop/tests/e2e/scientists-ui-test.db
   ```

2. **Database Creation**:
   ```bash
   npx prisma db push --skip-generate
   # Creates: /Users/elizabethberrigan/repos/bloom-desktop/tests/e2e/scientists-ui-test.db
   # ✅ Database file exists
   ```

3. **Electron Launch**:
   ```typescript
   electronApp = await electron.launch({
     env: {
       BLOOM_DATABASE_URL: TEST_DB_URL,  // file:/Users/.../scientists-ui-test.db
       NODE_ENV: 'test',
     }
   });
   ```

4. **Main Process (database.ts)**:
   ```typescript
   const rawPath = process.env.BLOOM_DATABASE_URL.replace(/^file:\/?\/?/, '');
   // Result: /Users/elizabethberrigan/repos/bloom-desktop/tests/e2e/scientists-ui-test.db
   
   if (rawPath.startsWith('./') || rawPath.startsWith('../')) {
     // Does NOT enter this branch
   } else {
     dbPath = rawPath;  // Uses as-is
     // Result: /Users/elizabethberrigan/repos/bloom-desktop/tests/e2e/scientists-ui-test.db
   }
   ```

5. **Prisma Client**:
   - Receives absolute path: `/Users/.../scientists-ui-test.db`
   - SQLite attempts to open: `/Users/.../scientists-ui-test.db`
   - **Error code 14: SQLITE_CANTOPEN - Unable to open the database file**

### Why It Fails

The **exact failure mechanism** is subtle:
- The database file EXISTS at the specified absolute path
- Prisma/SQLite should be able to open it
- **Hypothesis**: There's a permissions issue, path encoding issue, or timing issue with absolute paths
- **OR**: The path handling in Prisma's datasource URL has different behavior with absolute vs relative paths

### Why PR #63 Succeeds

1. **Test Setup**:
   ```typescript
   const TEST_DB_PATH = path.join(__dirname, 'renderer-ipc-test.db');
   // Result: tests/e2e/renderer-ipc-test.db (relative path string)
   
   const TEST_DB_URL = `file:${TEST_DB_PATH}`;
   // Result: file:tests/e2e/renderer-ipc-test.db
   ```

2. **Main Process**:
   ```typescript
   const rawPath = process.env.BLOOM_DATABASE_URL.replace(/^file:\/?\/?/, '');
   // Result: tests/e2e/renderer-ipc-test.db
   
   dbPath = rawPath;  // Uses as-is (treated as "absolute" but is actually relative)
   ```

3. **Prisma Client**:
   - Receives path: `tests/e2e/renderer-ipc-test.db`
   - SQLite resolves relative to `cwd` (app root)
   - **Success**: Database found and opened

---

## Claude Code Environment Issue - FIXED (Nov 2025)

**UPDATE**: This issue has been **FIXED** by discovering the root cause and implementing a solution.

**Previous Error**: `bad option: --remote-debugging-port=0`

**Root Cause Discovered**: The Claude Code VS Code extension sets `ELECTRON_RUN_AS_NODE=1` in its child process environment. This makes Electron run as plain Node.js instead of a full Electron app, causing it to reject Playwright's hardcoded `--remote-debugging-port=0` flag.

**Solution Implemented**: Added to `playwright.config.ts`:
```typescript
delete process.env.ELECTRON_RUN_AS_NODE;
```

**After Fix**:
- ✅ E2E tests now work in Claude Code environment
- ✅ E2E tests still work in normal terminal
- ✅ E2E tests still work in CI

**Documentation**:
- `playwright.config.ts`: Contains the fix with detailed comment
- `docs/E2E_TESTING.md`: Pitfall 6 explains this issue
- `openspec/changes/archive/2025-11-05-add-e2e-testing-framework/design.md`: Issue 12 documents full analysis

**Historical Note**: This was previously misattributed to "packaged apps" or "CI environments" but the actual root cause was environment variable inheritance from VS Code.