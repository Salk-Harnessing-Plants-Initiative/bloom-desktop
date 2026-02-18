/**
 * E2E Test: ScanPreview Page
 *
 * Tests the complete user workflow for viewing scan details and images.
 * Follows TDD: Tests written first (RED), then implementation (GREEN).
 *
 * **Test Focus:**
 * - Navigation from BrowseScans to ScanPreview
 * - Scan metadata display
 * - Image viewer with frame navigation
 * - Keyboard navigation
 * - Back navigation to BrowseScans
 *
 * **Database Isolation:**
 * - Test database: tests/e2e/scan-preview-test.db
 * - Created fresh for each test
 *
 * Related: openspec/changes/add-browse-scans/
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
const TEST_DB_PATH = path.join(__dirname, 'scan-preview-test.db');
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
 * Helper: Create test scan with related data
 */
async function createTestScan(
  overrides: {
    plant_id?: string;
    accession_name?: string;
    withImages?: number;
  } = {}
) {
  // Create scientist for experiment
  const scientist = await prisma.scientist.create({
    data: {
      name: 'Test Scientist',
      email: `test-${Date.now()}@example.com`,
    },
  });

  // Create experiment
  const experiment = await prisma.experiment.create({
    data: {
      name: 'Test Experiment',
      species: 'Arabidopsis',
      scientist_id: scientist.id,
    },
  });

  // Create phenotyper
  const phenotyper = await prisma.phenotyper.create({
    data: {
      name: 'Test Phenotyper',
      email: `phenotyper-${Date.now()}@example.com`,
    },
  });

  // Create scan
  const scan = await prisma.scan.create({
    data: {
      plant_id: overrides.plant_id || 'TEST-PLANT-001',
      accession_name: overrides.accession_name || 'Col-0',
      capture_date: new Date(),
      experiment_id: experiment.id,
      phenotyper_id: phenotyper.id,
      wave_number: 1,
      plant_age_days: 14,
      scanner_name: 'TestScanner',
      path: '/test/scans/test-scan',
      num_frames: overrides.withImages || 0,
      exposure_time: 1000,
      gain: 1.5,
      gamma: 1.0,
      brightness: 50,
      contrast: 50,
      seconds_per_rot: 60,
      deleted: false,
    },
  });

  // Create images if requested
  const imageCount = overrides.withImages || 0;
  for (let i = 0; i < imageCount; i++) {
    await prisma.image.create({
      data: {
        scan_id: scan.id,
        frame_number: i,
        path: `/test/images/frame_${i}.tiff`,
        status: 'pending',
      },
    });
  }

  return { scan, experiment, phenotyper, scientist };
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

test.describe('ScanPreview Navigation', () => {
  test('should navigate to ScanPreview from BrowseScans Plant ID link', async () => {
    // Create a test scan
    const { scan } = await createTestScan({ plant_id: 'PLANT-NAV-TEST' });

    // Navigate to Browse Scans
    await window.click('text=Browse Scans');
    await expect(
      window.getByRole('heading', { name: 'Browse Scans', exact: true })
    ).toBeVisible();

    // Click on Plant ID link
    await window.click('text=PLANT-NAV-TEST');

    // Should navigate to scan preview page
    await expect(window).toHaveURL(new RegExp(`/scan/${scan.id}`));
  });

  test('should navigate to ScanPreview from View button', async () => {
    // Create a test scan
    const { scan } = await createTestScan({ plant_id: 'PLANT-VIEW-BTN' });

    // Navigate to Browse Scans
    await window.click('text=Browse Scans');

    // Click View button in the row
    const row = window.locator('tr').filter({ hasText: 'PLANT-VIEW-BTN' });
    await row.locator('button[title="View scan"]').click();

    // Should navigate to scan preview page
    await expect(window).toHaveURL(new RegExp(`/scan/${scan.id}`));
  });

  test('should display scan Plant ID in header', async () => {
    // Create a test scan
    await createTestScan({ plant_id: 'PLANT-HEADER-TEST' });

    // Navigate to Browse Scans and click on Plant ID
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-HEADER-TEST');

    // Verify Plant ID is shown in the page
    await expect(window.locator('text=PLANT-HEADER-TEST')).toBeVisible();
  });

  test('should have back link to Browse Scans', async () => {
    // Create a test scan
    await createTestScan({ plant_id: 'PLANT-BACK-TEST' });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-BACK-TEST');

    // Click back link
    await window.click('text=Back to Scans');

    // Should navigate back to Browse Scans
    await expect(
      window.getByRole('heading', { name: 'Browse Scans', exact: true })
    ).toBeVisible();
  });

  test('should show error for non-existent scan ID', async () => {
    // Navigate directly to a non-existent scan
    await window.goto('http://localhost:9000/#/scan/non-existent-id');

    // Should show error message
    await expect(window.locator('text=Scan not found')).toBeVisible();
  });
});

test.describe('ScanPreview Metadata Display', () => {
  test('should display scan metadata', async () => {
    // Create a test scan with specific metadata
    await createTestScan({
      plant_id: 'PLANT-META-001',
      accession_name: 'Col-0',
    });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-META-001');

    // Verify metadata is displayed
    await expect(window.locator('text=PLANT-META-001')).toBeVisible();
    await expect(window.locator('text=Col-0')).toBeVisible();
    await expect(window.locator('text=Test Experiment')).toBeVisible();
    await expect(window.locator('text=Test Phenotyper')).toBeVisible();
  });

  test('should display camera settings', async () => {
    // Create a test scan
    await createTestScan({ plant_id: 'PLANT-CAM-TEST' });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-CAM-TEST');

    // Verify camera settings are displayed
    await expect(window.locator('text=Exposure')).toBeVisible();
    await expect(window.locator('text=1000')).toBeVisible();
    await expect(window.locator('text=Gain')).toBeVisible();
  });
});

test.describe('ScanPreview Image Viewer', () => {
  test('should display first image by default', async () => {
    // Create a test scan with images
    await createTestScan({ plant_id: 'PLANT-IMG-001', withImages: 5 });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-IMG-001');

    // Should show frame counter starting at 1
    await expect(window.locator('text=1 / 5')).toBeVisible();
  });

  test('should navigate to next frame with Next button', async () => {
    // Create a test scan with images
    await createTestScan({ plant_id: 'PLANT-NEXT-001', withImages: 5 });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-NEXT-001');

    // Click Next button
    await window.click('button[title="Next frame"]');

    // Frame counter should update
    await expect(window.locator('text=2 / 5')).toBeVisible();
  });

  test('should navigate to previous frame with Previous button', async () => {
    // Create a test scan with images
    await createTestScan({ plant_id: 'PLANT-PREV-001', withImages: 5 });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-PREV-001');

    // Go to frame 2 first
    await window.click('button[title="Next frame"]');
    await expect(window.locator('text=2 / 5')).toBeVisible();

    // Click Previous button
    await window.click('button[title="Previous frame"]');

    // Should be back to frame 1
    await expect(window.locator('text=1 / 5')).toBeVisible();
  });

  test('should show "No images" message when scan has no images', async () => {
    // Create a test scan without images
    await createTestScan({ plant_id: 'PLANT-NO-IMG', withImages: 0 });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-NO-IMG');

    // Should show no images message
    await expect(window.locator('text=No images')).toBeVisible();
  });
});

test.describe('ScanPreview Keyboard Navigation', () => {
  test('should go to next frame with Right Arrow key', async () => {
    // Create a test scan with images
    await createTestScan({ plant_id: 'PLANT-KEY-RIGHT', withImages: 5 });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-KEY-RIGHT');
    await expect(window.locator('text=1 / 5')).toBeVisible();

    // Press Right Arrow
    await window.keyboard.press('ArrowRight');

    // Should be on frame 2
    await expect(window.locator('text=2 / 5')).toBeVisible();
  });

  test('should go to previous frame with Left Arrow key', async () => {
    // Create a test scan with images
    await createTestScan({ plant_id: 'PLANT-KEY-LEFT', withImages: 5 });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-KEY-LEFT');

    // Go to frame 2 first
    await window.keyboard.press('ArrowRight');
    await expect(window.locator('text=2 / 5')).toBeVisible();

    // Press Left Arrow
    await window.keyboard.press('ArrowLeft');

    // Should be back to frame 1
    await expect(window.locator('text=1 / 5')).toBeVisible();
  });

  test('should go to first frame with Home key', async () => {
    // Create a test scan with images
    await createTestScan({ plant_id: 'PLANT-KEY-HOME', withImages: 5 });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-KEY-HOME');

    // Go to frame 3
    await window.keyboard.press('ArrowRight');
    await window.keyboard.press('ArrowRight');
    await expect(window.locator('text=3 / 5')).toBeVisible();

    // Press Home
    await window.keyboard.press('Home');

    // Should be on frame 1
    await expect(window.locator('text=1 / 5')).toBeVisible();
  });

  test('should go to last frame with End key', async () => {
    // Create a test scan with images
    await createTestScan({ plant_id: 'PLANT-KEY-END', withImages: 5 });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-KEY-END');
    await expect(window.locator('text=1 / 5')).toBeVisible();

    // Press End
    await window.keyboard.press('End');

    // Should be on last frame
    await expect(window.locator('text=5 / 5')).toBeVisible();
  });
});

test.describe('ScanPreview Zoom Controls', () => {
  test('should have zoom in button', async () => {
    // Create a test scan with images
    await createTestScan({ plant_id: 'PLANT-ZOOM-IN', withImages: 1 });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-ZOOM-IN');

    // Zoom in button should be visible
    await expect(window.locator('button[title="Zoom in"]')).toBeVisible();
  });

  test('should have zoom out button', async () => {
    // Create a test scan with images
    await createTestScan({ plant_id: 'PLANT-ZOOM-OUT', withImages: 1 });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-ZOOM-OUT');

    // Zoom out button should be visible
    await expect(window.locator('button[title="Zoom out"]')).toBeVisible();
  });

  test('should have reset zoom button', async () => {
    // Create a test scan with images
    await createTestScan({ plant_id: 'PLANT-ZOOM-RESET', withImages: 1 });

    // Navigate to ScanPreview
    await window.click('text=Browse Scans');
    await window.click('text=PLANT-ZOOM-RESET');

    // Reset/Fit button should be visible
    await expect(window.locator('button[title="Reset zoom"]')).toBeVisible();
  });
});
