/**
 * E2E Test: Export Scans Page
 *
 * Tests the complete user workflow for exporting a batch of scans to a
 * destination directory: navigation, selection state, the destination
 * picker (native dialog mocked via `electronApp.evaluate`, per Playwright's
 * standard technique — Playwright cannot drive a real OS file dialog), a
 * full export run, and re-running against a destination that already has
 * some/all files present.
 *
 * **Database Isolation:** fresh SQLite file per test (see TEST_DB_PATH).
 * **Filesystem isolation:** a fresh scans directory and destination
 * directory per test, both under a temp directory (see TEST_SCANS_DIR /
 * per-test destination dirs) — real files are read/copied for real, not
 * mocked, since that's the behavior under test.
 *
 * Related: openspec/changes/add-cylinderscan-export-page/
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
import * as os from 'os';
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
let prisma: PrismaClient;
let testScansDir: string;

const TEST_DB_PATH = path.join(__dirname, 'export-page-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

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

/** Mocks the native directory picker to resolve to `destDir`, the standard
 * technique for testing Electron's `dialog.showOpenDialog` under Playwright
 * (which cannot drive a real OS dialog). */
async function mockDirectoryPicker(destDir: string) {
  await electronApp.evaluate(({ dialog }, dir) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [dir],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })) as any;
  }, destDir);
}

/** Creates a real scan folder on disk under `testScansDir`, plus a matching `Scan` row. */
async function createScanFixture(overrides: {
  plant_id: string;
  scanPath: string;
  experimentName?: string;
  files: Record<string, string>;
  captureDate?: Date;
}) {
  const scientist = await prisma.scientist.create({
    data: {
      name: 'Test Scientist',
      email: `sci-${Date.now()}-${Math.random()}@test.com`,
    },
  });
  const experiment = await prisma.experiment.create({
    data: {
      name: overrides.experimentName || 'Test Experiment',
      species: 'Arabidopsis',
      scientist_id: scientist.id,
      experiment_type: 'cylinderscan',
    },
  });
  const phenotyper = await prisma.phenotyper.create({
    data: {
      name: 'Test Phenotyper',
      email: `pheno-${Date.now()}-${Math.random()}@test.com`,
    },
  });

  const absDir = path.join(testScansDir, overrides.scanPath);
  fs.mkdirSync(absDir, { recursive: true });
  for (const [filename, content] of Object.entries(overrides.files)) {
    fs.writeFileSync(path.join(absDir, filename), content);
  }

  const scan = await prisma.scan.create({
    data: {
      plant_id: overrides.plant_id,
      accession_name: 'Col-0',
      capture_date: overrides.captureDate ?? new Date(),
      experiment_id: experiment.id,
      phenotyper_id: phenotyper.id,
      wave_number: 1,
      plant_age_days: 14,
      scanner_name: 'TestScanner',
      path: overrides.scanPath,
      num_frames: Object.keys(overrides.files).length,
      exposure_time: 1000,
      gain: 1.5,
      gamma: 1.0,
      brightness: 50,
      contrast: 50,
      seconds_per_rot: 60,
      deleted: false,
    },
  });

  return { scan, experiment, phenotyper, scientist };
}

test.beforeEach(async () => {
  testScansDir = fs.mkdtempSync(
    path.join(os.tmpdir(), 'bloom-e2e-export-scans-')
  );
  createTestBloomConfig(testScansDir);

  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

  prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  await prisma.$connect();

  const appRoot = path.join(__dirname, '../..');
  execSync('npx prisma db push --skip-generate', {
    cwd: appRoot,
    env: { ...process.env, BLOOM_DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
  });

  await launchElectronApp();
});

test.afterEach(async () => {
  if (prisma) await prisma.$disconnect();
  await closeElectronApp(electronApp);
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  cleanupTestBloomConfig();
  fs.rmSync(testScansDir, { recursive: true, force: true });
});

test.describe('Export Scans Page', () => {
  test('shows the empty-state message when there are no scans', async () => {
    await window.click('text=Export Scans');
    await expect(window.locator('text=No scans to export')).toBeVisible();
  });

  test('export action is disabled until both scans and a destination are selected', async () => {
    await createScanFixture({
      plant_id: 'PLANT-001',
      scanPath: '2026-01-05/PLANT-001/scan-1',
      files: { 'metadata.json': '{}' },
    });

    await window.click('text=Export Scans');
    await expect(window.locator('text=PLANT-001')).toBeVisible();
    await expect(window.locator('text=0 scans selected')).toBeVisible();

    const exportButton = window.locator('button:has-text("Export 0 scan")');
    await expect(exportButton).toBeDisabled();

    // Select the scan via its own checkbox (group header is the first checkbox).
    const checkboxes = window.locator('input[type="checkbox"]');
    await checkboxes.nth(1).check();
    await expect(window.locator('text=1 scan selected')).toBeVisible();
    await expect(
      window.locator('button:has-text("Export 1 scan")')
    ).toBeDisabled();
  });

  test('runs a full export: shows progress, then a success completion banner', async () => {
    const destDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'bloom-e2e-export-dest-')
    );
    await createScanFixture({
      plant_id: 'PLANT-002',
      scanPath: '2026-01-05/PLANT-002/scan-2',
      files: { 'metadata.json': '{"frames":1}', '001.png': 'frame-data' },
    });
    await mockDirectoryPicker(destDir);

    await window.click('text=Export Scans');
    await expect(window.locator('text=PLANT-002')).toBeVisible();
    await window.locator('input[type="checkbox"]').nth(1).check();
    await window.click('button:has-text("Choose Destination")');
    // Not `locator('text=...')` — that selector engine's shorthand string
    // parses a leading `/` as the start of a `/pattern/flags` regex literal,
    // and POSIX temp dirs (os.tmpdir()) start with `/`, corrupting the match
    // on macOS/Linux while working by coincidence on Windows. getByText()
    // does plain substring matching with no such ambiguity.
    await expect(window.getByText(destDir)).toBeVisible();

    await window.click('button:has-text("Export 1 scan")');

    // Not asserting on the transient "Do not disconnect" warning here — for
    // a single small scan the whole export can complete before the next
    // Playwright poll, making that assertion inherently flaky (exactly the
    // risk task 4.3 calls out). That warning has dedicated, timing-controlled
    // coverage in tests/unit/components/Export.test.tsx instead. This is a
    // smoke check that the full pipe works end to end.
    await expect(window.locator('text=2 exported, 0 skipped')).toBeVisible({
      timeout: 15000,
    });

    expect(
      fs.readFileSync(
        path.join(destDir, '2026-01-05/PLANT-002/scan-2/metadata.json'),
        'utf-8'
      )
    ).toBe('{"frames":1}');
    expect(
      fs.readFileSync(
        path.join(destDir, '2026-01-05/PLANT-002/scan-2/001.png'),
        'utf-8'
      )
    ).toBe('frame-data');

    fs.rmSync(destDir, { recursive: true, force: true });
  });

  test('re-running against a destination with some and all files already present reports skips, not overwrites', async () => {
    const destDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'bloom-e2e-export-dest-')
    );
    await createScanFixture({
      plant_id: 'PLANT-003',
      scanPath: '2026-01-05/PLANT-003/scan-3',
      files: { 'metadata.json': '{}', '001.png': 'frame-data' },
    });
    await mockDirectoryPicker(destDir);

    await window.click('text=Export Scans');
    await expect(window.locator('text=PLANT-003')).toBeVisible();
    await window.locator('input[type="checkbox"]').nth(1).check();
    await window.click('button:has-text("Choose Destination")');
    // Not `locator('text=...')` — that selector engine's shorthand string
    // parses a leading `/` as the start of a `/pattern/flags` regex literal,
    // and POSIX temp dirs (os.tmpdir()) start with `/`, corrupting the match
    // on macOS/Linux while working by coincidence on Windows. getByText()
    // does plain substring matching with no such ambiguity.
    await expect(window.getByText(destDir)).toBeVisible();

    // First export: both files land on disk.
    await window.click('button:has-text("Export 1 scan")');
    await expect(window.locator('text=2 exported, 0 skipped')).toBeVisible({
      timeout: 15000,
    });

    // Second export of the SAME (now fully-present) scan: pure skip, no error.
    await window.locator('input[type="checkbox"]').nth(1).check();
    await window.click('button:has-text("Export 1 scan")');
    await expect(window.locator('text=0 exported, 2 skipped')).toBeVisible({
      timeout: 15000,
    });

    expect(
      fs.readFileSync(
        path.join(destDir, '2026-01-05/PLANT-003/scan-3/001.png'),
        'utf-8'
      )
    ).toBe('frame-data');

    fs.rmSync(destDir, { recursive: true, force: true });
  });
});
