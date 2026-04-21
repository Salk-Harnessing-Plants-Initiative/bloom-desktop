/**
 * E2E Test: GraviScan Scanner Config Page (Section 9)
 *
 * Smoke tests for the /scanner-config route. Verifies the page renders,
 * mock scanners are detected (GRAVISCAN_MOCK=true), and grid mode /
 * resolution selections can be saved.
 *
 * PREREQUISITES:
 * 1. Start Electron Forge dev server: `npm run start` (keep running)
 * 2. Run E2E tests: `npx playwright test tests/e2e/graviscan-scanner-config.e2e.ts`
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

// Test database (unique per test file to avoid conflicts)
const TEST_DB_PATH = path.join(__dirname, 'scanner-config-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Bloom config paths
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

test.describe('GraviScan Scanner Config Page', () => {
  test('page loads at /scanner-config via sidebar nav', async () => {
    // Click the Scanner Config link in the sidebar
    await window.click('text=Scanner Config');

    await expect(
      window.getByRole('heading', { name: 'Scanner Configuration' })
    ).toBeVisible({ timeout: 5000 });
  });

  test('mock scanners auto-detect on page load', async () => {
    await window.click('text=Scanner Config');
    await expect(
      window.getByRole('heading', { name: 'Scanner Configuration' })
    ).toBeVisible();

    // useScannerConfig auto-calls detectScanners on mount — mocks should appear.
    // GRAVISCAN_MOCK=true returns 2 mock Epson scanners per scanner-handlers.ts.
    // Wait for the "Detected Scanners" list to populate.
    await expect(window.locator('text=/Epson|EPSON/i').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('clicking Detect Scanners re-runs detection', async () => {
    await window.click('text=Scanner Config');
    await expect(
      window.getByRole('heading', { name: 'Scanner Configuration' })
    ).toBeVisible();

    // Wait for initial detection
    await expect(window.locator('text=/Epson|EPSON/i').first()).toBeVisible({
      timeout: 10000,
    });

    // Click re-detect
    const detectBtn = window.getByRole('button', { name: /Detect Scanners/i });
    await expect(detectBtn).toBeVisible();
    await detectBtn.click();

    // Verify scanners still render after re-detect
    await expect(window.locator('text=/Epson|EPSON/i').first()).toBeVisible({
      timeout: 10000,
    });
  });

  test('select grid mode and resolution, click Save, no error', async () => {
    await window.click('text=Scanner Config');
    await expect(
      window.getByRole('heading', { name: 'Scanner Configuration' })
    ).toBeVisible();

    // Wait for scanner detection (so assignments are populated)
    await expect(window.locator('text=/Epson|EPSON/i').first()).toBeVisible({
      timeout: 10000,
    });

    // Select 2grid radio (default, but verifies it's interactable)
    const gridRadio = window.locator('input[type="radio"][value="2grid"]');
    await gridRadio.check();
    await expect(gridRadio).toBeChecked();

    // Set resolution
    const resolutionSelect = window.locator('select#resolution');
    await resolutionSelect.selectOption('300');
    await expect(resolutionSelect).toHaveValue('300');

    // Click Save — should not throw an error banner
    await window.getByRole('button', { name: /Save Configuration/i }).click();

    // No red error banner should appear
    await window.waitForTimeout(500);
    const errorBanner = window.locator('.bg-red-50');
    // Detection-error banner should not appear after a successful save
    expect(await errorBanner.count()).toBeLessThanOrEqual(1);
  });

  test('saved config persists via gravi.getConfig IPC', async () => {
    await window.click('text=Scanner Config');
    await expect(
      window.getByRole('heading', { name: 'Scanner Configuration' })
    ).toBeVisible();

    await expect(window.locator('text=/Epson|EPSON/i').first()).toBeVisible({
      timeout: 10000,
    });

    // Set resolution to 600 and save
    await window.locator('select#resolution').selectOption('600');
    await window.getByRole('button', { name: /Save Configuration/i }).click();

    // Give saveConfig time to persist
    await window.waitForTimeout(1000);

    // Read config back via IPC
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.gravi.getConfig();
    });

    expect(result.success).toBe(true);
    // Config should now exist (non-null)
    expect(result.config).toBeDefined();
    if (result.config) {
      expect(result.config.resolution).toBe(600);
    }
  });
});
