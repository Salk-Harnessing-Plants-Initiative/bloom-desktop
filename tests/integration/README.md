# Integration Tests

This directory contains integration tests for Bloom Desktop. These tests validate the complete integration of different subsystems, from IPC communication to hardware interfaces to database operations.

## Test Types

### 1. Renderer Database IPC Tests (`renderer-database-ipc.test.ts`)

**Purpose**: Validates the complete renderer → IPC → main → database path for all database operations using Playwright.

**What it tests**:

- IPC bridge functionality between renderer and main processes
- Database CRUD operations via IPC handlers
- Context isolation (renderer cannot access Node.js APIs directly)
- Error handling in IPC communication
- Relations and filters in database queries

**Key characteristics**:

- Runs using Playwright with Electron
- Uses `window.evaluate()` to call IPC handlers from renderer context
- Creates isolated test database for each test
- Validates data via direct Prisma queries
- Tests all database models: Scientists, Phenotypers, Accessions, Experiments, Scans

**Relationship to E2E tests**: These tests validate the IPC infrastructure before UI development. Full E2E tests with UI interactions are in `tests/e2e/`. For reference on full E2E tests with UI, see the pilot's [create-experiments.e2e.ts](https://github.com/eberrigan/bloom-desktop-pilot/blob/benfica/add-testing/app/tests/e2e/create-experiments.e2e.ts).

**Running the tests**:

```bash
npm run test:renderer:database
```

**CI Integration**: Runs on Ubuntu with xvfb (headless display server). Expected duration: ~90 seconds.

### 2. IPC Tests (`test-ipc.ts`)

**Purpose**: Tests basic IPC communication between main and renderer processes.

**Running the tests**:

```bash
npm run test:ipc
```

### 3. Hardware Integration Tests

Tests for Python hardware backend integration:

- `test-camera.ts` / `test-streaming.ts`: Camera capture and streaming
- `test-daq.ts`: DAQ (Data Acquisition) for turntable control
- `test-scanner.ts`: Complete scanner workflow

**Running the tests**:

```bash
npm run test:camera    # Camera capture/streaming
npm run test:daq       # DAQ integration
npm run test:scanner   # Scanner workflow
```

### 4. Database Integration Tests

- `test-scanner-database.ts`: Scanner workflow with database persistence

**Running the tests**:

```bash
npm run test:scanner-database
```

### 5. Package Tests (`test-package.ts`)

**Purpose**: Tests the packaged application.

**Running the tests**:

```bash
npm run test:package
npm run test:package:database
```

## Test Patterns for Future Renderer IPC Tests

When adding new renderer IPC tests, follow these patterns:

### 1. Test File Setup

```typescript
import {
  test,
  expect,
  _electron as electron,
  ElectronApplication,
  Page,
} from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import type { ElectronAPI } from '../../src/types/electron';

// Type for window with electron API
interface WindowWithElectron extends Window {
  electron: ElectronAPI;
}

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

const TEST_DB_PATH = path.join(__dirname, 'your-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
```

### 2. Test Lifecycle

```typescript
test.beforeEach(async () => {
  // 1. Clean up existing test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  // 2. Create Prisma client
  prisma = new PrismaClient({
    datasources: { db: { url: TEST_DB_URL } },
  });
  await prisma.$connect();

  // 3. Apply schema
  execSync('npx prisma db push --skip-generate', {
    cwd: appRoot,
    env: { ...process.env, BLOOM_DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
  });

  // 4. Launch Electron
  await launchElectronApp();
});

test.afterEach(async () => {
  // Clean up in reverse order
  if (prisma) await prisma.$disconnect();
  if (electronApp) await electronApp.close();
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
});
```

### 3. Calling IPC Handlers from Renderer

```typescript
test('should perform database operation', async () => {
  const result = await window.evaluate(() => {
    return (
      window as WindowWithElectron
    ).electron.database.yourModel.yourMethod({
      // your data
    });
  });

  expect(result.success).toBe(true);
  expect(result.data).toBeDefined();
});
```

### 4. Testing Error Cases

For error cases, use type assertions instead of `any`:

```typescript
test('should handle error when creating with missing required field', async () => {
  const result = await window.evaluate(() => {
    return (window as WindowWithElectron).electron.database.yourModel.create({
      name: 'Test',
      // Missing required field
    } as { name: string }); // Use specific type instead of 'any'
  });

  expect(result.success).toBe(false);
  expect(result.error).toBeDefined();
  expect(result.error).toContain('required_field');
});
```

### 5. Verifying Data Persistence

Always verify that IPC operations actually persisted to the database:

```typescript
test('should create record via IPC', async () => {
  const result = await window.evaluate(() => {
    return (window as WindowWithElectron).electron.database.yourModel.create({
      name: 'Test',
    });
  });

  expect(result.success).toBe(true);

  // Verify in database via direct Prisma query
  const record = await prisma.yourModel.findFirst({
    where: { name: 'Test' },
  });
  expect(record).toBeDefined();
  expect(record?.name).toBe('Test');
});
```

### 6. Testing Relations

When testing models with relations, verify that related data is loaded:

```typescript
test('should load relations', async () => {
  // Seed related data
  const parent = await prisma.parentModel.create({
    data: { name: 'Parent' },
  });

  const child = await prisma.childModel.create({
    data: {
      name: 'Child',
      parent_id: parent.id,
    },
  });

  // Call IPC handler
  const result = await window.evaluate((id) => {
    return (window as WindowWithElectron).electron.database.childModel.get(id);
  }, child.id);

  expect(result.success).toBe(true);
  expect(result.data.parent).toBeDefined();
  expect(result.data.parent.name).toBe('Parent');
});
```

### 7. Testing Filters

When testing list operations with filters:

```typescript
test('should filter results', async () => {
  // Create multiple records
  await prisma.model.createMany({
    data: [
      { name: 'Record 1', category: 'A' },
      { name: 'Record 2', category: 'B' },
    ],
  });

  // Test filter
  const result = await window.evaluate(() => {
    return (window as WindowWithElectron).electron.database.model.list({
      category: 'A',
    });
  });

  expect(result.success).toBe(true);
  expect(result.data).toHaveLength(1);
  expect(result.data[0].name).toBe('Record 1');
});
```

### 8. Testing Context Isolation

Always include tests to verify context isolation:

```typescript
test.describe('Context Isolation', () => {
  test('should not expose require() to renderer', async () => {
    const hasRequire = await window.evaluate(() => {
      return typeof (window as any).require !== 'undefined';
    });
    expect(hasRequire).toBe(false);
  });

  test('should not expose process to renderer', async () => {
    const hasProcess = await window.evaluate(() => {
      return typeof (window as any).process !== 'undefined';
    });
    expect(hasProcess).toBe(false);
  });

  test('should only expose window.electron APIs', async () => {
    const apis = await window.evaluate(() => {
      const electron = (window as WindowWithElectron).electron;
      return {
        hasElectron: typeof electron !== 'undefined',
        hasYourAPI: typeof electron?.yourAPI !== 'undefined',
      };
    });
    expect(apis.hasElectron).toBe(true);
    expect(apis.hasYourAPI).toBe(true);
  });
});
```

## Best Practices

1. **Isolation**: Each test should use its own database and clean up after itself
2. **Type Safety**: Use TypeScript types instead of `any` for better error catching
3. **Verification**: Always verify IPC results both in the response and in the database
4. **Error Testing**: Test both success and error cases for all operations
5. **Relations**: Test that relations are properly loaded and serialized through IPC
6. **Context Isolation**: Verify security boundaries are maintained
7. **Performance**: Keep tests fast by only testing IPC bridge, not full UI workflows

## CI Configuration

All integration tests run in CI on multiple platforms. The renderer database IPC tests specifically run on Ubuntu with xvfb for headless testing.

See [.github/workflows/pr-checks.yml](../../.github/workflows/pr-checks.yml) for the complete CI configuration.
