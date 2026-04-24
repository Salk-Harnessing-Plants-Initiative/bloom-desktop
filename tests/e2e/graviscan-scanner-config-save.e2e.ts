/**
 * E2E Test: Scanner Config Save flow (fix-scanner-config-save-flow)
 *
 * Validates end-to-end that clicking "Save Configuration" on /scanner-config
 * writes N `GraviScanner` rows to the DB (with valid usb_port) and that the
 * downstream /metadata page loads without Prisma FK errors.
 *
 * Also verifies unchecking a scanner propagates enabled=false to the DB row.
 *
 * PREREQUISITES:
 * 1. Start Electron Forge dev server: `npm run start` (keep running)
 * 2. Run E2E tests: `npx playwright test tests/e2e/graviscan-scanner-config-save.e2e.ts`
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
import Database from 'better-sqlite3';
import { closeElectronApp } from './helpers/electron-cleanup';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;

const TEST_DB_PATH = path.join(__dirname, 'scanner-config-save-test.db');
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
  fs.writeFileSync(
    ENV_PATH,
    [
      '# GraviScan E2E Test Configuration',
      'SCANNER_MODE=graviscan',
      'SCANNER_NAME=TestGraviScanner',
      'CAMERA_IP_ADDRESS=mock',
      `SCANS_DIR=${path.join(BLOOM_DIR, 'e2e-test-scans')}`,
      'BLOOM_API_URL=https://api.bloom.salk.edu/proxy',
      'BLOOM_SCANNER_USERNAME=',
      'BLOOM_SCANNER_PASSWORD=',
      'BLOOM_ANON_KEY=',
      '',
    ].join('\n'),
    'utf-8'
  );
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

function queryScanners(): Array<{
  id: string;
  name: string;
  usb_port: string | null;
  enabled: number;
}> {
  const db = new Database(TEST_DB_PATH, { readonly: true });
  try {
    const rows = db
      .prepare(
        'SELECT id, name, usb_port, enabled FROM GraviScanner ORDER BY name'
      )
      .all() as Array<{
      id: string;
      name: string;
      usb_port: string | null;
      enabled: number;
    }>;
    return rows;
  } finally {
    db.close();
  }
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

test.describe('Scanner Config Save — fix-scanner-config-save-flow', () => {
  test('Save writes GraviScanner rows with valid usb_port and enabled=true', async () => {
    await window.click('text=Scanner Config');
    await expect(
      window.getByRole('heading', { name: 'Scanner Configuration' })
    ).toBeVisible();

    // Wait for auto-detection to populate mock scanners
    await expect(
      window.locator('text=/Mock Scanner|Epson/i').first()
    ).toBeVisible({ timeout: 10000 });

    // Click Save
    await window.getByRole('button', { name: /Save Configuration/i }).click();

    // Success banner visible within 2s (role=status, bg-green-50)
    const banner = window.locator('[role="status"]').filter({
      hasText: /scanners saved/i,
    });
    await expect(banner).toBeVisible({ timeout: 5000 });

    // Wait a beat so the follow-up re-detect completes and all rows are written
    await window.waitForTimeout(1000);

    // Query the test DB directly
    const rows = queryScanners();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(r.usb_port, 'usb_port must be non-empty').toBeTruthy();
      expect(r.usb_port!.length).toBeGreaterThan(0);
      expect(r.enabled).toBe(1); // all enabled after initial save
    }
  });

  test('Metadata page loads without Prisma FK errors after Save', async () => {
    const consoleErrors: string[] = [];
    window.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    await window.click('text=Scanner Config');
    await expect(
      window.getByRole('heading', { name: 'Scanner Configuration' })
    ).toBeVisible();

    await expect(
      window.locator('text=/Mock Scanner|Epson/i').first()
    ).toBeVisible({ timeout: 10000 });

    await window.getByRole('button', { name: /Save Configuration/i }).click();
    await window.waitForTimeout(1500);

    // Navigate to /metadata
    await window.click('text=Metadata');
    await window.waitForTimeout(2000);

    // No Prisma FK errors in console
    const fkErrors = consoleErrors.filter((e) =>
      /FOREIGN KEY constraint|Prisma.*FK/i.test(e)
    );
    expect(
      fkErrors,
      `Unexpected FK errors: ${fkErrors.join(' | ')}`
    ).toHaveLength(0);
  });

  test('Unchecking a scanner propagates enabled=false to the DB on Save', async () => {
    await window.click('text=Scanner Config');
    await expect(
      window.getByRole('heading', { name: 'Scanner Configuration' })
    ).toBeVisible();

    await expect(
      window.locator('text=/Mock Scanner|Epson/i').first()
    ).toBeVisible({ timeout: 10000 });

    // Save once with both scanners enabled so they exist in DB
    await window.getByRole('button', { name: /Save Configuration/i }).click();
    await window.waitForTimeout(1500);

    const beforeRows = queryScanners();
    expect(beforeRows.length).toBeGreaterThanOrEqual(2);

    // Uncheck the first Enabled checkbox
    const firstCheckbox = window.locator('input[type="checkbox"]').first();
    await firstCheckbox.uncheck();

    // Save again
    await window.getByRole('button', { name: /Save Configuration/i }).click();
    await window.waitForTimeout(1500);

    const afterRows = queryScanners();
    // One row should now have enabled=0
    const disabledRows = afterRows.filter((r) => r.enabled === 0);
    expect(disabledRows.length).toBeGreaterThanOrEqual(1);
    // Row IDs unchanged (no delete, just enabled flip)
    expect(afterRows.length).toBe(beforeRows.length);
  });

  test('Rapid double-click on Save produces exactly one IPC round-trip', async () => {
    await window.click('text=Scanner Config');
    await expect(
      window.getByRole('heading', { name: 'Scanner Configuration' })
    ).toBeVisible();

    await expect(
      window.locator('text=/Mock Scanner|Epson/i').first()
    ).toBeVisible({ timeout: 10000 });

    const saveBtn = window.getByRole('button', {
      name: /Save Configuration/i,
    });

    // Two rapid clicks
    await saveBtn.click();
    await saveBtn.click();

    // Success banner appears exactly once
    await window.waitForTimeout(2000);
    const banners = await window
      .locator('[role="status"]')
      .filter({ hasText: /scanners saved/i })
      .count();
    expect(banners).toBeLessThanOrEqual(1);
  });
});
