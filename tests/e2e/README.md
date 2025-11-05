# E2E Tests

End-to-end tests for Bloom Desktop using Playwright.

## Quick Start

> ⚠️ **CRITICAL**: Dev server must be running on http://localhost:9000 before running tests!

**Terminal 1** (keep running):

```bash
npm run start
```

**Terminal 2**:

```bash
npm run test:e2e
```

## What These Tests Do

- ✅ Launch Electron app
- ✅ Verify window creation and visibility
- ✅ Test database initialization (`tests/e2e/test.db`)
- ✅ Check UI rendering and page content
- ✅ Validate document title setting

## Test Files

- **`app-launch.e2e.ts`** - Main E2E test suite
  - Test 1: Application launch and window visibility
  - Test 2: Database initialization on startup
  - Test 3: Page content rendering

## Important Notes

### ⚠️ Dev Server Requirement

**The tests DO NOT start their own dev server!**

Tests launch Electron directly, which loads the renderer from `http://localhost:9000`. Without the dev server running, the Electron window opens but the UI is completely blank.

**Why:** Electron Forge configures `MAIN_WINDOW_WEBPACK_ENTRY` to point to the dev server URL (`http://localhost:9000`), not a file path. This is baked into the webpack build at compile time.

### Database Isolation

Tests use a separate database:

- **Test database**: `tests/e2e/test.db`
- **Dev database**: `prisma/dev.db`

Each test creates a fresh database in `beforeEach` and cleans it up in `afterEach`.

### Platform Differences

- **Linux**: Requires Xvfb (X Virtual FrameBuffer) in CI
- **Linux**: Requires `--no-sandbox` flag (added automatically when `CI=true`)
- **macOS**: Works out of the box
- **Windows**: Works out of the box

## Running Tests

```bash
# Standard run (headless)
npm run test:e2e

# UI mode (recommended for debugging)
npm run test:e2e:ui

# Debug mode (with debugger)
npm run test:e2e:debug
```

## Configuration

- **`playwright.config.ts`** - Playwright test configuration
- **`.env.e2e`** - E2E environment variables (database URL, etc.)
- **`app-launch.e2e.ts`** - Test implementation with detailed inline comments

## Troubleshooting

### Blank Electron Window

**Problem**: Window opens but no content appears

**Solution**: Start dev server first!

```bash
# Terminal 1
npm run start

# Wait for: "✔ Launched Electron app"

# Terminal 2
npm run test:e2e
```

### Port Already in Use

**Problem**: Dev server fails to start (port 9000 in use)

**Solution**: Kill the process using port 9000

```bash
# macOS/Linux
lsof -ti :9000 | xargs kill -9

# Windows
netstat -ano | findstr :9000
taskkill /F /PID <PID>
```

### Tests Timeout

**Problem**: `TimeoutError: page.waitForFunction: Timeout 60000ms exceeded`

**Likely Cause**: Dev server not running or very slow machine

**Solution**: Verify dev server is running and accessible:

```bash
curl http://localhost:9000
# Should return HTML content
```

## Full Documentation

For complete documentation including architecture, CI/CD integration, common pitfalls, and debugging guides, see:

👉 **[/docs/E2E_TESTING.md](../../docs/E2E_TESTING.md)**

Includes:

- Architecture explanation (why dev server is required)
- CI/CD integration details
- Platform-specific requirements (Xvfb, sandbox, timing)
- Common pitfalls and solutions
- Debugging strategies
- Troubleshooting guide
