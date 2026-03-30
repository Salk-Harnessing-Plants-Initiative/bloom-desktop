/**
 * E2E Test: GraviScan Workflow
 *
 * Tests the complete GraviScan user workflow in mock mode.
 * All tests run sequentially in a single app instance.
 *
 * **PREREQUISITES:**
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e` (in Terminal 2)
 *
 * Uses GRAVISCAN_MOCK=true for testing without physical hardware.
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

const TEST_DB_PATH = path.join(__dirname, 'graviscan-workflow-test.db');
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
      GRAVISCAN_MOCK: 'true',
      USE_GRAVISCAN_SUBPROCESS: 'true',
    } as Record<string, string>,
  });

  const windows = await electronApp.windows();
  window = windows.find((w) => w.url().includes('localhost')) || windows[0];
  await window.waitForLoadState('domcontentloaded', { timeout: 30000 });
}

/**
 * Navigate to GraviScan tab on a tabbed page.
 */
async function switchToGraviScanTab() {
  const graviTab = window.locator('button:has-text("GraviScan")');
  if (await graviTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await graviTab.click();
    await window.waitForTimeout(500);
  }
}

test.describe.serial('GraviScan Workflow', () => {
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

    // Seed base data
    const scientist = await prisma.scientist.create({
      data: { name: 'GraviScan Test Scientist', email: 'gravi-e2e@test.com' },
    });

    await prisma.phenotyper.create({
      data: {
        name: 'GraviScan Test Phenotyper',
        email: 'gravi-pheno-e2e@test.com',
      },
    });

    await prisma.experiment.create({
      data: {
        name: 'GraviScan E2E Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
        experiment_type: 'graviscan',
      },
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
  // Test 1: Page load and mock mode banner
  // =========================================================================

  test('should load GraviScan page and display mock mode banner', async () => {
    await window.click('text=Capture Scan');
    await switchToGraviScanTab();

    // Verify mock mode banner
    await expect(
      window.locator('text=Mock Mode - Simulated scanners')
    ).toBeVisible({ timeout: 10000 });

    // Verify Detect Scanners button
    await expect(
      window.locator('button:has-text("Detect Scanners")')
    ).toBeVisible({ timeout: 5000 });
  });

  // =========================================================================
  // Test 2: Scanner detection and configuration
  // =========================================================================

  test('should detect mock scanners and show scanner assignment', async () => {
    // Already on GraviScan tab from test 1
    // Click Detect Scanners
    await window.click('button:has-text("Detect Scanners")');

    // Mock returns 2 scanners — scanner name should appear
    await expect(
      window.locator('text=/Mock Scanner|Scanner 1|epkowa/i').first()
    ).toBeVisible({ timeout: 10000 });

    // Verify grid mode select exists with 2-grid option
    const gridSelect = window.locator('select option[value="2grid"]');
    await expect(gridSelect.first()).toBeAttached({ timeout: 5000 });

    // Verify resolution label is visible
    await expect(window.locator('text=/Resolution/i').first()).toBeVisible({
      timeout: 5000,
    });
  });

  // =========================================================================
  // Test 3: Scan form with experiment and phenotyper
  // =========================================================================

  test('should show experiment and phenotyper with seeded data', async () => {
    // Already on GraviScan tab — scroll down to form section

    // Verify seeded experiment exists in select option
    await expect(
      window.locator('option:has-text("GraviScan E2E Experiment")')
    ).toBeAttached({ timeout: 10000 });

    // Verify seeded phenotyper exists in select option
    await expect(
      window.locator('option:has-text("GraviScan Test Phenotyper")')
    ).toBeAttached({ timeout: 5000 });

    // Verify wave number input
    await expect(window.locator('text=/Wave/i').first()).toBeVisible({
      timeout: 5000,
    });

    // Verify Start Scan button
    await expect(window.locator('button:has-text("Start Scan")')).toBeVisible({
      timeout: 5000,
    });
  });

  // =========================================================================
  // Test 4: Browse scans GraviScan view
  // =========================================================================

  test('should show experiment with scans in GraviScan browse view', async () => {
    // Seed a scan so browse has data
    const experiment = await prisma.experiment.findFirst({
      where: { name: 'GraviScan E2E Experiment' },
    });
    const phenotyper = await prisma.phenotyper.findFirst();

    if (experiment && phenotyper) {
      let scanner = await prisma.graviScanner.findFirst();
      if (!scanner) {
        scanner = await prisma.graviScanner.create({
          data: {
            name: 'Mock Scanner 1',
            enabled: true,
            vendor_id: '04b8',
            product_id: '013a',
          },
        });
      }

      await prisma.graviScan.create({
        data: {
          experiment_id: experiment.id,
          phenotyper_id: phenotyper.id,
          scanner_id: scanner.id,
          path: '/test/scan/e2e-browse',
          grid_mode: '2grid',
          plate_index: '00',
          resolution: 1200,
          wave_number: 1,
          plate_barcode: 'Plate_1',
        },
      });
    }

    // Navigate to Browse Scans
    await window.click('text=Browse Scans');
    await switchToGraviScanTab();

    await window.waitForLoadState('networkidle', { timeout: 10000 });

    // Seeded experiment should appear
    await expect(window.locator('text=GraviScan E2E Experiment')).toBeVisible({
      timeout: 10000,
    });

    // Click experiment to view detail
    await window.click('text=GraviScan E2E Experiment');

    // Detail should show scan data
    await expect(
      window.locator('text=/wave|scan|Plate_1|2grid/i').first()
    ).toBeVisible({ timeout: 10000 });
  });

  // =========================================================================
  // Test 5: Metadata upload interface
  // =========================================================================

  test('should display GraviScan metadata upload UI', async () => {
    // Navigate to Metadata
    // Nav label is "Accessions" in full mode, "Metadata" in graviscan mode
    const metadataLink = window.getByRole('link', { name: 'Metadata' });
    const accessionsLink = window.getByRole('link', { name: 'Accessions' });
    if (await metadataLink.isVisible({ timeout: 1000 }).catch(() => false)) {
      await metadataLink.click();
    } else {
      await accessionsLink.click();
    }
    await switchToGraviScanTab();

    // Verify upload section heading
    await expect(
      window.locator('text=/Upload.*Plate.*Metadata/i').first()
    ).toBeVisible({ timeout: 10000 });

    // Verify Select File button
    await expect(window.locator('button:has-text("Select File")')).toBeVisible({
      timeout: 5000,
    });

    // Verify drag and drop instruction
    await expect(
      window.locator('text=/Drag.*drop|XLSX.*XLS/i').first()
    ).toBeVisible({ timeout: 5000 });

    // Verify empty state for metadata list
    await expect(
      window.locator('text=/No.*metadata.*uploaded/i').first()
    ).toBeVisible({ timeout: 5000 });
  });

  // =========================================================================
  // Test 6: Upload Excel file
  // =========================================================================

  test('should upload Excel file and show column mapping', async () => {
    // Re-navigate to ensure we're on the right tab
    // Nav label is "Accessions" in full mode, "Metadata" in graviscan mode
    const metadataLink = window.getByRole('link', { name: 'Metadata' });
    const accessionsLink = window.getByRole('link', { name: 'Accessions' });
    if (await metadataLink.isVisible({ timeout: 1000 }).catch(() => false)) {
      await metadataLink.click();
    } else {
      await accessionsLink.click();
    }
    await switchToGraviScanTab();

    const fixturePath = path.join(
      __dirname,
      '../fixtures/excel/single-sheet.xlsx'
    );
    if (!fs.existsSync(fixturePath)) {
      test.skip();
      return;
    }

    // Click "Select File" button and handle file chooser
    const [fileChooser] = await Promise.all([
      window.waitForEvent('filechooser', { timeout: 5000 }),
      window.click('button:has-text("Select File")'),
    ]);
    await fileChooser.setFiles(fixturePath);

    // Column mapping UI should appear
    await expect(
      window.locator('text=/Plant.*ID|Barcode|Column|Map/i').first()
    ).toBeVisible({ timeout: 10000 });

    // Column dropdowns should be visible
    const selects = window.locator('select');
    const selectCount = await selects.count();
    expect(selectCount).toBeGreaterThanOrEqual(1);
  });
});
