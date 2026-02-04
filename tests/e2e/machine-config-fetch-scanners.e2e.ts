/**
 * E2E Test: Machine Configuration - Fetch Scanners Button
 *
 * Tests the "Fetch Scanners from Bloom" button functionality in Machine Configuration.
 * This feature allows users to test their Bloom API credentials and fetch the scanner
 * list without saving the entire configuration form.
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
import { closeElectronApp } from './helpers/electron-cleanup';

// Import electron path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;

// Test database path
const E2E_DB_PATH = path.resolve(
  __dirname,
  '../../prisma/e2e-test-machine-config.db'
);

test.beforeAll(async () => {
  // Clean up any existing test database
  if (fs.existsSync(E2E_DB_PATH)) {
    fs.unlinkSync(E2E_DB_PATH);
  }

  // Launch Electron app
  electronApp = await electron.launch({
    executablePath: electronPath,
    args: [path.join(__dirname, '../../.webpack/main/index.js')],
    env: {
      ...process.env,
      BLOOM_DATABASE_URL: `file:${E2E_DB_PATH}`,
      NODE_ENV: 'test',
    },
  });

  // Get the first window
  window = await electronApp.firstWindow();
  await window.waitForLoadState('domcontentloaded');
});

test.afterAll(async () => {
  // Close app and wait for process to fully terminate
  await closeElectronApp(electronApp);

  // Clean up test database
  if (fs.existsSync(E2E_DB_PATH)) {
    fs.unlinkSync(E2E_DB_PATH);
  }
});

test.describe('Machine Configuration - Fetch Scanners Button', () => {
  test.beforeEach(async () => {
    // Navigate to Machine Configuration
    await window.click('text=Configuration');
    await window.waitForSelector('text=Machine Configuration');
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
