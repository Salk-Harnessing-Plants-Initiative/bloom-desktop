# E2E Testing with Playwright

Guide for running and writing end-to-end tests with Playwright for Electron apps.

## Commands

### Run E2E Tests

```bash
# Run all E2E tests (headless)
npm run test:e2e

# Run E2E tests in UI mode (interactive)
npm run test:e2e:ui

# Run E2E tests in debug mode (step through)
npm run test:e2e:debug
```

### View Test Report

```bash
# Open HTML report after test run
npx playwright show-report
```

## E2E Test Structure

Tests are located in `tests/e2e/` directory:

```
tests/e2e/
├── app-launch.e2e.ts     # Basic app launch and initialization tests
├── test.db               # Test database (created during tests)
└── README.md             # E2E testing documentation
```

## What E2E Tests Cover

E2E tests verify user-facing functionality:

### App Launch Test

```typescript
// tests/e2e/app-launch.e2e.ts

test('launches app successfully', async () => {
  // Launches Electron app
  const electronApp = await electron.launch({ args: ['.'] });

  // Gets first window
  const window = await electronApp.firstWindow();

  // Verifies window title
  await expect(window).toHaveTitle(/Bloom Desktop/);

  // Verifies content renders
  const body = await window.locator('body');
  await expect(body).toBeVisible();
});
```

### Database Initialization Test

```typescript
test('initializes database', async () => {
  // Launches app
  const electronApp = await electron.launch({ args: ['.'] });

  // Waits for database creation
  await waitFor(() => fs.existsSync('tests/e2e/test.db'));

  // Verifies database exists
  expect(fs.existsSync('tests/e2e/test.db')).toBe(true);
});
```

## Writing E2E Tests

### Test Template

```typescript
import { test, expect } from '@playwright/test';
import { _electron as electron } from 'playwright';

test('test description', async () => {
  // 1. Launch app
  const electronApp = await electron.launch({
    args: ['.'],
  });

  // 2. Get window
  const window = await electronApp.firstWindow();

  // 3. Interact with UI
  await window.click('button[data-testid="start-scan"]');

  // 4. Verify results
  await expect(window.locator('.scan-status')).toHaveText('Scanning...');

  // 5. Cleanup
  await electronApp.close();
});
```

### Electron-Specific Selectors

Use data-testid attributes:

```typescript
// In React component
<button data-testid="camera-settings-button">Settings</button>

// In test
await window.click('[data-testid="camera-settings-button"]');
```

### Database Setup

E2E tests use isolated database:

```typescript
import { test } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

test.beforeEach(async () => {
  // Clean up previous test database
  const testDbPath = path.join(__dirname, 'test.db');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }

  // Create fresh database with schema
  execSync('npx prisma db push --skip-generate', {
    env: { ...process.env, DATABASE_URL: 'file:./tests/e2e/test.db' },
  });
});

test.afterEach(async () => {
  // Cleanup
  const testDbPath = path.join(__dirname, 'test.db');
  if (fs.existsSync(testDbPath)) {
    fs.unlinkSync(testDbPath);
  }
});
```

## Configuration

**Location**: `playwright.config.ts`

Key settings:

```typescript
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.e2e.ts',
  workers: 1, // Sequential execution (Electron instances conflict)
  timeout: 60000, // 60 seconds per test (Electron startup is slow)
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
```

## CI/CD Integration

E2E tests run in GitHub Actions:

```yaml
# .github/workflows/pr-checks.yml

test-e2e-dev:
  runs-on: ${{ matrix.os }}
  strategy:
    matrix:
      os: [ubuntu-latest, macos-latest, windows-latest]
  steps:
    - uses: actions/checkout@v5
    - run: npm ci
    - run: npm run build:python
    - run: npm run webpack:dev
    - run: npm run test:e2e
```

**Platform support**:

- ✅ Linux (xvfb for headless)
- ✅ macOS
- ✅ Windows

## Debugging E2E Tests

### Interactive UI Mode

```bash
# Opens Playwright UI for interactive testing
npm run test:e2e:ui

# Features:
# - See test execution in real-time
# - Pause and inspect at any point
# - Time-travel debugging
# - Network request inspection
```

### Debug Mode

```bash
# Runs with Playwright Inspector
npm run test:e2e:debug

# Features:
# - Step through test line by line
# - Inspect page at each step
# - Evaluate expressions in console
```

### Screenshots and Videos

On test failure, Playwright automatically captures:

- **Screenshots**: `test-results/<test-name>/screenshot.png`
- **Videos**: `test-results/<test-name>/video.webm`
- **Traces**: `test-results/<test-name>/trace.zip`

View trace:

```bash
npx playwright show-trace test-results/<test-name>/trace.zip
```

### Console Logs

Capture app console logs in tests:

```typescript
test('captures console logs', async () => {
  const electronApp = await electron.launch({ args: ['.'] });
  const window = await electronApp.firstWindow();

  // Listen to console
  window.on('console', (msg) => {
    console.log(`[APP] ${msg.text()}`);
  });

  // Test continues...
});
```

## Common Issues

### "Electron failed to launch"

**Causes**:

- Webpack build not complete
- Python executable not built
- Electron binary not installed

**Solutions**:

```bash
# Rebuild dependencies
npm run build:python
npm run webpack:dev

# Or use test:e2e which builds automatically
npm run test:e2e
```

### Tests Timeout

**Causes**:

- App not starting (check build)
- Selector not found (check UI)
- Database not initializing

**Debug**:

1. Increase timeout in test:
   ```typescript
   test.setTimeout(120000); // 2 minutes
   ```
2. Run in UI mode to see what's happening:
   ```bash
   npm run test:e2e:ui
   ```
3. Check app logs (console output)

### Tests Pass Locally, Fail in CI

**Common causes**:

1. **Timing issues**: CI slower than local
   - Solution: Use `waitForLoadState('networkidle')` instead of fixed delays
2. **Display issues** (Linux):
   - Solution: CI uses xvfb automatically (headless X server)
3. **Database path issues**:
   - Solution: Use `.env.e2e` for consistent test environment

### Multiple Windows Open

**Cause**: Previous test didn't close app

**Solution**: Always close in afterEach:

```typescript
test.afterEach(async ({ electronApp }) => {
  await electronApp.close();
});
```

## Best Practices

### 1. Use Data-Testid Attributes

```tsx
// Good
<button data-testid="start-scan">Start</button>

// Bad (brittle)
<button className="btn-primary">Start</button>
```

### 2. Wait for Network Idle

```typescript
// Wait for page to fully load
await window.waitForLoadState('networkidle');
```

### 3. Use Expect Matchers

```typescript
// Good
await expect(window.locator('.status')).toHaveText('Ready');

// Bad
expect(await window.locator('.status').textContent()).toBe('Ready');
```

### 4. Keep Tests Independent

Each test should:

- Set up own database state
- Not depend on other tests
- Clean up after itself

### 5. Test User Workflows, Not Implementation

```typescript
// Good - tests user workflow
test('user can start a scan', async () => {
  await window.click('[data-testid="start-scan"]');
  await expect(window.locator('.scan-progress')).toBeVisible();
});

// Bad - tests implementation details
test('scanner calls start() method', async () => {
  // Don't test internal implementation
});
```

## Test Organization

### Group Related Tests

```typescript
import { test } from '@playwright/test';

test.describe('Camera Settings', () => {
  test('opens settings dialog', async () => {
    // ...
  });

  test('saves exposure setting', async () => {
    // ...
  });
});
```

### Use Fixtures for Setup

```typescript
import { test as base } from '@playwright/test';

const test = base.extend({
  electronApp: async ({}, use) => {
    const app = await electron.launch({ args: ['.'] });
    await use(app);
    await app.close();
  },
});

test('uses fixture', async ({ electronApp }) => {
  const window = await electronApp.firstWindow();
  // Test continues...
});
```

## Adding New E2E Tests

1. **Identify user workflow** to test
2. **Create test file** in `tests/e2e/` with `.e2e.ts` suffix
3. **Write test** following template above
4. **Add data-testid** attributes to UI elements if needed
5. **Run locally**: `npm run test:e2e:ui`
6. **Verify in CI**: Push and check GitHub Actions

## Performance

### Test Execution Time

- **Single test**: ~10-30 seconds (includes app launch)
- **Full suite**: Scales linearly (sequential execution)

### Optimization Tips

1. **Minimize app restarts**: Group tests in describe blocks
2. **Use beforeAll**: Share setup when safe
3. **Parallel workers**: Not recommended (Electron instances conflict)

## Related Commands

- `/integration-testing` - Lower-level integration tests
- `/hardware-testing` - Hardware-specific testing
- `/coverage` - E2E coverage expectations

## Documentation

- **E2E Testing Guide**: `docs/E2E_TESTING.md`
- **Playwright Docs**: https://playwright.dev/
- **Playwright Electron**: https://playwright.dev/docs/api/class-electron
