/**
 * E2E Test: Capture Scan Numeric Input Fields
 *
 * Tests Wave Number and Plant Age field behavior:
 * - Clearing the wave number and typing a new value
 * - Validation for required fields
 * - Validation for integer-only values (no decimals)
 * - Wave number 0 is valid
 * - The plant age is read-only, computed from the wave's germination date (#407, #428)
 *
 * **PREREQUISITES:**
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e` (in Terminal 2)
 *
 * Related: openspec/changes/fix-numeric-inputs/
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
import { closeElectronApp } from './helpers/electron-cleanup';
import { waitForAppReady } from './helpers/app-ready';
import {
  createTestBloomConfig,
  cleanupTestBloomConfig,
} from './helpers/bloom-config';
import { resetTestDatabase } from './helpers/test-database';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

const TEST_DB_PATH = path.join(__dirname, 'numeric-inputs-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

/** A local "YYYY-MM-DD" date `days` ago, by calendar arithmetic (DST-safe). */
function localDaysAgo(days: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

/**
 * Helper: Launch Electron app with test database
 */
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
  await waitForAppReady(window);
}

/**
 * Test setup: Create fresh database and launch app
 */
test.beforeEach(async () => {
  createTestBloomConfig();

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  resetTestDatabase(TEST_DB_PATH);

  prisma = new PrismaClient({
    datasources: {
      db: {
        url: TEST_DB_URL,
      },
    },
  });

  await prisma.$connect();

  await launchElectronApp();
});

/**
 * Test teardown: Clean up resources
 */
test.afterEach(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }

  await closeElectronApp(electronApp);

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  cleanupTestBloomConfig();
});

// ============================================================================
// UI Tests - Numeric Field Input Behavior
// ============================================================================

test.describe('UI: Numeric Field Input Behavior', () => {
  test.beforeEach(async () => {
    // Create test data for form to be usable
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. NumericTest', email: 'numeric@example.com' },
    });

    await prisma.phenotyper.create({
      data: { name: 'Numeric Phenotyper', email: 'numpheno@example.com' },
    });

    const accession = await prisma.accessions.create({
      data: {
        name: 'Numeric Test Accession',
        mappings: {
          create: [
            { plant_barcode: 'NUMERIC_PLANT_001', accession_name: 'GT_NUM' },
          ],
        },
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Numeric Test Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
        accession_id: accession.id,
      },
    });
    // Wave 1 germinated 14 days ago, so its plants are 14 days old (#407, #428).
    // Created before Capture Scan opens, which loads the experiment's waves.
    await prisma.cylinderWave.create({
      data: {
        experiment_id: experiment.id,
        wave_number: 1,
        germination_date: localDaysAgo(14),
        sowing_date: localDaysAgo(20),
      },
    });

    // Navigate to CaptureScan page
    await window.click('text=Capture Scan');
    await window.waitForLoadState('networkidle');

    // Select experiment and phenotyper
    await window.waitForSelector('.experiment-chooser');
    await window.selectOption('.experiment-chooser', { index: 1 });
    await window.selectOption('.phenotyper-chooser', { index: 1 });
  });

  test('should allow clearing Wave Number field and typing new value', async () => {
    const waveNumberInput = window.locator('#waveNumber');

    // Type initial value
    await waveNumberInput.fill('5');
    await expect(waveNumberInput).toHaveValue('5');

    // Clear and type new value
    await waveNumberInput.fill('');
    await expect(waveNumberInput).toHaveValue('');

    // Type new value
    await waveNumberInput.fill('10');
    await expect(waveNumberInput).toHaveValue('10');
  });

  test('should show validation error when Wave Number is empty', async () => {
    const waveNumberInput = window.locator('#waveNumber');

    // Clear the field
    await waveNumberInput.fill('');
    await waveNumberInput.blur();

    // Should show required error
    await expect(window.locator('text=Wave number is required')).toBeVisible({
      timeout: 5000,
    });
  });

  test("should show the plant age, read-only, computed from the wave's germination date", async () => {
    await window.locator('#waveNumber').fill('1');

    const plantAgeInput = window.locator('#plantAgeDays');
    await expect(plantAgeInput).toHaveAttribute('readonly');
    await expect(plantAgeInput).toHaveValue('14');
  });

  test('should leave the plant age blank, without an error, until the wave has dates', async () => {
    // Wave 2 is new: its dates are asked for first, and there's no age to show yet.
    await window.locator('#waveNumber').fill('2');

    const plantAgeInput = window.locator('#plantAgeDays');
    await expect(plantAgeInput).toHaveAttribute('readonly');
    await expect(window.locator("text=How are wave 2's dates")).toBeVisible({
      timeout: 5000,
    });
    await expect(plantAgeInput).toHaveValue('');
    await expect(
      window.locator('text=Plant age is required')
    ).not.toBeVisible();
  });
});

// ============================================================================
// UI Tests - Wave Number Zero Validation
// ============================================================================

test.describe('UI: Wave Number Zero Validation', () => {
  test.beforeEach(async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. ZeroTest', email: 'zero@example.com' },
    });

    await prisma.phenotyper.create({
      data: { name: 'Zero Phenotyper', email: 'zeropheno@example.com' },
    });

    const accession = await prisma.accessions.create({
      data: {
        name: 'Zero Test Accession',
        mappings: {
          create: [
            { plant_barcode: 'ZERO_PLANT_001', accession_name: 'GT_ZERO' },
          ],
        },
      },
    });

    await prisma.experiment.create({
      data: {
        name: 'Zero Test Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
        accession_id: accession.id,
      },
    });

    await window.click('text=Capture Scan');
    await window.waitForLoadState('networkidle');

    await window.waitForSelector('.experiment-chooser');
    await window.selectOption('.experiment-chooser', { index: 1 });
    await window.selectOption('.phenotyper-chooser', { index: 1 });
  });

  test('should accept Wave Number of 0 without validation error', async () => {
    const waveNumberInput = window.locator('#waveNumber');

    // Enter 0
    await waveNumberInput.fill('0');
    await waveNumberInput.blur();

    // Should NOT show validation error for wave number
    await expect(
      window.locator('text=Wave number must be greater than 0')
    ).not.toBeVisible({ timeout: 2000 });

    await expect(
      window.locator('text=Wave number must be 0 or greater')
    ).not.toBeVisible({ timeout: 2000 });
  });

  test('should show validation error for negative Wave Number', async () => {
    const waveNumberInput = window.locator('#waveNumber');

    // Enter negative value
    await waveNumberInput.fill('-1');
    await waveNumberInput.blur();

    // Should show error
    await expect(
      window.locator('text=Wave number must be 0 or greater')
    ).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================================
// UI Tests - Integer Validation (No Decimals)
// ============================================================================

test.describe('UI: Integer Validation', () => {
  test.beforeEach(async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. IntegerTest', email: 'integer@example.com' },
    });

    await prisma.phenotyper.create({
      data: { name: 'Integer Phenotyper', email: 'intpheno@example.com' },
    });

    const accession = await prisma.accessions.create({
      data: {
        name: 'Integer Test Accession',
        mappings: {
          create: [
            { plant_barcode: 'INT_PLANT_001', accession_name: 'GT_INT' },
          ],
        },
      },
    });

    await prisma.experiment.create({
      data: {
        name: 'Integer Test Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
        accession_id: accession.id,
      },
    });

    await window.click('text=Capture Scan');
    await window.waitForLoadState('networkidle');

    await window.waitForSelector('.experiment-chooser');
    await window.selectOption('.experiment-chooser', { index: 1 });
    await window.selectOption('.phenotyper-chooser', { index: 1 });
  });

  test('should show validation error for decimal Wave Number', async () => {
    const waveNumberInput = window.locator('#waveNumber');

    // Enter decimal value
    await waveNumberInput.fill('1.5');
    await waveNumberInput.blur();

    // Should show error
    await expect(
      window.locator('text=Wave number must be a whole number')
    ).toBeVisible({ timeout: 5000 });
  });

  test('should accept an integer Wave Number without error', async () => {
    const waveNumberInput = window.locator('#waveNumber');

    // Enter a valid integer
    await waveNumberInput.fill('5');

    // Blur to trigger validation
    await waveNumberInput.blur();

    // Should NOT show any decimal-related errors
    await expect(window.locator('text=must be a whole number')).not.toBeVisible(
      { timeout: 2000 }
    );
  });

  test('should clear decimal error when valid integer is entered', async () => {
    const waveNumberInput = window.locator('#waveNumber');

    // Enter decimal (should show error)
    await waveNumberInput.fill('1.5');
    await waveNumberInput.blur();
    await expect(
      window.locator('text=Wave number must be a whole number')
    ).toBeVisible({ timeout: 5000 });

    // Enter valid integer (should clear error)
    await waveNumberInput.fill('2');
    await waveNumberInput.blur();
    await expect(
      window.locator('text=Wave number must be a whole number')
    ).not.toBeVisible({ timeout: 3000 });
  });
});
