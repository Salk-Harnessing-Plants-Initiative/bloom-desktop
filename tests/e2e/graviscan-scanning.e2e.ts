/**
 * E2E Test: GraviScan Scanning Page (Section 11, covers 13.2 + 13.5)
 *
 * Smoke tests for the /graviscan capture route. Focuses on the readiness
 * gate (issue #159) — Start Scan must be disabled until all prerequisites
 * are met (config, experiment, phenotyper, selected plates, enabled scanner).
 *
 * Does NOT test actual scanning workflows (mock subprocess is complex).
 *
 * PREREQUISITES:
 * 1. Start Electron Forge dev server: `npm run start` (keep running)
 * 2. Run E2E tests: `npx playwright test tests/e2e/graviscan-scanning.e2e.ts`
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;

const TEST_DB_PATH = path.join(__dirname, 'scanning-test.db');
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

test.describe('GraviScan Scanning Page (Readiness Gate)', () => {
  test('page loads at /graviscan via sidebar nav', async () => {
    // In graviscan mode the "Capture Scan" sidebar link routes to /graviscan
    await window.click('text=Capture Scan');

    await expect(
      window.getByRole('heading', { name: 'GraviScan' })
    ).toBeVisible({ timeout: 5000 });
  });

  test('Start Scan button is DISABLED on fresh app (issue #159 readiness gate)', async () => {
    await window.click('text=Capture Scan');
    await expect(
      window.getByRole('heading', { name: 'GraviScan' })
    ).toBeVisible();

    // Fresh DB → no experiment selected, no phenotyper, no plates.
    // canStartScan = !isScanning && experiment && phenotyper && plates && enabledScanner
    // So the Start Scan button MUST be disabled.
    const startBtn = window.getByRole('button', { name: /Start Scan/i });
    await expect(startBtn).toBeVisible();
    await expect(startBtn).toBeDisabled();
  });

  test('form inputs render (experiment, phenotyper, wave, resolution)', async () => {
    await window.click('text=Capture Scan');
    await expect(
      window.getByRole('heading', { name: 'GraviScan' })
    ).toBeVisible();

    // Verify readiness prerequisites appear as form controls
    await expect(window.locator('select#experiment-select')).toBeVisible();
    await expect(window.locator('select#phenotyper-select')).toBeVisible();
    await expect(window.locator('input#wave-number')).toBeVisible();
    await expect(window.locator('select#resolution')).toBeVisible();
  });

  test('Cancel button is NOT visible when no scan is in progress', async () => {
    await window.click('text=Capture Scan');
    await expect(
      window.getByRole('heading', { name: 'GraviScan' })
    ).toBeVisible();

    // Cancel only appears when pendingJobs.size > 0 (scan in progress).
    // On fresh load there are no pending jobs → Cancel button should not exist.
    const cancelBtn = window.getByRole('button', { name: /^Cancel$/ });
    await expect(cancelBtn).toHaveCount(0);
  });

  test('scanner status panel renders (empty state when no config)', async () => {
    await window.click('text=Capture Scan');
    await expect(
      window.getByRole('heading', { name: 'GraviScan' })
    ).toBeVisible();

    // Scanners panel heading
    await expect(
      window.getByRole('heading', { name: 'Scanners' })
    ).toBeVisible();

    // With no saved config, the scanner list shows the empty-state hint.
    // Either the hint is visible OR mock scanners have been detected —
    // both paths prove the panel rendered without error.
    const emptyHint = window.locator(
      'text=/No scanners configured|Detect Scanners/i'
    );
    await expect(emptyHint.first()).toBeVisible({ timeout: 5000 });
  });

  test('Mode toggle buttons (Single/Continuous) render', async () => {
    await window.click('text=Capture Scan');
    await expect(
      window.getByRole('heading', { name: 'GraviScan' })
    ).toBeVisible();

    await expect(
      window.getByRole('button', { name: /^Single$/ })
    ).toBeVisible();
    await expect(
      window.getByRole('button', { name: /^Continuous$/ })
    ).toBeVisible();
  });
});
