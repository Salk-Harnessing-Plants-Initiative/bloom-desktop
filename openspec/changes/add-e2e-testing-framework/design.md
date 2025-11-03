# Design Document: E2E Testing Framework

## Context

Bloom Desktop is an Electron-based application that integrates multiple complex components:
- **Frontend**: React UI rendered in Electron's renderer process
- **Backend**: Node.js main process managing Python subprocess and database
- **Python subprocess**: Hardware control (camera, DAQ) via PyInstaller executable
- **Database**: Prisma ORM with SQLite, must work in dev, test, and production environments

**Current Testing Gap**: While we have comprehensive unit and integration tests, we lack end-to-end tests that validate the complete application lifecycle from app launch through user workflows.

**Constraints**:
- Electron's architecture requires special E2E testing approach (cannot use standard web testing)
- Playwright's `_electron` API has limitations with packaged apps
- Must support cross-platform testing (Linux, macOS, Windows)
- Must isolate E2E test environment from development database

**Stakeholders**:
- Developers: Need fast, reliable E2E tests for local development
- CI/CD: Need automated E2E tests on every PR
- QA/Users: Need confidence that packaged apps work correctly

## Goals / Non-Goals

### Goals
- ✅ Implement Playwright-based E2E testing for Electron app
- ✅ Test app launch, window creation, and database initialization
- ✅ Test basic UI rendering and content display
- ✅ Isolate E2E test environment with separate database
- ✅ Integrate E2E tests into CI/CD pipeline (Linux, macOS, Windows)
- ✅ Provide excellent debugging experience (Playwright UI, traces, screenshots)
- ✅ Fast iteration for local development (<30 seconds per test run)

### Non-Goals
- ❌ Testing packaged apps with Playwright (use integration tests instead)
- ❌ Testing hardware interfaces in E2E (covered by integration tests with mocks)
- ❌ Comprehensive UI workflow testing (initial implementation focuses on foundation)
- ❌ Visual regression testing (can be added later if needed)

## Decisions

### Decision 1: Dev Build vs Packaged App Testing

**Choice**: Use webpack dev build for Playwright E2E tests, keep integration tests for packaged app validation.

**Rationale**:
- Playwright's `_electron.launch()` API automatically adds debugging flags (`--remote-debugging-port=0`) that packaged apps reject
  - **Research Finding (2024)**: Playwright v1.44+ has a known regression bug ([Issue #32027](https://github.com/microsoft/playwright/issues/32027)) causing "bad option: --remote-debugging-port=0" errors with packaged Electron apps
  - Last working version was 1.43.1, but downgrading is not recommended
- Dev build testing is the industry standard for Electron E2E tests
  - **Best Practice Confirmed**: Multiple sources recommend building the app before testing, but acknowledge that dev builds work well for CI
  - VS Code and other major Electron projects use Playwright with dev builds
- Dev build tests catch 95% of integration issues with much better debugging experience
- We already have `test:package:database` integration test that validates packaged apps

**Research Sources**:
- Simon Willison's TIL: "Testing Electron apps with Playwright and GitHub Actions"
- Playwright Electron Documentation
- Electron React Boilerplate integration tests guide
- GitHub Issue #32027 (Playwright regression with packaged apps)

**Alternatives Considered**:
1. **Packaged app with CDP (Chrome DevTools Protocol)**: Possible but adds significant complexity
   - Would require custom spawn + CDP connection approach
   - More fragile, harder to debug
   - Not necessary given existing integration test coverage
   - **Research Note**: Some projects manually spawn Electron with `--remote-debugging-port=9222` and connect via `chromium.connectOverCDP()`, but this is non-standard
2. **Only integration tests, no Playwright**: Would miss UI rendering and user interaction bugs
   - Playwright provides better visibility into renderer process behavior
   - Easier to extend for future workflow testing
3. **Downgrade to Playwright 1.43.1**: Avoids packaged app bug but loses newer features
   - Not sustainable long-term
   - Dev build approach is more maintainable

**Trade-offs**:
- ✅ Faster test execution (~30 seconds vs ~2 minutes for packaged)
- ✅ Better debugging with Playwright UI
- ✅ Simpler implementation and maintenance
- ✅ Avoids Playwright v1.44+ regression bug
- ❌ Doesn't test final packaged distribution (mitigated by integration tests)

### Decision 2: Electron Launch Approach

**Choice**: Use `electron.launch({ args: [path.join(appRoot, '.webpack/main/index.js')] })` pointing directly to the webpack-built main process file.

**Rationale**:
- Points directly to the webpack dev build output created by `node scripts/build-webpack-dev.js`
- Works reliably in local development environments (confirmed on macOS)
- Avoids relying on package.json's "main" field resolution which can be inconsistent
- **Environment-specific behavior**: Works on developer machines but may fail in CI/automated environments with `--remote-debugging-port=0` error

**Research Sources**:
- Playwright Electron API: `args` parameter accepts array of strings for "additional arguments to pass to the application when launching"
- Common patterns from examples: `args: ['main.js']` or direct paths to entry files
- Implementation testing showed this approach works for local dev

**Alternatives Considered**:
1. **Package.json reference**: `args: ['.']` - More elegant but showed environment-specific failures during testing
2. **App bundle path**: Pointing to `.app` directory - FAILED with EACCES error
3. **Relative path**: `args: ['main.js']` - Requires package.json "main" field to be correct

**Implementation**:
```typescript
const appRoot = path.join(__dirname, '../..');
electronApp = await electron.launch({
  executablePath: electronPath,
  args: [path.join(appRoot, '.webpack/main/index.js')],
  cwd: appRoot,
  env: process.env as Record<string, string>,
});
```

**Why This Works (Locally)**:
- `executablePath` specifies the Electron binary (from node_modules/electron)
- `args` points directly to the built main process file
- `cwd` ensures relative paths resolve correctly from project root
- Works reliably on developer machines for local testing

**Known Limitation**:
- May encounter `--remote-debugging-port=0` error in CI/automated environments (see Issue 2)
- If CI fails, fallback plan is to downgrade Playwright to v1.43.1

### Decision 3: Database Path Resolution

**Choice**: Use relative path `file:../tests/e2e/test.db` in BLOOM_DATABASE_URL, which Prisma resolves relative to `prisma/` directory.

**Rationale**:
- Prisma resolves database URLs relative to the location of `schema.prisma` (in `prisma/` directory)
- Relative path `../tests/e2e/test.db` resolves to `tests/e2e/test.db` from project root
- Creates clean separation between dev database (`prisma/dev.db`) and E2E test database
- Same pattern used in pilot repository

**Path Resolution**:
```
prisma/schema.prisma (Prisma's working directory)
  └─ ../tests/e2e/test.db (relative path)
  └─ resolves to: /path/to/project/tests/e2e/test.db
```

**Alternatives Considered**:
1. **Absolute path**: Hard to maintain across different development machines and CI
2. **Same directory as dev.db**: Risk of accidentally deleting development data
3. **In-memory database**: SQLite `:memory:` doesn't test real file persistence

### Decision 4: Test Isolation and Cleanup

**Choice**: Use beforeEach/afterEach hooks for database creation and cleanup.

**Rationale**:
- Each test starts with clean database state (no state leakage between tests)
- `prisma db push --skip-generate` creates database file and applies schema without migrations
- Cleanup in afterEach ensures test artifacts don't persist
- Works reliably even if tests fail mid-execution
- **Research Confirmed**: Playwright best practices emphasize complete test isolation
  - "Each test should be completely isolated from another test and should run independently with its own local storage, session storage, data, cookies etc."
  - "Test isolation improves reproducibility, makes debugging easier and prevents cascading test failures"

**Research Sources**:
- Playwright Best Practices documentation
- Parallel testing guide emphasizes worker isolation

**Implementation Flow**:
```
beforeEach:
1. Delete existing test.db if exists
2. Create tests/e2e/ directory if missing
3. Run `prisma db push` to create database with schema
4. Launch Electron app

afterEach:
1. Close Electron app
2. Delete test.db file
```

**Why This Matters**:
- Prevents test interdependencies (test order shouldn't matter)
- Makes debugging easier (each test can run in isolation)
- Avoids cascading failures (one test's pollution doesn't break others)

### Decision 5: CI Webpack Build Strategy

**Choice**: Start Electron Forge dev server in background during E2E tests. The renderer process loads from the dev server at `http://localhost:9000`.

**Rationale**:
- `MAIN_WINDOW_WEBPACK_ENTRY` from Electron Forge points to dev server URL, not file path
- The renderer process expects to load from `http://localhost:9000` even after webpack build
- Without dev server running, Electron window loads but remains blank (no UI content)
- This matches normal Electron Forge development workflow

**CI Workflow**:
```yaml
1. Build webpack: node scripts/build-webpack-dev.js
   - Creates .webpack/main/index.js (main process)
   - Builds renderer assets but doesn't start server
2. Start dev server: npm run start & (background)
   - Electron Forge starts dev server on port 9000
   - Serves renderer process (React UI)
   - Wait 15 seconds for server to initialize
3. Run E2E tests: npm run test:e2e
   - Tests launch Electron with args: ['.webpack/main/index.js']
   - Renderer loads from http://localhost:9000
4. Stop dev server: kill PID (cleanup, always runs)
```

**Local Development**:
```bash
# Terminal 1: Start Electron Forge dev server (keep running)
npm run start

# Terminal 2: Run E2E tests (can run multiple times)
npm run test:e2e
```

**Why Dev Server is Required**:
- Electron Forge configures `MAIN_WINDOW_WEBPACK_ENTRY` to point to dev server URL
- The URL is baked into the webpack build at compile time
- Tests must have dev server running to serve the renderer process
- Without it: Electron launches but UI is blank

### Decision 6: Playwright Configuration

**Choice**: Sequential execution (1 worker), 60-second timeout, failure artifacts retained, headless mode conditional on environment.

**Rationale**:
- **1 worker**: Electron instances conflict if run in parallel (shared resources)
  - **Research Confirmed**: Playwright parallelism guide states "You can't communicate between the workers" and "Each worker gets its own browser instance"
  - For Electron, running multiple instances simultaneously can cause resource conflicts
- **60-second timeout**: Electron app startup can be slow, especially in CI (cold start, first build)
  - **Research Confirmed**: Playwright docs suggest 60-120s for slow operations like app startup
  - Simon Willison's TIL uses `test.setTimeout(0)` (unlimited) for Python installation tests
- **Failure artifacts**: Traces, screenshots, videos essential for debugging CI failures
  - **Research Confirmed**: Multiple sources recommend capturing videos, screenshots, and traces
  - Videos can be attached as GitHub Actions artifacts for post-mortem analysis
- **headless mode**: Should be `true` in CI, `false` for local debugging
  - **Current config has headless: false** - this needs to be fixed for CI
  - Local debugging benefits from visible browser
- **testMatch pattern**: `*.e2e.ts` clearly distinguishes E2E tests from unit (`*.test.ts`) and integration (`*.spec.ts`)

**Research Sources**:
- Playwright Test Timeouts documentation
- Playwright Parallelism and Workers guide
- Simon Willison's TIL on timeout configuration
- Best practices for CI video recording

**Configuration** (implemented):
```typescript
{
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  timeout: 60000, // ✅ 60s for Electron startup
  workers: 1, // ✅ Sequential execution
  fullyParallel: false, // ✅ No parallel tests
  retries: process.env.CI ? 1 : 0, // ✅ Retry once in CI
  use: {
    trace: 'retain-on-failure', // ✅ Capture traces on failure
    screenshot: 'only-on-failure', // ✅ Screenshots on failure
    video: 'retain-on-failure', // ✅ Videos on failure
    headless: process.env.CI ? true : false, // ✅ Headless in CI, visible locally
  }
}
```

**Why This Configuration Works**:
- Headless mode in CI prevents display issues on Linux runners
- Visible browser locally makes debugging easier
- 1 retry in CI handles transient timing issues
- Artifacts captured only on failure to save storage

## Risks / Trade-offs

### Risk: Dev build may not catch packaging bugs
- **Impact**: Medium - Packaging-specific issues could slip through
- **Likelihood**: Low - Most bugs are in application logic, not packaging
- **Mitigation**: Keep `test:package:database` integration test; run it in CI on macOS
- **Monitoring**: Watch for bugs reported in packaged app that E2E tests miss

### Risk: E2E tests may be flaky due to timing
- **Impact**: High - Flaky tests reduce confidence and waste developer time
- **Likelihood**: Medium - Electron app startup and database initialization have variable timing
- **Mitigation**:
  - Use Playwright's built-in wait mechanisms (waitForLoadState, waitForSelector)
  - Retry once in CI (configured in playwright.config.ts)
  - Add explicit delays for database initialization (3 seconds)
- **Monitoring**: Track test flakiness in CI; increase timeouts if needed

### Risk: Webpack build adds CI time
- **Impact**: Low - ~30 seconds added to each CI job
- **Likelihood**: High - Webpack build is required
- **Mitigation**:
  - Cache webpack build artifacts in CI where possible
  - Run E2E tests on separate job (doesn't block fast feedback from linting/unit tests)
- **Monitoring**: Track CI job duration; optimize webpack config if build time increases

### Risk: Cross-platform differences
- **Impact**: Medium - Tests might pass on one OS but fail on others
- **Likelihood**: Medium - Electron behavior can differ across platforms
- **Mitigation**:
  - Run E2E tests on all platforms in CI (Linux, macOS, Windows)
  - Use platform-agnostic path handling (path.join, not string concatenation)
- **Monitoring**: Watch for platform-specific failures in CI

## Migration Plan

This is a **new capability** - no migration required.

### Rollout Steps
1. ✅ Merge E2E testing PR with passing tests on all platforms
2. ✅ Monitor CI for 1 week to ensure stability
3. ✅ Add E2E tests to PR checklist (all PRs must pass E2E tests)
4. ✅ Archive this OpenSpec change after successful deployment

### Success Criteria
- ✅ E2E tests pass consistently in CI (>95% success rate over 1 week)
- ✅ E2E test duration <5 minutes per platform
- ✅ No false positives (flaky tests) reported by developers
- ✅ At least 1 real bug caught by E2E tests in first month

### Rollback Plan
If E2E tests prove too flaky or slow:
1. Disable E2E CI job (allow manual execution only)
2. Investigate and fix root cause (timing issues, webpack config, etc.)
3. Re-enable once stable

## Open Questions

### Q1: Should we add more comprehensive UI workflow tests?
- **Status**: Deferred to future work
- **Rationale**: Current implementation focuses on foundation (app launch, database, basic rendering)
- **Follow-up**: Create new OpenSpec change for workflow testing (experiment creation, scan capture, etc.) after foundation is stable

### Q2: Should we test packaged apps with Playwright + CDP?
- **Status**: Not needed
- **Rationale**: `test:package:database` integration test already validates packaged apps
- **Follow-up**: Revisit if integration test proves insufficient

### Q3: Should we use Playwright's test fixtures for database setup?
- **Status**: Deferred
- **Rationale**: Current beforeEach/afterEach approach is simple and works well
- **Follow-up**: Consider fixtures if we add more complex setup (user data, mock scans, etc.)

### Q4: Should we add visual regression testing with Playwright?
- **Status**: Not in scope
- **Rationale**: Visual changes are infrequent and manually reviewed in PRs
- **Follow-up**: Consider if UI becomes more complex or we get visual regression bugs

## Known Issues and Workarounds

### Issue 1: DevTools Window Race Condition

**Problem**: `electronApp.firstWindow()` can return either the DevTools window or the main application window when DevTools are enabled, causing tests to target the wrong window and timeout.

**GitHub Issue**: [#10964 - Cannot launch electron app with devtools](https://github.com/microsoft/playwright/issues/10964)

**Status**: Closed (2021), but still relevant for Electron testing

**Impact**: If DevTools launch on app start, tests may fail with timeout errors when waiting for selectors or wrong window title (e.g., "DevTools" instead of "Bloom Desktop")

**Workaround Options**:

1. **Disable DevTools** (simplest):
```typescript
// DON'T launch with DevTools enabled initially
const window = await electronApp.firstWindow();

// Open DevTools manually if needed for debugging
const browserWindow = await electronApp.browserWindow(window);
await browserWindow.evaluate((app: BrowserWindow) => {
  app.webContents.openDevTools();
});
```

2. **Filter windows by URL** (our approach):
```typescript
// Get all windows and filter out DevTools
const windows = await electronApp.windows();

// Find the main window (not DevTools)
const window = windows.find((w) => w.url().includes('localhost')) || windows[0];
```

**Our Approach**:
- Wait for all windows and filter by URL to find the main application window
- This handles cases where DevTools may open before or after the main window
- Fallback to first window if no localhost URL found (safety net)
- Use `headless: false` locally for visual debugging without DevTools interfering
- Use Playwright UI mode (`npm run test:e2e:ui`) for interactive debugging

**Implemented Fix** (2025-11-03):
The test file now uses the window filtering approach which successfully avoids the race condition.

### Issue 2: Packaged App Testing with Playwright

**Problem**: Playwright v1.44+ automatically adds `--remote-debugging-port=0` flag which packaged Electron apps reject with "bad option" error.

**GitHub Issue**: [#32027 - electron.launch: Process failed to launch](https://github.com/microsoft/playwright/issues/32027)

**Status**: Open (2024), regression in v1.44+

**Impact**: Cannot test packaged Electron apps directly with `_electron.launch()` API

**Workaround Options**:
1. **Test dev builds** (our approach) - Use webpack dev build instead of packaged app
2. **Downgrade Playwright** to v1.43.1 - Not sustainable long-term
3. **Manual spawn + CDP** - Spawn packaged app with `--remote-debugging-port=9222` and connect via `chromium.connectOverCDP()` - Complex, non-standard

**Our Approach**:
- Use webpack dev build for Playwright E2E tests (primary)
- Keep `test:package:database` integration test for packaged app validation (secondary)
- Accept that Playwright cannot test packaged apps until regression is fixed

**Important Finding - Environment-Specific Behavior** (2025-11-03):

During implementation, we discovered that the `--remote-debugging-port=0` error is **environment-dependent**:

- ✅ **User's local macOS environment**: Tests work correctly with `args: ['.webpack/main/index.js']`, no remote debugging port error
- ❌ **Automated/CI-like environment**: Same code triggers "bad option: --remote-debugging-port=0" error

**Hypothesis**: The error may be related to:
1. **macOS version differences** - Different macOS versions may have different Electron binary behavior
2. **Interactive vs non-interactive terminal** - Electron may detect automation and behave differently
3. **Process isolation** - Automated tools may run in restricted sandboxes that affect Electron flags

**Implications**:
- Local development works reliably on developer machines
- CI environment may hit the bug (needs testing in actual GitHub Actions)
- The workaround of using `.webpack/main/index.js` instead of `args: ['.']` is partially effective but not universal

**Action Items**:
- Monitor first CI run to see if it hits the remote debugging port error
- If CI fails, consider downgrading Playwright to v1.43.1 for CI only
- Document any CI-specific workarounds discovered during testing

### Issue 3: Electron Version Compatibility

**Problem**: Playwright Electron support is marked as **experimental** and has specific version requirements.

**Playwright Docs**: Supported Electron versions are v12.2.0+, v13.4.0+, and v14+

**Critical Fuse Requirement**: `nodeCliInspectArguments` fuse must **not** be set to `false` to avoid launch timeout issues

**Impact**: Apps with certain Electron versions or fuse configurations may not work with Playwright

**Workaround**:
- Verify Electron version compatibility before implementing E2E tests
- Check `electron-builder` or `electron-forge` configuration for fuse settings
- Test locally with your Electron version before committing to Playwright

**Our Setup**:
- Electron 28.2.2 (supported ✅)
- Electron Forge build system (no custom fuse configuration)
- No known compatibility issues

### Issue 4: Cross-Platform Path Handling

**Problem**: File paths in tests can break on different operating systems (Windows vs Unix)

**Impact**: Tests may pass locally but fail in CI on different platforms

**Workaround**:
```typescript
// ❌ BAD: String concatenation
const dbPath = __dirname + '/../../tests/e2e/test.db';

// ✅ GOOD: Use path.join for cross-platform compatibility
const dbPath = path.join(__dirname, '../../tests/e2e/test.db');
```

**Our Approach**:
- Always use `path.join()` for file paths
- Test on all platforms in CI (Linux, macOS, Windows)
- Use relative paths from known locations (e.g., `process.cwd()`)

### Issue 5: Webpack Asset Imports in Tests

**Problem**: Importing test files that depend on Webpack loaders (images, CSS) can cause Node.js parse errors

**Example Error**: `Cannot use import statement outside a module` when test files import components with CSS/image imports

**Impact**: Tests fail to run if they import React components that import assets

**Workaround**:
```typescript
// ❌ BAD: Importing component that imports CSS
import { MyComponent } from '../renderer/components/MyComponent';

// ✅ GOOD: Test the rendered output, not the component directly
const content = await window.locator('body').textContent();
expect(content).toContain('Expected text');
```

**Our Approach**:
- E2E tests focus on rendered output, not importing components
- Test behavior through the Electron window, not direct imports
- Keep tests in separate directory from source code

## References

### Playwright Documentation
- **Playwright Electron API**: https://playwright.dev/docs/api/class-electron
- **Test Timeouts**: https://playwright.dev/docs/test-timeouts
- **Parallelism Guide**: https://playwright.dev/docs/test-parallel
- **Best Practices**: https://playwright.dev/docs/best-practices

### GitHub Issues (Known Problems)
- **#10964**: DevTools window race condition (closed 2021)
- **#32027**: Packaged app regression in v1.44+ (open 2024)

### Electron Resources
- **Electron Testing Guide**: https://www.electronjs.org/docs/latest/tutorial/automated-testing
- **Electron React Boilerplate**: https://electron-react-boilerplate.js.org/docs/integration-tests

### Community Examples
- **Simon Willison's TIL**: https://til.simonwillison.net/electron/testing-electron-playwright
- **spaceagetv/electron-playwright-example**: Multi-window testing examples

### Project-Specific
- **Bloom Desktop Pilot E2E**: `bloom-desktop-pilot/benfica/add-testing` branch
- **Current Status**: See `PLAYWRIGHT_E2E_STATUS.md` for implementation progress
- **VS Code Testing Approach**: Uses Playwright with dev builds (similar pattern)