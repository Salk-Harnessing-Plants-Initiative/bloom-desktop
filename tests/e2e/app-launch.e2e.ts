/**
 * E2E Test: App Launch and Database Initialization
 *
 * Tests the Electron app's ability to launch and initialize using the development build.
 *
 * IMPORTANT: Playwright's _electron API is designed for development builds, not packaged apps.
 * Testing the webpack development build is the standard approach for Electron E2E tests.
 *
 * For packaged app testing, use the integration test: `npm run test:package:database`
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

let electronApp: ElectronApplication;
let window: Page;

test.describe('Electron App Launch', () => {
  // No beforeAll needed - Electron Forge auto-builds webpack on first launch

  test.beforeEach(async () => {
    // Clean up any existing test database
    // Database is created at prisma/tests/e2e/test.db (relative to prisma/ dir)
    const testDbPath = path.join(__dirname, '../../prisma/tests/e2e/test.db');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Also clean up the directory where it might be created
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
      env: process.env,  // Use environment from .env.e2e
      stdio: 'pipe',  // Suppress output
    });

    // Launch Electron app using the pilot's working approach
    // Pass '.' as the arg to load app from package.json "main" field
    // This avoids the --remote-debugging-port issue that occurs when
    // passing the main file path directly
    const electronPath = require('electron');
    
    electronApp = await electron.launch({
      executablePath: electronPath as string,
      args: ['.'],
      cwd: appRoot,
      env: process.env,  // Simply use environment (includes .env.e2e vars loaded by Playwright)
    });

    // Get the first window that opens
    window = await electronApp.firstWindow();
    
    // Wait for the window to be ready
    await window.waitForLoadState('domcontentloaded', { timeout: 30000 });
  });

  test.afterEach(async () => {
    // Close the app
    if (electronApp) {
      await electronApp.close();
    }

    // Clean up test database at prisma/tests/e2e/test.db
    const testDbPath = path.join(__dirname, '../../prisma/tests/e2e/test.db');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }
  });

  test('should launch successfully and show window', async () => {
    // Verify app launched
    expect(electronApp).toBeDefined();

    // Verify window was created
    expect(window).toBeDefined();

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

    // Verify test database file was created at prisma/tests/e2e/test.db
    const testDbPath = path.join(__dirname, '../../prisma/tests/e2e/test.db');
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