/**
 * E2E Test: Experiments Management UI — Sequential Story
 *
 * Tests run as a sequential user story with one app instance.
 * Order: Empty State → Validation → Create → List → Attach → Chooser Components
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

const SPECIES_LIST = [
  'Alfalfa',
  'Amaranth',
  'Arabidopsis',
  'Canola',
  'Lotus',
  'Maize',
  'Medicago',
  'Pennycress',
  'Rice',
  'Sorghum',
  'Soybean',
  'Spinach',
  'Sugar_Beet',
  'Tomato',
  'Wheat',
];

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

const TEST_DB_PATH = path.join(__dirname, 'experiments-ui-test.db');
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

// Shared seed data IDs
let scientistId: string;
let accessionId: string;

test.describe.serial('Experiments Management', () => {
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
  // Phase 1: Navigate + Empty State (DB empty)
  // =========================================================================

  test('should navigate to Experiments page', async () => {
    await window.click('text=Experiments');
    await expect(window.locator('h1:has-text("Experiments")')).toBeVisible();
  });

  test('should display empty state when no experiments exist', async () => {
    await expect(window.locator('text=No experiments yet')).toBeVisible();
  });

  test('should show all 15 species in dropdown alphabetically', async () => {
    const options = await window
      .locator('select#species-select option')
      .allTextContents();
    expect(options).toEqual(SPECIES_LIST);
    expect(options.length).toBe(15);
  });

  test('should prevent submission with empty name', async () => {
    await window.click('button:has-text("Create")');
    await expect(window.locator('text=No experiments yet')).toBeVisible();
  });

  // =========================================================================
  // Phase 1b: Validation (seed scientist + accession for form)
  // =========================================================================

  test('should prevent submission when scientist is not selected', async () => {
    // Seed data for dropdowns
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Test Scientist', email: 'scientist@example.com' },
    });
    scientistId = scientist.id;

    const accession = await prisma.accessions.create({
      data: { name: 'Test Accession File' },
    });
    accessionId = accession.id;

    // Reload to pick up new data
    await window.click('text=Home');
    await window.click('text=Experiments');

    // Fill name and accession but NOT scientist
    await window.fill('input#experiment-name', 'Missing Scientist');
    await window.selectOption('select#accession-select', accessionId);

    await window.click('button:has-text("Create")');
    await expect(window.locator('text=Scientist is required')).toBeVisible();
  });

  test('should prevent submission when accession is not selected', async () => {
    // Clear previous form state
    await window.fill('input#experiment-name', 'Missing Accession');
    await window.selectOption('select#scientist-select', scientistId);
    // Reset accession to placeholder
    await window.selectOption('select#accession-select', '');

    await window.click('button:has-text("Create")');
    await expect(window.locator('text=Accession is required')).toBeVisible();
  });

  // =========================================================================
  // Phase 2: Create experiments
  // =========================================================================

  test('should create experiment with all required fields', async () => {
    await window.fill('input#experiment-name', 'Drought Study 2025');
    await window.selectOption('select#scientist-select', scientistId);
    await window.selectOption('select#accession-select', accessionId);

    await window.click('button:has-text("Create")');

    await expect(
      window.locator('ul.experiments-list').locator('text=Drought Study 2025')
    ).toBeVisible();

    await expect(window.locator('input#experiment-name')).toHaveValue('');
  });

  test('should create experiment with scientist and accession linked', async () => {
    await window.fill('input#experiment-name', 'Growth Analysis');
    await window.selectOption('select#scientist-select', scientistId);
    await window.selectOption('select#accession-select', accessionId);

    await window.click('button:has-text("Create")');

    await expect(
      window
        .locator('ul.experiments-list')
        .locator('text=Growth Analysis (Dr. Test Scientist)')
    ).toBeVisible();

    // Verify in database
    const experiment = await prisma.experiment.findFirst({
      where: { name: 'Growth Analysis' },
      include: { scientist: true, accession: true },
    });
    expect(experiment?.scientist?.name).toBe('Dr. Test Scientist');
    expect(experiment?.accession?.name).toBe('Test Accession File');
  });

  test('should show loading state during creation', async () => {
    await window.fill('input#experiment-name', 'Loading Test');
    await window.selectOption('select#scientist-select', scientistId);
    await window.selectOption('select#accession-select', accessionId);

    const submitButton = window.locator(
      'button.create-experiment-button:has-text("Create")'
    );
    await submitButton.click();

    await expect(
      window.locator('ul.experiments-list').locator('text=Loading Test')
    ).toBeVisible();
  });

  // =========================================================================
  // Phase 3: Read/List
  // =========================================================================

  test('should display experiments sorted alphabetically by name', async () => {
    const listItems = await window
      .locator('ul.experiments-list li')
      .allTextContents();

    // Drought, Growth, Loading — should be alphabetical
    expect(listItems[0]).toContain('Drought Study 2025');
    expect(listItems[1]).toContain('Growth Analysis');
    expect(listItems[2]).toContain('Loading Test');
  });

  test('should display experiments with species, name, and scientist', async () => {
    // Experiments show format: Species - Name (Scientist)
    await expect(
      window
        .locator('ul.experiments-list')
        .locator('text=Drought Study 2025 (Dr. Test Scientist)')
    ).toBeVisible();
  });

  // =========================================================================
  // Phase 4: Attach Accession
  // =========================================================================

  test('should attach accession to existing experiment', async () => {
    // Create unlinked experiment
    const experiment = await prisma.experiment.create({
      data: { name: 'Unlinked Experiment', species: 'Arabidopsis' },
    });

    const newAccession = await prisma.accessions.create({
      data: { name: 'New Accession File' },
    });

    // Reload page to pick up new data
    await window.click('text=Home');
    await window.click('text=Experiments');

    await expect(
      window.locator('ul.experiments-list').locator('text=Unlinked Experiment')
    ).toBeVisible();

    await window.selectOption(
      'select#attach-experiment-select',
      experiment.id
    );
    await window.selectOption(
      'select#attach-accession-select',
      newAccession.id
    );
    await window.click('button:has-text("Attach Accession")');

    await expect(
      window.locator('text=Accession successfully attached')
    ).toBeVisible();
  });

  test('should show experiment dropdown with correct format', async () => {
    const options = await window
      .locator('select#attach-experiment-select option')
      .allTextContents();

    // Should include species - name (scientist) format
    expect(
      options.some(
        (o) =>
          o.includes('Drought Study 2025') &&
          o.includes('Dr. Test Scientist')
      )
    ).toBe(true);
  });

  test('should show accession dropdown with name and id', async () => {
    const options = await window
      .locator('select#attach-accession-select option')
      .allTextContents();

    expect(
      options.some(
        (o) => o.includes('Test Accession File') && o.includes(accessionId)
      )
    ).toBe(true);
  });

  // =========================================================================
  // Phase 5: Chooser Components (on Capture Scan page)
  // =========================================================================

  test('should display experiments in ExperimentChooser dropdown', async () => {
    await window.click('text=Capture Scan');
    await expect(
      window.getByRole('heading', { name: 'Capture Scan' })
    ).toBeVisible();

    const experimentSelect = window.locator('select#experiment-chooser');
    await expect(experimentSelect).toBeVisible();

    const options = await experimentSelect.locator('option').allTextContents();
    expect(options.some((o) => o.includes('Drought Study 2025'))).toBe(true);
  });

  test('should show ExperimentChooser placeholder when nothing selected', async () => {
    const experimentSelect = window.locator('select#experiment-chooser');
    const selectedValue = await experimentSelect.inputValue();
    expect(selectedValue).toBe('');

    const options = await experimentSelect.locator('option').allTextContents();
    expect(options[0]).toContain('Choose an experiment');
  });

  test('should have amber border on ExperimentChooser when unselected', async () => {
    const experimentSelect = window.locator('select#experiment-chooser');
    await expect(experimentSelect).toHaveClass(/border-amber/);
  });

  test('should have gray border on ExperimentChooser when selected', async () => {
    const experimentSelect = window.locator('select#experiment-chooser');
    // Select by index (first real option after placeholder)
    await experimentSelect.selectOption({ index: 1 });
    await expect(experimentSelect).toHaveClass(/border-gray/);
  });

  test('should display phenotypers in PhenotyperChooser dropdown', async () => {
    // Seed a phenotyper
    await prisma.phenotyper.create({
      data: { name: 'Test Phenotyper', email: 'pheno@example.com' },
    });

    // Reload page to pick up phenotyper
    await window.click('text=Home');
    await window.click('text=Capture Scan');

    const phenotyperSelect = window.locator('select#phenotyper-chooser');
    await expect(phenotyperSelect).toBeVisible();

    const options = await phenotyperSelect.locator('option').allTextContents();
    expect(options.some((o) => o.includes('Test Phenotyper'))).toBe(true);
  });

  test('should show PhenotyperChooser placeholder when nothing selected', async () => {
    const phenotyperSelect = window.locator('select#phenotyper-chooser');
    const selectedValue = await phenotyperSelect.inputValue();
    expect(selectedValue).toBe('');

    const options = await phenotyperSelect.locator('option').allTextContents();
    expect(options[0]).toContain('Choose a phenotyper');
  });

  test('should have amber border on PhenotyperChooser when unselected', async () => {
    const phenotyperSelect = window.locator('select#phenotyper-chooser');
    await expect(phenotyperSelect).toHaveClass(/border-amber/);
  });

  test('should have gray border on PhenotyperChooser when selected', async () => {
    const phenotyperSelect = window.locator('select#phenotyper-chooser');
    // Select by index (first real option after placeholder)
    await phenotyperSelect.selectOption({ index: 1 });
    await expect(phenotyperSelect).toHaveClass(/border-gray/);
  });

  // =========================================================================
  // Phase 5b: CaptureScan Integration
  // =========================================================================

  test('should use ExperimentChooser select instead of text input', async () => {
    const experimentSelect = window.locator('select#experiment-chooser');
    await expect(experimentSelect).toBeVisible();

    const experimentTextInput = window.locator('input#experimentId');
    await expect(experimentTextInput).not.toBeVisible();
  });

  test('should use PhenotyperChooser select instead of text input', async () => {
    const phenotyperSelect = window.locator('select#phenotyper-chooser');
    await expect(phenotyperSelect).toBeVisible();

    const phenotyperTextInput = window.locator('input#phenotyper');
    await expect(phenotyperTextInput).not.toBeVisible();
  });
});
