/**
 * E2E Test: Accessions Management UI — Sequential Story
 *
 * Tests run as a sequential user story with one app instance.
 * Order: Navigate + Empty State → Validation → Create → List → Expand Details →
 *        Inline Editing → Delete → Navigation
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
import {
  validAccession,
  createAccessionData,
  unsortedAccessions,
  sortedAccessions,
} from '../fixtures/accessions';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

const TEST_DB_PATH = path.join(__dirname, 'accessions-ui-test.db');
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

test.describe.serial('Accessions Management', () => {
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

  test('should navigate to Accessions page via menu link', async () => {
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
  });

  test('should show empty state message when no accessions exist', async () => {
    // Already on Accessions page from previous test
    await expect(
      window.locator('text=/No accessions|no accessions/i')
    ).toBeVisible({ timeout: 5000 });

    // Verify create form is visible
    await expect(window.locator('input[name="name"]')).toBeVisible();
    await expect(
      window.locator('button:has-text("Add Accession")')
    ).toBeVisible();
  });

  // =========================================================================
  // Phase 1b: Validation (empty name, clear errors)
  // =========================================================================

  test('should show validation error for empty name', async () => {
    // Click submit without filling name
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

    // Verify no accession was created
    const accessions = await prisma.accessions.findMany();
    expect(accessions).toHaveLength(0);
  });

  test('should clear validation error when typing', async () => {
    // Error is still visible from previous test
    await expect(
      window.locator('text=/required|cannot be empty/i')
    ).toBeVisible();

    // Start typing in name field
    await window.fill('input[name="name"]', 'Test');

    // Verify error is cleared
    await expect(
      window.locator('text=/required|cannot be empty/i')
    ).not.toBeVisible({ timeout: 2000 });

    // Clear the input for next tests
    await window.fill('input[name="name"]', '');
  });

  // =========================================================================
  // Phase 2: Create accessions
  // =========================================================================

  test('should create accession with valid name', async () => {
    // Fill in name field
    await window.fill('input[name="name"]', validAccession.name);

    // Click submit button
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

  test('should allow duplicate names', async () => {
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
    expect(accessions[0].id).not.toBe(accessions[1].id);
  });

  test('should show creation date for each accession', async () => {
    // Accessions already exist from previous tests — verify creation date is displayed
    await expect(
      window.locator('text=/Created|created|[0-9]{4}-[0-9]{2}-[0-9]{2}/i').first()
    ).toBeVisible();
  });

  // =========================================================================
  // Phase 3: Read/List (sorted alphabetically)
  // =========================================================================

  test('should display accessions sorted alphabetically by name', async () => {
    // Clear existing accessions from previous tests to have a clean sort check
    await prisma.accessions.deleteMany();

    // Seed accessions in non-alphabetical order via Prisma
    for (const acc of unsortedAccessions) {
      await prisma.accessions.create({ data: acc });
    }

    // Reload the page to pick up Prisma-seeded data
    await window.click('text=Home');
    await window.waitForTimeout(500);
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Wait for list to load
    await expect(
      window.locator(`text=${sortedAccessions[0].name}`)
    ).toBeVisible({ timeout: 5000 });

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

  // =========================================================================
  // Phase 4: Expand Details (expand, show mappings)
  // =========================================================================

  test('should expand accession to show details', async () => {
    // Use existing accessions from Phase 3 — click on the first sorted one
    const accessionName = sortedAccessions[0].name;
    await window.click(`text=${accessionName}`);

    // Verify details are visible (edit/delete buttons)
    await expect(window.locator('button:has-text("Edit")')).toBeVisible({
      timeout: 3000,
    });
    await expect(window.locator('button:has-text("Delete")')).toBeVisible({
      timeout: 3000,
    });
  });

  test('should show empty state when accession has no mappings', async () => {
    // The first sorted accession is already expanded from previous test and has no mappings
    await expect(
      window.locator('text=/no.*mapping|0.*mapping/i')
    ).toBeVisible({ timeout: 3000 });
  });

  test('should show mapping count in expanded view', async () => {
    // Seed plant mappings via Prisma for a specific accession
    const accession = await prisma.accessions.findFirst({
      where: { name: sortedAccessions[1].name },
    });
    expect(accession).not.toBeNull();

    await prisma.plantAccessionMappings.createMany({
      data: [
        {
          accession_file_id: accession!.id,
          plant_barcode: 'PLANT-001',
          accession_name: 'GT-001',
        },
        {
          accession_file_id: accession!.id,
          plant_barcode: 'PLANT-002',
          accession_name: 'GT-002',
        },
      ],
    });

    // Reload page to pick up Prisma-seeded mappings
    await window.click('text=Home');
    await window.waitForTimeout(500);
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Expand the accession with mappings
    await window.click(`text=${accession!.name}`);

    // Verify mapping count is shown
    await expect(window.locator('text=/2.*mapping|mapping.*2/i')).toBeVisible({
      timeout: 3000,
    });
  });

  test('should display mappings table with Plant Barcode and Accession columns', async () => {
    // Accession is already expanded with mappings from previous test
    // Verify mappings table is visible with correct headers
    const mappingsTable = window.locator('[data-testid="mappings-table"]');
    await expect(mappingsTable).toBeVisible({ timeout: 5000 });
    await expect(
      mappingsTable.locator('th:has-text("Plant Barcode")')
    ).toBeVisible();
    await expect(
      mappingsTable.locator('th:has-text("Accession")')
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

  test('should sort mappings alphabetically by plant barcode', async () => {
    // Seed mappings in reverse order for a different accession
    const accession = await prisma.accessions.findFirst({
      where: { name: sortedAccessions[2].name },
    });
    expect(accession).not.toBeNull();

    await prisma.plantAccessionMappings.createMany({
      data: [
        {
          accession_file_id: accession!.id,
          plant_barcode: 'ZEBRA-003',
          accession_name: 'GT-Z',
        },
        {
          accession_file_id: accession!.id,
          plant_barcode: 'ALPHA-001',
          accession_name: 'GT-A',
        },
        {
          accession_file_id: accession!.id,
          plant_barcode: 'MIDDLE-002',
          accession_name: 'GT-M',
        },
      ],
    });

    // Reload page to pick up Prisma-seeded mappings
    await window.click('text=Home');
    await window.waitForTimeout(500);
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Expand the accession
    await window.click(`text=${accession!.name}`);

    // Wait for mappings table
    const mappingsTable = window.locator('[data-testid="mappings-table"]');
    await expect(mappingsTable).toBeVisible({ timeout: 5000 });

    // Get all plant barcode cells in order
    const barcodeCells = await mappingsTable
      .locator('td:nth-child(1)')
      .allTextContents();

    // Verify alphabetical order
    expect(barcodeCells[0]).toContain('ALPHA-001');
    expect(barcodeCells[1]).toContain('MIDDLE-002');
    expect(barcodeCells[2]).toContain('ZEBRA-003');
  });

  // =========================================================================
  // Phase 5: Inline Editing
  // =========================================================================

  test('should enter edit mode when clicking genotype ID cell', async () => {
    // Seed a fresh accession + mapping via Prisma for predictable editing
    await prisma.accessions.create({
      data: { name: 'Edit-Test Accession' },
    });

    const editAccession = await prisma.accessions.findFirst({
      where: { name: 'Edit-Test Accession' },
    });

    await prisma.plantAccessionMappings.create({
      data: {
        accession_file_id: editAccession!.id,
        plant_barcode: 'EDIT-PLANT-001',
        accession_name: 'GT-ORIGINAL',
      },
    });

    // Reload page to pick up Prisma-seeded data
    await window.click('text=Home');
    await window.waitForTimeout(500);
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Expand the edit-test accession
    await window.click('text=Edit-Test Accession');

    // Wait for mappings table
    const mappingsTable = window.locator('[data-testid="mappings-table"]');
    await expect(mappingsTable).toBeVisible({ timeout: 5000 });

    // Click on genotype ID cell to edit
    await mappingsTable.locator('td:has-text("GT-ORIGINAL")').click();

    // Verify input appears with current value
    const editInput = mappingsTable.locator('input[type="text"]');
    await expect(editInput).toBeVisible();
    await expect(editInput).toHaveValue('GT-ORIGINAL');

    // Cancel so next test starts clean
    await editInput.press('Escape');
  });

  test('should save inline edit with Enter key', async () => {
    // Edit-Test Accession is already expanded from previous test
    const mappingsTable = window.locator('[data-testid="mappings-table"]');
    await expect(mappingsTable).toBeVisible({ timeout: 5000 });

    // Click on genotype ID cell to edit
    await mappingsTable.locator('td:has-text("GT-ORIGINAL")').click();
    const editInput = mappingsTable.locator('input[type="text"]');
    await expect(editInput).toBeVisible();

    // Edit and press Enter
    await editInput.fill('GT-UPDATED');
    await editInput.press('Enter');

    // Verify UI updated
    await expect(
      mappingsTable.locator('td:has-text("GT-UPDATED")')
    ).toBeVisible();
    await expect(mappingsTable.locator('input[type="text"]')).not.toBeVisible();

    // Verify database updated
    const updated = await prisma.plantAccessionMappings.findFirst({
      where: { plant_barcode: 'EDIT-PLANT-001' },
    });
    expect(updated?.accession_name).toBe('GT-UPDATED');
  });

  test('should cancel inline edit with Escape key', async () => {
    // Still on the Edit-Test Accession expanded view — mappings table visible
    const mappingsTable = window.locator('[data-testid="mappings-table"]');
    await expect(mappingsTable).toBeVisible({ timeout: 5000 });

    // Click on genotype ID cell to edit (it was updated to GT-UPDATED in previous test)
    await mappingsTable.locator('td:has-text("GT-UPDATED")').click();

    // Edit and press Escape
    const editInput = mappingsTable.locator('input[type="text"]');
    await editInput.fill('GT-SHOULD-NOT-SAVE');
    await editInput.press('Escape');

    // Verify original value restored in UI
    await expect(
      mappingsTable.locator('td:has-text("GT-UPDATED")')
    ).toBeVisible();
    await expect(mappingsTable.locator('input[type="text"]')).not.toBeVisible();

    // Verify database NOT updated
    const editAccession = await prisma.accessions.findFirst({
      where: { name: 'Edit-Test Accession' },
    });
    const mapping = await prisma.plantAccessionMappings.findFirst({
      where: { accession_file_id: editAccession!.id },
    });
    expect(mapping?.accession_name).toBe('GT-UPDATED');
  });

  test('should edit accession name with Enter to save', async () => {
    // Seed a fresh accession via Prisma for name editing
    const accession = await prisma.accessions.create({
      data: { name: 'Old Name' },
    });

    // Reload page to pick up Prisma-seeded data
    await window.click('text=Home');
    await window.waitForTimeout(500);
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Expand the accession by clicking its name
    const accessionContainer = window
      .locator('[data-testid="accession-item"]')
      .filter({ hasText: 'Old Name' });
    await accessionContainer.locator('button').first().click();

    // Click edit button within this expanded section
    const editButton = accessionContainer.locator('button:has-text("Edit")');
    await editButton.click();

    // The edit input replaces the name — find it
    const editInput = accessionContainer.locator('input[type="text"]');
    await expect(editInput).toBeVisible({ timeout: 5000 });

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
    // Seed a fresh accession via Prisma
    const accession = await prisma.accessions.create({
      data: { name: 'Original Name' },
    });

    // Reload page to pick up Prisma-seeded data
    await window.click('text=Home');
    await window.waitForTimeout(500);
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Expand and edit
    const accessionContainer = window
      .locator('[data-testid="accession-item"]')
      .filter({ hasText: 'Original Name' });
    await accessionContainer.locator('button').first().click();
    await accessionContainer.locator('button:has-text("Edit")').click();

    const editInput = accessionContainer.locator('input[type="text"]');
    await expect(editInput).toBeVisible({ timeout: 5000 });
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

  // =========================================================================
  // Phase 6: Delete (delete with confirmation, cascade delete mappings)
  // =========================================================================

  test('should delete accession with confirmation', async () => {
    // Seed a fresh accession for deletion
    const accession = await prisma.accessions.create({
      data: createAccessionData({ name: 'Delete-Me Accession' }),
    });

    // Reload page to pick up Prisma-seeded data
    await window.click('text=Home');
    await window.waitForTimeout(500);
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Expand accession
    const accessionContainer = window
      .locator('[data-testid="accession-item"]')
      .filter({ hasText: accession.name });
    await accessionContainer.locator('button').first().click();

    // Set up dialog handler BEFORE clicking delete (native confirm() dialog)
    window.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('Delete accession');
      await dialog.accept();
    });

    // Click delete button
    await accessionContainer.getByRole('button', { name: 'Delete', exact: true }).click();

    // Verify accession is removed from UI
    await expect(accessionContainer).not.toBeVisible({
      timeout: 3000,
    });

    // Verify deleted from database
    const deleted = await prisma.accessions.findUnique({
      where: { id: accession.id },
    });
    expect(deleted).toBeNull();
  });

  test('should cascade delete plant mappings', async () => {
    // Seed accession with mappings for cascade delete test
    const accession = await prisma.accessions.create({
      data: createAccessionData({ name: 'Cascade-Delete Accession' }),
    });

    await prisma.plantAccessionMappings.create({
      data: {
        accession_file_id: accession.id,
        plant_barcode: 'CASCADE-PLANT-001',
        accession_name: 'CASCADE-GT-001',
      },
    });

    // Reload page to pick up Prisma-seeded data
    await window.click('text=Home');
    await window.waitForTimeout(500);
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Expand accession
    const accessionContainer = window
      .locator('[data-testid="accession-item"]')
      .filter({ hasText: accession.name });
    await accessionContainer.locator('button').first().click();

    // Set up dialog handler BEFORE clicking delete
    window.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toContain('Delete accession');
      await dialog.accept();
    });

    // Click delete button
    await accessionContainer.getByRole('button', { name: 'Delete', exact: true }).click();

    // Wait for deletion
    await window.waitForTimeout(1000);

    // Verify mappings were also deleted
    const mappings = await prisma.plantAccessionMappings.findMany({
      where: { accession_file_id: accession.id },
    });
    expect(mappings).toHaveLength(0);
  });

  // =========================================================================
  // Phase 7: Navigation (preserve state across page navigation)
  // =========================================================================

  test('should preserve accessions list across navigation', async () => {
    // Seed an accession to verify persistence
    await prisma.accessions.create({
      data: { name: 'Persistent Accession' },
    });

    // Reload page to pick up Prisma-seeded data
    await window.click('text=Home');
    await window.waitForTimeout(500);
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();
    await expect(
      window.locator('text=Persistent Accession')
    ).toBeVisible();

    // Navigate away
    await window.click('text=Home');
    await window.waitForTimeout(500);

    // Navigate back
    await window.click('text=Accessions');
    await expect(
      window.getByRole('heading', { name: 'Accessions', exact: true })
    ).toBeVisible();

    // Verify accession still appears
    await expect(
      window.locator('text=Persistent Accession')
    ).toBeVisible();
  });
});
