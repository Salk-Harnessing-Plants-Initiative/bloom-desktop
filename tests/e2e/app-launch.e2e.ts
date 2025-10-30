/**
 * E2E Test: App Launch and Database Initialization
 *
 * Tests the packaged Electron app's ability to launch and initialize.
 * This is a foundational test that verifies the core application startup.
 *
 * NOTE: These tests require the app to be packaged first:
 * Run `npm run package` before running E2E tests.
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

// Path to the packaged app (macOS example - adjust for other platforms)
const getPackagedAppPath = () => {
  const platform = process.platform;

  if (platform === 'darwin') {
    return path.join(
      __dirname,
      '../../out/Bloom Desktop-darwin-arm64/Bloom Desktop.app/Contents/MacOS/Bloom Desktop'
    );
  } else if (platform === 'win32') {
    return path.join(
      __dirname,
      '../../out/Bloom Desktop-win32-x64/Bloom Desktop.exe'
    );
  } else {
    // Linux
    return path.join(
      __dirname,
      '../../out/Bloom Desktop-linux-x64/bloom-desktop'
    );
  }
};

test.describe('Electron App Launch', () => {
  test.beforeAll(async () => {
    // Check if packaged app exists, if not try to package it
    const appPath = getPackagedAppPath();
    if (!fs.existsSync(appPath)) {
      console.log('[E2E] Packaged app not found, building...');
      try {
        execSync('npm run package', {
          stdio: 'inherit',
          cwd: path.join(__dirname, '../..'),
        });
      } catch (error) {
        throw new Error(
          `Failed to package app. Please run 'npm run package' manually. Error: ${error}`
        );
      }
    }
  });

  test.beforeEach(async () => {
    // Clean up any existing test database
    const testDbPath = path.join(__dirname, 'test.db');
    if (fs.existsSync(testDbPath)) {
      fs.unlinkSync(testDbPath);
    }

    // Launch the packaged Electron app
    const appPath = getPackagedAppPath();

    electronApp = await electron.launch({
      executablePath: appPath,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        BLOOM_DATABASE_URL: `file:${testDbPath}`,
      },
    });

    // Get the first window that the app opens
    window = await electronApp.firstWindow();

    // Wait for the window to be ready
    await window.waitForLoadState('domcontentloaded', { timeout: 30000 });
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
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify test database file was created
    const testDbPath = path.join(__dirname, 'test.db');
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
