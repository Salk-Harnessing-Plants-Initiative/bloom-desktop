/**
 * E2E: the Camera Settings page reports the result of Apply Settings.
 *
 * Runs the real app with the mock camera (the default when no camera hardware is
 * configured): change gamma, click Apply, and the page confirms it and shows when.
 */

import {
  test,
  expect,
  _electron as electron,
  ElectronApplication,
  Page,
} from '@playwright/test';
import * as path from 'path';
import * as fs from 'fs';
import { closeElectronApp } from './helpers/electron-cleanup';
import { waitForAppReady } from './helpers/app-ready';
import {
  createTestBloomConfig,
  cleanupTestBloomConfig,
} from './helpers/bloom-config';
import { resetTestDatabase } from './helpers/test-database';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;

const TEST_DB_PATH = path.join(__dirname, 'camera-settings-apply-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Applying starts the mock camera process on first use, which can take a while on CI.
const APPLY_TIMEOUT_MS = 60000;

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
  await waitForAppReady(window);
}

test.beforeEach(async () => {
  createTestBloomConfig();
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  resetTestDatabase(TEST_DB_PATH);
  await launchElectronApp();
});

test.afterEach(async () => {
  await closeElectronApp(electronApp);
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  cleanupTestBloomConfig();
});

test.describe('Camera Settings Apply', () => {
  test('confirms the settings were applied and shows when', async () => {
    await window.click('text=Camera Settings');
    await expect(
      window.getByRole('heading', { name: /Camera Settings/ })
    ).toBeVisible();
    await expect(window.getByText('Not applied yet')).toBeVisible();

    // Exposure, gain, gamma: the third number box is gamma.
    await window.getByRole('spinbutton').nth(2).fill('1.2');
    await expect(window.getByText('Changes not applied yet')).toBeVisible();

    await window.getByRole('button', { name: 'Apply Settings' }).click();

    await expect(window.getByRole('status')).toHaveText(
      /Camera settings applied/,
      { timeout: APPLY_TIMEOUT_MS }
    );
    await expect(window.getByTestId('camera-settings-status')).toHaveText(
      'Applied to the camera, and saved for future sessions'
    );
    const today = await window.evaluate(() => new Date().toLocaleDateString());
    await expect(window.getByText(/Last applied:/)).toContainText(today);
  });
});
