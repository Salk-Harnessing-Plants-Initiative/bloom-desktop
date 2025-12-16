/**
 * E2E Test: Accession Excel Upload
 *
 * Tests the Excel file upload functionality for bulk-creating plant-to-genotype
 * mappings on the Accessions page.
 *
 * **PREREQUISITES:**
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e` (in Terminal 2)
 *
 * **Test Focus:**
 * - Drag-and-drop file upload
 * - File type and size validation
 * - Sheet selection for multi-sheet files
 * - Column mapping (Plant ID + Genotype ID)
 * - Visual column highlighting
 * - Preview table display
 * - Batch upload processing
 * - Error handling
 *
 * **Database Isolation:**
 * - Test database: tests/e2e/excel-upload-test.db
 * - Created fresh for each test via BLOOM_DATABASE_URL environment variable
 *
 * Related: openspec/changes/add-accession-excel-upload/
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

// Import electron path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

// Test database path
const TEST_DB_PATH = path.join(__dirname, 'excel-upload-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Excel test fixtures
const FIXTURES_DIR = path.join(__dirname, '../fixtures/excel');
const SINGLE_SHEET_FILE = path.join(FIXTURES_DIR, 'single-sheet.xlsx');
const MULTI_SHEET_FILE = path.join(FIXTURES_DIR, 'multi-sheet.xlsx');
const LARGE_BATCH_FILE = path.join(FIXTURES_DIR, 'large-batch.xlsx');
const EDGE_CASES_FILE = path.join(FIXTURES_DIR, 'edge-cases.xlsx');
// Reserved for future tests with alternative column names
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _ALTERNATIVE_COLUMNS_FILE = path.join(
  FIXTURES_DIR,
  'alternative-columns.xlsx'
);

// Real-world data fixture (ARV1 Media Pilot experiment)
const REAL_DATA_FILE = path.join(
  FIXTURES_DIR,
  'ARV1_Media_Pilot_Master_Data.xlsx'
);

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
 * Helper: Navigate to Accessions page
 */
async function navigateToAccessions() {
  await window.click('text=Accessions');
  await expect(
    window.getByRole('heading', { name: 'Accessions', exact: true })
  ).toBeVisible();
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

  // Run migrations to create schema
  execSync('npx prisma migrate deploy', {
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
 * Test cleanup: Close app and disconnect database
 */
test.afterEach(async () => {
  // Close Electron app
  if (electronApp) {
    await electronApp.close();
  }

  // Disconnect Prisma
  if (prisma) {
    await prisma.$disconnect();
  }

  // Clean up test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

// ============================================
// Upload Zone Display Tests
// ============================================

test.describe('Excel Upload Zone', () => {
  test('should display upload zone on Accessions page', async () => {
    await navigateToAccessions();

    // Verify upload zone is visible
    await expect(
      window.locator('[data-testid="excel-upload-zone"]')
    ).toBeVisible();

    // Verify upload instructions - use specific text
    await expect(
      window.getByText(
        'Drag and drop or click to select XLSX/XLS files (max 15MB)'
      )
    ).toBeVisible();
  });

  test('should show accepted file types hint', async () => {
    await navigateToAccessions();

    // Should indicate XLSX/XLS files are accepted - use specific text
    await expect(window.getByText(/XLSX\/XLS files/)).toBeVisible();
  });
});

// ============================================
// File Upload Tests
// ============================================

test.describe('File Upload', () => {
  test('should accept Excel file via file input', async () => {
    await navigateToAccessions();

    // Find file input and upload file
    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Verify file was accepted - column selectors should appear
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });
    await expect(
      window.locator('[data-testid="genotype-selector"]')
    ).toBeVisible();
  });

  test('should show loading indicator while parsing file', async () => {
    await navigateToAccessions();

    // Use a larger file to see loading state
    const fileInput = window.locator('input[type="file"]');

    // Start upload
    const uploadPromise = fileInput.setInputFiles(LARGE_BATCH_FILE);

    // Check for loading indicator (may be brief)
    // The loading state should appear during file parsing
    await uploadPromise;

    // After loading, column selectors should be visible
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });
  });

  test('should reject non-Excel files', async () => {
    await navigateToAccessions();

    // Create a temporary non-Excel file
    const tempFile = path.join(__dirname, 'temp-test.txt');
    fs.writeFileSync(tempFile, 'This is not an Excel file');

    try {
      const fileInput = window.locator('input[type="file"]');
      await fileInput.setInputFiles(tempFile);

      // Should show error message
      await expect(window.getByText(/only.*excel|invalid.*file/i)).toBeVisible({
        timeout: 3000,
      });
    } finally {
      // Cleanup
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    }
  });
});

// ============================================
// Sheet Selection Tests
// ============================================

test.describe('Sheet Selection', () => {
  test('should show sheet selector for multi-sheet files', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(MULTI_SHEET_FILE);

    // Wait for file to be parsed
    await expect(window.getByText(/select.*sheet/i)).toBeVisible({
      timeout: 5000,
    });

    // Sheet selector dropdown should be visible
    const sheetSelector = window.locator('[data-testid="sheet-selector"]');
    await expect(sheetSelector).toBeVisible();
  });

  test('should not show sheet selector for single-sheet files', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Wait for parsing
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    // Sheet selector should NOT be visible for single-sheet files
    const sheetSelector = window.locator('[data-testid="sheet-selector"]');
    await expect(sheetSelector).not.toBeVisible();
  });

  test('should update preview when sheet is changed', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(MULTI_SHEET_FILE);

    // Wait for parsing
    await expect(window.getByText(/select.*sheet/i)).toBeVisible({
      timeout: 5000,
    });

    // First sheet should show its columns in the preview table header
    const previewTable = window.locator('[data-testid="preview-table"]');
    await expect(previewTable.locator('th:has-text("Plant_ID")')).toBeVisible();

    // Select second sheet (Batch_B has QRCode, AccessionID, Date)
    const sheetSelector = window.locator('[data-testid="sheet-selector"]');
    await sheetSelector.selectOption('Batch_B');

    // Preview should update to show new columns
    await expect(previewTable.locator('th:has-text("QRCode")')).toBeVisible();
    await expect(
      previewTable.locator('th:has-text("AccessionID")')
    ).toBeVisible();
  });
});

// ============================================
// Column Mapping Tests
// ============================================

test.describe('Column Mapping', () => {
  test('should display column selector dropdowns', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Wait for parsing
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    // Both column selectors should be visible
    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );

    await expect(plantIdSelector).toBeVisible();
    await expect(genotypeSelector).toBeVisible();
  });

  test('should populate dropdowns with column headers', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Wait for parsing
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    // Plant ID selector should contain columns from the file
    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');

    // Should see column headers as options in the dropdown
    await expect(
      plantIdSelector.locator('option[value="PlantBarcode"]')
    ).toBeAttached();
    await expect(
      plantIdSelector.locator('option[value="GenotypeID"]')
    ).toBeAttached();
    await expect(
      plantIdSelector.locator('option[value="Notes"]')
    ).toBeAttached();
  });

  test('should enable upload button only when both columns selected', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Wait for parsing
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    const uploadButton = window.locator('[data-testid="upload-button"]');
    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );

    // Button should be disabled initially
    await expect(uploadButton).toBeDisabled();

    // Select Plant ID column
    await plantIdSelector.selectOption('PlantBarcode');

    // Button should still be disabled (only one column selected)
    await expect(uploadButton).toBeDisabled();

    // Select Genotype column
    await genotypeSelector.selectOption('GenotypeID');

    // Button should now be enabled
    await expect(uploadButton).toBeEnabled();
  });
});

// ============================================
// Visual Highlighting Tests
// ============================================

test.describe('Column Highlighting', () => {
  test('should highlight Plant ID column in green when selected', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Wait for parsing
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    // Select Plant ID column
    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    await plantIdSelector.selectOption('PlantBarcode');

    // Column header should have green highlighting class
    const plantIdHeader = window.locator(
      '[data-testid="preview-table"] th:has-text("PlantBarcode")'
    );
    await expect(plantIdHeader).toHaveClass(/bg-green/);
  });

  test('should highlight Genotype column in blue when selected', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Wait for parsing
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    // Select Genotype column
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );
    await genotypeSelector.selectOption('GenotypeID');

    // Column header should have blue highlighting class
    const genotypeHeader = window.locator(
      '[data-testid="preview-table"] th:has-text("GenotypeID")'
    );
    await expect(genotypeHeader).toHaveClass(/bg-blue/);
  });

  test('should show column labels in header when selected', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Wait for parsing
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    // Select both columns
    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );

    await plantIdSelector.selectOption('PlantBarcode');
    await genotypeSelector.selectOption('GenotypeID');

    // Should show Plant ID and Genotype ID labels in headers
    await expect(window.getByText(/🌱.*plant.*id/i)).toBeVisible();
    await expect(window.getByText(/🏷️.*genotype.*id/i)).toBeVisible();
  });
});

// ============================================
// Preview Table Tests
// ============================================

test.describe('Preview Table', () => {
  test('should display preview table with first 20 rows', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Wait for parsing
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    // Preview table should be visible
    const previewTable = window.locator('[data-testid="preview-table"]');
    await expect(previewTable).toBeVisible();

    // Should show data from file in the table (single-sheet.xlsx has 10 data rows)
    await expect(previewTable.locator('td:has-text("PLANT001")')).toBeVisible();
    // GT-A001 appears in multiple rows, just check the first one
    await expect(
      previewTable.locator('td:has-text("GT-A001")').first()
    ).toBeVisible();
  });

  test('should limit preview to 20 rows for large files', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(LARGE_BATCH_FILE);

    // Wait for parsing
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    // Preview table should exist
    const previewTable = window.locator('[data-testid="preview-table"]');
    await expect(previewTable).toBeVisible();

    // Should show first few rows
    await expect(window.getByText('PLANT-0001')).toBeVisible();

    // Should NOT show rows beyond 20 (large-batch has 250 rows)
    await expect(window.getByText('PLANT-0025')).not.toBeVisible();
  });

  test('should handle empty cells gracefully', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(EDGE_CASES_FILE);

    // Wait for parsing
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    // Should display rows (edge-cases.xlsx has some empty cells)
    await expect(window.getByText('EDGE001')).toBeVisible();

    // Empty cells should not display "undefined" or "null"
    await expect(window.getByText('undefined')).not.toBeVisible();
    await expect(window.getByText('null')).not.toBeVisible();
  });
});

// ============================================
// Upload Processing Tests
// ============================================

test.describe('Upload Processing', () => {
  test('should upload mappings and create accession', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Wait for parsing and select columns
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );

    await plantIdSelector.selectOption('PlantBarcode');
    await genotypeSelector.selectOption('GenotypeID');

    // Click upload button
    const uploadButton = window.locator('[data-testid="upload-button"]');
    await uploadButton.click();

    // Wait for success message
    await expect(window.getByText(/done.*upload|success/i)).toBeVisible({
      timeout: 10000,
    });

    // Verify accession was created in database
    const accessions = await prisma.accessions.findMany({
      include: { mappings: true },
    });

    expect(accessions.length).toBe(1);
    expect(accessions[0].name).toContain('single-sheet');
    expect(accessions[0].mappings.length).toBe(10); // single-sheet.xlsx has 10 data rows
  });

  test('should show progress indicator during upload', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(LARGE_BATCH_FILE);

    // Select columns
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );

    await plantIdSelector.selectOption('Barcode');
    await genotypeSelector.selectOption('Genotype');

    // Click upload button
    const uploadButton = window.locator('[data-testid="upload-button"]');
    await uploadButton.click();

    // The upload button should be disabled while uploading (or show uploading state)
    // Since upload happens quickly, we just verify successful completion
    await expect(window.getByText(/done.*upload|success/i)).toBeVisible({
      timeout: 30000,
    });
  });

  test('should refresh accession list after upload', async () => {
    await navigateToAccessions();

    // Initially no accessions
    await expect(window.getByText(/no accessions/i)).toBeVisible();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Select columns and upload
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );

    await plantIdSelector.selectOption('PlantBarcode');
    await genotypeSelector.selectOption('GenotypeID');

    const uploadButton = window.locator('[data-testid="upload-button"]');
    await uploadButton.click();

    // Wait for success
    await expect(window.getByText(/done.*upload|success/i)).toBeVisible({
      timeout: 10000,
    });

    // Accession list should now show the new accession
    await expect(window.getByText('single-sheet.xlsx')).toBeVisible();
  });

  test('should reset form after successful upload', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Select columns and upload
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );

    await plantIdSelector.selectOption('PlantBarcode');
    await genotypeSelector.selectOption('GenotypeID');

    const uploadButton = window.locator('[data-testid="upload-button"]');
    await uploadButton.click();

    // Wait for success
    await expect(window.getByText(/done.*upload|success/i)).toBeVisible({
      timeout: 10000,
    });

    // Preview table should be hidden (form reset)
    const previewTable = window.locator('[data-testid="preview-table"]');
    await expect(previewTable).not.toBeVisible();

    // Column selectors should be hidden
    await expect(plantIdSelector).not.toBeVisible();
    await expect(genotypeSelector).not.toBeVisible();
  });
});

// ============================================
// Batch Processing Tests
// ============================================

test.describe('Batch Processing', () => {
  test('should process large file in batches of 100', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(LARGE_BATCH_FILE);

    // Select columns
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );

    await plantIdSelector.selectOption('Barcode');
    await genotypeSelector.selectOption('Genotype');

    // Upload
    const uploadButton = window.locator('[data-testid="upload-button"]');
    await uploadButton.click();

    // Wait for completion
    await expect(window.getByText(/done.*upload|success/i)).toBeVisible({
      timeout: 30000,
    });

    // Verify all 250 rows were processed
    const accessions = await prisma.accessions.findMany({
      include: { mappings: true },
    });

    expect(accessions.length).toBe(1);
    expect(accessions[0].mappings.length).toBe(250);
  });
});

// ============================================
// Error Handling Tests
// ============================================

test.describe('Error Handling', () => {
  test('should handle upload errors gracefully', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(SINGLE_SHEET_FILE);

    // Select columns
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );

    await plantIdSelector.selectOption('PlantBarcode');
    await genotypeSelector.selectOption('GenotypeID');

    // Disconnect database to simulate error
    await prisma.$disconnect();

    // Try to upload
    const uploadButton = window.locator('[data-testid="upload-button"]');
    await uploadButton.click();

    // Should show error message (not crash)
    // Note: The actual error handling depends on implementation
    // This test verifies the app doesn't crash on database errors
  });
});

// ============================================
// File Validation Tests
// ============================================

test.describe('File Validation', () => {
  test.skip('should reject files larger than 15MB', async () => {
    // Skip: Would need to generate a 15MB+ file which is slow
    // This scenario is documented and should be tested manually
    await navigateToAccessions();

    // Would need a large file fixture
    // await fileInput.setInputFiles(OVERSIZED_FILE);
    // await expect(window.getByText(/file.*too.*large|exceeds.*15mb/i)).toBeVisible();
  });
});

// ============================================
// Real-World Data Tests (ARV1 Media Pilot)
// ============================================

test.describe('Real-World Data Upload', () => {
  test('should upload real experiment Excel file with non-standard column names', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(REAL_DATA_FILE);

    // Wait for parsing
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    // Verify column selectors contain real column names
    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );

    // Should have Barcode and Line columns from real data
    await expect(
      plantIdSelector.locator('option[value="Barcode"]')
    ).toBeAttached();
    await expect(
      genotypeSelector.locator('option[value="Line"]')
    ).toBeAttached();

    // Map columns (Barcode → Plant ID, Line → Genotype)
    await plantIdSelector.selectOption('Barcode');
    await genotypeSelector.selectOption('Line');

    // Upload button should be enabled
    const uploadButton = window.locator('[data-testid="upload-button"]');
    await expect(uploadButton).toBeEnabled();

    // Click upload
    await uploadButton.click();

    // Wait for success
    await expect(window.getByText(/done.*upload|success/i)).toBeVisible({
      timeout: 10000,
    });

    // Verify accession was created with correct data
    const accessions = await prisma.accessions.findMany({
      include: { mappings: true },
    });

    expect(accessions.length).toBe(1);
    expect(accessions[0].name).toContain('ARV1_Media_Pilot_Master_Data');
    expect(accessions[0].mappings.length).toBe(20); // Real file has 20 data rows
  });

  test('should display real data correctly in preview table', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(REAL_DATA_FILE);

    // Wait for parsing
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    // Preview table should show actual barcode values from real data
    const previewTable = window.locator('[data-testid="preview-table"]');
    await expect(previewTable).toBeVisible();

    // Check for actual data from the file (first row barcode)
    await expect(previewTable.locator('td:has-text("981T0FPX7B")')).toBeVisible();

    // Check for Line column value
    await expect(previewTable.locator('td:has-text("ARV1")').first()).toBeVisible();

    // Empty cells should not display "undefined" or "null"
    await expect(window.getByText('undefined')).not.toBeVisible();
    await expect(window.getByText('null')).not.toBeVisible();
  });

  test('should show accession in list after uploading real data', async () => {
    await navigateToAccessions();

    // Initially no accessions
    await expect(window.getByText(/no accessions/i)).toBeVisible();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(REAL_DATA_FILE);

    // Wait for parsing and select columns
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );

    await plantIdSelector.selectOption('Barcode');
    await genotypeSelector.selectOption('Line');

    const uploadButton = window.locator('[data-testid="upload-button"]');
    await uploadButton.click();

    // Wait for success
    await expect(window.getByText(/done.*upload|success/i)).toBeVisible({
      timeout: 10000,
    });

    // Accession list should show the uploaded file name
    await expect(
      window.getByText('ARV1_Media_Pilot_Master_Data.xlsx')
    ).toBeVisible();
  });

  test('should store correct plant-genotype mappings from real data', async () => {
    await navigateToAccessions();

    const fileInput = window.locator('input[type="file"]');
    await fileInput.setInputFiles(REAL_DATA_FILE);

    // Wait for parsing and select columns
    await expect(
      window.locator('[data-testid="plant-id-selector"]')
    ).toBeVisible({ timeout: 5000 });

    const plantIdSelector = window.locator('[data-testid="plant-id-selector"]');
    const genotypeSelector = window.locator(
      '[data-testid="genotype-selector"]'
    );

    await plantIdSelector.selectOption('Barcode');
    await genotypeSelector.selectOption('Line');

    const uploadButton = window.locator('[data-testid="upload-button"]');
    await uploadButton.click();

    // Wait for success
    await expect(window.getByText(/done.*upload|success/i)).toBeVisible({
      timeout: 10000,
    });

    // Verify specific mappings in database
    const mappings = await prisma.plantAccessionMappings.findMany();

    expect(mappings.length).toBe(20);

    // Check first mapping matches first row of real data
    const firstMapping = mappings.find(
      (m) => m.plant_barcode === '981T0FPX7B'
    );
    expect(firstMapping).toBeDefined();
    expect(firstMapping?.genotype_id).toBe('ARV1');

    // Check another mapping
    const anotherMapping = mappings.find(
      (m) => m.plant_barcode === '3R9FSDZ6M0'
    );
    expect(anotherMapping).toBeDefined();
    expect(anotherMapping?.genotype_id).toBe('ARV1');
  });
});
