/**
 * E2E Test: App Launch and Database Initialization
 *
 * Tests the Electron app's ability to launch and initialize using Electron Forge's dev build.
 *
 * PREREQUISITES:
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e` (in Terminal 2)
 *
 * The Electron app loads the renderer from Electron Forge's dev server on port 9000.
 * The dev server MUST be running or the Electron window will be blank.
 *
 * IMPORTANT: Playwright v1.44+ has a regression bug with packaged Electron apps.
 * The _electron.launch() API adds --remote-debugging-port=0 flag that packaged apps reject.
 * See: https://github.com/microsoft/playwright/issues/32027
 *
 * Decision: Use Electron Forge dev build for Playwright E2E tests (catches 95% of issues).
 * For packaged app validation, use integration test: `npm run test:package:database`
 *
 * Reference: openspec/changes/add-e2e-testing-framework/design.md (Decision 1, Issue 2, Decision 5)
 */

import {
  test,
  expect,
  _electron as electron,
  ElectronApplication,
  Page,
} from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

// Import electron path using require() since the module exports a string path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;

test.describe('Electron App Launch', () => {
  // IMPORTANT: These tests require the Electron Forge dev server to be running!
  // The dev server must be started BEFORE running tests with: npm run start
  //
  // Why: Electron Forge configures MAIN_WINDOW_WEBPACK_ENTRY to point to
  // http://localhost:9000 (dev server URL), not a file path.
  // Without the dev server running, the Electron window loads but UI is blank.
  //
  // In CI: The dev server is started in the workflow before running tests
  // Locally: Run `npm run start` in a separate terminal, then `npm run test:e2e`

  test.beforeEach(async () => {
    // Clean up any existing test database
    // Database path from .env.e2e: file:../tests/e2e/test.db (relative to prisma/ dir)
    // Resolves to: tests/e2e/test.db from project root
    // Reference: openspec/changes/add-e2e-testing-framework/design.md (Decision 3)
    const testDbPath = path.join(__dirname, '../../tests/e2e/test.db');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Create directory if it doesn't exist
    const testDbDir = path.dirname(testDbPath);
    if (!fs.existsSync(testDbDir)) {
      fs.mkdirSync(testDbDir, { recursive: true });
    }

    // Create the test database file and apply schema
    // prisma db push creates the database file and applies the schema without migrations
    // Uses BLOOM_DATABASE_URL from .env.e2e (single source of truth)
    const appRoot = path.join(__dirname, '../..');
    execSync('npx prisma db push --skip-generate', {
      cwd: appRoot,
      env: process.env, // Use environment from .env.e2e
      stdio: 'pipe', // Suppress output
    });

    // Launch Electron app using webpack dev build
    // Point directly to the built main process file to avoid Playwright's --remote-debugging-port=0 bug
    // The .webpack/main/index.js is created when the dev server starts (npm run start)
    // Reference: openspec/changes/add-e2e-testing-framework/design.md (Decision 5, Known Issue 2)
    //
    // IMPORTANT: The dev server must be running for these tests to work!
    // Locally: Start dev server with `npm run start` before running tests
    // CI: Dev server is started in the workflow as a background process
    //
    // Environment variables are loaded from .env.e2e by Playwright config (dotenv.config)
    // and are available in process.env for both this test file and the launched Electron app
    //
    // Linux CI Fix: Add --no-sandbox flag for Linux CI environments
    // This fixes SUID sandbox permission errors in GitHub Actions Linux runners
    const args = [path.join(appRoot, '.webpack/main/index.js')];
    if (process.platform === 'linux' && process.env.CI === 'true') {
      args.push('--no-sandbox');
    }

    electronApp = await electron.launch({
      executablePath: electronPath,
      args,
      cwd: appRoot,
      env: process.env as Record<string, string>,
    });

    // Get the first window that opens
    // WORKAROUND for DevTools race condition (GitHub issue #10964):
    // firstWindow() may return DevTools window instead of main window
    // Solution: Get all windows and filter for localhost
    // Reference: openspec/changes/add-e2e-testing-framework/design.md (Known Issue 1)
    const windows = await electronApp.windows();

    // Find the main window (not DevTools)
    window = windows.find((w) => w.url().includes('localhost')) || windows[0];

    // Wait for the window to be ready
    await window.waitForLoadState('domcontentloaded', { timeout: 30000 });
  });

  test.afterEach(async () => {
    // Close the app
    if (electronApp) {
      await electronApp.close();
    }

    // Clean up test database at tests/e2e/test.db
    const testDbPath = path.join(__dirname, '../../tests/e2e/test.db');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  test('should launch successfully and show window', async () => {
    // Verify app launched
    expect(electronApp).toBeDefined();

    // Verify window was created
    expect(window).toBeDefined();

    // Wait for title to be set (may take a moment for page to load)
    // Increased timeout for slower CI environments, especially Ubuntu
    // 60s timeout accounts for slower Ubuntu runners where initial page load can be slow
    await window.waitForFunction(
      () => document.title.includes('Bloom Desktop'),
      { timeout: 60000 }
    );

    // Check window title contains "Bloom Desktop"
    const title = await window.title();
    expect(title).toContain('Bloom Desktop');

    // Verify window is visible
    const isVisible = await window.isVisible('body');
    expect(isVisible).toBe(true);
  });

  test('should initialize database on startup', async () => {
    // Give the app time to initialize the database
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify test database file was created at tests/e2e/test.db
    const testDbPath = path.join(__dirname, '../../tests/e2e/test.db');
    const dbExists = fs.existsSync(testDbPath);
    expect(dbExists).toBe(true);
  });

  test('should display page content', async () => {
    // Wait for page to load
    await window.waitForLoadState('networkidle', { timeout: 15000 });

    // Check that we see some content on the page
    const bodyContent = await window.locator('body').textContent();
    expect(bodyContent).toBeTruthy();
    expect(bodyContent!.length).toBeGreaterThan(0);
  });
});
