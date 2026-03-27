/**
 * E2E Test: Phenotypers Management UI — Sequential Story
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

const TEST_DB_PATH = path.join(__dirname, 'phenotypers-ui-test.db');
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

test.describe.serial('Phenotypers Management', () => {
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
  // Phase 1: Navigate + Empty State
  // =========================================================================

  test('should navigate to Phenotypers page', async () => {
    await window.click('text=Phenotypers');
    await expect(
      window.getByRole('heading', { name: 'Phenotypers', exact: true })
    ).toBeVisible();
  });

  test('should display empty state when no phenotypers exist', async () => {
    await expect(window.locator('text=No phenotypers yet')).toBeVisible();
  });

  // =========================================================================
  // Phase 1b: Validation
  // =========================================================================

  test('should show validation error for empty name', async () => {
    await window.fill('input#email', 'test@example.com');
    await window.click('button:has-text("Add new phenotyper")');
    await expect(window.locator('text=Name is required')).toBeVisible();
    await expect(window.locator('text=No phenotypers yet')).toBeVisible();
  });

  test('should show validation error for invalid email format', async () => {
    await window.fill('input#name', 'Test Person');
    await window.fill('input#email', 'notanemail');
    await window.click('button:has-text("Add new phenotyper")');
    await expect(
      window.locator('text=Must be a valid email address')
    ).toBeVisible();
    await expect(window.locator('text=No phenotypers yet')).toBeVisible();
  });

  test('should clear validation errors when user starts typing', async () => {
    await window.fill('input#name', '');
    await window.fill('input#email', '');
    await window.click('button:has-text("Add new phenotyper")');
    await expect(window.locator('text=Name is required')).toBeVisible();

    await window.fill('input#name', 'Test');
    await window.fill('input#email', 'test-clear@example.com');
    await window.click('button:has-text("Add new phenotyper")');

    await expect(
      window.locator('text=Test (test-clear@example.com)')
    ).toBeVisible();
  });

  // =========================================================================
  // Phase 2: Create
  // =========================================================================

  test('should create phenotyper with valid data', async () => {
    await window.fill('input#name', 'John Smith');
    await window.fill('input#email', 'john.smith@example.com');
    await window.click('button:has-text("Add new phenotyper")');

    await expect(
      window.locator('text=John Smith (john.smith@example.com)')
    ).toBeVisible();

    await expect(window.locator('input#name')).toHaveValue('');
    await expect(window.locator('input#email')).toHaveValue('');
  });

  test('should display created phenotypers in alphabetical order', async () => {
    await window.fill('input#name', 'Zara Wilson');
    await window.fill('input#email', 'zara.wilson@example.com');
    await window.click('button:has-text("Add new phenotyper")');
    await expect(window.locator('text=Zara Wilson')).toBeVisible();

    await window.fill('input#name', 'Alice Brown');
    await window.fill('input#email', 'alice.brown@example.com');
    await window.click('button:has-text("Add new phenotyper")');
    await expect(window.locator('text=Alice Brown')).toBeVisible();

    const listItems = await window.locator('ul li').allTextContents();
    expect(listItems[0]).toContain('Alice Brown');
    expect(listItems[listItems.length - 1]).toContain('Zara Wilson');
  });

  test('should show database error for duplicate email', async () => {
    await window.fill('input#name', 'Duplicate');
    await window.fill('input#email', 'john.smith@example.com');
    await window.click('button:has-text("Add new phenotyper")');

    await expect(
      window.locator('text=A phenotyper with this email already exists')
    ).toBeVisible();
  });

  test('should show loading state during creation', async () => {
    await window.fill('input#name', 'Test Loading');
    await window.fill('input#email', 'loading@example.com');

    const submitButton = window.locator(
      'button:has-text("Add new phenotyper")'
    );
    await submitButton.click();

    const buttonText = await submitButton.textContent();
    expect(buttonText).toMatch(/Add new phenotyper|Adding\.\.\./);
  });

  // =========================================================================
  // Phase 3: Edge Cases
  // =========================================================================

  test('should create phenotyper with maximum length name (255 characters)', async () => {
    const maxLengthName = 'A'.repeat(255);
    await window.fill('input#name', maxLengthName);
    await window.fill('input#email', 'maxlength@example.com');
    await window.click('button:has-text("Add new phenotyper")');

    await expect(window.locator('text=maxlength@example.com')).toBeVisible();

    const phenotyper = await prisma.phenotyper.findUnique({
      where: { email: 'maxlength@example.com' },
    });
    expect(phenotyper?.name.length).toBe(255);
  });

  test('should create phenotyper with special characters in name', async () => {
    await window.fill('input#name', "O'Brien-Smith");
    await window.fill('input#email', 'obrien@example.com');
    await window.click('button:has-text("Add new phenotyper")');

    await expect(window.locator("text=O'Brien-Smith")).toBeVisible();
  });

  test('should create phenotyper with Unicode characters in name', async () => {
    await window.fill('input#name', 'José García');
    await window.fill('input#email', 'jose@example.com');
    await window.click('button:has-text("Add new phenotyper")');

    await expect(window.locator('text=José García')).toBeVisible();
  });

  test('should create phenotyper with subdomain email', async () => {
    await window.fill('input#name', 'Subdomain Test');
    await window.fill('input#email', 'user@test.example.com');
    await window.click('button:has-text("Add new phenotyper")');

    await expect(window.locator('text=user@test.example.com')).toBeVisible();
  });

  test('should prevent rapid double submission', async () => {
    await window.fill('input#name', 'Double Click Test');
    await window.fill('input#email', 'doubleclick@example.com');

    const submitButton = window.locator(
      'button:has-text("Add new phenotyper")'
    );
    await Promise.all([submitButton.click(), submitButton.click()]);

    await expect(window.locator('text=doubleclick@example.com')).toBeVisible();

    const count = await prisma.phenotyper.count({
      where: { email: 'doubleclick@example.com' },
    });
    expect(count).toBe(1);
  });

  // =========================================================================
  // Phase 6: Navigation
  // =========================================================================

  test('should preserve state across page navigation', async () => {
    await window.click('text=Home');
    await expect(
      window.getByRole('heading', { name: 'Under Construction', exact: true })
    ).toBeVisible();

    await window.click('text=Phenotypers');
    await expect(
      window.getByRole('heading', { name: 'Phenotypers', exact: true })
    ).toBeVisible();

    await expect(window.locator('text=John Smith')).toBeVisible();
  });
});
