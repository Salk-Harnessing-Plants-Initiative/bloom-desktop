/**
 * E2E Test: GraviScan Browse Page (Section 12)
 *
 * Smoke tests for the /browse-graviscan route. Verifies empty state,
 * filter rendering, and that the page queries the graviscans table
 * without crashing.
 *
 * PREREQUISITES:
 * 1. Start Electron Forge dev server: `npm run start` (keep running)
 * 2. Run E2E tests: `npx playwright test tests/e2e/graviscan-browse.e2e.ts`
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

const TEST_DB_PATH = path.join(__dirname, 'browse-graviscan-test.db');
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

test.describe('GraviScan Browse Page', () => {
  test('page loads at /browse-graviscan via sidebar nav', async () => {
    await window.click('text=Browse GraviScans');

    await expect(
      window.getByRole('heading', { name: 'Browse GraviScans' })
    ).toBeVisible({ timeout: 5000 });
  });

  test('empty state: shows "No scans found" when DB is empty', async () => {
    await window.click('text=Browse GraviScans');
    await expect(
      window.getByRole('heading', { name: 'Browse GraviScans' })
    ).toBeVisible();

    // Fresh DB has no graviscans — empty state copy should render
    await expect(window.locator('text=/No scans found/i')).toBeVisible({
      timeout: 10000,
    });
  });

  test('filters render (experiment dropdown, date inputs, clear button)', async () => {
    await window.click('text=Browse GraviScans');
    await expect(
      window.getByRole('heading', { name: 'Browse GraviScans' })
    ).toBeVisible();

    // Experiment filter dropdown
    await expect(window.locator('select#experiment-filter')).toBeVisible();
    // From-date input
    await expect(window.locator('input#date-from')).toBeVisible();
    // To-date input
    await expect(window.locator('input#date-to')).toBeVisible();
    // Clear Filters button
    await expect(
      window.getByRole('button', { name: /Clear Filters/i })
    ).toBeVisible();
  });

  test('experiment filter dropdown has "All Experiments" default option', async () => {
    await window.click('text=Browse GraviScans');
    await expect(
      window.getByRole('heading', { name: 'Browse GraviScans' })
    ).toBeVisible();

    const select = window.locator('select#experiment-filter');
    await expect(select).toHaveValue('');
    await expect(select.locator('option').first()).toHaveText(
      /All Experiments/i
    );
  });

  test('graviscans.list IPC returns an empty array for fresh DB', async () => {
    // Proves the IPC layer is wired up and the page's data source works.
    await window.click('text=Browse GraviScans');
    await expect(
      window.getByRole('heading', { name: 'Browse GraviScans' })
    ).toBeVisible();

    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.graviscans.list();
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data.length).toBe(0);
  });

  test('results summary shows "0 scan(s) in 0 session(s)" when empty', async () => {
    await window.click('text=Browse GraviScans');
    await expect(
      window.getByRole('heading', { name: 'Browse GraviScans' })
    ).toBeVisible();

    // Wait for loading to settle
    await expect(
      window.locator('text=/0 scan\\(s\\) in 0 session\\(s\\)/')
    ).toBeVisible({ timeout: 10000 });
  });
});
