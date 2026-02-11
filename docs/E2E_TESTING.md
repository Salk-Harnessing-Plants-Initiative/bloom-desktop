# E2E Testing Guide

End-to-end testing for Bloom Desktop using Playwright to test the complete Electron application flow.

## Table of Contents

1. [Overview](#overview)
2. [Quick Start (Local Development)](#quick-start-local-development)
3. [Architecture & Requirements](#architecture--requirements)
4. [Running Tests](#running-tests)
5. [CI/CD Integration](#cicd-integration)
6. [Common Pitfalls & Solutions](#common-pitfalls--solutions)
7. [Debugging](#debugging)
8. [Troubleshooting](#troubleshooting)
9. [Related Documentation](#related-documentation)

## Overview

### What E2E Tests Are

E2E (End-to-End) tests verify the complete application flow from start to finish, testing the app as a user would experience it. Our E2E tests use [Playwright](https://playwright.dev/) to:

- Launch the Electron application
- Verify window creation and visibility
- Test database initialization
- Check UI rendering and content
- Validate React app loading

### What They Test

- ✅ Application launch and window creation
- ✅ Database initialization on startup
- ✅ Page content rendering
- ✅ Document title setting
- ✅ UI element visibility

### What They Don't Test

- ❌ Packaged applications (see [PACKAGED_APP_TESTING.md](PACKAGED_APP_TESTING.md))
- ❌ Python hardware integration (see integration tests)
- ❌ Production builds (E2E tests use dev build only)

## Quick Start (Local Development)

> ⚠️ **CRITICAL**: E2E tests require the dev server to be running on port 9000 BEFORE you run the tests!

### Step 1: Start the Dev Server

In **Terminal 1** (keep this running):

```bash
npm run start
```

Wait for the message:

```
› Output Available: http://localhost:9000
✔ Launched Electron app
```

### Step 2: Run the Tests

In **Terminal 2**:

```bash
npm run test:e2e
```

### Why This Is Required

The tests **do not** start their own dev server. They launch Electron directly, which loads the renderer from `http://localhost:9000`. Without the dev server running, the Electron window opens but remains completely blank.

## Architecture & Requirements

### Dependencies

**dotenv** (`devDependencies`)

- Used **only** by `playwright.config.ts` to load `.env.e2e` during test setup
- **Not needed** at Electron runtime - the main process doesn't import dotenv
- Correctly placed in `devDependencies` (not `dependencies`) to keep production bundle minimal
- Environment variables loaded by Playwright are passed to Electron via `process.env`

### Why Dev Server is Required

Bloom Desktop uses Electron Forge's webpack plugin, which configures the renderer to load from a dev server URL rather than a file path.

**Key Architecture Points:**

1. **`MAIN_WINDOW_WEBPACK_ENTRY`** is set to `http://localhost:9000` (not a file path)
2. This URL is **baked into the webpack build** at compile time
3. The renderer process **always** loads from this URL in dev mode
4. Without the dev server, Electron launches successfully but the UI is blank

**Architecture Diagram:**

```
┌─────────────────────────────────────────────────────────┐
│ Playwright Test (app-launch.e2e.ts)                    │
│                                                         │
│  1. electron.launch()                                   │
│     └─> Launches: .webpack/main/index.js               │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Electron Main Process (.webpack/main/index.js)         │
│                                                         │
│  2. mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY)      │
│     └─> Points to: http://localhost:9000               │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│ Dev Server (npm run start)                              │
│                                                         │
│  3. Serves renderer from:                               │
│     http://localhost:9000                               │
│     └─> React app, bundled assets, HMR                 │
└─────────────────────────────────────────────────────────┘
```

### Platform-Specific Requirements

#### Linux (Ubuntu CI)

- **Xvfb** (X Virtual FrameBuffer) - Required for headless display
- **ELECTRON_DISABLE_SANDBOX=1** - Required in CI environments (no SUID sandbox permissions)
- **--no-sandbox** flag - Added automatically by tests when `CI=true`
- **Longer startup times** - Ubuntu CI runners are slower (~45s vs ~30s)

#### macOS

- No special configuration needed
- Native display works out of the box
- Fastest startup times

#### Windows

- No special configuration needed
- Uses PowerShell in CI (requires `shell: bash` for cross-platform scripts)
- Moderate startup times

## Running Tests

### Local Development

```bash
# Standard run (headless)
npm run test:e2e

# UI mode (recommended for development/debugging)
npm run test:e2e:ui

# Debug mode (step through with debugger)
npm run test:e2e:debug
```

### Test Files

- **`tests/e2e/app-launch.e2e.ts`** - Main E2E test suite
  - Test 1: Application launch and window visibility
  - Test 2: Database initialization
  - Test 3: Page content rendering

### Test Isolation

Each test runs in isolation:

- **beforeEach**: Creates fresh test database, launches new Electron instance
- **afterEach**: Closes app, cleans up test database
- **Test database**: `tests/e2e/test.db` (separate from `prisma/dev.db`)
- **Environment**: Loaded from `.env.e2e`

## Test Coverage Requirements

### IPC Handler Coverage Check

E2E tests include automated coverage analysis for database IPC handlers to ensure comprehensive testing of the renderer-main bridge.

**Run coverage check:**

```bash
npm run test:e2e:coverage
```

**Coverage requirements:**

- **Minimum threshold**: 90% of IPC handlers must be tested
- **CI enforcement**: Coverage check runs automatically in CI and fails PRs below threshold
- **Current coverage**: 93.3% (14/15 handlers)

**Example output:**

```
=== Renderer Database IPC Test Coverage Analysis ===

📊 Total IPC Handlers Found: 15

🗂️  EXPERIMENTS
------------------------------------------------------------
  ✅ create       db:experiments:create          (2 test calls)
  ✅ delete       db:experiments:delete          (2 test calls)
  ✅ get          db:experiments:get             (1 test calls)
  ✅ list         db:experiments:list            (1 test calls)
  ✅ update       db:experiments:update          (2 test calls)

📈 Coverage Summary:
  Tested handlers: 14/15
  Coverage: 93.3%
  Total test method calls: 27
```

**What gets checked:**

- All `ipcMain.handle()` registrations in `src/main/database-handlers.ts`
- Test method calls in `tests/e2e/renderer-database-ipc.e2e.ts`
- Coverage organized by model (Experiments, Scans, Scientists, etc.)

**When to update tests:**

- When adding new IPC handlers to `database-handlers.ts`
- When coverage drops below 90% threshold
- When removing handlers (tests should be removed too)

## CI/CD Integration

### How CI Runs E2E Tests

The GitHub Actions workflow (`.github/workflows/pr-checks.yml`) runs E2E tests in this sequence:

#### Step 1: Build Python Executable

```bash
npm run build:python
```

#### Step 2: Generate Prisma Client

```bash
npx prisma generate
```

#### Step 3: Start Dev Server (Platform-Specific)

**Linux:**

```yaml
- name: Start Electron Forge dev server in background (Linux with Xvfb)
  if: runner.os == 'Linux'
  env:
    ELECTRON_DISABLE_SANDBOX: 1
  run: |
    xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" npm run start &
    echo $! > electron-forge.pid
    sleep 45  # Wait for webpack build + server startup
```

**macOS/Windows:**

```yaml
- name: Start Electron Forge dev server in background (macOS/Windows)
  if: runner.os != 'Linux'
  run: |
    npm run start &
    echo $! > electron-forge.pid
    sleep 30  # Faster than Linux
```

#### Step 4: Run E2E Tests (Platform-Specific)

**Linux:**

```yaml
- name: Run Playwright E2E tests (Linux with Xvfb)
  if: runner.os == 'Linux'
  run: xvfb-run --auto-servernum --server-args="-screen 0 1280x960x24" npm run test:e2e
  env:
    CI: true
```

**macOS/Windows:**

```yaml
- name: Run Playwright E2E tests (macOS/Windows)
  if: runner.os != 'Linux'
  run: npm run test:e2e
  env:
    CI: true
```

#### Step 5: Stop Dev Server

```yaml
- name: Stop Electron Forge dev server
  if: always() # Run even if tests fail
  run: node scripts/stop-electron-forge.js
```

### Why Platform-Specific Steps?

1. **Linux needs Xvfb** - CI runners have no physical display
2. **Linux needs sandbox disabled** - GitHub Actions doesn't allow SUID sandbox permissions
3. **Timing varies** - Ubuntu runners are slower than macOS/Windows
4. **Same tests, different environment** - Code is identical, only execution environment differs

### Wait Times Explained

- **Linux: 45 seconds** - Slower CI runners + Xvfb overhead
- **macOS: 30 seconds** - Faster runners, native display
- **Windows: 30 seconds** - Moderate speed, native display

These are empirically determined values from CI testing. Too short = tests fail to connect to dev server. Too long = wasted CI time.

## Common Pitfalls & Solutions

### ❌ Pitfall 1: Port Conflict Error (Windows)

**Symptom:**

```
Error: listen EADDRINUSE: address already in use :::9000
```

**Cause:** Running `electron-forge start` twice in parallel (e.g., both `build-webpack-dev.js` and `npm run start`).

**Solution:** Only start the dev server once. The CI workflow has been fixed to avoid this issue.

**Historical Note:** Early implementation ran webpack build AND dev server separately, causing port conflicts on Windows.

---

### ❌ Pitfall 2: Blank Electron Window

**Symptom:** Electron window opens but shows no content, tests timeout waiting for page elements.

**Cause:** Dev server is not running on port 9000.

**Solution:**

```bash
# Terminal 1
npm run start

# Terminal 2
npm run test:e2e
```

**How to Verify Dev Server is Running:**

```bash
# macOS/Linux
lsof -i :9000

# Windows
netstat -ano | findstr :9000

# All platforms (check HTTP response)
curl http://localhost:9000
```

---

### ❌ Pitfall 3: Ubuntu CI Failures

**Symptom:**

```
[ERROR:ozone_platform_x11.cc(240)] Missing X server or $DISPLAY
[ERROR:env.cc(257)] The platform failed to initialize. Exiting.
```

**Cause:** Dev server started outside of Xvfb (no display available).

**Solution:** Already fixed in CI workflow - dev server runs inside `xvfb-run` on Linux.

---

### ❌ Pitfall 4: SUID Sandbox Error (Linux)

**Symptom:**

```
FATAL:setuid_sandbox_host.cc(158)] The SUID sandbox helper binary was found,
but is not configured correctly.
```

**Cause:** Electron tries to use SUID sandbox in CI, but GitHub Actions doesn't provide required permissions.

**Solution:** Already fixed - `ELECTRON_DISABLE_SANDBOX=1` environment variable set on Linux, plus `--no-sandbox` flag added by tests.

---

### ❌ Pitfall 5: Misleading Comment

**Old Comment:** "No beforeAll needed - Electron Forge auto-builds webpack on first launch"

**Reality:** While Electron Forge does auto-build webpack, the tests still require an **external dev server running** to serve the renderer.

**Corrected:** Comments in `app-launch.e2e.ts` now clearly explain the dev server requirement.

---

### ❌ Pitfall 6: ELECTRON_RUN_AS_NODE Causes "bad option" Error

**Symptom:**

```
Error: electron.launch: Process failed to launch!
bad option: --remote-debugging-port=0
```

**Cause:** VS Code-based tools (like Claude Code extension, VS Code integrated terminal tasks) set `ELECTRON_RUN_AS_NODE=1` in their child process environment. This makes Electron run as plain Node.js instead of a full Electron app, causing it to reject Chromium-specific flags like `--remote-debugging-port=0` that Playwright hardcodes.

**Why it's confusing:** Tests pass when run from a regular terminal but fail when run from VS Code integrated terminal or VS Code extensions. This was previously misattributed to "packaged apps" or "CI environments" in some documentation.

**Solution:** Already fixed in `playwright.config.ts` - we delete this env var before tests run:

```typescript
delete process.env.ELECTRON_RUN_AS_NODE;
```

**If you still see this error:**

1. Check for the env var: `env | grep ELECTRON_RUN_AS_NODE`
2. Ensure `playwright.config.ts` has the `delete process.env.ELECTRON_RUN_AS_NODE` line
3. Try running from a fresh terminal outside VS Code

**Historical Note:** This was discovered in November 2025 after extensive debugging. The root cause is VS Code's architecture - it uses Electron and sets this env var to spawn Node.js worker processes. See [GitHub Issue #32027](https://github.com/microsoft/playwright/issues/32027) and [design.md Issue 12](../openspec/changes/archive/2025-11-05-add-e2e-testing-framework/design.md).

---

### ❌ Pitfall 7: Database Path Parsing Bug (file:// URL)

**Symptom:**

```
Error code 14: Unable to open the database file
[Database] Using BLOOM_DATABASE_URL (absolute): Users/foo/bar.db
```

Note the **missing leading slash** - it should be `/Users/foo/bar.db`.

**Cause:** Using regex to parse `file://` URLs strips the leading slash from absolute paths.

```typescript
// BROKEN - strips leading slash
const path = url.replace(/^file:\/?\/?/, '');
// file:/Users/foo/bar.db → Users/foo/bar.db (WRONG)
```

**Solution:** Always use `new URL()` for parsing file:// URLs:

```typescript
// CORRECT - preserves leading slash
const url = new URL(process.env.BLOOM_DATABASE_URL);
const path = decodeURIComponent(url.pathname);
// file:/Users/foo/bar.db → /Users/foo/bar.db (CORRECT)
```

**How to diagnose:**

1. Check logs for `[Database] Using BLOOM_DATABASE_URL:` line
2. Verify absolute paths start with `/` (Unix) or drive letter (Windows)
3. If path shows `Users/...` instead of `/Users/...`, the parsing is broken

**Historical Note:** This was fixed in November 2025 (commit 30cd920). The fix uses `new URL()` parsing which correctly handles both Unix (`/path`) and Windows (`C:\path`) absolute paths, plus URL encoding.

---

### ❌ Pitfall 8: Browser HTML5 Validation vs Zod Validation

**Symptom:**

E2E tests for form validation fail because the error message doesn't match what your Zod schema produces.

```
Expected: "Invalid email format"
Received: "Please include an '@' in the email address"
```

**Cause:** HTML5 form validation (`type="email"`, `required`, etc.) triggers **before** your JavaScript validation (Zod, Yup, etc.). The browser shows its own validation messages.

**Solution:** Add `noValidate` attribute to forms where you want JavaScript validation to handle errors:

```tsx
// ❌ Browser validation intercepts before Zod
<form onSubmit={handleSubmit(onSubmit)}>
  <input type="email" {...register('email')} />
</form>

// ✅ Zod validation handles all errors
<form onSubmit={handleSubmit(onSubmit)} noValidate>
  <input type="email" {...register('email')} />
</form>
```

**When to use `noValidate`:**

- When testing validation error messages in E2E tests
- When you want consistent error styling/messaging
- When Zod/Yup provides better validation than HTML5 (e.g., custom email patterns)

**When NOT to use `noValidate`:**

- Simple forms where browser validation is sufficient
- Forms where you want the browser's native validation UX

**Historical Note:** This was discovered in November 2025 when E2E tests for ScientistForm validation failed. The fix was adding `noValidate` to ensure Zod validation messages are shown.

---

### ❌ Pitfall 9: E2E Tests Fail Intermittently Without Startup Delay

**Symptom:**

E2E tests fail intermittently with 60-second timeouts in the beforeEach hook. Tests that pass sometimes fail other times, with no code changes.

**Cause:** The Machine Configuration feature (commit a6d3cd6) added an async IPC call (`config.exists()`) in Home.tsx that runs immediately on app startup. This new async operation during initialization creates a race condition with Playwright's remote debugging connection.

**Why this wasn't a problem before:** Previous versions of the app didn't have async IPC calls firing immediately on startup. The Machine Configuration redirect check in Home.tsx is the first feature to call an IPC handler (`config:exists`) during initial render, which can interfere with Playwright's connection establishment.

**Solution:** A startup delay is added in `src/main/database.ts` during E2E mode:

```typescript
if (process.env.E2E_TEST === 'true') {
  const delay = process.env.CI === 'true' ? 500 : 100;
  await new Promise((resolve) => setTimeout(resolve, delay));
}
```

**Empirical results (local):**

- Without delay: ~15% of tests pass (4/27)
- With 100ms delay: 100% of tests pass (27/27)

**CI environments:** CI runners (GitHub Actions) need a longer 500ms delay due to variable performance on shared runners. The `CI=true` environment variable is automatically set by GitHub Actions.

The delay allows Playwright's remote debugging connection to stabilize before the Electron app fully initializes and starts processing IPC calls.

**Important:** Do NOT remove this delay. It was empirically verified in February 2025 that removing it causes most E2E tests to fail.

## Debugging

### Using Playwright UI Mode (Recommended)

```bash
npm run test:e2e:ui
```

**Features:**

- Visual test runner
- Step through tests one by one
- See what the browser/window sees in real-time
- Inspect selectors and element properties
- Re-run individual tests
- Time-travel debugging

### Using Debug Mode

```bash
npm run test:e2e:debug
```

Opens Playwright Inspector for step-by-step debugging with breakpoints.

### Checking Dev Server Status

**Is port 9000 in use?**

```bash
# macOS/Linux
lsof -i :9000

# Windows
netstat -ano | findstr :9000
```

**Is dev server responding?**

```bash
curl http://localhost:9000
# Should return HTML content
```

**Check webpack build exists:**

```bash
ls -la .webpack/main/index.js
# Should show the compiled main process
```

### Common Debug Commands

**View test database:**

```bash
ls -la tests/e2e/test.db
sqlite3 tests/e2e/test.db ".tables"
```

**Check environment variables:**

```bash
cat .env.e2e
```

**Enable Playwright debug logging:**

```bash
DEBUG=pw:* npm run test:e2e
```

**Enable Electron debug logging:**

```bash
ELECTRON_ENABLE_LOGGING=1 npm run test:e2e
```

## Troubleshooting

### Issue: Dev Server Won't Start

**Symptoms:** `npm run start` fails or hangs

**Possible Causes:**

1. **Port 9000 already in use**

   ```bash
   # Kill process using port 9000
   # macOS/Linux
   lsof -ti :9000 | xargs kill -9

   # Windows
   netstat -ano | findstr :9000
   taskkill /F /PID <PID>
   ```

2. **Python executable missing**

   ```bash
   npm run build:python
   ```

3. **Prisma client not generated**
   ```bash
   npx prisma generate
   ```

---

### Issue: Tests Timeout

**Symptoms:** Tests fail with `TimeoutError: page.waitForFunction: Timeout 60000ms exceeded`

**Possible Causes:**

1. **Dev server not running** - Start it first!
2. **Slow machine** - Increase timeout in test file
3. **Network issues** - Check if `http://localhost:9000` is accessible
4. **Electron crash** - Check Playwright test output for errors

**Solutions:**

```typescript
// In app-launch.e2e.ts, increase timeout
await window.waitForFunction(
  () => document.title.includes('Bloom Desktop'),
  { timeout: 90000 } // Increase from 60000
);
```

---

### Issue: Database Errors

**Symptoms:** `Database 'test.db' does not exist` or schema errors

**Solutions:**

1. **Check `.env.e2e` file exists**

   ```bash
   cat .env.e2e
   # Should show: BLOOM_DATABASE_URL="file:../tests/e2e/test.db"
   ```

2. **Manually create test database**

   ```bash
   npx prisma db push --skip-generate
   ```

3. **Check Prisma schema is valid**
   ```bash
   npx prisma validate
   ```

---

### Issue: CI Passes Locally, Fails in CI

**Common Causes:**

1. **Timing issues** - CI is slower, needs longer waits
2. **Platform differences** - Test on the failing platform (Linux/Windows/macOS)
3. **Environment variables** - Check `.env.e2e` is committed
4. **Dependencies** - Ensure `package-lock.json` is up to date

**Debug CI Failures:**

1. Check CI logs for specific error
2. Look for platform-specific issues (Xvfb, sandbox, etc.)
3. Run tests locally with `CI=true` environment variable
4. Check Playwright test artifacts uploaded by CI

## Related Documentation

- **[PACKAGED_APP_TESTING.md](PACKAGED_APP_TESTING.md)** - Testing packaged/production apps
- **[DATABASE.md](DATABASE.md)** - Database architecture and Prisma setup
- **[tests/e2e/README.md](../tests/e2e/README.md)** - Quick reference for E2E tests
- **[openspec/changes/add-e2e-testing-framework/design.md](../openspec/changes/add-e2e-testing-framework/design.md)** - Architectural decisions and design rationale
- **[.github/workflows/pr-checks.yml](../.github/workflows/pr-checks.yml)** - CI configuration (line 268-302 for E2E section)
- **[Playwright Documentation](https://playwright.dev/docs/intro)** - Official Playwright docs
- **[Electron Testing Guide](https://www.electronjs.org/docs/latest/tutorial/automated-testing)** - Official Electron testing docs
