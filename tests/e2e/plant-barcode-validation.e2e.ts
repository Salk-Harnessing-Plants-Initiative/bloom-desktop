/**
 * E2E Test: Plant Barcode Validation
 *
 * Tests plant barcode autocomplete, validation against accession mappings,
 * genotype ID auto-population, and duplicate scan prevention.
 *
 * **PREREQUISITES:**
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e` (in Terminal 2)
 *
 * Related: Issue #74, openspec/changes/add-plant-barcode-validation/
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
import type { ElectronAPI } from '../../src/types/electron';

// Import electron path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

// Type definition for window object with electron API
interface WindowWithElectron extends Window {
  electron: ElectronAPI;
}

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

// Test database path
const TEST_DB_PATH = path.join(__dirname, 'plant-barcode-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

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
}

/**
 * Test setup: Create fresh database and launch app
 */
test.beforeEach(async () => {
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  prisma = new PrismaClient({
    datasources: {
      db: {
        url: TEST_DB_URL,
      },
    },
  });

  await prisma.$connect();

  const appRoot = path.join(__dirname, '../..');
  execSync('npx prisma db push --skip-generate', {
    cwd: appRoot,
    env: {
      ...process.env,
      BLOOM_DATABASE_URL: TEST_DB_URL,
    },
    stdio: 'pipe',
  });

  await launchElectronApp();
});

/**
 * Test teardown: Clean up resources
 */
test.afterEach(async () => {
  if (prisma) {
    await prisma.$disconnect();
  }

  if (electronApp) {
    await electronApp.close();
  }

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

// ============================================================================
// IPC Handler Tests - db:accessions:getPlantBarcodes
// ============================================================================

test.describe('IPC: db:accessions:getPlantBarcodes', () => {
  test('should return plant barcodes for an accession', async () => {
    // Create accession with plant mappings
    const accession = await prisma.accessions.create({
      data: {
        name: 'Test Accession',
        mappings: {
          create: [
            {
              plant_barcode: 'PLANT_001',
              genotype_id: 'GT_A',
              accession_id: 'ACC_001',
            },
            {
              plant_barcode: 'PLANT_002',
              genotype_id: 'GT_B',
              accession_id: 'ACC_002',
            },
            {
              plant_barcode: 'OTHER_001',
              genotype_id: 'GT_C',
              accession_id: 'ACC_003',
            },
          ],
        },
      },
    });

    const result = await window.evaluate((accId) => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.accessions.getPlantBarcodes(accId);
    }, accession.id);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);
    expect(result.data).toContain('PLANT_001');
    expect(result.data).toContain('PLANT_002');
    expect(result.data).toContain('OTHER_001');
  });

  test('should return empty array for accession with no mappings', async () => {
    const accession = await prisma.accessions.create({
      data: { name: 'Empty Accession' },
    });

    const result = await window.evaluate((accId) => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.accessions.getPlantBarcodes(accId);
    }, accession.id);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });

  test('should handle invalid accession ID', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.accessions.getPlantBarcodes('invalid-uuid');
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(0);
  });
});

// ============================================================================
// IPC Handler Tests - db:accessions:getGenotypeByBarcode
// ============================================================================

test.describe('IPC: db:accessions:getGenotypeByBarcode', () => {
  test('should return genotype ID for valid plant barcode and experiment', async () => {
    // Create scientist
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Test', email: 'test@example.com' },
    });

    // Create accession with mappings
    const accession = await prisma.accessions.create({
      data: {
        name: 'Test Accession',
        mappings: {
          create: [
            {
              plant_barcode: 'PLANT_001',
              genotype_id: 'GT_ABC123',
              accession_id: 'ACC_001',
            },
          ],
        },
      },
    });

    // Create experiment linked to accession
    const experiment = await prisma.experiment.create({
      data: {
        name: 'Test Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
        accession_id: accession.id,
      },
    });

    const result = await window.evaluate(
      ({ barcode, expId }) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.accessions.getGenotypeByBarcode(barcode, expId);
      },
      { barcode: 'PLANT_001', expId: experiment.id }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('GT_ABC123');
  });

  test('should return null for invalid plant barcode', async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Test', email: 'test2@example.com' },
    });

    const accession = await prisma.accessions.create({
      data: {
        name: 'Test Accession',
        mappings: {
          create: [
            {
              plant_barcode: 'PLANT_001',
              genotype_id: 'GT_ABC123',
              accession_id: 'ACC_001',
            },
          ],
        },
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Test Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
        accession_id: accession.id,
      },
    });

    const result = await window.evaluate(
      ({ barcode, expId }) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.accessions.getGenotypeByBarcode(barcode, expId);
      },
      { barcode: 'INVALID_BARCODE', expId: experiment.id }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  test('should return null for experiment without accession', async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Test', email: 'test3@example.com' },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Experiment No Accession',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
        // No accession linked
      },
    });

    const result = await window.evaluate(
      ({ barcode, expId }) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.accessions.getGenotypeByBarcode(barcode, expId);
      },
      { barcode: 'PLANT_001', expId: experiment.id }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });
});

// ============================================================================
// IPC Handler Tests - db:scans:getMostRecentScanDate
// ============================================================================

test.describe('IPC: db:scans:getMostRecentScanDate', () => {
  test('should return most recent scan date for plant and experiment', async () => {
    // Create required entities
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Scan', email: 'scan@example.com' },
    });

    const phenotyper = await prisma.phenotyper.create({
      data: { name: 'Test Phenotyper', email: 'pheno@example.com' },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Scan Test Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
      },
    });

    // Create a scan for today
    const today = new Date();
    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Test Scanner',
        plant_id: 'PLANT_001',
        path: '/test/path',
        capture_date: today,
        num_frames: 100,
        exposure_time: 1000,
        gain: 1.0,
        brightness: 50.0,
        contrast: 50.0,
        gamma: 1.0,
        seconds_per_rot: 30.0,
        wave_number: 1,
        plant_age_days: 14,
      },
    });

    const result = await window.evaluate(
      ({ plantId, expId }) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.scans.getMostRecentScanDate(plantId, expId);
      },
      { plantId: 'PLANT_001', expId: experiment.id }
    );

    expect(result.success).toBe(true);
    expect(result.data).not.toBeNull();

    // Verify it's today's date
    const scanDate = new Date(result.data!);
    expect(scanDate.getFullYear()).toBe(today.getFullYear());
    expect(scanDate.getMonth()).toBe(today.getMonth());
    expect(scanDate.getDate()).toBe(today.getDate());
  });

  test('should return null when no scans exist', async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. NoScan', email: 'noscan@example.com' },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'No Scan Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
      },
    });

    const result = await window.evaluate(
      ({ plantId, expId }) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.scans.getMostRecentScanDate(plantId, expId);
      },
      { plantId: 'NONEXISTENT_PLANT', expId: experiment.id }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  test('should ignore deleted scans', async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Deleted', email: 'deleted@example.com' },
    });

    const phenotyper = await prisma.phenotyper.create({
      data: { name: 'Delete Phenotyper', email: 'delpheno@example.com' },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Delete Test Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
      },
    });

    // Create a deleted scan
    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Test Scanner',
        plant_id: 'PLANT_DELETED',
        path: '/test/path',
        capture_date: new Date(),
        num_frames: 100,
        exposure_time: 1000,
        gain: 1.0,
        brightness: 50.0,
        contrast: 50.0,
        gamma: 1.0,
        seconds_per_rot: 30.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: true, // Marked as deleted
      },
    });

    const result = await window.evaluate(
      ({ plantId, expId }) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.scans.getMostRecentScanDate(plantId, expId);
      },
      { plantId: 'PLANT_DELETED', expId: experiment.id }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeNull(); // Deleted scan should be ignored
  });
});

// ============================================================================
// UI Tests - Plant Barcode Validation
// ============================================================================

test.describe('UI: Plant Barcode Validation', () => {
  test('should show validation error for invalid barcode', async () => {
    // Create scientist
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. UI Test', email: 'uitest@example.com' },
    });

    // Create phenotyper (for future tests - not used in this test)
    await prisma.phenotyper.create({
      data: { name: 'UI Phenotyper', email: 'uipheno@example.com' },
    });

    // Create accession with specific plant barcodes
    const accession = await prisma.accessions.create({
      data: {
        name: 'UI Test Accession',
        mappings: {
          create: [
            {
              plant_barcode: 'VALID_PLANT_001',
              genotype_id: 'GT_001',
              accession_id: 'ACC_001',
            },
          ],
        },
      },
    });

    // Create experiment linked to accession
    await prisma.experiment.create({
      data: {
        name: 'UI Test Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
        accession_id: accession.id,
      },
    });

    // Navigate to CaptureScan page
    await window.click('text=Capture Scan');
    await window.waitForLoadState('networkidle');

    // Wait for dropdowns to load
    await window.waitForSelector('.experiment-chooser');
    await window.waitForSelector('.phenotyper-chooser');

    // Select experiment
    await window.selectOption('.experiment-chooser', { index: 1 });

    // Select phenotyper
    await window.selectOption('.phenotyper-chooser', { index: 1 });

    // Wait for plant barcodes to be loaded from experiment's accession
    await window.waitForTimeout(500);

    // Enter an invalid plant barcode
    const plantBarcodeInput = window.locator('#plantQrCode');
    await plantBarcodeInput.fill('INVALID_BARCODE');
    await plantBarcodeInput.blur();

    // Should show validation error
    await expect(
      window.locator('text=Barcode not found in accession file')
    ).toBeVisible({ timeout: 5000 });
  });

  test('should auto-populate genotype ID for valid barcode', async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Genotype', email: 'genotype@example.com' },
    });

    // Create phenotyper (required for dropdown selection)
    await prisma.phenotyper.create({
      data: { name: 'Genotype Phenotyper', email: 'genopheno@example.com' },
    });

    const accession = await prisma.accessions.create({
      data: {
        name: 'Genotype Test Accession',
        mappings: {
          create: [
            {
              plant_barcode: 'PLANT_WITH_GENOTYPE',
              genotype_id: 'AUTO_GENOTYPE_123',
              accession_id: 'ACC_001',
            },
          ],
        },
      },
    });

    await prisma.experiment.create({
      data: {
        name: 'Genotype Test Experiment',
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

    // Enter a valid plant barcode
    const plantBarcodeInput = window.locator('#plantQrCode');
    await plantBarcodeInput.fill('PLANT_WITH_GENOTYPE');
    await plantBarcodeInput.blur();

    // Genotype ID should be auto-populated
    const genotypeInput = window.locator('#genotypeId');
    await expect(genotypeInput).toHaveValue('AUTO_GENOTYPE_123', {
      timeout: 5000,
    });
  });
});

// ============================================================================
// UI Tests - Duplicate Scan Prevention
// ============================================================================

test.describe('UI: Duplicate Scan Prevention', () => {
  test('should show warning when plant already scanned today', async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Duplicate', email: 'duplicate@example.com' },
    });

    const phenotyper = await prisma.phenotyper.create({
      data: { name: 'Dup Phenotyper', email: 'duppheno@example.com' },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Duplicate Test Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
      },
    });

    // Create a scan for today
    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Test Scanner',
        plant_id: 'ALREADY_SCANNED_PLANT',
        path: '/test/path',
        capture_date: new Date(),
        num_frames: 100,
        exposure_time: 1000,
        gain: 1.0,
        brightness: 50.0,
        contrast: 50.0,
        gamma: 1.0,
        seconds_per_rot: 30.0,
        wave_number: 1,
        plant_age_days: 14,
      },
    });

    await window.click('text=Capture Scan');
    await window.waitForLoadState('networkidle');

    await window.waitForSelector('.experiment-chooser');
    await window.selectOption('.experiment-chooser', { index: 1 });
    await window.selectOption('.phenotyper-chooser', { index: 1 });

    // Enter the already scanned plant barcode
    const plantBarcodeInput = window.locator('#plantQrCode');
    await plantBarcodeInput.fill('ALREADY_SCANNED_PLANT');
    await plantBarcodeInput.blur();

    // Should show duplicate warning
    await expect(
      window.locator('text=This plant was already scanned today')
    ).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================================
// UI Tests - Barcode Autocomplete
// ============================================================================

test.describe('UI: Barcode Autocomplete', () => {
  test('should show autocomplete suggestions when typing', async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Autocomplete', email: 'auto@example.com' },
    });

    // Create phenotyper (required for dropdown selection)
    await prisma.phenotyper.create({
      data: { name: 'Auto Phenotyper', email: 'autopheno@example.com' },
    });

    const accession = await prisma.accessions.create({
      data: {
        name: 'Autocomplete Test Accession',
        mappings: {
          create: [
            {
              plant_barcode: 'PLANT_001',
              genotype_id: 'GT_001',
              accession_id: 'ACC_001',
            },
            {
              plant_barcode: 'PLANT_002',
              genotype_id: 'GT_002',
              accession_id: 'ACC_002',
            },
            {
              plant_barcode: 'PLANT_003',
              genotype_id: 'GT_003',
              accession_id: 'ACC_003',
            },
            {
              plant_barcode: 'OTHER_001',
              genotype_id: 'GT_004',
              accession_id: 'ACC_004',
            },
          ],
        },
      },
    });

    await prisma.experiment.create({
      data: {
        name: 'Autocomplete Test Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
        accession_id: accession.id,
      },
    });

    await window.click('text=Capture Scan');
    await window.waitForLoadState('networkidle');

    await window.waitForSelector('.experiment-chooser');
    await window.selectOption('.experiment-chooser', { index: 1 });

    // Wait for plant barcodes to be loaded
    await window.waitForTimeout(500);

    // Type in plant barcode to trigger autocomplete
    const plantBarcodeInput = window.locator('#plantQrCode');
    await plantBarcodeInput.fill('PLANT');

    // Should show autocomplete dropdown with matching suggestions
    const autocompleteDropdown = window.locator(
      '[data-testid="plant-barcode-dropdown"]'
    );
    await expect(autocompleteDropdown).toBeVisible({ timeout: 5000 });

    // Should show PLANT_001, PLANT_002, PLANT_003 but not OTHER_001
    await expect(window.locator('text=PLANT_001')).toBeVisible();
    await expect(window.locator('text=PLANT_002')).toBeVisible();
    await expect(window.locator('text=PLANT_003')).toBeVisible();
    await expect(window.locator('text=OTHER_001')).not.toBeVisible();
  });

  test('should select suggestion and populate genotype ID', async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Select', email: 'select@example.com' },
    });

    // Create phenotyper (required for dropdown selection)
    await prisma.phenotyper.create({
      data: { name: 'Select Phenotyper', email: 'selpheno@example.com' },
    });

    const accession = await prisma.accessions.create({
      data: {
        name: 'Select Test Accession',
        mappings: {
          create: [
            {
              plant_barcode: 'SELECTABLE_PLANT',
              genotype_id: 'SELECTED_GENOTYPE',
              accession_id: 'ACC_001',
            },
          ],
        },
      },
    });

    await prisma.experiment.create({
      data: {
        name: 'Select Test Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
        accession_id: accession.id,
      },
    });

    await window.click('text=Capture Scan');
    await window.waitForLoadState('networkidle');

    await window.waitForSelector('.experiment-chooser');
    await window.selectOption('.experiment-chooser', { index: 1 });

    // Wait for plant barcodes to be loaded
    await window.waitForTimeout(500);

    // Type to trigger autocomplete
    const plantBarcodeInput = window.locator('#plantQrCode');
    await plantBarcodeInput.fill('SELECT');

    // Wait for autocomplete dropdown to appear and click the suggestion
    await window.waitForSelector('[data-testid="plant-barcode-dropdown"]', {
      timeout: 5000,
    });
    await window.click('text=SELECTABLE_PLANT');

    // Barcode should be populated
    await expect(plantBarcodeInput).toHaveValue('SELECTABLE_PLANT');

    // Genotype should be auto-populated
    const genotypeInput = window.locator('#genotypeId');
    await expect(genotypeInput).toHaveValue('SELECTED_GENOTYPE', {
      timeout: 5000,
    });
  });
});

// ============================================================================
// UI Tests - Barcode Sanitization
// ============================================================================

test.describe('UI: Barcode Sanitization', () => {
  test('should replace plus signs with underscores', async () => {
    await window.click('text=Capture Scan');
    await window.waitForLoadState('networkidle');

    const plantBarcodeInput = window.locator('#plantQrCode');
    await plantBarcodeInput.fill('PLANT+001');

    await expect(plantBarcodeInput).toHaveValue('PLANT_001');
  });

  test('should replace spaces with underscores', async () => {
    await window.click('text=Capture Scan');
    await window.waitForLoadState('networkidle');

    const plantBarcodeInput = window.locator('#plantQrCode');
    await plantBarcodeInput.fill('PLANT 001 TEST');

    await expect(plantBarcodeInput).toHaveValue('PLANT_001_TEST');
  });

  test('should preserve dashes', async () => {
    await window.click('text=Capture Scan');
    await window.waitForLoadState('networkidle');

    const plantBarcodeInput = window.locator('#plantQrCode');
    await plantBarcodeInput.fill('PLANT-001-A');

    await expect(plantBarcodeInput).toHaveValue('PLANT-001-A');
  });

  test('should strip other special characters', async () => {
    await window.click('text=Capture Scan');
    await window.waitForLoadState('networkidle');

    const plantBarcodeInput = window.locator('#plantQrCode');
    await plantBarcodeInput.fill('PLANT@001#TEST!');

    await expect(plantBarcodeInput).toHaveValue('PLANT001TEST');
  });
});
