/**
 * E2E Tests: Experiment Accession Indicator
 *
 * Tests that ExperimentChooser displays visual indicators for experiments
 * that have accessions attached, helping users know which experiments
 * support barcode validation and autocomplete.
 *
 * **PREREQUISITES:**
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e` (in Terminal 2)
 *
 * The Electron app loads the renderer from Electron Forge's dev server on port 9000.
 */

import {
  test,
  expect,
  ElectronApplication,
  Page,
  _electron as electron,
} from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import path from 'path';
import fs from 'fs';

// Import electron path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

// Test database path for UI tests
const TEST_DB_PATH = path.join(
  __dirname,
  'experiment-accession-indicator-test.db'
);
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

  // Run migrations to create schema
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { execSync } = require('child_process');
  execSync('npx prisma migrate deploy', {
    env: {
      ...process.env,
      BLOOM_DATABASE_URL: TEST_DB_URL,
    },
  });

  // Seed test data - create scientist, accession, and experiments
  const scientist = await prisma.scientist.create({
    data: {
      name: 'Test Scientist',
      email: 'scientist@test.com',
    },
  });

  const accession = await prisma.accessions.create({
    data: {
      name: 'Test Accession',
    },
  });

  // Create experiment WITH accession
  await prisma.experiment.create({
    data: {
      name: 'Experiment with Accession',
      species: 'Arabidopsis thaliana',
      scientist_id: scientist.id,
      accession_id: accession.id,
    },
  });

  // Create experiment WITHOUT accession
  await prisma.experiment.create({
    data: {
      name: 'Experiment without Accession',
      species: 'Sorghum bicolor',
      scientist_id: scientist.id,
      accession_id: null,
    },
  });

  // Launch Electron app
  await launchElectronApp();
});

/**
 * Test cleanup
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

test.describe('Experiment Accession Indicator', () => {
  test('ExperimentChooser shows checkmark for experiments with accessions', async () => {
    // Navigate to CaptureScan page
    await window.click('text=Capture Scan');
    await window.waitForSelector('#experiment-chooser', { timeout: 5000 });

    // Open the experiment chooser dropdown
    const experimentChooser = window.locator('#experiment-chooser');
    await expect(experimentChooser).toBeVisible();

    // Get all options
    const allOptions = window.locator('#experiment-chooser option');
    const optionCount = await allOptions.count();
    expect(optionCount).toBeGreaterThan(2); // Placeholder + 2 experiments

    // Check for experiment with accession (should have ✓)
    const optionWithAccession = window.locator(
      '#experiment-chooser option:has-text("✓ Experiment with Accession")'
    );
    // Option elements are not visible by default, just check they exist
    await expect(optionWithAccession).toHaveCount(1);
    const textWithAccession = await optionWithAccession.textContent();
    expect(textWithAccession).toContain('✓');

    // Check for experiment without accession (should NOT have ✓)
    const optionWithoutAccession = window.locator(
      '#experiment-chooser option:has-text("Experiment without Accession")'
    );
    await expect(optionWithoutAccession).toHaveCount(1);

    // Verify the option without accession doesn't have the checkmark
    const textWithoutAccession = await optionWithoutAccession.textContent();
    expect(textWithoutAccession).not.toContain('✓');
  });

  test('Experiments without accession do not show checkmark', async () => {
    // Navigate to CaptureScan page
    await window.click('text=Capture Scan');
    await window.waitForSelector('#experiment-chooser', { timeout: 5000 });

    // Get all options from the experiment chooser
    const options = await window.locator('#experiment-chooser option').all();

    // Count experiments with and without indicators
    let withIndicator = 0;
    let withoutIndicator = 0;

    for (const option of options) {
      const text = await option.textContent();
      const value = await option.getAttribute('value');

      // Skip the placeholder option
      if (!value) continue;

      // Check if this option has the indicator
      if (text && text.includes('✓')) {
        withIndicator++;
      } else {
        withoutIndicator++;
      }
    }

    // Verify counts match our test data
    expect(withIndicator).toBe(1); // 1 experiment with accession
    expect(withoutIndicator).toBe(1); // 1 experiment without accession
  });
});
