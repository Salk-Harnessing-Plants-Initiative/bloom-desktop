/**
 * E2E Test: Database Auto-Initialization
 *
 * Tests the database auto-initialization feature across various database states:
 * - Fresh install (no database file)
 * - Existing database with current schema
 * - Existing database with user data
 * - Corrupted database file
 * - Empty database file
 *
 * PREREQUISITES:
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e -- database-auto-init` (in Terminal 2)
 *
 * Reference: openspec/changes/add-database-auto-init-e2e-tests/
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

// Import electron path using require() since the module exports a string path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

// E2E test database path - unique for auto-init tests to avoid conflicts
const TEST_DB_DIR = path.join(__dirname, 'auto-init-test');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;
const APP_ROOT = path.join(__dirname, '../..');

// Expected tables from Prisma schema
const EXPECTED_TABLES = [
  'Phenotyper',
  'Scientist',
  'Experiment',
  'Accessions',
  'PlantAccessionMappings',
  'Scan',
  'Image',
];

// ============================================
// Utility Functions
// ============================================

/**
 * Create a database with schema and optional test data.
 */
async function createDatabaseWithTestData(
  includeTestData = false
): Promise<void> {
  // Ensure directory exists
  if (!fs.existsSync(TEST_DB_DIR)) {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  }

  // Create database with schema using prisma db push
  execSync('npx prisma db push --skip-generate', {
    cwd: APP_ROOT,
    env: { ...process.env, BLOOM_DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
  });

  if (includeTestData) {
    // Insert a test Scientist record using sqlite3 CLI
    execSync(
      `sqlite3 "${TEST_DB_PATH}" "INSERT INTO Scientist (id, name, email) VALUES ('test-scientist-001', 'Test Scientist', 'test@example.com');"`,
      { stdio: 'pipe' }
    );
  }
}

/**
 * Create a corrupted (non-SQLite) database file.
 */
function createCorruptedDatabase(): void {
  if (!fs.existsSync(TEST_DB_DIR)) {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  fs.writeFileSync(TEST_DB_PATH, 'This is not a valid SQLite database file!');
}

/**
 * Create an empty database file (0 bytes).
 */
function createEmptyDatabase(): void {
  if (!fs.existsSync(TEST_DB_DIR)) {
    fs.mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  fs.writeFileSync(TEST_DB_PATH, '');
}

/**
 * Verify that all expected tables exist in the database.
 */
function verifyDatabaseTables(): { valid: boolean; tables: string[] } {
  try {
    const result = execSync(
      `sqlite3 "${TEST_DB_PATH}" "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma_%';"`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );

    const tables = result
      .trim()
      .split('\n')
      .filter((name) => name.length > 0);

    const missingTables = EXPECTED_TABLES.filter((t) => !tables.includes(t));
    return {
      valid: missingTables.length === 0,
      tables,
    };
  } catch {
    return { valid: false, tables: [] };
  }
}

/**
 * Clean up test database directory and any backup/corrupted files.
 */
function cleanupTestDatabase(): void {
  if (fs.existsSync(TEST_DB_DIR)) {
    // Remove all files in the test directory
    const files = fs.readdirSync(TEST_DB_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(TEST_DB_DIR, file));
    }
    fs.rmdirSync(TEST_DB_DIR);
  }
}

/**
 * Launch the Electron app with the test database.
 */
async function launchApp(): Promise<{
  app: ElectronApplication;
  window: Page;
}> {
  const args = [path.join(APP_ROOT, '.webpack/main/index.js')];
  if (process.platform === 'linux' && process.env.CI === 'true') {
    args.push('--no-sandbox');
  }

  const app = await electron.launch({
    executablePath: electronPath,
    args,
    cwd: APP_ROOT,
    env: { ...process.env, BLOOM_DATABASE_URL: TEST_DB_URL } as Record<
      string,
      string
    >,
  });

  // Get the main window (not DevTools)
  const windows = await app.windows();
  const window =
    windows.find((w) => w.url().includes('localhost')) || windows[0];

  await window.waitForLoadState('domcontentloaded', { timeout: 30000 });

  return { app, window };
}

/**
 * Wait for database file to exist with polling.
 */
async function waitForDatabaseFile(
  maxWaitMs = 15000,
  checkIntervalMs = 100
): Promise<boolean> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if (fs.existsSync(TEST_DB_PATH)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, checkIntervalMs));
  }
  return false;
}

// ============================================
// E2E Tests
// ============================================

test.describe('Database Auto-Initialization', () => {
  let electronApp: ElectronApplication | null = null;

  test.afterEach(async () => {
    // Close the app if it's running
    if (electronApp) {
      await electronApp.close();
      electronApp = null;
    }

    // Clean up test database
    cleanupTestDatabase();
  });

  test.describe('Fresh Install', () => {
    test('should create database automatically when none exists', async () => {
      // GIVEN: No database file exists
      cleanupTestDatabase();
      expect(fs.existsSync(TEST_DB_PATH)).toBe(false);

      // WHEN: The Electron app is launched
      const { app, window } = await launchApp();
      electronApp = app;

      // THEN: The database file should be created
      const dbCreated = await waitForDatabaseFile();
      expect(dbCreated).toBe(true);

      // AND: All 7 expected tables should exist
      const { valid, tables } = verifyDatabaseTables();
      expect(valid).toBe(true);
      expect(tables).toEqual(expect.arrayContaining(EXPECTED_TABLES));

      // AND: The app window should display without errors
      await window.waitForFunction(
        () => document.title.includes('Bloom Desktop'),
        { timeout: 60000 }
      );
      const title = await window.title();
      expect(title).toContain('Bloom Desktop');
    });
  });

  test.describe('Existing Database', () => {
    test('should preserve existing database with current schema', async () => {
      // GIVEN: A database file exists with all required tables
      await createDatabaseWithTestData(false);
      expect(fs.existsSync(TEST_DB_PATH)).toBe(true);

      const originalStats = fs.statSync(TEST_DB_PATH);
      const originalMtime = originalStats.mtime.getTime();

      // WHEN: The Electron app is launched
      const { app, window } = await launchApp();
      electronApp = app;

      // Wait for app to initialize
      await window.waitForLoadState('networkidle', { timeout: 30000 });

      // THEN: The database should still exist with all tables
      const { valid } = verifyDatabaseTables();
      expect(valid).toBe(true);

      // AND: The database file should not have been recreated
      // (modification time should be the same or very close)
      const newStats = fs.statSync(TEST_DB_PATH);
      const newMtime = newStats.mtime.getTime();

      // Allow 2 second tolerance for file system timestamp granularity
      expect(Math.abs(newMtime - originalMtime)).toBeLessThan(2000);
    });

    test('should preserve user data after app restart', async () => {
      // GIVEN: A database exists with a Scientist record
      await createDatabaseWithTestData(true);

      // Verify the test data exists
      const checkData = execSync(
        `sqlite3 "${TEST_DB_PATH}" "SELECT name FROM Scientist WHERE id='test-scientist-001';"`,
        { encoding: 'utf-8' }
      );
      expect(checkData.trim()).toBe('Test Scientist');

      // WHEN: The Electron app is launched
      const { app, window } = await launchApp();
      electronApp = app;

      // Navigate to Scientists page
      await window.waitForLoadState('networkidle', { timeout: 30000 });

      // Click on Scientists navigation link
      await window.click('text=Scientists');
      await window.waitForTimeout(1000);

      // THEN: The test scientist should be visible
      const pageContent = await window.textContent('body');
      expect(pageContent).toContain('Test Scientist');
    });
  });

  test.describe('Corrupted Database', () => {
    test('should handle corrupted database gracefully', async () => {
      // GIVEN: A database file exists but contains invalid content
      createCorruptedDatabase();
      expect(fs.existsSync(TEST_DB_PATH)).toBe(true);

      // WHEN: The Electron app is launched
      const { app, window } = await launchApp();
      electronApp = app;

      // Wait for initialization
      await waitForDatabaseFile();
      await window.waitForLoadState('networkidle', { timeout: 30000 });

      // THEN: The corrupted file should be renamed with .corrupted.{timestamp} suffix
      const files = fs.readdirSync(TEST_DB_DIR);
      const corruptedFile = files.find((f) => f.includes('.corrupted.'));
      expect(corruptedFile).toBeDefined();

      // AND: The corrupted file should contain the original invalid content
      const corruptedContent = fs.readFileSync(
        path.join(TEST_DB_DIR, corruptedFile!),
        'utf-8'
      );
      expect(corruptedContent).toContain('This is not a valid SQLite');

      // AND: A new database should be created with correct schema
      const { valid } = verifyDatabaseTables();
      expect(valid).toBe(true);

      // AND: The app window should display without errors
      const title = await window.title();
      expect(title).toContain('Bloom Desktop');
    });
  });

  test.describe('Empty Database', () => {
    test('should apply schema to empty database file', async () => {
      // GIVEN: An empty database file exists (0 bytes)
      createEmptyDatabase();
      expect(fs.existsSync(TEST_DB_PATH)).toBe(true);
      expect(fs.statSync(TEST_DB_PATH).size).toBe(0);

      // WHEN: The Electron app is launched
      const { app, window } = await launchApp();
      electronApp = app;

      // Wait for initialization
      await window.waitForLoadState('networkidle', { timeout: 30000 });

      // THEN: The schema should be applied
      const { valid, tables } = verifyDatabaseTables();
      expect(valid).toBe(true);
      expect(tables).toEqual(expect.arrayContaining(EXPECTED_TABLES));

      // AND: The file should no longer be empty
      expect(fs.statSync(TEST_DB_PATH).size).toBeGreaterThan(0);

      // AND: The app window should display without errors
      const title = await window.title();
      expect(title).toContain('Bloom Desktop');
    });
  });
});
