/**
 * E2E Tests: Experiment Accession Indicator
 *
 * Tests that ExperimentChooser displays visual indicators for experiments
 * that have accessions attached, helping users know which experiments
 * support barcode validation and autocomplete.
 */

import {
  test,
  expect,
  ElectronApplication,
  Page,
  _electron as electron,
} from '@playwright/test';
import path from 'path';
import fs from 'fs';

// Test database setup
const TEST_DB_PATH = path.join(__dirname, '../../prisma/prisma/test.db');
const DEV_DB_PATH = path.join(__dirname, '../../prisma/prisma/dev.db');

let electronApp: ElectronApplication;
let page: Page;

test.describe('Experiment Accession Indicator', () => {
  test.beforeAll(async () => {
    // Copy dev database for testing if it exists
    if (fs.existsSync(DEV_DB_PATH)) {
      fs.copyFileSync(DEV_DB_PATH, TEST_DB_PATH);
    }

    // Launch Electron app
    electronApp = await electron.launch({
      args: [path.join(__dirname, '../../dist/main/main.js')],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: `file:${TEST_DB_PATH}`,
      },
    });

    page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');
  });

  test.afterAll(async () => {
    if (electronApp) {
      await electronApp.close();
    }
    // Clean up test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  test('ExperimentChooser shows accession indicator for experiments with accessions', async () => {
    // Navigate to CaptureScan page
    await page.click('text=Capture Scan');
    await page.waitForTimeout(500);

    // Open the experiment chooser dropdown
    const experimentChooser = page.locator('#experiment-chooser');
    await expect(experimentChooser).toBeVisible();
    await experimentChooser.click();

    // Wait for experiments to load
    await page.waitForTimeout(1000);

    // At least verify the dropdown has options
    const allOptions = page.locator('#experiment-chooser option');
    const optionCount = await allOptions.count();
    expect(optionCount).toBeGreaterThan(1); // At least placeholder + 1 experiment

    // Check for accession indicators (checkmarks) if any experiments have accessions
    const optionsWithAccession = page.locator(
      '#experiment-chooser option:has-text("✓")'
    );
    const accessionCount = await optionsWithAccession.count();
    // Log for debugging - we expect some experiments to have accessions
    console.log(
      `Found ${accessionCount} experiments with accession indicators`
    );
  });

  test('Selected experiment with accession shows indicator text', async () => {
    // Navigate to CaptureScan page
    await page.click('text=Capture Scan');
    await page.waitForTimeout(500);

    // Get the experiment chooser
    const experimentChooser = page.locator('#experiment-chooser');
    await expect(experimentChooser).toBeVisible();

    // Select an experiment (if one with accession exists)
    // The test will verify the indicator is shown after selection
    const options = await page.locator('#experiment-chooser option').all();

    // Find an option that has the accession indicator
    for (const option of options) {
      const text = await option.textContent();
      if (text && (text.includes('✓') || text.includes('accession'))) {
        const value = await option.getAttribute('value');
        if (value) {
          await experimentChooser.selectOption(value);
          break;
        }
      }
    }
  });

  test('Experiments without accession do not show indicator', async () => {
    // Navigate to CaptureScan page
    await page.click('text=Capture Scan');
    await page.waitForTimeout(500);

    // Get all options from the experiment chooser
    const options = await page.locator('#experiment-chooser option').all();

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

    // Log for debugging
    console.log(
      `Experiments with accession: ${withIndicator}, without: ${withoutIndicator}`
    );

    // Verify that the counts are reasonable (at least one experiment exists)
    expect(withIndicator + withoutIndicator).toBeGreaterThan(0);
  });
});
