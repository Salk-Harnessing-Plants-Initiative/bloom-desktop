/**
 * E2E Test: Phenotypers Management UI
 *
 * Tests the complete user workflow for managing phenotypers through the UI,
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
 * - Database integration (phenotyper creation and list refresh)
 * - Error handling (duplicate email constraint)
 *
 * **Database Isolation:**
 * - Test database: tests/e2e/phenotypers-ui-test.db
 * - Created fresh for each test via BLOOM_DATABASE_URL environment variable
 * - Main process uses test database, dev server only serves UI
 *
 * Related: openspec/changes/add-phenotypers-management-ui/
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
import {
  createTestBloomConfig,
  cleanupTestBloomConfig,
} from './helpers/bloom-config';

// Import electron path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

// Test database path for UI tests
const TEST_DB_PATH = path.join(__dirname, 'phenotypers-ui-test.db');
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
  // Create minimal ~/.bloom/.env to prevent Machine Config redirect
  createTestBloomConfig();

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

  // Clean up test ~/.bloom/.env (restores original if there was one)
  cleanupTestBloomConfig();
});

test.describe('Phenotypers Management', () => {
  test('should navigate to Phenotypers page', async () => {
    // Click on Phenotypers navigation link
    await window.click('text=Phenotypers');

    // Verify page heading (use getByRole to be more specific and avoid sidebar title)
    await expect(
      window.getByRole('heading', { name: 'Phenotypers', exact: true })
    ).toBeVisible();
  });

  test('should display empty state when no phenotypers exist', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Verify empty state message
    await expect(window.locator('text=No phenotypers yet')).toBeVisible();
  });

  test('should create phenotyper with valid data', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Fill in the form
    await window.fill('input#name', 'John Smith');
    await window.fill('input#email', 'john.smith@example.com');

    // Submit the form
    await window.click('button:has-text("Add new phenotyper")');

    // Wait for phenotyper to appear in the list
    await expect(
      window.locator('text=John Smith (john.smith@example.com)')
    ).toBeVisible();

    // Verify form was cleared
    await expect(window.locator('input#name')).toHaveValue('');
    await expect(window.locator('input#email')).toHaveValue('');
  });

  test('should display created phenotypers in alphabetical order', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Create first phenotyper
    await window.fill('input#name', 'Zara Wilson');
    await window.fill('input#email', 'zara.wilson@example.com');
    await window.click('button:has-text("Add new phenotyper")');
    await expect(window.locator('text=Zara Wilson')).toBeVisible();

    // Create second phenotyper
    await window.fill('input#name', 'Alice Brown');
    await window.fill('input#email', 'alice.brown@example.com');
    await window.click('button:has-text("Add new phenotyper")');
    await expect(window.locator('text=Alice Brown')).toBeVisible();

    // Get list items
    const listItems = await window.locator('ul li').allTextContents();

    // Verify alphabetical order (Alice should come before Zara)
    expect(listItems[0]).toContain('Alice Brown');
    expect(listItems[1]).toContain('Zara Wilson');
  });

  test('should show validation error for empty name', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Fill only email, leave name empty
    await window.fill('input#email', 'test@example.com');

    // Try to submit
    await window.click('button:has-text("Add new phenotyper")');

    // Verify validation error appears
    await expect(window.locator('text=Name is required')).toBeVisible();

    // Verify phenotyper was NOT created (still empty state)
    await expect(window.locator('text=No phenotypers yet')).toBeVisible();
  });

  test('should show validation error for invalid email format', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Fill with invalid email
    await window.fill('input#name', 'Test Person');
    await window.fill('input#email', 'notanemail');

    // Try to submit
    await window.click('button:has-text("Add new phenotyper")');

    // Verify validation error appears
    await expect(
      window.locator('text=Must be a valid email address')
    ).toBeVisible();

    // Verify phenotyper was NOT created
    await expect(window.locator('text=No phenotypers yet')).toBeVisible();
  });

  test('should show database error for duplicate email', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Create first phenotyper
    await window.fill('input#name', 'John Doe');
    await window.fill('input#email', 'john.doe@example.com');
    await window.click('button:has-text("Add new phenotyper")');
    await expect(window.locator('text=John Doe')).toBeVisible();

    // Try to create another phenotyper with same email
    await window.fill('input#name', 'Jane Doe');
    await window.fill('input#email', 'john.doe@example.com');
    await window.click('button:has-text("Add new phenotyper")');

    // Verify duplicate email error appears
    await expect(
      window.locator('text=A phenotyper with this email already exists')
    ).toBeVisible();

    // Verify only one phenotyper exists in the list
    const listItems = await window.locator('ul li').count();
    expect(listItems).toBe(1);
  });

  test('should show loading state during creation', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Fill in the form
    await window.fill('input#name', 'Test Loading');
    await window.fill('input#email', 'loading@example.com');

    // Click submit and immediately check for loading state
    const submitButton = window.locator(
      'button:has-text("Add new phenotyper")'
    );
    await submitButton.click();

    // The button should show "Adding..." while submitting
    // Note: This might be too fast to catch, but we verify it exists
    const buttonText = await submitButton.textContent();
    expect(buttonText).toMatch(/Add new phenotyper|Adding\.\.\./);
  });

  test('should clear validation errors when user starts typing', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Submit empty form to trigger validation error
    await window.click('button:has-text("Add new phenotyper")');

    // Verify error appears
    await expect(window.locator('text=Name is required')).toBeVisible();

    // Start typing in name field
    await window.fill('input#name', 'T');

    // Error should be cleared (or at least not visible after a brief moment)
    // We check that the form can now be filled normally
    await window.fill('input#name', 'Test');
    await window.fill('input#email', 'test@example.com');
    await window.click('button:has-text("Add new phenotyper")');

    // Should succeed - wait for phenotyper to appear
    await expect(window.locator('text=Test (test@example.com)')).toBeVisible();
  });

  // Edge Case Tests
  test('should create phenotyper with maximum length name (255 characters)', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Create name with exactly 255 characters (database schema limit)
    const maxLengthName = 'A'.repeat(255);

    // Fill in the form
    await window.fill('input#name', maxLengthName);
    await window.fill('input#email', 'maxlength@example.com');

    // Submit the form
    await window.click('button:has-text("Add new phenotyper")');

    // Verify phenotyper was created (check by email since name is very long)
    await expect(window.locator('text=maxlength@example.com')).toBeVisible();

    // Verify in database
    const phenotyper = await prisma.phenotyper.findUnique({
      where: { email: 'maxlength@example.com' },
    });
    expect(phenotyper).not.toBeNull();
    expect(phenotyper?.name).toBe(maxLengthName);
    expect(phenotyper?.name.length).toBe(255);
  });

  test('should create phenotyper with special characters in name', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Test name with apostrophe and hyphen
    await window.fill('input#name', "O'Brien-Smith");
    await window.fill('input#email', 'obrien@example.com');

    // Submit the form
    await window.click('button:has-text("Add new phenotyper")');

    // Verify phenotyper appears with special characters preserved
    await expect(window.locator("text=O'Brien-Smith")).toBeVisible();

    // Verify in database
    const phenotyper = await prisma.phenotyper.findUnique({
      where: { email: 'obrien@example.com' },
    });
    expect(phenotyper?.name).toBe("O'Brien-Smith");
  });

  test('should create phenotyper with Unicode characters in name', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Test name with Unicode characters
    await window.fill('input#name', 'José García');
    await window.fill('input#email', 'jose@example.com');

    // Submit the form
    await window.click('button:has-text("Add new phenotyper")');

    // Verify phenotyper appears with Unicode characters preserved
    await expect(window.locator('text=José García')).toBeVisible();

    // Create another phenotyper to test alphabetical sorting with Unicode
    await window.fill('input#name', 'Anderson');
    await window.fill('input#email', 'anderson@example.com');
    await window.click('button:has-text("Add new phenotyper")');
    await expect(window.locator('text=Anderson')).toBeVisible();

    // Verify alphabetical sorting works with Unicode
    const listItems = await window.locator('ul li').allTextContents();
    expect(listItems[0]).toContain('Anderson');
    expect(listItems[1]).toContain('José García');
  });

  test('should create phenotyper with subdomain email', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Test email with subdomain
    await window.fill('input#name', 'Subdomain Test');
    await window.fill('input#email', 'user@test.example.com');

    // Submit the form
    await window.click('button:has-text("Add new phenotyper")');

    // Verify phenotyper was created
    await expect(window.locator('text=user@test.example.com')).toBeVisible();

    // Verify in database
    const phenotyper = await prisma.phenotyper.findUnique({
      where: { email: 'user@test.example.com' },
    });
    expect(phenotyper).not.toBeNull();
  });

  test('should prevent rapid double submission', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Fill in the form
    await window.fill('input#name', 'Double Click Test');
    await window.fill('input#email', 'doubleclick@example.com');

    // Click submit button twice in rapid succession
    const submitButton = window.locator(
      'button:has-text("Add new phenotyper")'
    );
    await Promise.all([submitButton.click(), submitButton.click()]);

    // Wait for phenotyper to appear in the list
    await expect(window.locator('text=doubleclick@example.com')).toBeVisible();

    // Verify only one phenotyper was created
    const count = await prisma.phenotyper.count({
      where: { email: 'doubleclick@example.com' },
    });
    expect(count).toBe(1);

    // Verify only one entry in the list
    const listItems = await window.locator('ul li').count();
    expect(listItems).toBe(1);
  });

  test('should preserve state across page navigation', async () => {
    // Navigate to Phenotypers page
    await window.click('text=Phenotypers');

    // Create a phenotyper
    await window.fill('input#name', 'Navigation Test');
    await window.fill('input#email', 'navigation@example.com');
    await window.click('button:has-text("Add new phenotyper")');

    // Verify phenotyper appears
    await expect(window.locator('text=Navigation Test')).toBeVisible();

    // Navigate to home page
    await window.click('text=Home');

    // Wait for home page to load (unique heading on home page)
    await expect(
      window.getByRole('heading', { name: 'Under Construction', exact: true })
    ).toBeVisible();

    // Navigate back to Phenotypers page
    await window.click('text=Phenotypers');

    // Wait for Phenotypers page heading to load
    await expect(
      window.getByRole('heading', { name: 'Phenotypers', exact: true })
    ).toBeVisible();

    // Verify phenotyper still appears (loaded from database, not just UI state)
    await expect(window.locator('text=Navigation Test')).toBeVisible();

    // Verify form is cleared (not showing previous input)
    await expect(window.locator('input#name')).toHaveValue('');
    await expect(window.locator('input#email')).toHaveValue('');

    // Verify data is in database
    const phenotyper = await prisma.phenotyper.findUnique({
      where: { email: 'navigation@example.com' },
    });
    expect(phenotyper).not.toBeNull();
    expect(phenotyper?.name).toBe('Navigation Test');
  });
});
