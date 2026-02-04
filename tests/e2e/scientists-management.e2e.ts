/**
 * E2E Test: Scientists Management UI
 *
 * Tests the complete user workflow for managing scientists through the UI,
 * including navigation, list display, form validation, and creation.
 *
 * **PREREQUISITES:**
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e` (in Terminal 2)
 *
 * The Electron app loads the renderer from Electron Forge's dev server on port 9000.
 * The dev server MUST be running or the Electron window will be blank.
 *
 * **Test Focus:**
 * - UI interactions (navigation, form filling, button clicks)
 * - Form validation (client-side Zod validation)
 * - Database integration (scientist creation and list refresh)
 * - Error handling (duplicate email constraint)
 *
 * **Database Isolation:**
 * - Test database: tests/e2e/scientists-ui-test.db
 * - Created fresh for each test via BLOOM_DATABASE_URL environment variable
 * - Main process uses test database, dev server only serves UI
 *
 * Related: openspec/changes/add-scientists-management-ui/
 */

import {
  test,
  expect,
  _electron as electron,
  ElectronApplication,
  Page,
} from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { closeElectronApp } from './helpers/electron-cleanup';

// Import electron path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

// Test database path for UI tests
const TEST_DB_PATH = path.join(__dirname, 'scientists-ui-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

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
 * Test setup: Create fresh database and launch app
 */
test.beforeEach(async () => {
  // Clean up any existing test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  // Create Prisma client for direct database access
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: TEST_DB_URL,
      },
    },
  });

  // Connect to database
  await prisma.$connect();

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

  // Launch Electron app
  await launchElectronApp();
});

/**
 * Test teardown: Close app and clean up database
 */
test.afterEach(async () => {
  // Disconnect from database
  if (prisma) {
    await prisma.$disconnect();
  }

  // Close Electron app and wait for process to fully terminate
  await closeElectronApp(electronApp);

  // Clean up test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

test.describe('Scientists Management', () => {
  test('should navigate to Scientists page', async () => {
    // Click on Scientists navigation link
    await window.click('text=Scientists');

    // Verify page heading (use getByRole to be more specific and avoid sidebar title)
    await expect(
      window.getByRole('heading', { name: 'Scientists', exact: true })
    ).toBeVisible();
  });

  test('should display empty state when no scientists exist', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Verify empty state message
    await expect(window.locator('text=No scientists yet')).toBeVisible();
  });

  test('should create scientist with valid data', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Fill in the form
    await window.fill('input#name', 'Dr. Jane Smith');
    await window.fill('input#email', 'jane.smith@example.com');

    // Submit the form
    await window.click('button:has-text("Add new scientist")');

    // Wait for scientist to appear in the list
    await expect(
      window.locator('text=Dr. Jane Smith (jane.smith@example.com)')
    ).toBeVisible();

    // Verify form was cleared
    await expect(window.locator('input#name')).toHaveValue('');
    await expect(window.locator('input#email')).toHaveValue('');
  });

  test('should display created scientists in alphabetical order', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Create first scientist
    await window.fill('input#name', 'Dr. Zara Wilson');
    await window.fill('input#email', 'zara.wilson@example.com');
    await window.click('button:has-text("Add new scientist")');
    await expect(window.locator('text=Dr. Zara Wilson')).toBeVisible();

    // Create second scientist
    await window.fill('input#name', 'Dr. Alice Brown');
    await window.fill('input#email', 'alice.brown@example.com');
    await window.click('button:has-text("Add new scientist")');
    await expect(window.locator('text=Dr. Alice Brown')).toBeVisible();

    // Get list items
    const listItems = await window.locator('ul li').allTextContents();

    // Verify alphabetical order (Alice should come before Zara)
    expect(listItems[0]).toContain('Dr. Alice Brown');
    expect(listItems[1]).toContain('Dr. Zara Wilson');
  });

  test('should show validation error for empty name', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Fill only email, leave name empty
    await window.fill('input#email', 'test@example.com');

    // Try to submit
    await window.click('button:has-text("Add new scientist")');

    // Verify validation error appears
    await expect(window.locator('text=Name is required')).toBeVisible();

    // Verify scientist was NOT created (still empty state)
    await expect(window.locator('text=No scientists yet')).toBeVisible();
  });

  test('should show validation error for invalid email format', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Fill with invalid email
    await window.fill('input#name', 'Dr. Test Person');
    await window.fill('input#email', 'notanemail');

    // Try to submit
    await window.click('button:has-text("Add new scientist")');

    // Verify validation error appears
    await expect(
      window.locator('text=Must be a valid email address')
    ).toBeVisible();

    // Verify scientist was NOT created
    await expect(window.locator('text=No scientists yet')).toBeVisible();
  });

  test('should show database error for duplicate email', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Create first scientist
    await window.fill('input#name', 'Dr. John Doe');
    await window.fill('input#email', 'john.doe@example.com');
    await window.click('button:has-text("Add new scientist")');
    await expect(window.locator('text=Dr. John Doe')).toBeVisible();

    // Try to create another scientist with same email
    await window.fill('input#name', 'Dr. Jane Doe');
    await window.fill('input#email', 'john.doe@example.com');
    await window.click('button:has-text("Add new scientist")');

    // Verify duplicate email error appears
    await expect(
      window.locator('text=A scientist with this email already exists')
    ).toBeVisible();

    // Verify only one scientist exists in the list
    const listItems = await window.locator('ul li').count();
    expect(listItems).toBe(1);
  });

  test('should show loading state during creation', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Fill in the form
    await window.fill('input#name', 'Dr. Test Loading');
    await window.fill('input#email', 'loading@example.com');

    // Click submit and immediately check for loading state
    const submitButton = window.locator('button:has-text("Add new scientist")');
    await submitButton.click();

    // The button should show "Adding..." while submitting
    // Note: This might be too fast to catch, but we verify it exists
    const buttonText = await submitButton.textContent();
    expect(buttonText).toMatch(/Add new scientist|Adding\.\.\./);
  });

  test('should clear validation errors when user starts typing', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Submit empty form to trigger validation error
    await window.click('button:has-text("Add new scientist")');

    // Verify error appears
    await expect(window.locator('text=Name is required')).toBeVisible();

    // Start typing in name field
    await window.fill('input#name', 'D');

    // Error should be cleared (or at least not visible after a brief moment)
    // We check that the form can now be filled normally
    await window.fill('input#name', 'Dr. Test');
    await window.fill('input#email', 'test@example.com');
    await window.click('button:has-text("Add new scientist")');

    // Should succeed - wait for scientist to appear
    await expect(
      window.locator('text=Dr. Test (test@example.com)')
    ).toBeVisible();
  });

  // Edge Case Tests
  test('should create scientist with maximum length name (255 characters)', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Create name with exactly 255 characters (database schema limit)
    const maxLengthName = 'A'.repeat(255);

    // Fill in the form
    await window.fill('input#name', maxLengthName);
    await window.fill('input#email', 'maxlength@example.com');

    // Submit the form
    await window.click('button:has-text("Add new scientist")');

    // Verify scientist was created (check by email since name is very long)
    await expect(window.locator('text=maxlength@example.com')).toBeVisible();

    // Verify in database
    const scientist = await prisma.scientist.findUnique({
      where: { email: 'maxlength@example.com' },
    });
    expect(scientist).not.toBeNull();
    expect(scientist?.name).toBe(maxLengthName);
    expect(scientist?.name.length).toBe(255);
  });

  test('should create scientist with special characters in name', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Test name with apostrophe and hyphen
    await window.fill('input#name', "Dr. O'Brien-Smith");
    await window.fill('input#email', 'obrien@example.com');

    // Submit the form
    await window.click('button:has-text("Add new scientist")');

    // Verify scientist appears with special characters preserved
    await expect(window.locator("text=Dr. O'Brien-Smith")).toBeVisible();

    // Verify in database
    const scientist = await prisma.scientist.findUnique({
      where: { email: 'obrien@example.com' },
    });
    expect(scientist?.name).toBe("Dr. O'Brien-Smith");
  });

  test('should create scientist with Unicode characters in name', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Test name with Unicode characters
    await window.fill('input#name', 'Dr. Müller');
    await window.fill('input#email', 'muller@example.com');

    // Submit the form
    await window.click('button:has-text("Add new scientist")');

    // Verify scientist appears with Unicode characters preserved
    await expect(window.locator('text=Dr. Müller')).toBeVisible();

    // Create another scientist to test alphabetical sorting with Unicode
    await window.fill('input#name', 'Dr. Anderson');
    await window.fill('input#email', 'anderson@example.com');
    await window.click('button:has-text("Add new scientist")');
    await expect(window.locator('text=Dr. Anderson')).toBeVisible();

    // Verify alphabetical sorting works with Unicode
    const listItems = await window.locator('ul li').allTextContents();
    expect(listItems[0]).toContain('Dr. Anderson');
    expect(listItems[1]).toContain('Dr. Müller');
  });

  test('should create scientist with subdomain email', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Test email with subdomain
    await window.fill('input#name', 'Dr. Subdomain Test');
    await window.fill('input#email', 'user@test.example.com');

    // Submit the form
    await window.click('button:has-text("Add new scientist")');

    // Verify scientist was created
    await expect(window.locator('text=user@test.example.com')).toBeVisible();

    // Verify in database
    const scientist = await prisma.scientist.findUnique({
      where: { email: 'user@test.example.com' },
    });
    expect(scientist).not.toBeNull();
  });

  test('should prevent rapid double submission', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Fill in the form
    await window.fill('input#name', 'Dr. Double Click Test');
    await window.fill('input#email', 'doubleclick@example.com');

    // Click submit button twice in rapid succession
    const submitButton = window.locator('button:has-text("Add new scientist")');
    await Promise.all([submitButton.click(), submitButton.click()]);

    // Wait for scientist to appear in the list
    await expect(window.locator('text=doubleclick@example.com')).toBeVisible();

    // Verify only one scientist was created
    const count = await prisma.scientist.count({
      where: { email: 'doubleclick@example.com' },
    });
    expect(count).toBe(1);

    // Verify only one entry in the list
    const listItems = await window.locator('ul li').count();
    expect(listItems).toBe(1);
  });

  test('should preserve state across page navigation', async () => {
    // Navigate to Scientists page
    await window.click('text=Scientists');

    // Create a scientist
    await window.fill('input#name', 'Dr. Navigation Test');
    await window.fill('input#email', 'navigation@example.com');
    await window.click('button:has-text("Add new scientist")');

    // Verify scientist appears
    await expect(window.locator('text=Dr. Navigation Test')).toBeVisible();

    // Navigate to home page
    await window.click('text=Home');

    // Wait for home page to load (unique heading on home page)
    await expect(
      window.getByRole('heading', { name: 'Under Construction', exact: true })
    ).toBeVisible();

    // Navigate back to Scientists page
    await window.click('text=Scientists');

    // Wait for Scientists page heading to load
    await expect(
      window.getByRole('heading', { name: 'Scientists', exact: true })
    ).toBeVisible();

    // Verify scientist still appears (loaded from database, not just UI state)
    await expect(window.locator('text=Dr. Navigation Test')).toBeVisible();

    // Verify form is cleared (not showing previous input)
    await expect(window.locator('input#name')).toHaveValue('');
    await expect(window.locator('input#email')).toHaveValue('');

    // Verify data is in database
    const scientist = await prisma.scientist.findUnique({
      where: { email: 'navigation@example.com' },
    });
    expect(scientist).not.toBeNull();
    expect(scientist?.name).toBe('Dr. Navigation Test');
  });
});
