/**
 * E2E Test: GraviScan Browse / Experiment Detail / Metadata UI (Tier 5)
 *
 * Tests the real renderer → preload → IPC → main → database round-trip for
 * the Tier 5 screens, driving the actual UI (not just `window.evaluate`
 * IPC calls) — see
 * openspec/changes/add-graviscan-tier5-browse-metadata/tasks.md Section 10.
 *
 * PREREQUISITES:
 * 1. `npm run build:python && npx electron-forge package` (or an
 *    equivalent build producing `.webpack/main/index.js`)
 * 2. `npx playwright test tests/e2e/graviscan-browse-metadata.e2e.ts`
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

const TEST_DB_PATH = path.join(__dirname, 'graviscan-browse-metadata-test.db');
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
    `SCANNER_MODE=graviscan
SCANNER_NAME=TestGraviScanner
CAMERA_IP_ADDRESS=mock
SCANS_DIR=${path.join(BLOOM_DIR, 'e2e-tier5-scans')}
BLOOM_API_URL=https://api.bloom.salk.edu/proxy
BLOOM_SCANNER_USERNAME=
BLOOM_SCANNER_PASSWORD=
BLOOM_ANON_KEY=
`,
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

  // TEMPORARY DIAGNOSTIC: see tests/e2e/accession-excel-upload.e2e.ts for
  // context (E2E CI hang investigation, PR #290). Added here too because
  // this file's Metadata-navigation tests are still failing after the
  // exceljs/require() fix, and this file previously had no error capture
  // at all — remove once resolved.
  window.on('pageerror', (err) => {
    console.log(`[renderer pageerror] ${err.stack || err.message}`);
  });
  window.on('console', (msg) => {
    console.log(`[renderer console:${msg.type()}] ${msg.text()}`);
  });

  await window.waitForLoadState('domcontentloaded', { timeout: 30000 });
  await waitForAppReady(window);
}

test.beforeEach(async () => {
  createGraviScanTestConfig();

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  const appRoot = path.join(__dirname, '../..');
  execSync('npx prisma db push --skip-generate', {
    cwd: appRoot,
    env: { ...process.env, BLOOM_DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
  });

  prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
  await launchElectronApp();
});

test.afterEach(async () => {
  await prisma.$disconnect();
  await closeElectronApp(electronApp);
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
  cleanupGraviScanTestConfig();
});

async function seedExperimentWithMetadata() {
  const phenotyper = await prisma.phenotyper.create({
    data: { name: 'E2E Phenotyper', email: `e2e-t5-${Date.now()}@salk.edu` },
  });
  const scientist = await prisma.scientist.create({
    data: { name: 'E2E Scientist', email: `e2e-t5-sci-${Date.now()}@salk.edu` },
  });
  const metadataFile = await prisma.accessions.create({
    data: { name: 'e2e-batch.xlsx' },
  });
  const plateAccession = await prisma.graviPlateAccession.create({
    data: {
      metadata_file_id: metadataFile.id,
      plate_id: 'P1',
      accession: 'Col-0',
    },
  });
  await prisma.graviPlateSectionMapping.create({
    data: {
      gravi_plate_id: plateAccession.id,
      plate_section_id: 'S1',
      plant_qr: 'QR1',
    },
  });
  const experiment = await prisma.experiment.create({
    data: {
      name: 'E2E Tier5 Experiment',
      species: 'Amaranthus',
      experiment_type: 'graviscan',
      scientist_id: scientist.id,
      accession_id: metadataFile.id,
    },
  });
  const scanner = await prisma.graviScanner.create({
    data: { name: 'e2e-t5-scanner', display_name: 'E2E Scanner' },
  });
  await prisma.graviScan.create({
    data: {
      experiment_id: experiment.id,
      phenotyper_id: phenotyper.id,
      scanner_id: scanner.id,
      path: '/scans/e2e-t5.tif',
      grid_mode: '2grid',
      plate_index: '00',
      resolution: 600,
    },
  });
  return { experiment, metadataFile };
}

test.describe('BrowseGraviScans / ExperimentDetail / Metadata (Tier 5)', () => {
  test('seeded experiment renders in Browse GraviScans and links through to Experiment Detail', async () => {
    const { experiment } = await seedExperimentWithMetadata();

    await window.click('text=Browse GraviScans');
    await window.waitForSelector('text=E2E Tier5 Experiment');

    await window.click('text=View Images');
    await window.waitForSelector('h1:has-text("E2E Tier5 Experiment")');

    // Link a new wave, confirm it appears, then unlink it via the real
    // window.confirm() dialog.
    await window.fill('#new-wave-input', '1');
    await window.selectOption('#new-metadata-select', {
      label: 'e2e-batch.xlsx',
    });
    await window.click('button:has-text("Link")');
    await window.waitForSelector('text=Wave 1: e2e-batch.xlsx');

    const row = await prisma.graviExperimentWaveMetadata.findUnique({
      where: {
        experiment_id_wave_number: {
          experiment_id: experiment.id,
          wave_number: 1,
        },
      },
    });
    expect(row).not.toBeNull();

    window.once('dialog', (dialog) => dialog.accept());
    await window
      .locator(
        'li:has-text("Wave 1: e2e-batch.xlsx") button:has-text("Unlink")'
      )
      .click();

    await expect
      .poll(async () =>
        prisma.graviExperimentWaveMetadata.findUnique({
          where: {
            experiment_id_wave_number: {
              experiment_id: experiment.id,
              wave_number: 1,
            },
          },
        })
      )
      .toBeNull();
  });

  test('Metadata page lists the seeded file', async () => {
    await seedExperimentWithMetadata();

    await window.click('text=Metadata');
    await window.waitForSelector('text=e2e-batch.xlsx');
  });

  test('"Metadata" and "Browse GraviScans" workflow steps/nav resolve to the new routes, and the shared "Browse Scans" link is absent', async () => {
    await expect(
      window.locator('nav a', { hasText: 'Browse Scans' })
    ).toHaveCount(0);

    const metadataLink = window.locator('nav a', { hasText: 'Metadata' });
    await expect(metadataLink).toHaveAttribute('href', '/metadata');

    const browseLink = window.locator('nav a', {
      hasText: 'Browse GraviScans',
    });
    await expect(browseLink).toHaveAttribute('href', '/browse-graviscans');

    // Home page's workflow-step cards navigate to the same routes.
    await window.click('text=Home');
    await window.click('[data-testid="workflow-step-3"]');
    await window.waitForURL(/\/metadata$/);
  });

  test('global upload-progress indicator persists across navigation from Browse GraviScans to Metadata', async () => {
    await seedExperimentWithMetadata();
    await window.click('text=Browse GraviScans');
    await window.waitForSelector('text=E2E Tier5 Experiment');

    await window.click('button:has-text("Backup to Box")');
    // rclone is not installed in the mock/CI test environment, so this
    // exercises the friendly-message path deterministically.
    await window.waitForSelector('text=Box backup unavailable');

    await window.click('text=Metadata');
    await window.waitForSelector('h1:has-text("Metadata")');
    await expect(
      window.locator('[data-testid="upload-status-indicator"]')
    ).toBeVisible();
  });
});
