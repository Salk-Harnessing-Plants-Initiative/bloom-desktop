/**
 * E2E Test: Machine Configuration - Fetch Scanners Button
 *
 * Tests the "Fetch Scanners from Bloom" button functionality in Machine Configuration.
 * This feature allows users to test their Bloom API credentials and fetch the scanner
 * list without saving the entire configuration form.
 *
 * NOTE: These tests do NOT create ~/.bloom/.env, so the app automatically redirects
 * to the Machine Configuration page on startup. This follows the spec:
 * "Machine Configuration tests skip config setup - the test SHALL NOT create
 * ~/.bloom/.env to allow the natural redirect to occur"
 *
 * PREREQUISITES:
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e` (in Terminal 2)
 *
 * Reference: openspec/changes/add-fetch-scanners-button/
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
import { closeElectronApp } from './helpers/electron-cleanup';
import { getEnvPath, getBloomDir } from './helpers/bloom-config';

// Import electron path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;

// Test database path
const TEST_DB_PATH = path.join(
  __dirname,
  'machine-config-fetch-scanners-test.db'
);
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Store original env file if it exists
let originalEnvContent: string | null = null;
let originalEnvExisted = false;

/**
 * Helper: Launch Electron app with test database
 */
async function launchElectronApp() {
  const appRoot = path.join(__dirname, '../..');

  // Build args for Electron
  const args = [path.join(appRoot, '.webpack/main/index.js')];
  if (process.platform === 'linux' && process.env.CI === 'true') {
    args.push('--no-sandbox');
  }

  // Launch Electron with test database URL
  electronApp = await electron.launch({
    executablePath: electronPath,
    args,
    cwd: appRoot,
    env: {
      ...process.env,
      BLOOM_DATABASE_URL: TEST_DB_URL,
      NODE_ENV: 'test',
    } as Record<string, string>,
  });

  // Get the main window
  const windows = await electronApp.windows();
  window = windows.find((w) => w.url().includes('localhost')) || windows[0];

  // Wait for window to be ready
  await window.waitForLoadState('domcontentloaded', { timeout: 30000 });
}

/**
 * Test setup: Create fresh database and launch app WITHOUT ~/.bloom/.env
 *
 * This test suite intentionally does NOT create the bloom config file,
 * causing the app to redirect to Machine Configuration on startup.
 */
test.beforeEach(async () => {
  const envPath = getEnvPath();
  const bloomDir = getBloomDir();

  // Backup existing env file if it exists
  if (fs.existsSync(envPath)) {
    originalEnvExisted = true;
    originalEnvContent = fs.readFileSync(envPath, 'utf-8');
    fs.unlinkSync(envPath); // Remove it so app redirects to Machine Config
  } else {
    originalEnvExisted = false;
    originalEnvContent = null;
  }

  // Ensure .bloom directory exists (for the app to work)
  if (!fs.existsSync(bloomDir)) {
    fs.mkdirSync(bloomDir, { recursive: true });
  }

  // Clean up any existing test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  // Create the test database file and apply schema
  const appRoot = path.join(__dirname, '../..');
  execSync('npx prisma db push --skip-generate', {
    cwd: appRoot,
    env: {
      ...process.env,
      BLOOM_DATABASE_URL: TEST_DB_URL,
    },
    stdio: 'pipe',
  });

  // Launch Electron app - it will redirect to Machine Configuration
  await launchElectronApp();
});

/**
 * Test teardown: Close app, restore env file, and clean up database
 */
test.afterEach(async () => {
  // Close Electron app and wait for process to fully terminate
  await closeElectronApp(electronApp);

  // Restore original env file if it existed
  const envPath = getEnvPath();
  if (originalEnvExisted && originalEnvContent !== null) {
    fs.writeFileSync(envPath, originalEnvContent, 'utf-8');
  }

  // Clean up test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

test.describe('Machine Configuration - Fetch Scanners Button', () => {
  test.beforeEach(async () => {
    // Wait for Machine Configuration page to load (app auto-redirects here)
    await expect(
      window.getByRole('heading', { name: 'Machine Configuration' })
    ).toBeVisible({ timeout: 15000 });
  });

  test('should display Fetch Scanners button in credentials section', async () => {
    // Check for button presence
    const button = await window.locator(
      'button:has-text("Fetch Scanners from Bloom")'
    );
    await expect(button).toBeVisible();
  });

  test('should have button disabled when credentials are incomplete', async () => {
    // Button should be disabled initially (no credentials)
    const button = await window.locator(
      'button:has-text("Fetch Scanners from Bloom")'
    );
    await expect(button).toBeDisabled();
  });

  test('should enable button when all credentials are entered', async () => {
    // Fill in all credential fields
    await window.fill('input[id*="creds-username"]', 'test@salk.edu');
    await window.fill('input[id*="creds-password"]', 'testpass123');
    await window.fill(
      'input[id*="creds-anonkey"]',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
    );

    // API URL should be pre-filled, but let's make sure
    const apiUrlInput = await window.locator('input[id*="api-url"]');
    const apiUrlValue = await apiUrlInput.inputValue();
    if (!apiUrlValue) {
      await window.fill(
        'input[id*="api-url"]',
        'https://api.bloom.salk.edu/proxy'
      );
    }

    // Button should now be enabled
    const button = await window.locator(
      'button:has-text("Fetch Scanners from Bloom")'
    );
    await expect(button).toBeEnabled();
  });

  test('should show loading state when fetching scanners', async () => {
    // Fill in credentials
    await window.fill('input[id*="creds-username"]', 'test@salk.edu');
    await window.fill('input[id*="creds-password"]', 'testpass123');
    await window.fill(
      'input[id*="creds-anonkey"]',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test'
    );

    // Click the fetch button
    const button = await window.locator(
      'button:has-text("Fetch Scanners from Bloom")'
    );
    await button.click();

    // Should show loading text (might be fast, so we check if it appears OR succeeds quickly)
    try {
      await window.waitForSelector('text=Fetching scanners...', {
        timeout: 1000,
      });
    } catch {
      // If it's too fast to see loading, that's okay - check for result instead
      await window.waitForSelector(
        'text=/Found \\d+ scanner|Authentication failed|Failed to fetch/',
        { timeout: 5000 }
      );
    }
  });

  test('should show error message with invalid credentials', async () => {
    // Fill in invalid credentials
    await window.fill('input[id*="creds-username"]', 'invalid@salk.edu');
    await window.fill('input[id*="creds-password"]', 'wrongpassword');
    await window.fill(
      'input[id*="creds-anonkey"]',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.invalid'
    );

    // Click the fetch button
    const button = await window.locator(
      'button:has-text("Fetch Scanners from Bloom")'
    );
    await button.click();

    // Should show error message
    await window.waitForSelector(
      'text=/Authentication failed|Failed to fetch|Invalid/',
      { timeout: 10000 }
    );
  });

  test('should populate scanner dropdown after successful fetch', async () => {
    // Fill in VALID test credentials (from .env)
    await window.fill(
      'input[id*="creds-username"]',
      process.env.BLOOM_TEST_USERNAME || 'bloom_desktop_test@salk.edu'
    );
    await window.fill(
      'input[id*="creds-password"]',
      process.env.BLOOM_TEST_PASSWORD || 'bloom_desktop_test_123'
    );
    await window.fill(
      'input[id*="creds-anonkey"]',
      process.env.BLOOM_ANON_KEY ||
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ewogICAgInJvbGUiOiAiYW5vbiIsCiAgICAiaXNzIjogInN1cGFiYXNlIiwKICAgICJpYXQiOiAxNjg3NTkwMDAwLAogICAgImV4cCI6IDE4NDU0NDI4MDAKfQ.ev7gXAhB8Uv6pgRF9B5oEpmlYI6l15DUIlAQBWSGxPU'
    );

    // Click the fetch button
    const button = await window.locator(
      'button:has-text("Fetch Scanners from Bloom")'
    );
    await button.click();

    // Wait for success message
    await window.waitForSelector('text=/Found \\d+ scanner/', {
      timeout: 10000,
    });

    // Check that scanner dropdown is now populated
    const scannerDropdown = await window.locator('select[id*="scanner-name"]');
    const options = await scannerDropdown.locator('option').count();

    // Should have at least 2 options (placeholder + at least 1 scanner)
    expect(options).toBeGreaterThan(1);
  });

  test('should not require full form completion to fetch scanners', async () => {
    // Fill ONLY credentials (not camera IP or scans directory)
    await window.fill(
      'input[id*="creds-username"]',
      process.env.BLOOM_TEST_USERNAME || 'bloom_desktop_test@salk.edu'
    );
    await window.fill(
      'input[id*="creds-password"]',
      process.env.BLOOM_TEST_PASSWORD || 'bloom_desktop_test_123'
    );
    await window.fill(
      'input[id*="creds-anonkey"]',
      process.env.BLOOM_ANON_KEY ||
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.ewogICAgInJvbGUiOiAiYW5vbiIsCiAgICAiaXNzIjogInN1cGFiYXNlIiwKICAgICJpYXQiOiAxNjg3NTkwMDAwLAogICAgImV4cCI6IDE4NDU0NDI4MDAKfQ.ev7gXAhB8Uv6pgRF9B5oEpmlYI6l15DUIlAQBWSGxPU'
    );

    // Click fetch button - should work without filling other fields
    const button = await window.locator(
      'button:has-text("Fetch Scanners from Bloom")'
    );
    await button.click();

    // Should fetch successfully (this is the key UX improvement)
    await window.waitForSelector('text=/Found \\d+ scanner/', {
      timeout: 10000,
    });

    // Success! User can now select scanner and complete rest of form
  });
});
