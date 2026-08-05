/**
 * E2E Test: Experiments.tsx wave-scoped metadata-link UI (Tier 5, task 9.3)
 *
 * Covers the real IPC round-trip for Experiments.tsx's graviscan "attach"
 * panel branch — what tests/unit/pages/Experiments.test.tsx's mocked-IPC
 * tests cannot: the real handler wiring persisting to a real database.
 *
 * Not added to tests/e2e/experiments-management.e2e.ts directly: that
 * file's file-level `test.beforeEach`/`afterEach` hardcode
 * `SCANNER_MODE=cylinderscan` via `createTestBloomConfig()`, shared across
 * every describe block in the file — there is no per-describe override
 * point to run a graviscan-mode test alongside it without either editing
 * shared hooks (risking the file's existing passing cylinderscan tests) or
 * launching a second, conflicting Electron instance. A separate file with
 * its own graviscan-mode setup (matching graviscan-ipc.e2e.ts's existing
 * pattern) avoids both risks.
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

const TEST_DB_PATH = path.join(__dirname, 'graviscan-experiments-wave-test.db');
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
SCANS_DIR=${path.join(BLOOM_DIR, 'e2e-wave-scans')}
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

test.describe('Experiments.tsx — graviscan attach panel real IPC round-trip', () => {
  test('linking then unlinking a wave via the attach panel persists to the database', async () => {
    const scientist = await prisma.scientist.create({
      data: { name: 'E2E Scientist', email: `e2e-wave-${Date.now()}@salk.edu` },
    });
    const metadataFile = await prisma.accessions.create({
      data: { name: 'wave-e2e.xlsx' },
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
        name: 'E2E Wave Experiment',
        species: 'Amaranthus',
        experiment_type: 'graviscan',
        scientist_id: scientist.id,
        accession_id: metadataFile.id,
      },
    });

    await window.click('text=Experiments');
    await window.waitForSelector('text=E2E Wave Experiment');

    await window.selectOption('#attach-experiment-select', {
      label: new RegExp('E2E Wave Experiment').source,
    });
    await window.fill('#wave-number-attach-input', '2');
    await window.selectOption('#attach-gravi-accession-select', {
      label: 'wave-e2e.xlsx',
    });
    await window.click('button:has-text("Link")');

    await expect
      .poll(async () =>
        prisma.graviExperimentWaveMetadata.findUnique({
          where: {
            experiment_id_wave_number: {
              experiment_id: experiment.id,
              wave_number: 2,
            },
          },
        })
      )
      .not.toBeNull();

    window.once('dialog', (dialog) => dialog.accept());
    await window
      .locator('li:has-text("Wave 2: wave-e2e.xlsx") button:has-text("Unlink")')
      .click();

    await expect
      .poll(async () =>
        prisma.graviExperimentWaveMetadata.findUnique({
          where: {
            experiment_id_wave_number: {
              experiment_id: experiment.id,
              wave_number: 2,
            },
          },
        })
      )
      .toBeNull();
  });
});
