# Testing Reference

## Directory Structure

```
tests/
├── e2e/                    # Playwright E2E tests
│   ├── app-launch.e2e.ts   # App startup tests
│   ├── renderer-database-ipc.e2e.ts  # IPC communication tests
│   └── scientists-management.e2e.ts  # UI workflow tests
├── unit/                   # Vitest unit tests
│   ├── components/         # React component tests
│   └── utils/              # Utility function tests
├── integration/            # Integration tests
│   └── (IPC, hardware mocks)
└── fixtures/               # Shared test data
```

## Vitest Configuration

**File**: `vitest.config.ts`

```typescript
{
  test: {
    environment: 'happy-dom',  // Lightweight DOM for React
    setupFiles: ['./tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
    },
  },
}
```

**Setup file** (`tests/unit/setup.ts`):

- Mocks `window.electron` API
- Sets up testing-library matchers

## Playwright Configuration

**File**: `playwright.config.ts`

Key settings:

- `testDir: './tests/e2e'`
- `testMatch: '**/*.e2e.ts'`
- `timeout: 60000` (60s for Electron startup)
- `workers: 1` (sequential to avoid conflicts)
- `retries: 1` in CI only

**Environment fix**:

```typescript
// Required for VS Code/Claude Code environments
delete process.env.ELECTRON_RUN_AS_NODE;
```

## Database Testing

### E2E Test Database

**Location**: `tests/e2e/test.db` (created per test)

**IMPORTANT: URL Format**

- Use `file:` protocol with proper URL format
- Absolute paths: `file:/absolute/path/to/db` (preserves leading `/`)
- The `database.ts` module uses `new URL()` parsing - NEVER regex
- If you see "Error code 14", check logs for missing leading slash

**Pattern**:

```typescript
const TEST_DB_PATH = path.join(__dirname, 'test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
// Result: file:/Users/.../tests/e2e/test.db (correct absolute path)

// In beforeEach
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
execSync('npx prisma db push --skip-generate', {
  env: { ...process.env, BLOOM_DATABASE_URL: TEST_DB_URL },
});

// In afterEach
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
```

### Unit Test Database

Unit tests mock `window.electron.database` - no real database needed.

## IPC Handler Testing

### E2E Approach (Full Integration)

Tests the complete flow: React component → preload → main → database

```typescript
test('should create scientist via IPC', async () => {
  // Navigate to page
  await window.click('text=Scientists');

  // Fill form
  await window.fill('input[name="name"]', 'Dr. Test');
  await window.fill('input[name="email"]', 'test@example.com');

  // Submit
  await window.click('button:has-text("Add")');

  // Verify
  await expect(window.locator('text=Dr. Test')).toBeVisible();
});
```

### Unit Test Approach (Isolated)

Tests component behavior with mocked IPC:

```typescript
// tests/unit/setup.ts
vi.mock('window.electron', () => ({
  database: {
    scientists: {
      list: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: 1, name: 'Test' }),
    },
  },
}));
```

## Coverage Requirements

| Test Type         | Threshold | Command                      |
| ----------------- | --------- | ---------------------------- |
| Unit (TypeScript) | 50%+      | `npm run test:unit:coverage` |
| Python            | 80%+      | `npm run test:python`        |
| E2E IPC           | 90%+      | `npm run test:e2e:coverage`  |

## Playwright Selectors

### Recommended

```typescript
// By role (most accessible)
await window.getByRole('button', { name: 'Submit' });

// By text
await window.locator('text=Welcome');

// By test ID
await window.locator('[data-testid="scientist-form"]');
```

### Avoid

```typescript
// Too brittle
await window.locator('.btn-primary-lg');
await window.locator('#form-submit-btn-2');
```

## CI Workflow

**File**: `.github/workflows/pr-checks.yml`

### E2E Test Flow

1. Build Python executable
2. Generate Prisma client
3. Start dev server (platform-specific)
   - Linux: `xvfb-run npm run start &`
   - Others: `npm run start &`
4. Wait for server (Linux: 45s, others: 30s)
5. Run E2E tests
6. Stop dev server

### Platform-Specific

```yaml
# Linux
env:
  ELECTRON_DISABLE_SANDBOX: 1
run: xvfb-run npm run test:e2e

# macOS/Windows
run: npm run test:e2e
```

## Debugging Failed Tests

### View Artifacts

```bash
# Screenshots
ls test-results/**/test-failed*.png

# Videos
ls test-results/**/*.webm

# Traces
npx playwright show-trace test-results/**/trace.zip
```

### Run Single Test

```bash
# By name
npm run test:e2e -- --grep "should create scientist"

# By file
npm run test:e2e -- tests/e2e/scientists-management.e2e.ts
```

### Debug Mode

```bash
# Step through with inspector
npm run test:e2e:debug

# Interactive UI
npm run test:e2e:ui
```

## Known Issues

### 1. DevTools Race Condition

**Issue**: `firstWindow()` may return DevTools instead of main window

**Solution**:

```typescript
const windows = await electronApp.windows();
const window = windows.find((w) => w.url().includes('localhost')) || windows[0];
```

### 2. ELECTRON_RUN_AS_NODE

**Issue**: "bad option: --remote-debugging-port=0" in VS Code environments

**Solution**: Fixed in `playwright.config.ts`:

```typescript
delete process.env.ELECTRON_RUN_AS_NODE;
```

### 3. Linux Sandbox

**Issue**: SUID sandbox errors in CI

**Solution**:

```typescript
if (process.platform === 'linux' && process.env.CI === 'true') {
  args.push('--no-sandbox');
}
```

## Documentation Links

- [E2E Testing Guide](../../../docs/E2E_TESTING.md)
- [Database Setup](../../../docs/DATABASE.md)
- [OpenSpec E2E Framework](../../../openspec/changes/archive/2025-11-05-add-e2e-testing-framework/design.md)
- [Playwright Docs](https://playwright.dev/docs/intro)
- [Vitest Docs](https://vitest.dev/)
