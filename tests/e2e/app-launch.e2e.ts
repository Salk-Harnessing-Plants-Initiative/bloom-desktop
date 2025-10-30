/**
 * E2E Test: App Launch and Database Initialization
 *
 * Tests the Electron app's ability to launch and initialize the database.
 * This is a foundational test that verifies the core application startup.
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

let electronApp: ElectronApplication;
let window: Page;

test.describe('Electron App Launch', () => {
  test.beforeEach(async () => {
    // Clean up any existing test database
    const testDbPath = path.join(__dirname, 'test.db');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Launch Electron app
    // For Electron Forge, we need to point to the Electron executable and main entry point
    const executablePath = path.join(
      __dirname,
      '../../node_modules/.bin/electron'
    );
    const mainPath = path.join(__dirname, '../../.webpack/main/index.js');

    electronApp = await electron.launch({
      executablePath,
      args: [mainPath],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        BLOOM_DATABASE_URL: `file:${testDbPath}`,
      },
    });

    // Get the first window that the app opens
    window = await electronApp.firstWindow();

    // Wait a moment for the window to be ready
    await window.waitForLoadState('domcontentloaded');
  });

  test.afterEach(async () => {
    // Close the app
    if (electronApp) {
      await electronApp.close();
    }

    // Clean up test database
    const testDbPath = path.join(__dirname, 'test.db');
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
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Verify test database file was created
    const testDbPath = path.join(__dirname, 'test.db');
    const dbExists = fs.existsSync(testDbPath);
    expect(dbExists).toBe(true);
  });

  test('should display page content', async () => {
    // Wait for page to load
    await window.waitForLoadState('networkidle', { timeout: 10000 });

    // Check that we see some content on the page
    const bodyContent = await window.locator('body').textContent();
    expect(bodyContent).toBeTruthy();
    expect(bodyContent!.length).toBeGreaterThan(0);
  });
});
