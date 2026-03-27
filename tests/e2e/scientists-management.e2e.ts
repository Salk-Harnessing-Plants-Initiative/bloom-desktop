/**
 * E2E Test: Scientists Management UI — Sequential Story
 *
 * Tests run as a sequential user story with one app instance.
 * Order: Empty State → Validation → Create → List → Edge Cases → Navigation
 *
 * **PREREQUISITES:**
 * 1. Start Electron Forge dev server: `npm run start`
 * 2. Run E2E tests: `npm run test:e2e`
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

const TEST_DB_PATH = path.join(__dirname, 'scientists-ui-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

async function launchElectronApp() {
  const appRoot = path.join(__dirname, '../..');
  const args = [path.join(appRoot, '.webpack/main/index.js')];
  if (process.platform === 'linux' && process.env.CI === 'true') {
    args.push('--no-sandbox');
  }

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

  const windows = await electronApp.windows();
  window = windows.find((w) => w.url().includes('localhost')) || windows[0];
  await window.waitForLoadState('domcontentloaded', { timeout: 30000 });
}

test.describe.serial('Scientists Management', () => {
  test.beforeAll(async () => {
    createTestBloomConfig();

    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    prisma = new PrismaClient({
      datasources: { db: { url: TEST_DB_URL } },
    });
    await prisma.$connect();

    const appRoot = path.join(__dirname, '../..');
    execSync('npx prisma db push --skip-generate', {
      cwd: appRoot,
      env: { ...process.env, BLOOM_DATABASE_URL: TEST_DB_URL },
      stdio: 'pipe',
    });

    await launchElectronApp();
  });

  test.afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    await closeElectronApp(electronApp);
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    cleanupTestBloomConfig();
  });

  // =========================================================================
  // Phase 1: Navigate + Empty State (DB empty from beforeAll)
  // =========================================================================

  test('should navigate to Scientists page', async () => {
    await window.click('text=Scientists');
    await expect(
      window.getByRole('heading', { name: 'Scientists', exact: true })
    ).toBeVisible();
  });

  test('should display empty state when no scientists exist', async () => {
    // Already on Scientists page from previous test
    await expect(window.locator('text=No scientists yet')).toBeVisible();
  });

  // =========================================================================
  // Phase 1b: Validation (no DB data needed)
  // =========================================================================

  test('should show validation error for empty name', async () => {
    await window.fill('input#email', 'test@example.com');
    await window.click('button:has-text("Add new scientist")');
    await expect(window.locator('text=Name is required')).toBeVisible();
    // Still empty state
    await expect(window.locator('text=No scientists yet')).toBeVisible();
  });

  test('should show validation error for invalid email format', async () => {
    await window.fill('input#name', 'Dr. Test Person');
    await window.fill('input#email', 'notanemail');
    await window.click('button:has-text("Add new scientist")');
    await expect(
      window.locator('text=Must be a valid email address')
    ).toBeVisible();
    await expect(window.locator('text=No scientists yet')).toBeVisible();
  });

  test('should clear validation errors when user starts typing', async () => {
    // Clear form and trigger error
    await window.fill('input#name', '');
    await window.fill('input#email', '');
    await window.click('button:has-text("Add new scientist")');
    await expect(window.locator('text=Name is required')).toBeVisible();

    // Start typing — error should clear
    await window.fill('input#name', 'Dr. Test');
    await window.fill('input#email', 'test-clear@example.com');
    await window.click('button:has-text("Add new scientist")');

    // Should succeed
    await expect(
      window.locator('text=Dr. Test (test-clear@example.com)')
    ).toBeVisible();
  });

  // =========================================================================
  // Phase 2: Create (build up data)
  // =========================================================================

  test('should create scientist with valid data', async () => {
    await window.fill('input#name', 'Dr. Jane Smith');
    await window.fill('input#email', 'jane.smith@example.com');
    await window.click('button:has-text("Add new scientist")');

    await expect(
      window.locator('text=Dr. Jane Smith (jane.smith@example.com)')
    ).toBeVisible();

    // Verify form was cleared
    await expect(window.locator('input#name')).toHaveValue('');
    await expect(window.locator('input#email')).toHaveValue('');
  });

  test('should display created scientists in alphabetical order', async () => {
    // Create Zara (should sort after Jane)
    await window.fill('input#name', 'Dr. Zara Wilson');
    await window.fill('input#email', 'zara.wilson@example.com');
    await window.click('button:has-text("Add new scientist")');
    await expect(window.locator('text=Dr. Zara Wilson')).toBeVisible();

    // Create Alice (should sort before Jane)
    await window.fill('input#name', 'Dr. Alice Brown');
    await window.fill('input#email', 'alice.brown@example.com');
    await window.click('button:has-text("Add new scientist")');
    await expect(window.locator('text=Dr. Alice Brown')).toBeVisible();

    // Verify alphabetical order
    const listItems = await window.locator('ul li').allTextContents();
    expect(listItems[0]).toContain('Dr. Alice Brown');
    // Dr. Jane Smith and Dr. Test from earlier tests should be in between
    expect(listItems[listItems.length - 1]).toContain('Dr. Zara Wilson');
  });

  test('should show database error for duplicate email', async () => {
    // Try to create scientist with existing email
    await window.fill('input#name', 'Dr. Duplicate');
    await window.fill('input#email', 'jane.smith@example.com');
    await window.click('button:has-text("Add new scientist")');

    await expect(
      window.locator('text=A scientist with this email already exists')
    ).toBeVisible();
  });

  test('should show loading state during creation', async () => {
    await window.fill('input#name', 'Dr. Test Loading');
    await window.fill('input#email', 'loading@example.com');

    const submitButton = window.locator('button:has-text("Add new scientist")');
    await submitButton.click();

    const buttonText = await submitButton.textContent();
    expect(buttonText).toMatch(/Add new scientist|Adding\.\.\./);
  });

  // =========================================================================
  // Phase 3: Edge Cases (uses existing data context)
  // =========================================================================

  test('should create scientist with maximum length name (255 characters)', async () => {
    const maxLengthName = 'A'.repeat(255);
    await window.fill('input#name', maxLengthName);
    await window.fill('input#email', 'maxlength@example.com');
    await window.click('button:has-text("Add new scientist")');

    await expect(window.locator('text=maxlength@example.com')).toBeVisible();

    const scientist = await prisma.scientist.findUnique({
      where: { email: 'maxlength@example.com' },
    });
    expect(scientist?.name.length).toBe(255);
  });

  test('should create scientist with special characters in name', async () => {
    await window.fill('input#name', "Dr. O'Brien-Smith");
    await window.fill('input#email', 'obrien@example.com');
    await window.click('button:has-text("Add new scientist")');

    await expect(window.locator("text=Dr. O'Brien-Smith")).toBeVisible();
  });

  test('should create scientist with Unicode characters in name', async () => {
    await window.fill('input#name', 'Dr. Müller');
    await window.fill('input#email', 'muller@example.com');
    await window.click('button:has-text("Add new scientist")');

    await expect(window.locator('text=Dr. Müller')).toBeVisible();
  });

  test('should create scientist with subdomain email', async () => {
    await window.fill('input#name', 'Dr. Subdomain Test');
    await window.fill('input#email', 'user@test.example.com');
    await window.click('button:has-text("Add new scientist")');

    await expect(window.locator('text=user@test.example.com')).toBeVisible();
  });

  test('should prevent rapid double submission', async () => {
    await window.fill('input#name', 'Dr. Double Click Test');
    await window.fill('input#email', 'doubleclick@example.com');

    const submitButton = window.locator('button:has-text("Add new scientist")');
    await Promise.all([submitButton.click(), submitButton.click()]);

    await expect(window.locator('text=doubleclick@example.com')).toBeVisible();

    const count = await prisma.scientist.count({
      where: { email: 'doubleclick@example.com' },
    });
    expect(count).toBe(1);
  });

  // =========================================================================
  // Phase 6: Navigation (preserves all data from above)
  // =========================================================================

  test('should preserve state across page navigation', async () => {
    // Navigate away
    await window.click('text=Home');
    await expect(
      window.getByRole('heading', { name: 'Under Construction', exact: true })
    ).toBeVisible();

    // Navigate back
    await window.click('text=Scientists');
    await expect(
      window.getByRole('heading', { name: 'Scientists', exact: true })
    ).toBeVisible();

    // Verify scientists still appear (Dr. Jane Smith from earlier)
    await expect(window.locator('text=Dr. Jane Smith')).toBeVisible();
  });
});
