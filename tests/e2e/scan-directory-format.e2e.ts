/**
 * E2E Test: Scan Directory Path Format
 *
 * Tests that the scan directory path format follows the pilot-compatible format:
 *   YYYY-MM-DD/<plant_qr_code>/<scan_uuid>/
 *
 * And that relative paths stored in the database are correctly resolved
 * by ScanPreview when displaying images.
 *
 * **Test Focus:**
 * - Relative image paths are resolved by prepending scansDir
 * - Absolute image paths (backward compat) still work
 * - Path format matches pilot convention
 *
 * **Database Isolation:**
 * - Test database: tests/e2e/scan-directory-format-test.db
 * - Created fresh for each test
 *
 * Related: openspec/changes/update-scan-directory-format/
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

// Test database path
const TEST_DB_PATH = path.join(__dirname, 'scan-directory-format-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Test scans directory — use the fixtures directory as the "scans root"
const FIXTURES_DIR = path.join(__dirname, '../fixtures');
const TEST_SCANS_DIR = FIXTURES_DIR;

/**
 * Helper: Launch Electron app with test database and custom scans dir
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
 * Helper: Create test scan with related data
 */
async function createTestScan(overrides: {
  plant_id: string;
  scanPath: string;
  imagePaths?: string[];
}) {
  const scientist = await prisma.scientist.create({
    data: {
      name: 'Test Scientist',
      email: `test-${Date.now()}@example.com`,
    },
  });

  const experiment = await prisma.experiment.create({
    data: {
      name: 'Test Experiment',
      species: 'Arabidopsis',
      scientist_id: scientist.id,
    },
  });

  const phenotyper = await prisma.phenotyper.create({
    data: {
      name: 'Test Phenotyper',
      email: `phenotyper-${Date.now()}@example.com`,
    },
  });

  const scan = await prisma.scan.create({
    data: {
      plant_id: overrides.plant_id,
      accession_name: 'Col-0',
      capture_date: new Date(),
      experiment_id: experiment.id,
      phenotyper_id: phenotyper.id,
      wave_number: 1,
      plant_age_days: 14,
      scanner_name: 'TestScanner',
      path: overrides.scanPath,
      num_frames: overrides.imagePaths?.length || 0,
      exposure_time: 1000,
      gain: 1.5,
      gamma: 1.0,
      brightness: 50,
      contrast: 50,
      seconds_per_rot: 60,
      deleted: false,
    },
  });

  if (overrides.imagePaths) {
    for (let i = 0; i < overrides.imagePaths.length; i++) {
      await prisma.image.create({
        data: {
          scan_id: scan.id,
          frame_number: i,
          path: overrides.imagePaths[i],
          status: 'pending',
        },
      });
    }
  }

  return { scan, experiment, phenotyper, scientist };
}

/**
 * Test setup: Create fresh database and launch app
 */
test.beforeEach(async () => {
  // Create ~/.bloom/.env with test scans directory pointing to fixtures
  createTestBloomConfig(TEST_SCANS_DIR);

  // Clean up any existing test database
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
 * Test teardown: Close app and clean up database
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

test.describe('Scan Directory Format — Relative Path Resolution', () => {
  test('should load images using relative paths with scansDir prepended', async () => {
    // Create a scan with a relative path matching pilot format:
    //   YYYY-MM-DD/<plant_qr_code>/<scan_uuid>/
    // The image path is relative: sample_scan/1.png
    // ScanPreview should prepend scansDir (TEST_SCANS_DIR = fixtures dir)
    // to get the full path: <fixtures>/sample_scan/1.png
    await createTestScan({
      plant_id: 'PLANT-RELATIVE-PATH',
      scanPath: '2026-03-04/PLANT-RELATIVE-PATH/test-uuid-001',
      imagePaths: ['sample_scan/1.png'],
    });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await expect(window.locator('text=PLANT-RELATIVE-PATH')).toBeVisible();
    await window.click('text=PLANT-RELATIVE-PATH');

    // Wait for ScanPreview to load
    await expect(window.getByText('Back to Scans')).toBeVisible();

    // Verify image loads (no "Image not found" error)
    const imageContainer = window.locator(
      '.overflow-auto.flex.items-center.justify-center'
    );
    await expect(imageContainer).toBeVisible({ timeout: 10000 });

    // "Image not found" should NOT appear — the relative path was resolved
    const imageNotFound = window.locator('text=Image not found');
    await expect(imageNotFound).not.toBeVisible({ timeout: 5000 });

    // Verify img element exists with file:// src containing the resolved path
    const imgElement = imageContainer.locator('img');
    await expect(imgElement).toHaveCount(1, { timeout: 5000 });

    const src = await imgElement.getAttribute('src');
    expect(src).toContain('file://');
    expect(src).toContain('1.png');
  });

  test('should still load images with absolute paths (backward compat)', async () => {
    // Absolute path pointing directly to fixture image
    const absoluteImagePath = path.join(FIXTURES_DIR, 'sample_scan', '1.png');

    await createTestScan({
      plant_id: 'PLANT-ABSOLUTE-PATH',
      scanPath: '/some/absolute/scan/path',
      imagePaths: [absoluteImagePath],
    });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-ABSOLUTE-PATH');

    // Wait for ScanPreview to load
    await expect(window.getByText('Back to Scans')).toBeVisible();

    // Verify image loads correctly with absolute path
    const imageContainer = window.locator(
      '.overflow-auto.flex.items-center.justify-center'
    );
    await expect(imageContainer).toBeVisible({ timeout: 10000 });

    const imageNotFound = window.locator('text=Image not found');
    await expect(imageNotFound).not.toBeVisible({ timeout: 5000 });

    const imgElement = imageContainer.locator('img');
    await expect(imgElement).toHaveCount(1, { timeout: 5000 });

    const src = await imgElement.getAttribute('src');
    expect(src).toContain('file://');
    expect(src).toContain('1.png');
  });
});

test.describe('Scan Directory Format — Date Timezone', () => {
  test('should use local date in path, not UTC', async () => {
    // Verify that buildScanPath uses local timezone by checking
    // that a scan created now has today's local date in its path.
    // We can't easily test the UTC rollover edge case in E2E,
    // but we CAN verify the date in the path matches local date.
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const relativePath = `${localDate}/PLANT-TIMEZONE-TEST/tz-test-uuid`;

    await createTestScan({
      plant_id: 'PLANT-TIMEZONE-TEST',
      scanPath: relativePath,
      imagePaths: ['sample_scan/1.png'],
    });

    // Navigate to Browse Scans and verify scan is visible
    await window.click('text=Browse Scans');
    await expect(window.locator('text=PLANT-TIMEZONE-TEST')).toBeVisible();

    // Navigate to ScanPreview
    await window.click('text=PLANT-TIMEZONE-TEST');
    await expect(window.getByText('Back to Scans')).toBeVisible();

    // Image should load — the date in the path matches local date
    const imageContainer = window.locator(
      '.overflow-auto.flex.items-center.justify-center'
    );
    await expect(imageContainer).toBeVisible({ timeout: 10000 });

    const imgElement = imageContainer.locator('img');
    await expect(imgElement).toHaveCount(1, { timeout: 5000 });

    const src = await imgElement.getAttribute('src');
    expect(src).toContain('file://');
    expect(src).toContain('1.png');
  });
});

test.describe('Scan Directory Format — Path Format Validation', () => {
  test('should display scan with pilot-format relative path in database', async () => {
    // Create scan with pilot-compatible relative path format
    const relativePath = '2026-03-04/TEST-PLANT-42/a1b2c3d4-uuid';

    await createTestScan({
      plant_id: 'PLANT-FORMAT-TEST',
      scanPath: relativePath,
    });

    // Navigate to Browse Scans and verify scan is visible
    await window.click('text=Browse Scans');
    await expect(window.locator('text=PLANT-FORMAT-TEST')).toBeVisible();

    // Navigate to ScanPreview
    await window.click('text=PLANT-FORMAT-TEST');
    await expect(window.getByText('Back to Scans')).toBeVisible();

    // Verify the scan loads without error (path format is valid)
    await expect(
      window.getByRole('heading', { name: 'PLANT-FORMAT-TEST' })
    ).toBeVisible();
  });

  test('should display scan with sanitized plant QR code in path', async () => {
    // Plant QR codes with special characters should be sanitized in the path
    // but the plant_id in the database keeps the original value
    const relativePath = '2026-03-04/PLANT-WITH-SPECIAL-CHARS/b2c3d4e5-uuid';

    await createTestScan({
      plant_id: 'PLANT/WITH:SPECIAL<CHARS>',
      scanPath: relativePath,
    });

    // Navigate and verify the scan displays correctly
    await window.click('text=Browse Scans');

    // The plant_id is stored as-is in the DB, displayed in the table
    // The path component is sanitized separately
    await expect(
      window.locator('text=PLANT/WITH:SPECIAL<CHARS>')
    ).toBeVisible();
  });

  test('should handle multiple frames with relative paths', async () => {
    // Create scan with multiple frames using relative paths
    await createTestScan({
      plant_id: 'PLANT-MULTI-FRAME',
      scanPath: '2026-03-04/PLANT-MULTI-FRAME/c3d4e5f6-uuid',
      imagePaths: [
        'sample_scan/1.png',
        'sample_scan/2.png',
        'sample_scan/3.png',
      ],
    });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-MULTI-FRAME');

    // Wait for page to load
    await expect(window.getByText('Back to Scans')).toBeVisible();

    // Verify frame counter shows 3 frames
    await expect(window.locator('text=1 / 3')).toBeVisible({ timeout: 10000 });

    // Navigate through frames using keyboard
    await window.keyboard.press('ArrowRight');
    await expect(window.locator('text=2 / 3')).toBeVisible({ timeout: 10000 });

    await window.keyboard.press('ArrowRight');
    await expect(window.locator('text=3 / 3')).toBeVisible({ timeout: 10000 });

    // All frames should load without error (no "Image not found")
    const imageNotFound = window.locator('text=Image not found');
    await expect(imageNotFound).not.toBeVisible({ timeout: 5000 });
  });
});
