/**
 * E2E Test: Renderer GraviScan Database IPC
 *
 * Tests the complete renderer → IPC → main → database path for all GraviScan
 * database operations. Covers: graviscans, graviscan sessions, gravi images,
 * plate assignments, plate accessions, and accession mapping updates.
 *
 * **PREREQUISITES:**
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e` (in Terminal 2)
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
import { execSync } from 'child_process';
import { closeElectronApp } from './helpers/electron-cleanup';
import {
  createTestBloomConfig,
  cleanupTestBloomConfig,
} from './helpers/bloom-config';
import type { ElectronAPI } from '../../src/types/electron';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

interface WindowWithElectron extends Window {
  electron: ElectronAPI;
}

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

const TEST_DB_PATH = path.join(__dirname, 'renderer-graviscan-ipc-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Shared seed data IDs
let scientistId: string;
let phenotyperId: string;
let experimentId: string;
let scannerId: string;

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
}

/**
 * Seed base data needed by most GraviScan tests.
 */
async function seedBaseData() {
  const scientist = await prisma.scientist.create({
    data: { name: 'GraviScan Scientist', email: 'gravi-scientist@test.com' },
  });
  scientistId = scientist.id;

  const phenotyper = await prisma.phenotyper.create({
    data: { name: 'GraviScan Phenotyper', email: 'gravi-phenotyper@test.com' },
  });
  phenotyperId = phenotyper.id;

  const experiment = await prisma.experiment.create({
    data: {
      name: 'GraviScan Test Experiment',
      species: 'Arabidopsis',
      scientist_id: scientistId,
      experiment_type: 'graviscan',
    },
  });
  experimentId = experiment.id;

  const scanner = await prisma.graviScanner.create({
    data: {
      name: 'test-scanner-001',
      enabled: true,
      vendor_id: '04b8',
      product_id: '013a',
    },
  });
  scannerId = scanner.id;
}

test.beforeEach(async () => {
  createTestBloomConfig();

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  prisma = new PrismaClient({
    datasources: { db: { url: TEST_DB_URL } },
  });
  await prisma.$connect();

  const appRoot = path.join(__dirname, '../..');
  execSync('npx prisma db push --skip-generate', {
    cwd: appRoot,
    env: { ...process.env, BLOOM_DATABASE_URL: TEST_DB_URL },
    stdio: 'pipe',
  });

  await seedBaseData();
  await launchElectronApp();
});

test.afterEach(async () => {
  if (prisma) await prisma.$disconnect();
  await closeElectronApp(electronApp);
  if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  cleanupTestBloomConfig();
});

// =============================================================================
// GraviScans
// =============================================================================

test.describe('Renderer GraviScan IPC - GraviScans', () => {
  test('should create a graviscan', async () => {
    const result = await window.evaluate(
      ([expId, phenId, scanId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviscans.create({
          experiment_id: expId,
          phenotyper_id: phenId,
          scanner_id: scanId,
          path: '/test/scan/output',
          grid_mode: '2grid',
          plate_index: '00',
          resolution: 1200,
        });
      },
      [experimentId, phenotyperId, scannerId]
    );

    expect(result.success).toBe(true);
    expect(result.data.id).toBeDefined();
    expect(result.data.experiment_id).toBe(experimentId);
    expect(result.data.grid_mode).toBe('2grid');
  });

  test('should get max wave number for experiment', async () => {
    // Seed scans with different wave numbers
    await prisma.graviScan.createMany({
      data: [
        {
          experiment_id: experimentId,
          phenotyper_id: phenotyperId,
          scanner_id: scannerId,
          path: '/scan/1',
          grid_mode: '2grid',
          plate_index: '00',
          resolution: 1200,
          wave_number: 1,
        },
        {
          experiment_id: experimentId,
          phenotyper_id: phenotyperId,
          scanner_id: scannerId,
          path: '/scan/2',
          grid_mode: '2grid',
          plate_index: '00',
          resolution: 1200,
          wave_number: 3,
        },
      ],
    });

    const result = await window.evaluate(
      ([expId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviscans.getMaxWaveNumber(expId);
      },
      [experimentId]
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe(3);
  });

  test('should check barcode unique in wave', async () => {
    // Seed a scan with a barcode
    await prisma.graviScan.create({
      data: {
        experiment_id: experimentId,
        phenotyper_id: phenotyperId,
        scanner_id: scannerId,
        path: '/scan/barcode-test',
        grid_mode: '2grid',
        plate_index: '00',
        resolution: 1200,
        wave_number: 1,
        plate_barcode: 'Plate_1',
      },
    });

    // Check duplicate
    const duplicateResult = await window.evaluate(
      ([expId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviscans.checkBarcodeUniqueInWave({
          experiment_id: expId,
          wave_number: 1,
          plate_barcode: 'Plate_1',
        });
      },
      [experimentId]
    );

    expect(duplicateResult.success).toBe(true);
    expect(duplicateResult.data.isDuplicate).toBe(true);

    // Check unique
    const uniqueResult = await window.evaluate(
      ([expId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviscans.checkBarcodeUniqueInWave({
          experiment_id: expId,
          wave_number: 1,
          plate_barcode: 'Plate_999',
        });
      },
      [experimentId]
    );

    expect(uniqueResult.success).toBe(true);
    expect(uniqueResult.data.isDuplicate).toBe(false);
  });

  test('should update grid timestamps', async () => {
    const scan = await prisma.graviScan.create({
      data: {
        experiment_id: experimentId,
        phenotyper_id: phenotyperId,
        scanner_id: scannerId,
        path: '/scan/timestamps',
        grid_mode: '2grid',
        plate_index: '00',
        resolution: 1200,
      },
    });

    const startedAt = '2026-03-18T18:43:17.000Z';
    const endedAt = '2026-03-18T18:44:51.000Z';

    const result = await window.evaluate(
      ([scanId, start, end]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviscans.updateGridTimestamps({
          ids: [scanId],
          scan_started_at: start,
          scan_ended_at: end,
        });
      },
      [scan.id, startedAt, endedAt]
    );

    expect(result.success).toBe(true);
    expect(result.data.count).toBe(1);

    const updated = await prisma.graviScan.findUnique({
      where: { id: scan.id },
    });
    expect(updated?.scan_started_at).toBeDefined();
    expect(updated?.scan_ended_at).toBeDefined();
  });

  test('should browse experiments with graviscans', async () => {
    // Seed a scan so the experiment shows up
    await prisma.graviScan.create({
      data: {
        experiment_id: experimentId,
        phenotyper_id: phenotyperId,
        scanner_id: scannerId,
        path: '/scan/browse',
        grid_mode: '2grid',
        plate_index: '00',
        resolution: 1200,
        wave_number: 1,
      },
    });

    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.graviscans.browseByExperiment({
        offset: 0,
        limit: 10,
      });
    });

    expect(result.success).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    expect(result.data[0].name).toBe('GraviScan Test Experiment');
  });

  // Covers: 'db:graviscans:experiment-detail'
  test('should get experiment detail with scans', async () => {
    await prisma.graviScan.create({
      data: {
        experiment_id: experimentId,
        phenotyper_id: phenotyperId,
        scanner_id: scannerId,
        path: '/scan/detail',
        grid_mode: '4grid',
        plate_index: '01',
        resolution: 1200,
        wave_number: 2,
      },
    });

    const result = await window.evaluate(
      ([expId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviscans.getExperimentDetail(expId);
      },
      [experimentId]
    );

    expect(result.success).toBe(true);
    expect(result.data.id).toBe(experimentId);
    expect(result.data.scans.length).toBeGreaterThanOrEqual(1);
  });
});

// =============================================================================
// GraviScan Sessions
// =============================================================================

test.describe('Renderer GraviScan IPC - Sessions', () => {
  test('should create a graviscan session', async () => {
    const result = await window.evaluate(
      ([expId, phenId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviscanSessions.create({
          experiment_id: expId,
          phenotyper_id: phenId,
          scan_mode: 'continuous',
          interval_seconds: 300,
          total_cycles: 10,
        });
      },
      [experimentId, phenotyperId]
    );

    expect(result.success).toBe(true);
    expect(result.data.id).toBeDefined();
    expect(result.data.scan_mode).toBe('continuous');
  });

  test('should complete a graviscan session', async () => {
    const session = await prisma.graviScanSession.create({
      data: {
        experiment_id: experimentId,
        phenotyper_id: phenotyperId,
        scan_mode: 'one-shot',
      },
    });

    const result = await window.evaluate(
      ([sessId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviscanSessions.complete({
          session_id: sessId,
          cancelled: false,
        });
      },
      [session.id]
    );

    expect(result.success).toBe(true);
    expect(result.data.completed_at).toBeDefined();
    expect(result.data.cancelled).toBe(false);
  });
});

// =============================================================================
// GraviImages
// =============================================================================

test.describe('Renderer GraviScan IPC - GraviImages', () => {
  test('should create a gravi image', async () => {
    const scan = await prisma.graviScan.create({
      data: {
        experiment_id: experimentId,
        phenotyper_id: phenotyperId,
        scanner_id: scannerId,
        path: '/scan/for-image',
        grid_mode: '2grid',
        plate_index: '00',
        resolution: 1200,
      },
    });

    const result = await window.evaluate(
      ([scanId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviimages.create({
          graviscan_id: scanId,
          path: '/images/test_image.tif',
        });
      },
      [scan.id]
    );

    expect(result.success).toBe(true);
    expect(result.data.id).toBeDefined();
    expect(result.data.status).toBe('pending');
    expect(result.data.path).toBe('/images/test_image.tif');
  });
});

// =============================================================================
// GraviScan Plate Assignments
// =============================================================================

test.describe('Renderer GraviScan IPC - Plate Assignments', () => {
  test('should list plate assignments (empty)', async () => {
    const result = await window.evaluate(
      ([expId, scanId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviscanPlateAssignments.list(expId, scanId);
      },
      [experimentId, scannerId]
    );

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  test('should upsert a plate assignment', async () => {
    const result = await window.evaluate(
      ([expId, scanId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviscanPlateAssignments.upsert(
          expId,
          scanId,
          '00',
          {
            plate_barcode: 'Plate_1',
            selected: true,
          }
        );
      },
      [experimentId, scannerId]
    );

    expect(result.success).toBe(true);
    expect(result.data.plate_index).toBe('00');
    expect(result.data.plate_barcode).toBe('Plate_1');

    // Verify in DB
    const assignment = await prisma.graviScanPlateAssignment.findFirst({
      where: {
        experiment_id: experimentId,
        scanner_id: scannerId,
        plate_index: '00',
      },
    });
    expect(assignment?.plate_barcode).toBe('Plate_1');
  });

  test('should upsert many plate assignments', async () => {
    const result = await window.evaluate(
      ([expId, scanId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviscanPlateAssignments.upsertMany(
          expId,
          scanId,
          [
            { plate_index: '00', plate_barcode: 'Plate_1', selected: true },
            { plate_index: '01', plate_barcode: 'Plate_2', selected: true },
            { plate_index: '10', plate_barcode: 'Plate_3', selected: false },
          ]
        );
      },
      [experimentId, scannerId]
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);

    const count = await prisma.graviScanPlateAssignment.count({
      where: { experiment_id: experimentId, scanner_id: scannerId },
    });
    expect(count).toBe(3);
  });
});

// =============================================================================
// GraviPlate Accessions
// =============================================================================

test.describe('Renderer GraviScan IPC - Plate Accessions', () => {
  test('should create metadata file with sections', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.graviPlateAccessions.createWithSections(
        { name: 'Test Metadata File' },
        [
          {
            plate_id: 'Plate_1',
            accession: 'COL-0',
            sections: [
              {
                plate_section_id: 'S1',
                plant_qr: 'QR-001',
                medium: 'MS',
              },
              {
                plate_section_id: 'S2',
                plant_qr: 'QR-002',
              },
            ],
          },
          {
            plate_id: 'Plate_2',
            accession: 'WS-2',
            sections: [
              {
                plate_section_id: 'S1',
                plant_qr: 'QR-003',
              },
            ],
          },
        ]
      );
    });

    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Test Metadata File');
    expect(result.data.totalPlates).toBe(2);
    expect(result.data.totalSections).toBe(3);
  });

  test('should list plates for a metadata file', async () => {
    // Create via Prisma
    const accession = await prisma.accessions.create({
      data: { name: 'List Test File' },
    });
    await prisma.graviPlateAccession.create({
      data: {
        metadata_file_id: accession.id,
        plate_id: 'Plate_A',
        accession: 'COL-0',
        sections: {
          create: [
            {
              plate_section_id: 'S1',
              plant_qr: 'QR-100',
            },
          ],
        },
      },
    });

    const result = await window.evaluate(
      ([accId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviPlateAccessions.list(accId);
      },
      [accession.id]
    );

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].plate_id).toBe('Plate_A');
    expect(result.data[0].sections).toHaveLength(1);
  });

  test('should list all metadata files', async () => {
    // Create a metadata file with a plate
    await prisma.accessions.create({
      data: {
        name: 'ListFiles Test',
        graviPlateAccessions: {
          create: {
            plate_id: 'Plate_X',
            accession: 'WS-2',
          },
        },
      },
    });

    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.graviPlateAccessions.listFiles();
    });

    expect(result.success).toBe(true);
    expect(result.data.length).toBeGreaterThanOrEqual(1);
    expect(result.data[0].name).toBeDefined();
  });

  test('should delete metadata file with cascade', async () => {
    const accession = await prisma.accessions.create({
      data: {
        name: 'Delete Test File',
        graviPlateAccessions: {
          create: {
            plate_id: 'Plate_Del',
            accession: 'COL-0',
            sections: {
              create: {
                plate_section_id: 'S1',
                plant_qr: 'QR-DEL',
              },
            },
          },
        },
      },
    });

    const result = await window.evaluate(
      ([accId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.graviPlateAccessions.delete(accId);
      },
      [accession.id]
    );

    expect(result.success).toBe(true);

    // Verify cascade
    const plates = await prisma.graviPlateAccession.findMany({
      where: { metadata_file_id: accession.id },
    });
    expect(plates).toHaveLength(0);
  });
});

// =============================================================================
// Accessions - updateMapping
// =============================================================================

test.describe('Renderer GraviScan IPC - Accession Mapping', () => {
  test('should update an accession mapping', async () => {
    const accession = await prisma.accessions.create({
      data: {
        name: 'Mapping Test File',
        mappings: {
          create: {
            plant_barcode: 'PLANT-001',
            accession_name: 'OLD_NAME',
          },
        },
      },
      include: { mappings: true },
    });

    const mappingId = accession.mappings[0].id;

    const result = await window.evaluate(
      ([mapId]) => {
        return (
          window as unknown as WindowWithElectron
        ).electron.database.accessions.updateMapping(mapId, {
          accession_name: 'NEW_NAME',
        });
      },
      [mappingId]
    );

    expect(result.success).toBe(true);

    const updated = await prisma.plantAccessionMappings.findUnique({
      where: { id: mappingId },
    });
    expect(updated?.accession_name).toBe('NEW_NAME');
  });
});
