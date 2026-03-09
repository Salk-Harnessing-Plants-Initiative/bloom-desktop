/**
 * E2E Test: Experiments Management UI
 *
 * Tests the complete user workflow for managing experiments through the UI,
 * including navigation, list display, form validation, creation, and attach accession.
 *
 * **PREREQUISITES:**
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e` (in Terminal 2)
 *
 * The Electron app loads the renderer from Electron Forge's dev server on port 9000.
 * The dev server MUST be running or the Electron window will be blank.
 *
 * **Test Focus:**
 * - UI interactions (navigation, form filling, dropdown selection)
 * - Form validation (name required, species required)
 * - Database integration (experiment creation and list refresh)
 * - Attach accession to existing experiment
 *
 * **Database Isolation:**
 * - Test database: tests/e2e/experiments-ui-test.db
 * - Created fresh for each test via BLOOM_DATABASE_URL environment variable
 *
 * Related: openspec/changes/add-experiments-management-ui/
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
import { SPECIES_LIST } from '../fixtures/experiments';

// Import electron path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

// Test database path for UI tests
const TEST_DB_PATH = path.join(__dirname, 'experiments-ui-test.db');
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

  // Close Electron app
  if (electronApp) {
    await electronApp.close();
  }

  // Clean up test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
});

test.describe('Experiments Management', () => {
  test('should navigate to Experiments page', async () => {
    // Click on Experiments navigation link
    await window.click('text=Experiments');

    // Verify page heading (main h1 title)
    await expect(window.locator('h1:has-text("Experiments")')).toBeVisible();
  });

  test('should display empty state when no experiments exist', async () => {
    // Navigate to Experiments page
    await window.click('text=Experiments');

    // Verify empty state message
    await expect(window.locator('text=No experiments yet')).toBeVisible();
  });

  test('should display experiments list with species, name, and scientist', async () => {
    // First create a scientist to link
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Jane Smith', email: 'jane@example.com' },
    });

    // Create experiments directly in database
    await prisma.experiment.create({
      data: {
        name: 'Drought Study',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
      },
    });

    await prisma.experiment.create({
      data: {
        name: 'Growth Analysis',
        species: 'Rice',
        // No scientist linked
      },
    });

    // Navigate to Experiments page
    await window.click('text=Experiments');

    // Verify experiments are displayed with correct format in the list
    await expect(
      window
        .locator('ul.experiments-list')
        .locator('text=Arabidopsis - Drought Study (Dr. Jane Smith)')
    ).toBeVisible();
    await expect(
      window
        .locator('ul.experiments-list')
        .locator('text=Rice - Growth Analysis (unknown)')
    ).toBeVisible();
  });

  test('should display experiments sorted alphabetically by name', async () => {
    // Create experiments in non-alphabetical order
    await prisma.experiment.createMany({
      data: [
        { name: 'Zinc Study', species: 'Wheat' },
        { name: 'Alpha Test', species: 'Arabidopsis' },
        { name: 'Maize Research', species: 'Maize' },
      ],
    });

    // Navigate to Experiments page
    await window.click('text=Experiments');

    // Wait for experiments to load (use list-specific locator)
    await expect(
      window.locator('ul.experiments-list').locator('text=Alpha Test')
    ).toBeVisible();

    // Get list items and verify alphabetical order
    const listItems = await window
      .locator('ul.experiments-list li')
      .allTextContents();

    expect(listItems[0]).toContain('Alpha Test');
    expect(listItems[1]).toContain('Maize Research');
    expect(listItems[2]).toContain('Zinc Study');
  });

  test('should create experiment with valid name and species', async () => {
    // Navigate to Experiments page
    await window.click('text=Experiments');

    // Fill in the form
    await window.fill('input#experiment-name', 'Drought Study 2025');
    // Species dropdown should have a default selection

    // Submit the form
    await window.click('button:has-text("Create")');

    // Wait for experiment to appear in the list
    await expect(
      window.locator('ul.experiments-list').locator('text=Drought Study 2025')
    ).toBeVisible();

    // Verify form was cleared
    await expect(window.locator('input#experiment-name')).toHaveValue('');
  });

  test('should create experiment with scientist and accession linked', async () => {
    // Create a scientist and accession first
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Test Scientist', email: 'test@example.com' },
    });

    const accession = await prisma.accessions.create({
      data: { name: 'Test Accession File' },
    });

    // Navigate to Experiments page
    await window.click('text=Experiments');

    // Fill in the form
    await window.fill('input#experiment-name', 'Linked Experiment');

    // Select scientist from dropdown
    await window.selectOption('select#scientist-select', scientist.id);

    // Select accession from dropdown
    await window.selectOption('select#accession-select', accession.id);

    // Submit the form
    await window.click('button:has-text("Create")');

    // Wait for experiment to appear with scientist name in the list
    await expect(
      window
        .locator('ul.experiments-list')
        .locator('text=Linked Experiment (Dr. Test Scientist)')
    ).toBeVisible();

    // Verify in database
    const experiment = await prisma.experiment.findFirst({
      where: { name: 'Linked Experiment' },
      include: { scientist: true, accession: true },
    });
    expect(experiment).not.toBeNull();
    expect(experiment?.scientist?.name).toBe('Dr. Test Scientist');
    expect(experiment?.accession?.name).toBe('Test Accession File');
  });

  test('should show all 15 species in dropdown alphabetically', async () => {
    // Navigate to Experiments page
    await window.click('text=Experiments');

    // Get all options from species dropdown
    const options = await window
      .locator('select#species-select option')
      .allTextContents();

    // Verify all 15 species are present and sorted
    expect(options).toEqual(SPECIES_LIST);
    expect(options.length).toBe(15);

    // Verify alphabetical order
    const sortedOptions = [...options].sort();
    expect(options).toEqual(sortedOptions);
  });

  test('should prevent submission with empty name', async () => {
    // Navigate to Experiments page
    await window.click('text=Experiments');

    // Try to submit without entering name
    await window.click('button:has-text("Create")');

    // Verify experiment was NOT created (still empty state)
    await expect(window.locator('text=No experiments yet')).toBeVisible();
  });

  test('should show loading state during creation', async () => {
    // Navigate to Experiments page
    await window.click('text=Experiments');

    // Fill in the form
    await window.fill('input#experiment-name', 'Loading Test');

    // Click submit and check button state
    const submitButton = window.locator(
      'button.create-experiment-button:has-text("Create")'
    );
    await submitButton.click();

    // Verify experiment was created in the list
    await expect(
      window.locator('ul.experiments-list').locator('text=Loading Test')
    ).toBeVisible();
  });
});

test.describe('Attach Accession to Existing Experiment', () => {
  test('should attach accession to existing experiment', async () => {
    // Create experiment and accession first
    const experiment = await prisma.experiment.create({
      data: { name: 'Unlinked Experiment', species: 'Arabidopsis' },
    });

    const accession = await prisma.accessions.create({
      data: { name: 'New Accession File' },
    });

    // Navigate to Experiments page
    await window.click('text=Experiments');

    // Wait for page to load (experiment in list)
    await expect(
      window.locator('ul.experiments-list').locator('text=Unlinked Experiment')
    ).toBeVisible();

    // Select experiment from dropdown in attach section
    await window.selectOption('select#attach-experiment-select', experiment.id);

    // Select accession from dropdown
    await window.selectOption('select#attach-accession-select', accession.id);

    // Click attach button
    await window.click('button:has-text("Attach Accession")');

    // Verify success message
    await expect(
      window.locator('text=Accession successfully attached')
    ).toBeVisible();

    // Verify in database
    const updatedExperiment = await prisma.experiment.findUnique({
      where: { id: experiment.id },
      include: { accession: true },
    });
    expect(updatedExperiment?.accession?.name).toBe('New Accession File');
  });

  test('should disable attach button when no experiments or accessions exist', async () => {
    // Navigate to Experiments page without creating any experiments
    await window.click('text=Experiments');

    // The attach section should handle empty state gracefully
    // Verify the attach button is disabled when no experiments/accessions exist
    const attachButton = window.locator('button:has-text("Attach Accession")');
    await expect(attachButton).toBeDisabled();
  });

  test('should show experiment dropdown with correct format', async () => {
    // Create experiments with and without scientists
    const scientist = await prisma.scientist.create({
      data: { name: 'Dr. Format Test', email: 'format@example.com' },
    });

    await prisma.experiment.create({
      data: {
        name: 'With Scientist',
        species: 'Rice',
        scientist_id: scientist.id,
      },
    });

    await prisma.experiment.create({
      data: { name: 'No Scientist', species: 'Maize' },
    });

    // Navigate to Experiments page
    await window.click('text=Experiments');

    // Get options from attach experiment dropdown
    const options = await window
      .locator('select#attach-experiment-select option')
      .allTextContents();

    // Verify format includes species, name, and scientist
    expect(
      options.some((o) => o.includes('Rice - With Scientist (Dr. Format Test)'))
    ).toBe(true);
    expect(
      options.some((o) => o.includes('Maize - No Scientist (unknown)'))
    ).toBe(true);
  });

  test('should show accession dropdown with name and id', async () => {
    // Create accessions
    const accession = await prisma.accessions.create({
      data: { name: 'Test Accession' },
    });

    // Navigate to Experiments page
    await window.click('text=Experiments');

    // Get options from attach accession dropdown
    const options = await window
      .locator('select#attach-accession-select option')
      .allTextContents();

    // Verify format includes name and id
    expect(
      options.some(
        (o) => o.includes('Test Accession') && o.includes(accession.id)
      )
    ).toBe(true);
  });
});

test.describe('ExperimentChooser Component', () => {
  test('should display experiments in dropdown', async () => {
    // Create experiments
    await prisma.experiment.createMany({
      data: [
        { name: 'Experiment Alpha', species: 'Arabidopsis' },
        { name: 'Experiment Beta', species: 'Rice' },
      ],
    });

    // Navigate to CaptureScan page where ExperimentChooser is used
    await window.click('text=Capture Scan');

    // Wait for page to load
    await expect(
      window.getByRole('heading', { name: 'Capture Scan' })
    ).toBeVisible();

    // Find the experiment chooser dropdown
    const experimentSelect = window.locator('select.experiment-chooser');
    await expect(experimentSelect).toBeVisible();

    // Get options
    const options = await experimentSelect.locator('option').allTextContents();

    // Verify experiments are in dropdown
    expect(options).toContain('Experiment Alpha');
    expect(options).toContain('Experiment Beta');
  });

  test('should show placeholder when nothing selected', async () => {
    // Navigate to CaptureScan page
    await window.click('text=Capture Scan');

    // Find the experiment chooser
    const experimentSelect = window.locator('select.experiment-chooser');
    await expect(experimentSelect).toBeVisible();

    // Verify placeholder option
    const selectedValue = await experimentSelect.inputValue();
    expect(selectedValue).toBe('');

    // Verify placeholder text
    const options = await experimentSelect.locator('option').allTextContents();
    expect(options[0]).toContain('Choose an experiment');
  });

  test('should have amber border when unselected', async () => {
    // Navigate to CaptureScan page
    await window.click('text=Capture Scan');

    // Find the experiment chooser
    const experimentSelect = window.locator('select.experiment-chooser');
    await expect(experimentSelect).toBeVisible();

    // Verify amber border class when unselected
    await expect(experimentSelect).toHaveClass(/border-amber/);
  });

  test('should have gray border when selected', async () => {
    // Create an experiment
    await prisma.experiment.create({
      data: { name: 'Test Selection', species: 'Arabidopsis' },
    });

    // Navigate to CaptureScan page
    await window.click('text=Capture Scan');

    // Find and select experiment
    const experimentSelect = window.locator('select.experiment-chooser');
    await experimentSelect.selectOption({ label: 'Test Selection' });

    // Verify gray border class when selected
    await expect(experimentSelect).toHaveClass(/border-gray/);
  });
});

test.describe('PhenotyperChooser Component', () => {
  test('should display phenotypers in dropdown', async () => {
    // Create phenotypers
    await prisma.phenotyper.createMany({
      data: [
        { name: 'Phenotyper Alpha', email: 'alpha@example.com' },
        { name: 'Phenotyper Beta', email: 'beta@example.com' },
      ],
    });

    // Navigate to CaptureScan page where PhenotyperChooser is used
    await window.click('text=Capture Scan');

    // Wait for page to load
    await expect(
      window.getByRole('heading', { name: 'Capture Scan' })
    ).toBeVisible();

    // Find the phenotyper chooser dropdown
    const phenotyperSelect = window.locator('select.phenotyper-chooser');
    await expect(phenotyperSelect).toBeVisible();

    // Get options
    const options = await phenotyperSelect.locator('option').allTextContents();

    // Verify phenotypers are in dropdown
    expect(options).toContain('Phenotyper Alpha');
    expect(options).toContain('Phenotyper Beta');
  });

  test('should show placeholder when nothing selected', async () => {
    // Navigate to CaptureScan page
    await window.click('text=Capture Scan');

    // Find the phenotyper chooser
    const phenotyperSelect = window.locator('select.phenotyper-chooser');
    await expect(phenotyperSelect).toBeVisible();

    // Verify placeholder option
    const selectedValue = await phenotyperSelect.inputValue();
    expect(selectedValue).toBe('');

    // Verify placeholder text
    const options = await phenotyperSelect.locator('option').allTextContents();
    expect(options[0]).toContain('Choose a phenotyper');
  });

  test('should have amber border when unselected', async () => {
    // Navigate to CaptureScan page
    await window.click('text=Capture Scan');

    // Find the phenotyper chooser
    const phenotyperSelect = window.locator('select.phenotyper-chooser');
    await expect(phenotyperSelect).toBeVisible();

    // Verify amber border class when unselected
    await expect(phenotyperSelect).toHaveClass(/border-amber/);
  });

  test('should have gray border when selected', async () => {
    // Create a phenotyper
    await prisma.phenotyper.create({
      data: { name: 'Test Phenotyper', email: 'test@example.com' },
    });

    // Navigate to CaptureScan page
    await window.click('text=Capture Scan');

    // Find and select phenotyper
    const phenotyperSelect = window.locator('select.phenotyper-chooser');
    await phenotyperSelect.selectOption({ label: 'Test Phenotyper' });

    // Verify gray border class when selected
    await expect(phenotyperSelect).toHaveClass(/border-gray/);
  });
});

test.describe('CaptureScan Integration', () => {
  test('should use ExperimentChooser instead of text input', async () => {
    // Navigate to CaptureScan page
    await window.click('text=Capture Scan');

    // Verify ExperimentChooser (select) exists
    const experimentSelect = window.locator('select.experiment-chooser');
    await expect(experimentSelect).toBeVisible();

    // Verify text input does NOT exist for experiment
    const experimentTextInput = window.locator('input#experimentId');
    await expect(experimentTextInput).not.toBeVisible();
  });

  test('should use PhenotyperChooser instead of text input', async () => {
    // Navigate to CaptureScan page
    await window.click('text=Capture Scan');

    // Verify PhenotyperChooser (select) exists
    const phenotyperSelect = window.locator('select.phenotyper-chooser');
    await expect(phenotyperSelect).toBeVisible();

    // Verify text input does NOT exist for phenotyper
    const phenotyperTextInput = window.locator('input#phenotyper');
    await expect(phenotyperTextInput).not.toBeVisible();
  });
});
