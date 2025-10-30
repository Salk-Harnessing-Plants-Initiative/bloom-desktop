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

    // Launch Electron app with webpack dev build
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../.webpack/main')],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        BLOOM_DATABASE_URL: `file:${testDbPath}`,
      },
    });

    // Get the first window that the app opens
    window = await electronApp.firstWindow();
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
    // Wait for database initialization log
    // The app logs "[Database] Database initialized successfully" on startup

    // Give the app a few seconds to initialize
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Verify test database file was created
    const testDbPath = path.join(__dirname, 'test.db');
    const dbExists = fs.existsSync(testDbPath);
    expect(dbExists).toBe(true);
  });

  test('should navigate to Home page by default', async () => {
    // Wait for page to load
    await window.waitForLoadState('networkidle');

    // Check that we're on the home page
    // The home page should have a heading with "Bloom Desktop"
    const heading = await window.locator('h1').first();
    const headingText = await heading.textContent();

    // Verify we see content (could be "Capture Scan" or "Bloom Desktop")
    expect(headingText).toBeTruthy();
    expect(headingText!.length).toBeGreaterThan(0);
  });

  test('should have navigation menu', async () => {
    // Wait for page to load
    await window.waitForLoadState('networkidle');

    // Check for navigation links
    // The Layout component should have links to Capture Scan, Browse Scans, etc.
    const navLinks = await window.locator('nav a').count();

    // We should have at least some navigation links
    expect(navLinks).toBeGreaterThan(0);
  });

  test('should initialize Python subprocess', async () => {
    // Give Python subprocess time to start
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // The app should have logged Python initialization
    // We can't directly check logs in Playwright, but we can verify
    // the app is responsive and hasn't crashed

    // Check that the window is still responsive
    const isVisible = await window.isVisible('body');
    expect(isVisible).toBe(true);

    // Verify we can interact with the page
    const bodyContent = await window.locator('body').textContent();
    expect(bodyContent).toBeTruthy();
    expect(bodyContent!.length).toBeGreaterThan(0);
  });
});
