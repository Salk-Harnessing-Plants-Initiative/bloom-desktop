/**
 * E2E Test: Accessions Management UI
 *
 * Tests the complete user workflow for managing accessions through the UI,
 * including navigation, list display, form validation, creation, Excel file upload,
 * column mapping, visual highlighting, inline editing, and deletion.
 *
 * **PREREQUISITES:**
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e` (in Terminal 2)
 *
 * The Electron app loads the renderer from Electron Forge's dev server on port 9000.
 * The dev server MUST be running or the Electron window will be blank.
 *
 * **Test Focus:**
 * - UI interactions (navigation, form filling, file upload, button clicks)
 * - Form validation (client-side Zod validation)
 * - Excel file upload and parsing
 * - Sheet selection for multi-sheet files
 * - Column mapping (Plant ID + Genotype ID)
 * - Visual column highlighting (green/blue)
 * - Database integration (accession creation, list refresh, plant mappings)
 * - Inline editing with keyboard shortcuts (Enter/Escape)
 * - Delete with confirmation
 * - Batch processing for large files
 *
 * **Database Isolation:**
 * - Test database: tests/e2e/accessions-ui-test.db
 * - Created fresh for each test via BLOOM_DATABASE_URL environment variable
 * - Main process uses test database, dev server only serves UI
 *
 * **TESTING BEST PRACTICES (Lessons Learned):**
 *
 * 1. **Navigation Assertions:**
 *    DO: Use semantic role-based selectors
 *       await expect(window.getByRole('heading', { name: 'PageName', exact: true })).toBeVisible();
 *    DON'T: Use CSS selectors with text content
 *       await expect(window.locator('h1:has-text("PageName")')).toBeVisible();
 *    WHY: Role-based selectors are more reliable and align with accessibility best practices
 *
 * 2. **Checking Multiple Elements:**
 *    DO: Check each element individually
 *       await expect(window.locator('button:has-text("Edit")')).toBeVisible();
 *       await expect(window.locator('button:has-text("Delete")')).toBeVisible();
 *    DON'T: Use comma-separated selectors with single assertion
 *       await expect(window.locator('button:has-text("Edit"), button:has-text("Delete")')).toBeVisible();
 *    WHY: Comma selectors match ALL elements, causing strict mode violations
 *
 * 3. **React Controlled Inputs:**
 *    DO: Use getByRole() and verify value with toHaveValue()
 *       const input = window.getByRole('textbox').first();
 *       await expect(input).toHaveValue('expected value');
 *    DON'T: Use attribute selectors like input[value="..."]
 *       const input = window.locator('input[value="Old Name"]');
 *    WHY: React controlled inputs set the value property (JS), not the value attribute (HTML)
 *
 * 4. **Multiple Textboxes on Page:**
 *    DO: Use .first() or .last() to disambiguate when multiple textboxes exist
 *       const editInput = window.getByRole('textbox').first(); // Gets expanded section input
 *    DON'T: Use getByRole('textbox') when multiple exist
 *       const editInput = window.getByRole('textbox'); // Throws strict mode error
 *    WHY: Playwright strict mode requires exactly one element match
 *
 * 5. **Dialog Handling:**
 *    TODO: Document native confirm() dialog handling approach
 *    (Tests currently fail because they expect UI buttons but component uses browser confirm())
 *
 * Related: openspec/changes/add-accessions-management-ui/
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
import {
  validAccession,
  createAccessionData,
  unsortedAccessions,
  sortedAccessions,
} from '../fixtures/accessions';

// Import electron path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

// Test database path for UI tests
const TEST_DB_PATH = path.join(__dirname, 'accessions-ui-test.db');
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
  // Close Electron app and wait for process to fully terminate
  await closeElectronApp(electronApp);

  // Disconnect Prisma
  if (prisma) {
    await prisma.$disconnect();
  }

  // Clean up test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  // Clean up test ~/.bloom/.env (restores original if there was one)
  cleanupTestBloomConfig();
});

// ============================================
// Navigation Tests
// ============================================

test.describe('Navigation to Accessions Page', () => {
  test('should navigate to Accessions page via menu link', async () => {
    // Click Accessions link in navigation
    await window.click('text=Accessions');

    // Verify page heading is visible
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
  });
});

// ============================================
// Empty State Tests
// ============================================

test.describe('Empty State Display', () => {
  test('should show empty state message when no accessions exist', async () => {
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Verify empty state message
    await expect(
      window.locator('text=/No accessions|no accessions/i')
    ).toBeVisible({ timeout: 5000 });

    // Verify create form is visible
    await expect(window.locator('input[name="name"]')).toBeVisible();
    await expect(
      window.locator('button:has-text("Add Accession")')
    ).toBeVisible();
  });
});

// ============================================
// Create Accession Tests
// ============================================

test.describe('Create Accession', () => {
  test('should create accession with valid name', async () => {
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Fill in name field
    await window.fill('input[name="name"]', validAccession.name);

    // Click submit button (check for either "Add" or "Create")
    const addButton = window.locator('button:has-text("Add")');
    const createButton = window.locator('button:has-text("Create")');
    if (await addButton.isVisible()) {
      await addButton.click();
    } else if (await createButton.isVisible()) {
      await createButton.click();
    }

    // Wait for success (list should update)
    await expect(window.locator(`text=${validAccession.name}`)).toBeVisible({
      timeout: 5000,
    });

    // Verify in database
    const accessions = await prisma.accessions.findMany();
    expect(accessions).toHaveLength(1);
    expect(accessions[0].name).toBe(validAccession.name);

    // Verify form was cleared
    const nameInput = window.locator('input[name="name"]');
    await expect(nameInput).toHaveValue('');
  });

  test('should show validation error for empty name', async () => {
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Click submit without filling name (check for either button)
    const addButton = window.locator('button:has-text("Add")');
    const createButton = window.locator('button:has-text("Create")');
    if (await addButton.isVisible()) {
      await addButton.click();
    } else if (await createButton.isVisible()) {
      await createButton.click();
    }

    // Verify error message appears
    await expect(
      window.locator('text=/required|cannot be empty/i')
    ).toBeVisible({ timeout: 3000 });

    // Verify no database call was made
    const accessions = await prisma.accessions.findMany();
    expect(accessions).toHaveLength(0);
  });

  test('should clear validation error when typing', async () => {
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Trigger validation error (check for either button)
    const addButton = window.locator('button:has-text("Add")');
    const createButton = window.locator('button:has-text("Create")');
    if (await addButton.isVisible()) {
      await addButton.click();
    } else if (await createButton.isVisible()) {
      await createButton.click();
    }
    await expect(
      window.locator('text=/required|cannot be empty/i')
    ).toBeVisible();

    // Start typing in name field
    await window.fill('input[name="name"]', 'Test');

    // Verify error is cleared
    await expect(
      window.locator('text=/required|cannot be empty/i')
    ).not.toBeVisible({ timeout: 2000 });
  });

  test('should allow duplicate names', async () => {
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    const duplicateName = 'Duplicate Name Test';

    // Create first accession
    await window.fill('input[name="name"]', duplicateName);
    await window.click('button:has-text("Add Accession")');
    await expect(window.locator(`text=${duplicateName}`)).toBeVisible();

    // Create second accession with same name
    await window.fill('input[name="name"]', duplicateName);
    await window.click('button:has-text("Add Accession")');

    // Wait for list to refresh and show BOTH duplicate entries
    const nameLocator = window.locator(`text=${duplicateName}`);
    await expect(nameLocator).toHaveCount(2, { timeout: 5000 });

    // Verify both exist in database
    const accessions = await prisma.accessions.findMany({
      where: { name: duplicateName },
    });
    expect(accessions).toHaveLength(2);
    expect(accessions[0].id).not.toBe(accessions[1].id); // Different UUIDs
  });

  test.skip('should show loading state during creation', async () => {
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    await window.fill('input[name="name"]', validAccession.name);

    const submitButton = window.locator('button:has-text("Add Accession")');

    // Don't await the click - let it run in background so we can check loading state
    const clickPromise = submitButton.click();

    // Immediately check for loading state (should catch it during operation)
    const isDisabled = await submitButton.isDisabled().catch(() => false);
    const hasLoadingText = await window
      .locator('text=/Creating/i')
      .isVisible()
      .catch(() => false);

    expect(isDisabled || hasLoadingText).toBe(true);

    // Now wait for operation to complete
    await clickPromise;
  });
});

// ============================================
// List Display and Sorting Tests
// ============================================

test.describe('Accessions List Display', () => {
  test('should display accessions sorted alphabetically by name', async () => {
    // Create accessions in non-alphabetical order
    for (const acc of unsortedAccessions) {
      await prisma.accessions.create({ data: acc });
    }

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Wait for list to load
    await expect(
      window.locator(`text=${sortedAccessions[0].name}`)
    ).toBeVisible({
      timeout: 5000,
    });

    // Get all accession names from UI
    const accessionElements = await window
      .locator('[data-testid="accession-item"]')
      .all();
    const displayedNames: string[] = [];

    for (const element of accessionElements) {
      const text = await element.textContent();
      if (text) displayedNames.push(text.trim());
    }

    // Verify they appear in alphabetical order
    const expectedNames = sortedAccessions.map((a) => a.name);
    for (let i = 0; i < expectedNames.length; i++) {
      expect(displayedNames[i]).toContain(expectedNames[i]);
    }
  });

  test('should show creation date for each accession', async () => {
    const accession = createAccessionData();
    await prisma.accessions.create({ data: accession });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    await expect(window.locator(`text=${accession.name}`)).toBeVisible();

    // Verify creation date is displayed (format may vary)
    await expect(
      window.locator('text=/Created|created|[0-9]{4}-[0-9]{2}-[0-9]{2}/i')
    ).toBeVisible();
  });
});

// ============================================
// Expand/Collapse Tests
// ============================================

test.describe('Expand Accession Details', () => {
  test('should expand accession to show details', async () => {
    const accession = await prisma.accessions.create({
      data: createAccessionData(),
    });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Click on accession item to expand
    await window.click(`text=${accession.name}`);

    // Verify details are visible (edit/delete buttons)
    await expect(window.locator('button:has-text("Edit")')).toBeVisible({
      timeout: 3000,
    });
    await expect(window.locator('button:has-text("Delete")')).toBeVisible({
      timeout: 3000,
    });
  });

  test('should show mapping count in expanded view', async () => {
    const accession = await prisma.accessions.create({
      data: createAccessionData(),
    });

    // Create plant mappings
    await prisma.plantAccessionMappings.createMany({
      data: [
        {
          accession_file_id: accession.id,
          plant_barcode: 'PLANT-001',
          accession_name: 'GT-001',
        },
        {
          accession_file_id: accession.id,
          plant_barcode: 'PLANT-002',
          accession_name: 'GT-002',
        },
      ],
    });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await window.click(`text=${accession.name}`);

    // Verify mapping count is shown
    await expect(window.locator('text=/2.*mapping|mapping.*2/i')).toBeVisible({
      timeout: 3000,
    });
  });

  test('should display mappings table with Plant Barcode and Genotype ID columns', async () => {
    const accession = await prisma.accessions.create({
      data: createAccessionData(),
    });

    // Create plant mappings
    await prisma.plantAccessionMappings.createMany({
      data: [
        {
          accession_file_id: accession.id,
          plant_barcode: 'PLANT-001',
          accession_name: 'GT-001',
        },
        {
          accession_file_id: accession.id,
          plant_barcode: 'PLANT-002',
          accession_name: 'GT-002',
        },
      ],
    });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await window.click(`text=${accession.name}`);

    // Verify mappings table is visible with correct headers
    const mappingsTable = window.locator('[data-testid="mappings-table"]');
    await expect(mappingsTable).toBeVisible({ timeout: 5000 });
    await expect(
      mappingsTable.locator('th:has-text("Plant Barcode")')
    ).toBeVisible();
    await expect(
      mappingsTable.locator('th:has-text("Genotype ID")')
    ).toBeVisible();

    // Verify actual data is displayed
    await expect(
      mappingsTable.locator('td:has-text("PLANT-001")')
    ).toBeVisible();
    await expect(mappingsTable.locator('td:has-text("GT-001")')).toBeVisible();
    await expect(
      mappingsTable.locator('td:has-text("PLANT-002")')
    ).toBeVisible();
    await expect(mappingsTable.locator('td:has-text("GT-002")')).toBeVisible();
  });

  test('should show empty state when accession has no mappings', async () => {
    const accession = await prisma.accessions.create({
      data: createAccessionData(),
    });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await window.click(`text=${accession.name}`);

    // Verify empty state message
    await expect(window.locator('text=/no.*mapping|0.*mapping/i')).toBeVisible({
      timeout: 3000,
    });

    // Edit and Delete buttons should still be visible
    await expect(window.locator('button:has-text("Edit")')).toBeVisible();
    await expect(window.locator('button:has-text("Delete")')).toBeVisible();
  });

  test('should sort mappings alphabetically by plant barcode', async () => {
    const accession = await prisma.accessions.create({
      data: createAccessionData(),
    });

    // Create mappings in non-alphabetical order
    await prisma.plantAccessionMappings.createMany({
      data: [
        {
          accession_file_id: accession.id,
          plant_barcode: 'ZEBRA-001',
          accession_name: 'GT-Z',
        },
        {
          accession_file_id: accession.id,
          plant_barcode: 'ALPHA-001',
          accession_name: 'GT-A',
        },
      ],
    });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await window.click(`text=${accession.name}`);

    // Wait for mappings table
    const mappingsTable = window.locator('[data-testid="mappings-table"]');
    await expect(mappingsTable).toBeVisible({ timeout: 5000 });

    // Get all plant barcode cells and verify order
    const rows = mappingsTable.locator('tbody tr');
    const firstRowBarcode = rows.nth(0).locator('td').first();
    const secondRowBarcode = rows.nth(1).locator('td').first();

    await expect(firstRowBarcode).toHaveText('ALPHA-001');
    await expect(secondRowBarcode).toHaveText('ZEBRA-001');
  });
});

// ============================================
// Inline Mapping Edit Tests
// ============================================

test.describe('Inline Mapping Editing', () => {
  test('should enter edit mode when clicking genotype ID cell', async () => {
    const accession = await prisma.accessions.create({
      data: createAccessionData(),
    });

    await prisma.plantAccessionMappings.create({
      data: {
        accession_file_id: accession.id,
        plant_barcode: 'PLANT-001',
        accession_name: 'GT-001',
      },
    });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await window.click(`text=${accession.name}`);

    // Wait for mappings table
    const mappingsTable = window.locator('[data-testid="mappings-table"]');
    await expect(mappingsTable).toBeVisible({ timeout: 5000 });

    // Click on genotype ID cell
    await mappingsTable.locator('td:has-text("GT-001")').click();

    // Verify input appears with current value
    const editInput = mappingsTable.locator('input[type="text"]');
    await expect(editInput).toBeVisible();
    await expect(editInput).toHaveValue('GT-001');
  });

  test('should save inline edit with Enter key', async () => {
    const accession = await prisma.accessions.create({
      data: createAccessionData(),
    });

    const mapping = await prisma.plantAccessionMappings.create({
      data: {
        accession_file_id: accession.id,
        plant_barcode: 'PLANT-001',
        accession_name: 'GT-001',
      },
    });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await window.click(`text=${accession.name}`);

    // Wait for mappings table
    const mappingsTable = window.locator('[data-testid="mappings-table"]');
    await expect(mappingsTable).toBeVisible({ timeout: 5000 });

    // Click on genotype ID cell to edit
    await mappingsTable.locator('td:has-text("GT-001")').click();

    // Edit and press Enter
    const editInput = mappingsTable.locator('input[type="text"]');
    await editInput.fill('GT-UPDATED');
    await editInput.press('Enter');

    // Verify UI updated
    await expect(
      mappingsTable.locator('td:has-text("GT-UPDATED")')
    ).toBeVisible();
    await expect(mappingsTable.locator('input[type="text"]')).not.toBeVisible();

    // Verify database updated
    const updated = await prisma.plantAccessionMappings.findUnique({
      where: { id: mapping.id },
    });
    expect(updated?.accession_name).toBe('GT-UPDATED');
  });

  test('should cancel inline edit with Escape key', async () => {
    const accession = await prisma.accessions.create({
      data: createAccessionData(),
    });

    const mapping = await prisma.plantAccessionMappings.create({
      data: {
        accession_file_id: accession.id,
        plant_barcode: 'PLANT-001',
        accession_name: 'GT-001',
      },
    });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await window.click(`text=${accession.name}`);

    // Wait for mappings table
    const mappingsTable = window.locator('[data-testid="mappings-table"]');
    await expect(mappingsTable).toBeVisible({ timeout: 5000 });

    // Click on genotype ID cell to edit
    await mappingsTable.locator('td:has-text("GT-001")').click();

    // Edit and press Escape
    const editInput = mappingsTable.locator('input[type="text"]');
    await editInput.fill('GT-CHANGED');
    await editInput.press('Escape');

    // Verify original value restored in UI
    await expect(mappingsTable.locator('td:has-text("GT-001")')).toBeVisible();
    await expect(mappingsTable.locator('input[type="text"]')).not.toBeVisible();

    // Verify database NOT updated
    const unchanged = await prisma.plantAccessionMappings.findUnique({
      where: { id: mapping.id },
    });
    expect(unchanged?.accession_name).toBe('GT-001');
  });
});

// ============================================
// Inline Edit Tests
// ============================================

test.describe('Inline Accession Name Editing', () => {
  test('should edit accession name with Enter to save', async () => {
    const accession = await prisma.accessions.create({
      data: { name: 'Old Name' },
    });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await window.click('text=Old Name');

    // Click edit button
    await window.click('button:has-text("Edit")');

    // Get the edit input (React controlled component - use first() to get the expanded section input)
    const editInput = window.getByRole('textbox').first();
    await expect(editInput).toBeVisible();
    await expect(editInput).toHaveValue('Old Name');

    // Change name and press Enter
    await editInput.fill('New Name');
    await editInput.press('Enter');

    // Verify new name appears in UI
    await expect(window.locator('text=New Name')).toBeVisible({
      timeout: 3000,
    });

    // Verify in database
    const updated = await prisma.accessions.findUnique({
      where: { id: accession.id },
    });
    expect(updated?.name).toBe('New Name');
  });

  test('should cancel inline edit with Escape', async () => {
    const accession = await prisma.accessions.create({
      data: { name: 'Original Name' },
    });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await window.click('text=Original Name');
    await window.click('button:has-text("Edit")');

    // Get the edit input (React controlled component - use first() to get the expanded section input)
    const editInput = window.getByRole('textbox').first();
    await expect(editInput).toHaveValue('Original Name');
    await editInput.fill('Changed Name');
    await editInput.press('Escape');

    // Verify original name is restored
    await expect(window.locator('text=Original Name')).toBeVisible();

    // Verify database was not changed
    const unchanged = await prisma.accessions.findUnique({
      where: { id: accession.id },
    });
    expect(unchanged?.name).toBe('Original Name');
  });
});

// ============================================
// Delete Tests
// ============================================

test.describe('Delete Accession', () => {
  test('should delete accession with confirmation', async () => {
    const accession = await prisma.accessions.create({
      data: createAccessionData(),
    });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await window.click(`text=${accession.name}`);

    // Set up dialog handler BEFORE clicking delete (native confirm() dialog)
    window.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('Delete accession');
      await dialog.accept();
    });

    // Click delete button (triggers window.confirm())
    await window.click('button:has-text("Delete")');

    // Verify accession is removed from UI
    await expect(window.locator(`text=${accession.name}`)).not.toBeVisible({
      timeout: 3000,
    });

    // Verify deleted from database
    const deleted = await prisma.accessions.findUnique({
      where: { id: accession.id },
    });
    expect(deleted).toBeNull();
  });

  test('should cascade delete plant mappings', async () => {
    const accession = await prisma.accessions.create({
      data: createAccessionData(),
    });

    await prisma.plantAccessionMappings.create({
      data: {
        accession_file_id: accession.id,
        plant_barcode: 'PLANT-001',
        accession_name: 'GT-001',
      },
    });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await window.click(`text=${accession.name}`);

    // Set up dialog handler BEFORE clicking delete (native confirm() dialog)
    window.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('Delete accession');
      await dialog.accept();
    });

    // Click delete button (triggers window.confirm())
    await window.click('button:has-text("Delete")');

    // Wait for deletion
    await window.waitForTimeout(1000);

    // Verify mappings were also deleted
    const mappings = await prisma.plantAccessionMappings.findMany({
      where: { accession_file_id: accession.id },
    });
    expect(mappings).toHaveLength(0);
  });
});

// ============================================
// State Preservation Tests
// ============================================

test.describe('State Preservation', () => {
  test('should preserve accessions list across navigation', async () => {
    await prisma.accessions.create({ data: validAccession });

    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await expect(window.locator(`text=${validAccession.name}`)).toBeVisible();

    // Navigate away
    await window.click('text=Home');
    await window.waitForTimeout(500);

    // Navigate back
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Verify accession still appears
    await expect(window.locator(`text=${validAccession.name}`)).toBeVisible();
  });
});
