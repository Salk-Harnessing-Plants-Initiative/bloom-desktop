/**
 * E2E Test: GraviScan Metadata Page (Section 10)
 *
 * Smoke tests for the /metadata route. Verifies the no-config guard,
 * plate assignment rendering when config is present, and Continue
 * navigation to /graviscan.
 *
 * PREREQUISITES:
 * 1. Start Electron Forge dev server: `npm run start` (keep running)
 * 2. Run E2E tests: `npx playwright test tests/e2e/graviscan-metadata.e2e.ts`
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
import * as os from 'os';
import { execSync } from 'child_process';
import { closeElectronApp } from './helpers/electron-cleanup';
import type { ElectronAPI } from '../../src/types/electron';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

interface WindowWithElectron extends Window {
  electron: ElectronAPI;
}

let electronApp: ElectronApplication;
let window: Page;

const TEST_DB_PATH = path.join(__dirname, 'metadata-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

const BLOOM_DIR = path.join(os.homedir(), '.bloom');
const ENV_PATH = path.join(BLOOM_DIR, '.env');
let originalEnvContent: string | null = null;

function createGraviScanTestConfig(): void {
  if (!fs.existsSync(BLOOM_DIR)) {
    fs.mkdirSync(BLOOM_DIR, { recursive: true });
  }
  if (fs.existsSync(ENV_PATH)) {
    originalEnvContent = fs.readFileSync(ENV_PATH, 'utf-8');
  }
  const envContent = `# GraviScan E2E Test Configuration
SCANNER_MODE=graviscan
SCANNER_NAME=TestGraviScanner
CAMERA_IP_ADDRESS=mock
SCANS_DIR=${path.join(BLOOM_DIR, 'e2e-test-scans')}
BLOOM_API_URL=https://api.bloom.salk.edu/proxy
BLOOM_SCANNER_USERNAME=
BLOOM_SCANNER_PASSWORD=
BLOOM_ANON_KEY=
`;
  fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
}

function cleanupGraviScanTestConfig(): void {
  if (originalEnvContent !== null) {
    fs.writeFileSync(ENV_PATH, originalEnvContent, 'utf-8');
    originalEnvContent = null;
  } else if (fs.existsSync(ENV_PATH)) {
    fs.unlinkSync(ENV_PATH);
  }
}

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
      GRAVISCAN_MOCK: 'true',
      NODE_ENV: 'test',
    } as Record<string, string>,
  });

  const windows = await electronApp.windows();
  window = windows.find((w) => w.url().includes('localhost')) || windows[0];
  await window.waitForLoadState('domcontentloaded', { timeout: 30000 });
}

test.beforeEach(async () => {
  createGraviScanTestConfig();

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

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

test.afterEach(async () => {
  await closeElectronApp(electronApp);

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  cleanupGraviScanTestConfig();
});

test.describe('GraviScan Metadata Page', () => {
  test('page loads at /metadata via sidebar nav', async () => {
    // Metadata link is shown in graviscan mode sidebar
    await window.click('text=Metadata');
    // Either the no-config guard or the Scan Metadata heading should appear
    const guardOrHeading = window.locator(
      'text=/Scanner Not Configured|Scan Metadata/'
    );
    await expect(guardOrHeading.first()).toBeVisible({ timeout: 5000 });
  });

  test('shows "Scanner Not Configured" guard when no config exists', async () => {
    await window.click('text=Metadata');

    // Fresh DB has no saved graviscan config — guard should render
    await expect(
      window.getByRole('heading', { name: /Scanner Not Configured/i })
    ).toBeVisible({ timeout: 10000 });

    // Verify the "Go to Scanner Config" CTA is shown
    await expect(
      window.getByRole('button', { name: /Go to Scanner Config/i })
    ).toBeVisible();
  });

  test('with saved config: metadata form renders', async () => {
    // Seed a config first via the IPC layer
    const saveResult = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.gravi.saveConfig({
        grid_mode: '2grid',
        resolution: 300,
      });
    });
    expect(saveResult.success).toBe(true);

    // Navigate to metadata page (config is loaded via getConfig on mount)
    await window.click('text=Metadata');

    await expect(
      window.getByRole('heading', { name: 'Scan Metadata' })
    ).toBeVisible({ timeout: 10000 });

    // Verify experiment dropdown is shown
    await expect(window.locator('select#experiment')).toBeVisible();
    // Verify phenotyper dropdown is shown
    await expect(window.locator('select#phenotyper')).toBeVisible();
    // Verify wave number input is shown
    await expect(window.locator('input#waveNumber')).toBeVisible();
  });

  test('Continue button navigates to /graviscan', async () => {
    // Seed config so the form renders
    await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.gravi.saveConfig({
        grid_mode: '2grid',
        resolution: 300,
      });
    });

    await window.click('text=Metadata');
    await expect(
      window.getByRole('heading', { name: 'Scan Metadata' })
    ).toBeVisible({ timeout: 10000 });

    // Click Continue
    await window.getByRole('button', { name: /^Continue$/ }).click();

    // Should navigate to /graviscan — verify the GraviScan capture page is shown
    await expect(
      window.getByRole('heading', { name: 'GraviScan' })
    ).toBeVisible({ timeout: 5000 });
  });
});
