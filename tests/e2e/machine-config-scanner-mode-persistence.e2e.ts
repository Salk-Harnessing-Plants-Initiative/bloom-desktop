/**
 * E2E Test: Machine Configuration reflects the loaded scanner_mode
 *
 * Regression test for a bug found via manual smoke testing of
 * fix-cylinderscan-config-ux-quickfixes: the real `config:get` IPC handler
 * (src/main/main.ts) omitted `scanner_mode` from its returned config object
 * entirely, so `MachineConfiguration.tsx` always received `scanner_mode:
 * undefined` on load — the Scanner Mode radios rendered unchecked and the
 * entire CylinderScan-only Hardware section (camera IP, Check Hardware,
 * Restart Python) never rendered, regardless of what was actually saved to
 * `~/.bloom/.env`.
 *
 * This was invisible to every unit test covering MachineConfiguration.tsx
 * because those tests mock `window.electron.config.get()` directly with a
 * hand-built response that always included `scanner_mode` — only a real
 * IPC round-trip through the actual main-process handler could catch a
 * missing field in that handler's own return statement. Kept as a
 * permanent E2E test since this class of bug is structurally invisible to
 * mocked unit tests.
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
import { execSync } from 'child_process';
import { closeElectronApp } from './helpers/electron-cleanup';
import { waitForAppReady } from './helpers/app-ready';
import {
  createTestBloomConfig,
  cleanupTestBloomConfig,
} from './helpers/bloom-config';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;

const TEST_DB_PATH = path.join(
  __dirname,
  'machine-config-scanner-mode-persistence-test.db'
);
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

test.describe('Machine Configuration — scanner_mode round-trip', () => {
  test.beforeEach(async () => {
    // createTestBloomConfig() writes SCANNER_MODE=cylinderscan to a fresh
    // ~/.bloom/.env (backing up/restoring any existing real one).
    createTestBloomConfig();

    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
    const testDbDir = path.dirname(TEST_DB_PATH);
    if (!fs.existsSync(testDbDir)) fs.mkdirSync(testDbDir, { recursive: true });

    const appRoot = path.join(__dirname, '../..');
    execSync('npx prisma db push --skip-generate', {
      cwd: appRoot,
      env: { ...process.env, BLOOM_DATABASE_URL: TEST_DB_URL },
      stdio: 'pipe',
    });

    const args = [path.join(appRoot, '.webpack/main/index.js')];
    if (process.platform === 'linux' && process.env.CI === 'true') {
      args.push('--no-sandbox');
    }

    electronApp = await electron.launch({
      executablePath: electronPath,
      args,
      cwd: appRoot,
      env: { ...process.env, BLOOM_DATABASE_URL: TEST_DB_URL } as Record<
        string,
        string
      >,
    });

    const windows = await electronApp.windows();
    window = windows.find((w) => w.url().includes('localhost')) || windows[0];
    await window.waitForLoadState('domcontentloaded');
    await waitForAppReady(window);
  });

  test.afterEach(async () => {
    await closeElectronApp(electronApp);
    cleanupTestBloomConfig();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  test('CylinderScan radio is checked and the Hardware section renders when scanner_mode=cylinderscan is already saved', async () => {
    // Layout.tsx's shortcut handler checks navigator.platform for 'MAC' and
    // requires metaKey (Cmd) there, ctrlKey everywhere else — mirror that
    // here, since the CI matrix runs this on macOS too.
    const shortcut =
      process.platform === 'darwin'
        ? 'Meta+Shift+Comma'
        : 'Control+Shift+Comma';
    await window.keyboard.press(shortcut);
    await expect(
      window.getByRole('heading', { name: 'Machine Configuration' })
    ).toBeVisible({ timeout: 15000 });

    await expect(
      window.locator('input[name="scanner_mode"][value="cylinderscan"]')
    ).toBeChecked({ timeout: 10000 });

    await expect(
      window.getByRole('heading', { name: 'Hardware' })
    ).toBeVisible();
    await expect(window.getByLabel('Camera IP Address')).toBeVisible();
  });
});
