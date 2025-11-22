---
name: electron-playwright-workflow
description: |
  Development workflow for Electron + React + TypeScript apps with Playwright E2E testing, Vitest unit tests, and CI integration.
  Use when: implementing features across main/renderer processes, writing or debugging E2E tests, fixing CI failures,
  refactoring IPC handlers, or working with Playwright MCP for browser automation.
  Integrates with OpenSpec for spec-driven development.
allowed-tools: Read, Grep, Glob, Bash, Edit, Write, Task
---

# Electron + Playwright Development Workflow

You are working on an Electron + React + TypeScript desktop application with comprehensive testing.

## Architecture Overview

```
Renderer Process (React)  ←→  Preload Bridge  ←→  Main Process (Node.js)  ←→  Python Subprocess
     src/renderer/              src/main/preload.ts      src/main/              python/
```

**Critical Boundaries:**

- **Renderer**: Browser context, NO Node.js APIs, access main via `window.electron.*`
- **Preload**: ONLY file that bridges main/renderer, uses `contextBridge.exposeInMainWorld`
- **Main**: Node.js context, manages IPC handlers, database, Python subprocesses
- **Python**: Hardware control, communicates with main via stdio IPC

## Before Making Changes

### Context Checklist

- [ ] Read relevant OpenSpec if exists: check `openspec/specs/` or `openspec/changes/`
- [ ] Understand the file's process context (main vs renderer)
- [ ] Review related tests in `tests/unit/` or `tests/e2e/`

### Process Boundary Rules

**NEVER do these:**

- Import Node.js modules (`fs`, `path`, `child_process`) in renderer code
- Import React/browser APIs in main process code
- Bypass preload bridge for main↔renderer communication
- Access `window.electron` without null checks

**ALWAYS do these:**

- Validate IPC inputs with Zod schemas in main process handlers
- Update `src/types/electron.d.ts` when adding IPC methods
- Use `contextBridge.exposeInMainWorld` in preload for new APIs

## Testing Commands

### Quick Reference

| Task                  | Command                                         |
| --------------------- | ----------------------------------------------- |
| Lint                  | `npm run lint`                                  |
| Format                | `npm run format`                                |
| Unit tests            | `npm run test:unit`                             |
| Unit tests (watch)    | `npm run test:unit:watch`                       |
| Unit tests (coverage) | `npm run test:unit:coverage`                    |
| E2E tests             | Start dev server first, then `npm run test:e2e` |
| E2E tests (UI mode)   | `npm run test:e2e:ui`                           |
| Python tests          | `npm run test:python`                           |

### E2E Test Requirements

**CRITICAL**: E2E tests require the dev server running on port 9000!

```bash
# Terminal 1: Start dev server (keep running)
npm run start

# Terminal 2: Run E2E tests
npm run test:e2e
```

Without the dev server, Electron launches but the window is blank.

### Validation After Changes

**Always run after code changes:**

```bash
npm run lint && npm run test:unit
```

**For E2E changes, additionally run E2E tests.**

## E2E Testing Patterns

### Test Structure

```typescript
import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

const electronPath: string = require('electron');

test.describe('Feature Name', () => {
  let electronApp;
  let window;

  test.beforeEach(async () => {
    // Setup database
    const TEST_DB_PATH = path.join(__dirname, 'test.db');
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

    execSync('npx prisma db push --skip-generate', {
      env: { ...process.env, BLOOM_DATABASE_URL: `file:${TEST_DB_PATH}` },
      stdio: 'pipe',
    });

    // Launch Electron
    electronApp = await electron.launch({
      executablePath: electronPath,
      args: [path.join(__dirname, '../..', '.webpack/main/index.js')],
      env: { ...process.env, BLOOM_DATABASE_URL: `file:${TEST_DB_PATH}` },
    });

    window = await electronApp.firstWindow();
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    await electronApp?.close();
    // Cleanup database
  });

  test('should do something', async () => {
    // Test implementation
  });
});
```

### Avoid Flaky Tests

**BAD - Fixed timeouts:**

```typescript
await window.waitForTimeout(500); // Avoid!
```

**GOOD - Wait for actual state:**

```typescript
await expect(window.locator('text=Expected Text')).toBeVisible({
  timeout: 5000,
});

// Or wait for network idle
await window.waitForLoadState('networkidle');

// Or poll for condition
await expect(async () => {
  const count = await prisma.scientist.count();
  expect(count).toBe(1);
}).toPass({ timeout: 5000 });
```

### CI Platform Notes

| Platform | Special Requirements                                          |
| -------- | ------------------------------------------------------------- |
| Linux    | `--no-sandbox` flag, `xvfb-run`, `ELECTRON_DISABLE_SANDBOX=1` |
| macOS    | None - works out of the box                                   |
| Windows  | Use `shell: bash` in CI for cross-platform scripts            |

## Adding New Features

### Implementation Order

1. **Types first**: `src/types/` - Define interfaces
2. **Main process**: `src/main/` - IPC handlers, database
3. **Preload bridge**: `src/main/preload.ts` - Expose to renderer
4. **Type declarations**: `src/types/electron.d.ts` - Update window.electron types
5. **Renderer**: `src/renderer/` - React components
6. **Unit tests**: `tests/unit/` - Component/function tests
7. **E2E tests**: `tests/e2e/` - User workflow tests

### IPC Handler Pattern

**In `src/main/database-handlers.ts`:**

```typescript
import { z } from 'zod';

const CreateScientistSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
});

ipcMain.handle('db:scientists:create', async (_, data: unknown) => {
  const validated = CreateScientistSchema.parse(data);
  return prisma.scientist.create({ data: validated });
});
```

**In `src/main/preload.ts`:**

```typescript
contextBridge.exposeInMainWorld('electron', {
  database: {
    scientists: {
      create: (data) => ipcRenderer.invoke('db:scientists:create', data),
    },
  },
});
```

**In `src/types/electron.d.ts`:**

```typescript
interface ElectronAPI {
  database: {
    scientists: {
      create: (data: CreateScientistInput) => Promise<Scientist>;
    };
  };
}
```

## Common Issues & Solutions

### "bad option: --remote-debugging-port=0"

**Cause**: `ELECTRON_RUN_AS_NODE=1` set in environment (VS Code/Claude Code)

**Solution**: Already fixed in `playwright.config.ts`:

```typescript
delete process.env.ELECTRON_RUN_AS_NODE;
```

### Blank Electron Window

**Cause**: Dev server not running on port 9000

**Solution**: Start dev server first with `npm run start`

### Database Errors in E2E Tests

**Cause**: Path resolution issues

**Solution**: Use `path.join(__dirname, 'test.db')` not `path.resolve()`

## Files to Avoid Modifying

Without explicit request, do NOT modify:

- `forge.config.ts` - Electron builder config
- `webpack.*.ts` - Build configuration
- `prisma/schema.prisma` - Use migrations instead
- `.github/workflows/*.yml` - CI pipelines
- `python/*.spec` - PyInstaller config

## OpenSpec Integration

For new features or significant changes:

1. Check `openspec/specs/` for existing specifications
2. Create proposal in `openspec/changes/` if needed
3. Follow the spec during implementation
4. Update tasks.md as you complete work

## Debugging

### E2E Test Debugging

```bash
# Interactive UI mode (recommended)
npm run test:e2e:ui

# Step-through debugging
npm run test:e2e:debug

# View test report
npx playwright show-report
```

### Check Dev Server

```bash
# Is port 9000 in use?
lsof -i :9000

# Is server responding?
curl http://localhost:9000
```

### Enable Debug Logging

```bash
# Playwright debug
DEBUG=pw:* npm run test:e2e

# Electron debug
ELECTRON_ENABLE_LOGGING=1 npm run test:e2e
```
