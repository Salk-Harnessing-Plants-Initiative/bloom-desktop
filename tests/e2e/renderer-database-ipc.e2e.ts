/**
 * E2E Test: Renderer Database IPC
 *
 * Tests the complete renderer → IPC → main → database path for all database
 * operations. These tests validate the IPC bridge works correctly, ensuring
 * context isolation and error handling work as expected.
 *
 * **PREREQUISITES:**
 * 1. Start Electron Forge dev server: `npm run start` (keep running in Terminal 1)
 * 2. Run E2E tests: `npm run test:e2e` (in Terminal 2)
 *
 * The Electron app loads the renderer from Electron Forge's dev server on port 9000.
 * The dev server MUST be running or the Electron window will be blank.
 *
 * **Test Focus:**
 * - IPC bridge validation (not UI workflows)
 * - Uses window.evaluate() to call IPC handlers directly from renderer
 * - Tests all database models: Scientists, Phenotypers, Accessions, Experiments, Scans
 * - Validates context isolation (renderer cannot access Node.js APIs)
 * - Verifies error handling in IPC communication
 *
 * **Comparison with UI E2E Tests:**
 * - This test: Calls IPC directly via window.evaluate(), validates data layer
 * - UI E2E tests: Clicks buttons, fills forms, validates user workflows
 * - Both require dev server, both use Playwright with Electron
 *
 * For reference on full E2E tests with UI interactions, see the pilot's
 * create-experiments.e2e.ts which tests complete user workflows.
 *
 * Related: Issue #58, openspec/changes/renderer-database-ipc-testing/
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

// Import electron path
// eslint-disable-next-line @typescript-eslint/no-require-imports
const electronPath: string = require('electron');

// Type definition for window object with electron API
interface WindowWithElectron extends Window {
  electron: ElectronAPI;
}

let electronApp: ElectronApplication;
let window: Page;
let prisma: PrismaClient;

// Test database path for renderer IPC tests
const TEST_DB_PATH = path.join(__dirname, 'renderer-ipc-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

/**
 * Helper: Launch Electron app with test database
 */
async function launchElectronApp() {
  const appRoot = path.join(__dirname, '../..');

  // Build args for Electron
  const args = [path.join(appRoot, '.webpack/main/index.js')];
  if (process.platform === 'linux' && process.env.CI === 'true') {
    args.push('--no-sandbox');
  }

  // Launch Electron with test database URL
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

  // Get the main window
  const windows = await electronApp.windows();
  window = windows.find((w) => w.url().includes('localhost')) || windows[0];

  // Wait for window to be ready
  await window.waitForLoadState('domcontentloaded', { timeout: 30000 });
}

/**
 * Test setup: Create fresh database and launch app
 */
test.beforeEach(async () => {
  // Create minimal ~/.bloom/.env to prevent Machine Config redirect
  createTestBloomConfig();

  // Clean up any existing test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  // Create Prisma client for direct database access
  prisma = new PrismaClient({
    datasources: {
      db: {
        url: TEST_DB_URL,
      },
    },
  });

  // Connect to database
  await prisma.$connect();

  // Create the test database file and apply schema
  const appRoot = path.join(__dirname, '../..');
  execSync('npx prisma db push --skip-generate', {
    cwd: appRoot,
    env: {
      ...process.env,
      BLOOM_DATABASE_URL: TEST_DB_URL,
    },
    stdio: 'pipe',
  });

  // Launch Electron app
  await launchElectronApp();
});

/**
 * Test teardown: Clean up resources
 */
test.afterEach(async () => {
  // Disconnect from database
  if (prisma) {
    await prisma.$disconnect();
  }

  // Close Electron app and wait for process to fully terminate
  await closeElectronApp(electronApp);

  // Clean up test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  // Clean up test ~/.bloom/.env (restores original if there was one)
  cleanupTestBloomConfig();
});

test.describe('Renderer Database IPC - Scientists', () => {
  test('should list scientists from renderer (empty state)', async () => {
    const result = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.database.scientists.list();
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  test('should list scientists from renderer (with seeded data)', async () => {
    // Seed data via Prisma
    await prisma.scientist.create({
      data: {
        name: 'Test Scientist',
        email: 'scientist@test.com',
      },
    });

    const result = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.database.scientists.list();
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Test Scientist');
    expect(result.data[0].email).toBe('scientist@test.com');
  });

  test('should create scientist from renderer', async () => {
    const result = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.database.scientists.create(
        {
          name: 'New Scientist',
          email: 'new@test.com',
        }
      );
    });

    expect(result.success).toBe(true);
    expect(result.data.name).toBe('New Scientist');
    expect(result.data.email).toBe('new@test.com');

    // Verify in database
    const scientist = await prisma.scientist.findFirst({
      where: { email: 'new@test.com' },
    });
    expect(scientist).toBeDefined();
    expect(scientist?.name).toBe('New Scientist');
  });

  test('should handle error when creating scientist with missing email', async () => {
    const result = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.database.scientists.create(
        {
          name: 'Invalid Scientist',
          // Missing required email field
        } as { name: string }
      );
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('email');
  });
});

test.describe('Renderer Database IPC - Phenotypers', () => {
  test('should list phenotypers from renderer (empty state)', async () => {
    const result = await window.evaluate(() => {
      return (
        window as WindowWithElectron
      ).electron.database.phenotypers.list();
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  test('should list phenotypers from renderer (with seeded data)', async () => {
    // Seed data via Prisma
    await prisma.phenotyper.create({
      data: {
        name: 'Test Phenotyper',
        email: 'phenotyper@test.com',
      },
    });

    const result = await window.evaluate(() => {
      return (
        window as WindowWithElectron
      ).electron.database.phenotypers.list();
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Test Phenotyper');
    expect(result.data[0].email).toBe('phenotyper@test.com');
  });

  test('should create phenotyper from renderer', async () => {
    const result = await window.evaluate(() => {
      return (
        window as WindowWithElectron
      ).electron.database.phenotypers.create({
        name: 'New Phenotyper',
        email: 'newpheno@test.com',
      });
    });

    expect(result.success).toBe(true);
    expect(result.data.name).toBe('New Phenotyper');
    expect(result.data.email).toBe('newpheno@test.com');

    // Verify in database
    const phenotyper = await prisma.phenotyper.findFirst({
      where: { email: 'newpheno@test.com' },
    });
    expect(phenotyper).toBeDefined();
    expect(phenotyper?.name).toBe('New Phenotyper');
  });

  test('should handle error when creating phenotyper with missing email', async () => {
    const result = await window.evaluate(() => {
      return (
        window as WindowWithElectron
      ).electron.database.phenotypers.create({
        name: 'Invalid Phenotyper',
        // Missing required email field
      } as { name: string });
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('email');
  });
});

test.describe('Renderer Database IPC - Accessions', () => {
  test('should list accessions from renderer (empty state)', async () => {
    const result = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.database.accessions.list();
    });

    expect(result.success).toBe(true);
    expect(result.data).toEqual([]);
  });

  test('should list accessions from renderer (with seeded data)', async () => {
    // Seed data via Prisma
    await prisma.accessions.create({
      data: {
        name: 'Test Accession',
      },
    });

    const result = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.database.accessions.list();
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Test Accession');
  });

  test('should create accession from renderer', async () => {
    const result = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.database.accessions.create(
        {
          name: 'New Accession',
        }
      );
    });

    expect(result.success).toBe(true);
    expect(result.data.name).toBe('New Accession');

    // Verify in database
    const accession = await prisma.accessions.findFirst({
      where: { name: 'New Accession' },
    });
    expect(accession).toBeDefined();
  });

  test('should handle error when creating accession with missing required field', async () => {
    const result = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.database.accessions.create(
        {
          // Missing required name field
        } as Record<string, never>
      );
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should update accession from renderer', async () => {
    // Create accession first
    const accession = await prisma.accessions.create({
      data: {
        name: 'Original Name',
      },
    });

    const result = await window.evaluate((id) => {
      return (window as WindowWithElectron).electron.database.accessions.update(
        id,
        {
          name: 'Updated Name',
        }
      );
    }, accession.id);

    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Updated Name');

    // Verify in database
    const updated = await prisma.accessions.findUnique({
      where: { id: accession.id },
    });
    expect(updated?.name).toBe('Updated Name');
  });

  test('should delete accession from renderer', async () => {
    // Create accession first
    const accession = await prisma.accessions.create({
      data: {
        name: 'To Delete',
      },
    });

    const result = await window.evaluate((id) => {
      return (window as WindowWithElectron).electron.database.accessions.delete(
        id
      );
    }, accession.id);

    expect(result.success).toBe(true);

    // Verify deletion in database
    const deleted = await prisma.accessions.findUnique({
      where: { id: accession.id },
    });
    expect(deleted).toBeNull();
  });

  test('should create accession with mappings from renderer', async () => {
    const result = await window.evaluate(() => {
      return (
        window as WindowWithElectron
      ).electron.database.accessions.createWithMappings(
        { name: 'Accession with Mappings' },
        [
          {
            plant_barcode: 'PLANT001',
            accession_name: 'GENOTYPE_A',
          },
          {
            plant_barcode: 'PLANT002',
            accession_name: 'GENOTYPE_B',
          },
        ]
      );
    });

    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Accession with Mappings');
    expect(result.data.mappingCount).toBe(2);

    // Verify in database
    const accession = await prisma.accessions.findFirst({
      where: { name: 'Accession with Mappings' },
      include: { mappings: true },
    });
    expect(accession).toBeDefined();
    expect(accession?.mappings).toHaveLength(2);
  });

  test('should get mappings for accession from renderer', async () => {
    // Create accession with mappings
    const accession = await prisma.accessions.create({
      data: {
        name: 'Test Accession',
        mappings: {
          create: [
            {
              plant_barcode: 'PLANT001',
              accession_name: 'GENOTYPE_A',
            },
            {
              plant_barcode: 'PLANT002',
              accession_name: 'GENOTYPE_B',
            },
          ],
        },
      },
    });

    const result = await window.evaluate((id) => {
      return (
        window as WindowWithElectron
      ).electron.database.accessions.getMappings(id);
    }, accession.id);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
    expect(result.data[0].plant_barcode).toBe('PLANT001');
    expect(result.data[1].plant_barcode).toBe('PLANT002');
  });

  test('should get plant barcodes for accession from renderer', async () => {
    // Create accession with mappings
    const accession = await prisma.accessions.create({
      data: {
        name: 'Barcode Test Accession',
        mappings: {
          create: [
            {
              plant_barcode: 'PLANT_A_01',
              accession_name: 'GENO_A',
            },
            {
              plant_barcode: 'PLANT_B_02',
              accession_name: 'GENO_B',
            },
            {
              plant_barcode: 'PLANT_C_03',
              accession_name: 'GENO_C',
            },
          ],
        },
      },
    });

    const result = await window.evaluate((id) => {
      return (
        window as WindowWithElectron
      ).electron.database.accessions.getPlantBarcodes(id);
    }, accession.id);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(3);
    expect(result.data).toContain('PLANT_A_01');
    expect(result.data).toContain('PLANT_B_02');
    expect(result.data).toContain('PLANT_C_03');
  });

  test('should get accession name by barcode from renderer', async () => {
    // Seed scientist
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Genotype Scientist',
        email: 'genosci@test.com',
      },
    });

    // Create accession with mappings
    const accession = await prisma.accessions.create({
      data: {
        name: 'Genotype Lookup Accession',
        mappings: {
          create: [
            {
              plant_barcode: 'PLANT_X_01',
              accession_name: 'GENOTYPE_X',
            },
            {
              plant_barcode: 'PLANT_Y_02',
              accession_name: 'GENOTYPE_Y',
            },
          ],
        },
      },
    });

    // Create experiment linked to the accession
    const experiment = await prisma.experiment.create({
      data: {
        name: 'Genotype Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
        accession_id: accession.id,
      },
    });

    const result = await window.evaluate(
      ({ barcode, expId }) => {
        return (
          window as WindowWithElectron
        ).electron.database.accessions.getAccessionNameByBarcode(
          barcode,
          expId
        );
      },
      { barcode: 'PLANT_X_01', expId: experiment.id }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBe('GENOTYPE_X');
  });

  test('should return null when barcode not found in accession', async () => {
    // Seed scientist
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Not Found Scientist',
        email: 'notfound@test.com',
      },
    });

    // Create accession with mappings
    const accession = await prisma.accessions.create({
      data: {
        name: 'Not Found Accession',
        mappings: {
          create: [
            {
              plant_barcode: 'PLANT_VALID',
              accession_name: 'GENO_VALID',
            },
          ],
        },
      },
    });

    // Create experiment linked to accession
    const experiment = await prisma.experiment.create({
      data: {
        name: 'Not Found Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
        accession_id: accession.id,
      },
    });

    const result = await window.evaluate(
      ({ barcode, expId }) => {
        return (
          window as WindowWithElectron
        ).electron.database.accessions.getAccessionNameByBarcode(
          barcode,
          expId
        );
      },
      { barcode: 'PLANT_INVALID', expId: experiment.id }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });
});

test.describe('Renderer Database IPC - Experiments (with Relations)', () => {
  test('should list experiments with relations from renderer', async () => {
    // Seed scientist and accession
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Experiment Scientist',
        email: 'expscientist@test.com',
      },
    });

    const accession = await prisma.accessions.create({
      data: {
        name: 'Experiment Accession',
      },
    });

    // Create experiment
    await prisma.experiment.create({
      data: {
        name: 'Test Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
        accession_id: accession.id,
      },
    });

    const result = await window.evaluate(() => {
      return (
        window as WindowWithElectron
      ).electron.database.experiments.list();
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Test Experiment');
    expect(result.data[0].scientist).toBeDefined();
    expect(result.data[0].scientist.name).toBe('Experiment Scientist');
    expect(result.data[0].accession).toBeDefined();
    expect(result.data[0].accession.name).toBe('Experiment Accession');
  });

  test('should get experiment by ID with relations from renderer', async () => {
    // Seed data
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Get Scientist',
        email: 'getscientist@test.com',
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Get Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    const result = await window.evaluate((expId) => {
      return (window as WindowWithElectron).electron.database.experiments.get(
        expId
      );
    }, experiment.id);

    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Get Experiment');
    expect(result.data.scientist).toBeDefined();
    expect(result.data.scientist.name).toBe('Get Scientist');
  });

  test('should create experiment from renderer', async () => {
    // Seed scientist
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Create Scientist',
        email: 'createscientist@test.com',
      },
    });

    const result = await window.evaluate((scientistId) => {
      return (
        window as WindowWithElectron
      ).electron.database.experiments.create({
        name: 'New Experiment',
        species: 'Arabidopsis thaliana',
        scientist: {
          connect: { id: scientistId },
        },
      });
    }, scientist.id);

    expect(result.success).toBe(true);
    expect(result.data.name).toBe('New Experiment');
    expect(result.data.species).toBe('Arabidopsis thaliana');

    // Verify in database
    const experiment = await prisma.experiment.findFirst({
      where: { name: 'New Experiment' },
    });
    expect(experiment).toBeDefined();
    expect(experiment?.scientist_id).toBe(scientist.id);
  });

  test('should update experiment from renderer', async () => {
    // Seed scientist and experiment
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Update Scientist',
        email: 'updatescientist@test.com',
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Original Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    const result = await window.evaluate((expId) => {
      return (
        window as WindowWithElectron
      ).electron.database.experiments.update(expId, {
        name: 'Updated Experiment',
        species: 'Sorghum bicolor',
      });
    }, experiment.id);

    expect(result.success).toBe(true);
    expect(result.data.name).toBe('Updated Experiment');
    expect(result.data.species).toBe('Sorghum bicolor');

    // Verify in database
    const updated = await prisma.experiment.findUnique({
      where: { id: experiment.id },
    });
    expect(updated?.name).toBe('Updated Experiment');
    expect(updated?.species).toBe('Sorghum bicolor');
  });

  test('should delete experiment from renderer', async () => {
    // Seed scientist and experiment
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Delete Scientist',
        email: 'deletescientist@test.com',
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Experiment To Delete',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    const result = await window.evaluate((expId) => {
      return (
        window as WindowWithElectron
      ).electron.database.experiments.delete(expId);
    }, experiment.id);

    expect(result.success).toBe(true);

    // Verify deleted from database
    const deleted = await prisma.experiment.findUnique({
      where: { id: experiment.id },
    });
    expect(deleted).toBeNull();
  });

  test('should handle error when updating experiment with invalid ID', async () => {
    const result = await window.evaluate(() => {
      return (
        window as WindowWithElectron
      ).electron.database.experiments.update('invalid-uuid', {
        name: 'Updated Name',
      });
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should handle error when deleting experiment with invalid ID', async () => {
    const result = await window.evaluate(() => {
      return (
        window as WindowWithElectron
      ).electron.database.experiments.delete('invalid-uuid');
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should handle error when creating experiment with invalid foreign key', async () => {
    const result = await window.evaluate(() => {
      return (
        window as WindowWithElectron
      ).electron.database.experiments.create({
        name: 'Invalid Experiment',
        species: 'Test species',
        scientist: {
          connect: { id: 'invalid-uuid' },
        },
      });
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should attach accession to experiment from renderer', async () => {
    // Seed scientist
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Attach Scientist',
        email: 'attachsci@test.com',
      },
    });

    // Create experiment without accession
    const experiment = await prisma.experiment.create({
      data: {
        name: 'Experiment Without Accession',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    // Create accession to attach
    const accession = await prisma.accessions.create({
      data: {
        name: 'Accession To Attach',
      },
    });

    // Attach accession to experiment via IPC
    const result = await window.evaluate(
      ({ expId, accId }) => {
        return (
          window as WindowWithElectron
        ).electron.database.experiments.attachAccession(expId, accId);
      },
      { expId: experiment.id, accId: accession.id }
    );

    expect(result.success).toBe(true);
    expect(result.data.accession).toBeDefined();
    expect(result.data.accession.name).toBe('Accession To Attach');

    // Verify in database
    const updated = await prisma.experiment.findUnique({
      where: { id: experiment.id },
      include: { accession: true },
    });
    expect(updated?.accession_id).toBe(accession.id);
    expect(updated?.accession?.name).toBe('Accession To Attach');
  });

  test('should handle error when attaching accession with invalid experiment ID', async () => {
    // Create accession
    const accession = await prisma.accessions.create({
      data: {
        name: 'Valid Accession',
      },
    });

    const result = await window.evaluate((accId) => {
      return (
        window as WindowWithElectron
      ).electron.database.experiments.attachAccession('invalid-uuid', accId);
    }, accession.id);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

test.describe('Renderer Database IPC - Scans (with Filters)', () => {
  test('should list scans without filters from renderer', async () => {
    // Seed scientist, experiment, and phenotyper
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Scan Scientist',
        email: 'scansci@test.com',
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Scan Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    const phenotyper = await prisma.phenotyper.create({
      data: {
        name: 'Scan Phenotyper',
        email: 'scanpheno@test.com',
      },
    });

    // Create scans with all required fields
    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-001',
        path: '/test/scans/PLANT-001',
        capture_date: new Date('2025-01-15'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
      },
    });

    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-002',
        path: '/test/scans/PLANT-002',
        capture_date: new Date('2025-01-16'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
      },
    });

    const result = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.database.scans.list();
    });

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(2);
  });

  test('should list scans with phenotyper filter from renderer', async () => {
    // Seed scientist and experiment
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Filter Scientist',
        email: 'filtersci@test.com',
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Filter Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    // Seed two phenotypers
    const phenotyper1 = await prisma.phenotyper.create({
      data: {
        name: 'Phenotyper 1',
        email: 'pheno1@test.com',
      },
    });

    const phenotyper2 = await prisma.phenotyper.create({
      data: {
        name: 'Phenotyper 2',
        email: 'pheno2@test.com',
      },
    });

    // Create scans for each phenotyper with all required fields
    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper1.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-101',
        path: '/test/scans/PLANT-101',
        capture_date: new Date('2025-01-15'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
      },
    });

    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper2.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-102',
        path: '/test/scans/PLANT-102',
        capture_date: new Date('2025-01-16'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
      },
    });

    // Filter by phenotyper1
    const result = await window.evaluate((phenoId) => {
      return (window as WindowWithElectron).electron.database.scans.list({
        phenotyper_id: phenoId,
      });
    }, phenotyper1.id);

    expect(result.success).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data[0].plant_id).toBe('PLANT-101');
  });

  test('should get scan by ID with all relations from renderer', async () => {
    // Seed phenotyper and experiment
    const phenotyper = await prisma.phenotyper.create({
      data: {
        name: 'Get Scan Phenotyper',
        email: 'getscanpheno@test.com',
      },
    });

    const scientist = await prisma.scientist.create({
      data: {
        name: 'Get Scan Scientist',
        email: 'getscansci@test.com',
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Get Scan Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    // Create scan with all required fields
    const scan = await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-999',
        path: '/test/scans/PLANT-999',
        capture_date: new Date('2025-01-20'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
      },
    });

    const result = await window.evaluate((scanId) => {
      return (window as WindowWithElectron).electron.database.scans.get(scanId);
    }, scan.id);

    expect(result.success).toBe(true);
    expect(result.data.plant_id).toBe('PLANT-999');
    expect(result.data.phenotyper).toBeDefined();
    expect(result.data.phenotyper.name).toBe('Get Scan Phenotyper');
    expect(result.data.experiment).toBeDefined();
    expect(result.data.experiment.name).toBe('Get Scan Experiment');
  });

  test('should get scan with images sorted by frame_number', async () => {
    // Seed phenotyper and experiment
    const phenotyper = await prisma.phenotyper.create({
      data: {
        name: 'Image Sort Phenotyper',
        email: 'imagesort@test.com',
      },
    });

    const scientist = await prisma.scientist.create({
      data: {
        name: 'Image Sort Scientist',
        email: 'imagesortscientist@test.com',
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Image Sort Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    // Create scan
    const scan = await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-IMAGES',
        path: '/test/scans/PLANT-IMAGES',
        capture_date: new Date('2025-01-20'),
        num_frames: 5,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
      },
    });

    // Create images in non-sequential order
    await prisma.image.createMany({
      data: [
        {
          scan_id: scan.id,
          frame_number: 3,
          path: '/test/scans/PLANT-IMAGES/frame_003.png',
          status: 'pending',
        },
        {
          scan_id: scan.id,
          frame_number: 1,
          path: '/test/scans/PLANT-IMAGES/frame_001.png',
          status: 'pending',
        },
        {
          scan_id: scan.id,
          frame_number: 5,
          path: '/test/scans/PLANT-IMAGES/frame_005.png',
          status: 'pending',
        },
        {
          scan_id: scan.id,
          frame_number: 2,
          path: '/test/scans/PLANT-IMAGES/frame_002.png',
          status: 'pending',
        },
        {
          scan_id: scan.id,
          frame_number: 4,
          path: '/test/scans/PLANT-IMAGES/frame_004.png',
          status: 'pending',
        },
      ],
    });

    const result = await window.evaluate((scanId) => {
      return (window as WindowWithElectron).electron.database.scans.get(scanId);
    }, scan.id);

    expect(result.success).toBe(true);
    expect(result.data!.images).toHaveLength(5);

    // Verify images are sorted by frame_number ascending
    const frameNumbers = result.data!.images.map(
      (img: { frame_number: number }) => img.frame_number
    );
    expect(frameNumbers).toEqual([1, 2, 3, 4, 5]);
  });

  test('should return null for non-existent scan ID', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await window.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.database.scans.get(
        'non-existent-scan-id-12345'
      );
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });

  test('should create scan from renderer', async () => {
    // Seed scientist, experiment, and phenotyper
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Create Scan Scientist',
        email: 'createscan@test.com',
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Create Scan Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    const phenotyper = await prisma.phenotyper.create({
      data: {
        name: 'Create Scan Phenotyper',
        email: 'createscanpheno@test.com',
      },
    });

    // Create scan via IPC
    const result = await window.evaluate(
      ({ expId, phenoId }) => {
        return (window as WindowWithElectron).electron.database.scans.create({
          experiment_id: expId,
          phenotyper_id: phenoId,
          scanner_name: 'TestScanner',
          plant_id: 'PLANT-CREATE-001',
          path: '/test/scans/create/PLANT-CREATE-001',
          capture_date: new Date('2025-01-25').toISOString(),
          num_frames: 36,
          exposure_time: 100,
          gain: 1.0,
          brightness: 0.5,
          contrast: 1.0,
          gamma: 1.0,
          seconds_per_rot: 10.0,
          wave_number: 1,
          plant_age_days: 14,
        });
      },
      { expId: experiment.id, phenoId: phenotyper.id }
    );

    expect(result.success).toBe(true);
    expect(result.data.plant_id).toBe('PLANT-CREATE-001');
    expect(result.data.scanner_name).toBe('TestScanner');
    expect(result.data.experiment_id).toBe(experiment.id);
    expect(result.data.phenotyper_id).toBe(phenotyper.id);

    // Verify in database
    const scan = await prisma.scan.findFirst({
      where: { plant_id: 'PLANT-CREATE-001' },
    });
    expect(scan).toBeDefined();
    expect(scan?.scanner_name).toBe('TestScanner');
    expect(scan?.experiment_id).toBe(experiment.id);
    expect(scan?.phenotyper_id).toBe(phenotyper.id);
  });

  test('should handle error when creating scan with invalid experiment_id', async () => {
    // Seed phenotyper
    const phenotyper = await prisma.phenotyper.create({
      data: {
        name: 'Error Scan Phenotyper',
        email: 'errorscanpheno@test.com',
      },
    });

    const result = await window.evaluate((phenoId) => {
      return (window as WindowWithElectron).electron.database.scans.create({
        experiment_id: 'invalid-uuid',
        phenotyper_id: phenoId,
        scanner_name: 'TestScanner',
        plant_id: 'PLANT-ERROR-001',
        path: '/test/scans/error/PLANT-ERROR-001',
        capture_date: new Date('2025-01-25').toISOString(),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
      });
    }, phenotyper.id);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  test('should get most recent scan date for plant and experiment from renderer', async () => {
    // Seed scientist and experiment
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Recent Scan Scientist',
        email: 'recentscan@test.com',
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Recent Scan Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    const phenotyper = await prisma.phenotyper.create({
      data: {
        name: 'Recent Scan Phenotyper',
        email: 'recentscanpheno@test.com',
      },
    });

    // Create 3 scans for the same plant on different dates
    const today = new Date();
    const threeDaysAgo = new Date(today);
    threeDaysAgo.setDate(today.getDate() - 3);
    const fiveDaysAgo = new Date(today);
    fiveDaysAgo.setDate(today.getDate() - 5);

    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT_RECENT_TEST',
        path: '/test/scans/scan1',
        capture_date: fiveDaysAgo,
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
      },
    });

    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT_RECENT_TEST',
        path: '/test/scans/scan2',
        capture_date: today,
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
      },
    });

    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT_RECENT_TEST',
        path: '/test/scans/scan3',
        capture_date: threeDaysAgo,
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
      },
    });

    const result = await window.evaluate(
      ({ expId, plantId }) => {
        return (
          window as WindowWithElectron
        ).electron.database.scans.getMostRecentScanDate(plantId, expId);
      },
      { expId: experiment.id, plantId: 'PLANT_RECENT_TEST' }
    );

    expect(result.success).toBe(true);
    // Should return the most recent date (today)
    const returnedDate = new Date(result.data);
    expect(returnedDate.toDateString()).toBe(today.toDateString());
  });

  test('should return null when no scans exist for plant and experiment', async () => {
    // Seed scientist and experiment
    const scientist = await prisma.scientist.create({
      data: {
        name: 'No Scan Scientist',
        email: 'noscan@test.com',
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'No Scan Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    const result = await window.evaluate(
      ({ expId, plantId }) => {
        return (
          window as WindowWithElectron
        ).electron.database.scans.getMostRecentScanDate(plantId, expId);
      },
      { expId: experiment.id, plantId: 'PLANT_NEVER_SCANNED' }
    );

    expect(result.success).toBe(true);
    expect(result.data).toBeNull();
  });
});

/**
 * TDD Tests for Paginated Scans List API
 *
 * These tests are written BEFORE the implementation exists (RED phase).
 * They will fail until Phase 1.2 implements the paginated scans.list() handler.
 *
 * The API will add new parameters to scans.list():
 * - page: number (1-indexed)
 * - pageSize: number
 * - experimentId?: string
 * - dateFrom?: string (ISO date)
 * - dateTo?: string (ISO date)
 *
 * And return a new response shape:
 * - { scans: ScanWithRelations[], total: number, page: number, pageSize: number }
 */
test.describe('Renderer Database IPC - Scans List with Pagination', () => {
  // Type for the new paginated response (will be added in Phase 1.2)
  interface PaginatedScansResponse {
    scans: Array<{
      plant_id: string;
      phenotyper: { name: string; email: string };
      experiment: { name: string; species: string };
    }>;
    total: number;
    page: number;
    pageSize: number;
  }

  // Type for new paginated list params (will be added in Phase 1.2)
  interface PaginatedListParams {
    page: number;
    pageSize: number;
    experimentId?: string;
    dateFrom?: string;
    dateTo?: string;
  }

  /**
   * Helper to create test data for pagination/filtering tests
   */
  async function createTestScanData() {
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Pagination Test Scientist',
        email: 'paginationsci@test.com',
      },
    });

    const experiment1 = await prisma.experiment.create({
      data: {
        name: 'Pagination Experiment 1',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    const experiment2 = await prisma.experiment.create({
      data: {
        name: 'Pagination Experiment 2',
        species: 'Sorghum bicolor',
        scientist_id: scientist.id,
      },
    });

    const phenotyper = await prisma.phenotyper.create({
      data: {
        name: 'Pagination Phenotyper',
        email: 'paginationpheno@test.com',
      },
    });

    return { scientist, experiment1, experiment2, phenotyper };
  }

  /**
   * Helper to call paginated list via IPC
   * Uses type assertions since the API doesn't exist yet (TDD RED phase)
   */
  async function callPaginatedList(
    params: PaginatedListParams
  ): Promise<{ success: boolean; data: PaginatedScansResponse }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await window.evaluate((p: PaginatedListParams) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.database.scans.list(p);
    }, params);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any;
  }

  /**
   * Helper to call paginated list with experimentId filter
   */
  async function callPaginatedListWithExperiment(
    params: PaginatedListParams,
    experimentId: string
  ): Promise<{ success: boolean; data: PaginatedScansResponse }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await window.evaluate(
      ({ p, expId }: { p: PaginatedListParams; expId: string }) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).electron.database.scans.list({
          ...p,
          experimentId: expId,
        });
      },
      { p: params, expId: experimentId }
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return result as any;
  }

  test('should return paginated results with page and pageSize', async () => {
    const { experiment1, phenotyper } = await createTestScanData();

    // Create 30 scans to test pagination
    for (let i = 0; i < 30; i++) {
      await prisma.scan.create({
        data: {
          experiment_id: experiment1.id,
          phenotyper_id: phenotyper.id,
          scanner_name: 'Scanner1',
          plant_id: `PLANT-PAGE-${String(i).padStart(3, '0')}`,
          path: `/test/scans/page/PLANT-PAGE-${String(i).padStart(3, '0')}`,
          capture_date: new Date(`2025-01-${String(i + 1).padStart(2, '0')}`),
          num_frames: 36,
          exposure_time: 100,
          gain: 1.0,
          brightness: 0.5,
          contrast: 1.0,
          gamma: 1.0,
          seconds_per_rot: 10.0,
          wave_number: 1,
          plant_age_days: 14,
          deleted: false,
        },
      });
    }

    // Request page 1 with 10 items per page
    const result = await callPaginatedList({ page: 1, pageSize: 10 });

    expect(result.success).toBe(true);
    expect(result.data.scans).toHaveLength(10);
    expect(result.data.total).toBe(30);
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(10);
  });

  test('should exclude soft-deleted scans (deleted: true)', async () => {
    const { experiment1, phenotyper } = await createTestScanData();

    // Create active scans
    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-ACTIVE-001',
        path: '/test/scans/active/PLANT-ACTIVE-001',
        capture_date: new Date('2025-01-15'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-ACTIVE-002',
        path: '/test/scans/active/PLANT-ACTIVE-002',
        capture_date: new Date('2025-01-16'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    // Create soft-deleted scan
    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-DELETED-001',
        path: '/test/scans/deleted/PLANT-DELETED-001',
        capture_date: new Date('2025-01-17'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: true, // Soft deleted
      },
    });

    const result = await callPaginatedList({ page: 1, pageSize: 25 });

    expect(result.success).toBe(true);
    expect(result.data.scans).toHaveLength(2);
    expect(result.data.total).toBe(2);

    // Verify deleted scan is not in results
    const plantIds = result.data.scans.map((s) => s.plant_id);
    expect(plantIds).toContain('PLANT-ACTIVE-001');
    expect(plantIds).toContain('PLANT-ACTIVE-002');
    expect(plantIds).not.toContain('PLANT-DELETED-001');
  });

  test('should filter by experimentId', async () => {
    const { experiment1, experiment2, phenotyper } = await createTestScanData();

    // Create scans for experiment1
    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-EXP1-001',
        path: '/test/scans/exp1/PLANT-EXP1-001',
        capture_date: new Date('2025-01-15'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-EXP1-002',
        path: '/test/scans/exp1/PLANT-EXP1-002',
        capture_date: new Date('2025-01-16'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    // Create scan for experiment2
    await prisma.scan.create({
      data: {
        experiment_id: experiment2.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-EXP2-001',
        path: '/test/scans/exp2/PLANT-EXP2-001',
        capture_date: new Date('2025-01-17'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    // Filter by experiment1
    const result = await callPaginatedListWithExperiment(
      { page: 1, pageSize: 25 },
      experiment1.id
    );

    expect(result.success).toBe(true);
    expect(result.data.scans).toHaveLength(2);
    expect(result.data.total).toBe(2);

    // Verify only experiment1 scans returned
    const plantIds = result.data.scans.map((s) => s.plant_id);
    expect(plantIds).toContain('PLANT-EXP1-001');
    expect(plantIds).toContain('PLANT-EXP1-002');
    expect(plantIds).not.toContain('PLANT-EXP2-001');
  });

  test('should filter by date range (dateFrom, dateTo)', async () => {
    const { experiment1, phenotyper } = await createTestScanData();

    // Create scans with different dates
    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-DATE-JAN10',
        path: '/test/scans/date/PLANT-DATE-JAN10',
        capture_date: new Date('2025-01-10'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-DATE-JAN15',
        path: '/test/scans/date/PLANT-DATE-JAN15',
        capture_date: new Date('2025-01-15'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-DATE-JAN20',
        path: '/test/scans/date/PLANT-DATE-JAN20',
        capture_date: new Date('2025-01-20'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-DATE-JAN25',
        path: '/test/scans/date/PLANT-DATE-JAN25',
        capture_date: new Date('2025-01-25'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    // Filter by date range: Jan 12 to Jan 22
    const result = await callPaginatedList({
      page: 1,
      pageSize: 25,
      dateFrom: '2025-01-12',
      dateTo: '2025-01-22',
    });

    expect(result.success).toBe(true);
    expect(result.data.scans).toHaveLength(2);
    expect(result.data.total).toBe(2);

    // Verify only scans within date range returned
    const plantIds = result.data.scans.map((s) => s.plant_id);
    expect(plantIds).toContain('PLANT-DATE-JAN15');
    expect(plantIds).toContain('PLANT-DATE-JAN20');
    expect(plantIds).not.toContain('PLANT-DATE-JAN10');
    expect(plantIds).not.toContain('PLANT-DATE-JAN25');
  });

  test('should filter same-day scans correctly (timezone handling)', async () => {
    // This test verifies that filtering by "today to today" works correctly
    // regardless of timezone. The bug was that date strings like "2025-02-17"
    // were parsed as UTC midnight, causing scans captured later in the day
    // to be excluded from the filter.
    const { experiment1, phenotyper } = await createTestScanData();

    // Create a scan with a specific time during the day (e.g., 2pm local)
    // Using a fixed date to make the test deterministic
    const testDate = new Date('2025-02-17T14:30:00'); // 2:30pm local time
    const dateString = testDate.toISOString().split('T')[0]; // "2025-02-17"

    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-SAME-DAY',
        path: '/test/scans/sameday/PLANT-SAME-DAY',
        capture_date: testDate,
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    // Filter by the same day (from "2025-02-17" to "2025-02-17")
    const result = await callPaginatedList({
      page: 1,
      pageSize: 25,
      dateFrom: dateString,
      dateTo: dateString,
    });

    expect(result.success).toBe(true);
    expect(result.data.total).toBeGreaterThanOrEqual(1);

    // The scan created at 2:30pm should be included
    const plantIds = result.data.scans.map((s) => s.plant_id);
    expect(plantIds).toContain('PLANT-SAME-DAY');
  });

  test('should include phenotyper and experiment relations', async () => {
    const { experiment1, phenotyper } = await createTestScanData();

    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-RELATIONS-001',
        path: '/test/scans/relations/PLANT-RELATIONS-001',
        capture_date: new Date('2025-01-15'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    const result = await callPaginatedList({ page: 1, pageSize: 25 });

    expect(result.success).toBe(true);
    expect(result.data.scans).toHaveLength(1);

    const scan = result.data.scans[0];

    // Verify phenotyper relation is included
    expect(scan.phenotyper).toBeDefined();
    expect(scan.phenotyper.name).toBe('Pagination Phenotyper');
    expect(scan.phenotyper.email).toBe('paginationpheno@test.com');

    // Verify experiment relation is included
    expect(scan.experiment).toBeDefined();
    expect(scan.experiment.name).toBe('Pagination Experiment 1');
    expect(scan.experiment.species).toBe('Arabidopsis thaliana');
  });

  test('should return total count for pagination', async () => {
    const { experiment1, phenotyper } = await createTestScanData();

    // Create 15 scans
    for (let i = 0; i < 15; i++) {
      await prisma.scan.create({
        data: {
          experiment_id: experiment1.id,
          phenotyper_id: phenotyper.id,
          scanner_name: 'Scanner1',
          plant_id: `PLANT-TOTAL-${String(i).padStart(3, '0')}`,
          path: `/test/scans/total/PLANT-TOTAL-${String(i).padStart(3, '0')}`,
          capture_date: new Date(`2025-01-${String(i + 1).padStart(2, '0')}`),
          num_frames: 36,
          exposure_time: 100,
          gain: 1.0,
          brightness: 0.5,
          contrast: 1.0,
          gamma: 1.0,
          seconds_per_rot: 10.0,
          wave_number: 1,
          plant_age_days: 14,
          deleted: false,
        },
      });
    }

    // Request page 1 with 5 items per page
    const result = await callPaginatedList({ page: 1, pageSize: 5 });

    expect(result.success).toBe(true);
    expect(result.data.scans).toHaveLength(5);
    expect(result.data.total).toBe(15);
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(5);

    // Request page 2
    const page2Result = await callPaginatedList({ page: 2, pageSize: 5 });

    expect(page2Result.success).toBe(true);
    expect(page2Result.data.scans).toHaveLength(5);
    expect(page2Result.data.total).toBe(15);
    expect(page2Result.data.page).toBe(2);
  });

  test('should order by capture_date descending', async () => {
    const { experiment1, phenotyper } = await createTestScanData();

    // Create scans with different dates (not in order)
    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-ORDER-MID',
        path: '/test/scans/order/PLANT-ORDER-MID',
        capture_date: new Date('2025-01-15'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-ORDER-OLDEST',
        path: '/test/scans/order/PLANT-ORDER-OLDEST',
        capture_date: new Date('2025-01-10'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    await prisma.scan.create({
      data: {
        experiment_id: experiment1.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-ORDER-NEWEST',
        path: '/test/scans/order/PLANT-ORDER-NEWEST',
        capture_date: new Date('2025-01-20'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    const result = await callPaginatedList({ page: 1, pageSize: 25 });

    expect(result.success).toBe(true);
    expect(result.data.scans).toHaveLength(3);

    // Verify order: newest first (descending)
    expect(result.data.scans[0].plant_id).toBe('PLANT-ORDER-NEWEST');
    expect(result.data.scans[1].plant_id).toBe('PLANT-ORDER-MID');
    expect(result.data.scans[2].plant_id).toBe('PLANT-ORDER-OLDEST');
  });
});

/**
 * TDD Tests for Soft Delete Scans API
 *
 * These tests verify the soft delete behavior where scans are marked
 * as deleted (deleted: true) rather than being permanently removed.
 */
test.describe('Renderer Database IPC - Scans Delete (Soft Delete)', () => {
  test('should soft delete scan by setting deleted: true', async () => {
    // Create test data
    const scientist = await prisma.scientist.create({
      data: { name: 'Delete Test Scientist', email: 'deletesci@test.com' },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Delete Test Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    const phenotyper = await prisma.phenotyper.create({
      data: { name: 'Delete Test Phenotyper', email: 'deletepheno@test.com' },
    });

    // Create scan to delete
    const scan = await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-TO-DELETE',
        path: '/test/scans/delete/PLANT-TO-DELETE',
        capture_date: new Date('2025-01-15'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    // Call delete via IPC
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await window.evaluate((scanId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.database.scans.delete(scanId);
    }, scan.id);

    expect(result.success).toBe(true);

    // Verify scan was soft deleted (not removed from database)
    const deletedScan = await prisma.scan.findUnique({
      where: { id: scan.id },
    });
    expect(deletedScan).not.toBeNull();
    expect(deletedScan!.deleted).toBe(true);
  });

  test('should NOT delete Image records when soft deleting scan', async () => {
    // Create test data
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Image Preserve Scientist',
        email: 'imagepreservesci@test.com',
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Image Preserve Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    const phenotyper = await prisma.phenotyper.create({
      data: {
        name: 'Image Preserve Phenotyper',
        email: 'imagepreservepheno@test.com',
      },
    });

    // Create scan with images
    const scan = await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-WITH-IMAGES',
        path: '/test/scans/delete/PLANT-WITH-IMAGES',
        capture_date: new Date('2025-01-15'),
        num_frames: 3,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    // Create images for the scan
    await prisma.image.createMany({
      data: [
        {
          scan_id: scan.id,
          frame_number: 1,
          path: '/test/scans/delete/PLANT-WITH-IMAGES/frame_001.png',
          status: 'pending',
        },
        {
          scan_id: scan.id,
          frame_number: 2,
          path: '/test/scans/delete/PLANT-WITH-IMAGES/frame_002.png',
          status: 'uploaded',
        },
        {
          scan_id: scan.id,
          frame_number: 3,
          path: '/test/scans/delete/PLANT-WITH-IMAGES/frame_003.png',
          status: 'pending',
        },
      ],
    });

    // Call delete via IPC
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await window.evaluate((scanId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.database.scans.delete(scanId);
    }, scan.id);

    expect(result.success).toBe(true);

    // Verify images still exist
    const images = await prisma.image.findMany({
      where: { scan_id: scan.id },
    });
    expect(images).toHaveLength(3);

    // Verify image statuses are preserved
    const statuses = images.map((img) => img.status);
    expect(statuses).toContain('pending');
    expect(statuses).toContain('uploaded');
  });

  test('should exclude deleted scans from paginated list results', async () => {
    // Create test data
    const scientist = await prisma.scientist.create({
      data: {
        name: 'Exclude Deleted Scientist',
        email: 'excludedeleted@test.com',
      },
    });

    const experiment = await prisma.experiment.create({
      data: {
        name: 'Exclude Deleted Experiment',
        species: 'Arabidopsis thaliana',
        scientist_id: scientist.id,
      },
    });

    const phenotyper = await prisma.phenotyper.create({
      data: {
        name: 'Exclude Deleted Phenotyper',
        email: 'excludedeletedpheno@test.com',
      },
    });

    // Create active scan
    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-STILL-ACTIVE',
        path: '/test/scans/exclude/PLANT-STILL-ACTIVE',
        capture_date: new Date('2025-01-15'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    // Create scan and then delete it
    const scanToDelete = await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Scanner1',
        plant_id: 'PLANT-WILL-DELETE',
        path: '/test/scans/exclude/PLANT-WILL-DELETE',
        capture_date: new Date('2025-01-16'),
        num_frames: 36,
        exposure_time: 100,
        gain: 1.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 10.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    // Soft delete the scan
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await window.evaluate((scanId: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.database.scans.delete(scanId);
    }, scanToDelete.id);

    // List scans with pagination
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await window.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.database.scans.list({
        page: 1,
        pageSize: 25,
      });
    });

    expect(result.success).toBe(true);

    // Get all plant_ids in results
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const plantIds = result.data.scans.map((s: any) => s.plant_id);

    // Active scan should be in results
    expect(plantIds).toContain('PLANT-STILL-ACTIVE');

    // Deleted scan should NOT be in results
    expect(plantIds).not.toContain('PLANT-WILL-DELETE');
  });
});

test.describe('Renderer Database IPC - Scans getRecent', () => {
  test('should get recent scans from today', async () => {
    // Create test data
    const scientist = await prisma.scientist.create({
      data: { name: 'Recent Scientist', email: 'recent@test.com' },
    });
    const phenotyper = await prisma.phenotyper.create({
      data: { name: 'Recent Phenotyper', email: 'recentpheno@test.com' },
    });
    const experiment = await prisma.experiment.create({
      data: {
        name: 'Recent Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
      },
    });

    // Create a scan from today
    await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Test-Scanner',
        plant_id: 'RECENT_SCAN_001',
        path: './scans/test/RECENT_SCAN_001',
        capture_date: new Date(),
        num_frames: 72,
        exposure_time: 10000,
        gain: 5.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 36.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    // Call getRecent via IPC
    const result = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.database.scans.getRecent();
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(Array.isArray(result.data)).toBe(true);
    expect(result.data!.length).toBeGreaterThan(0);
    expect(result.data![0].plant_id).toBe('RECENT_SCAN_001');
  });
});

/**
 * Scans Upload IPC Tests
 *
 * These tests verify the upload IPC handlers work correctly.
 * Since CI doesn't have real Bloom credentials, we test error handling paths:
 * - Missing credentials error
 * - Non-existent scan error
 * - Response structure validation
 *
 * For manual testing with real uploads, see: docs/MANUAL_UPLOAD_TESTING.md
 */
test.describe('Renderer Database IPC - Scans Upload', () => {
  test('db:scans:upload should return error for non-existent scan', async () => {
    // Call upload with a fake scan ID
    // This tests the handler exists and returns proper error structure
    const result = await window.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.database.scans.upload(
        'non-existent-scan-id'
      );
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    // Should fail with either "Scan not found" or "Missing Bloom credentials"
    // depending on whether credentials check happens first
    expect(result.error).toMatch(/Scan not found|Missing Bloom credentials/);
  });

  test('db:scans:upload should return structured response', async () => {
    // Create test data
    const scientist = await prisma.scientist.create({
      data: { name: 'Upload Test Scientist', email: 'uploadtest@test.com' },
    });
    const phenotyper = await prisma.phenotyper.create({
      data: { name: 'Upload Test Phenotyper', email: 'uploadpheno@test.com' },
    });
    const experiment = await prisma.experiment.create({
      data: {
        name: 'Upload Test Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
      },
    });

    const scan = await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Test-Scanner',
        plant_id: 'UPLOAD_TEST_SCAN',
        path: './scans/test/UPLOAD_TEST_SCAN',
        capture_date: new Date(),
        num_frames: 1,
        exposure_time: 10000,
        gain: 5.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 36.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    // Call upload - will fail due to missing credentials in CI
    // but validates the handler exists and response structure
    const result = await window.evaluate((scanId) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.database.scans.upload(scanId);
    }, scan.id);

    // Should fail with credentials error (scan exists but no credentials)
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Missing Bloom credentials');
  });

  test('db:scans:uploadBatch should return error for empty array', async () => {
    // Call batch upload with empty array
    const result = await window.evaluate(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.database.scans.uploadBatch([]);
    });

    // Should fail with credentials error (checked before processing scans)
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Missing Bloom credentials');
  });

  test('db:scans:uploadBatch should return structured response', async () => {
    // Create test data
    const scientist = await prisma.scientist.create({
      data: { name: 'Batch Upload Scientist', email: 'batchupload@test.com' },
    });
    const phenotyper = await prisma.phenotyper.create({
      data: { name: 'Batch Upload Phenotyper', email: 'batchpheno@test.com' },
    });
    const experiment = await prisma.experiment.create({
      data: {
        name: 'Batch Upload Experiment',
        species: 'Arabidopsis',
        scientist_id: scientist.id,
      },
    });

    const scan1 = await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Test-Scanner',
        plant_id: 'BATCH_UPLOAD_001',
        path: './scans/test/BATCH_UPLOAD_001',
        capture_date: new Date(),
        num_frames: 1,
        exposure_time: 10000,
        gain: 5.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 36.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    const scan2 = await prisma.scan.create({
      data: {
        experiment_id: experiment.id,
        phenotyper_id: phenotyper.id,
        scanner_name: 'Test-Scanner',
        plant_id: 'BATCH_UPLOAD_002',
        path: './scans/test/BATCH_UPLOAD_002',
        capture_date: new Date(),
        num_frames: 1,
        exposure_time: 10000,
        gain: 5.0,
        brightness: 0.5,
        contrast: 1.0,
        gamma: 1.0,
        seconds_per_rot: 36.0,
        wave_number: 1,
        plant_age_days: 14,
        deleted: false,
      },
    });

    // Call batch upload - will fail due to missing credentials
    const result = await window.evaluate(
      (scanIds) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).electron.database.scans.uploadBatch(scanIds);
      },
      [scan1.id, scan2.id]
    );

    // Should fail with credentials error
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain('Missing Bloom credentials');
  });
});

test.describe('Renderer Database IPC - Context Isolation', () => {
  test('should not expose require() to renderer', async () => {
    const hasRequire = await window.evaluate(() => {
      return (
        typeof (window as WindowWithElectron & { require?: unknown })
          .require !== 'undefined'
      );
    });

    expect(hasRequire).toBe(false);
  });

  test('should not expose process object to renderer', async () => {
    const hasProcess = await window.evaluate(() => {
      return (
        typeof (window as WindowWithElectron & { process?: unknown })
          .process !== 'undefined'
      );
    });

    expect(hasProcess).toBe(false);
  });

  test('should only expose window.electron APIs', async () => {
    const electronAPIs = await window.evaluate(() => {
      const apis = (window as WindowWithElectron).electron;
      return {
        hasElectron: typeof apis !== 'undefined',
        hasDatabase: typeof apis?.database !== 'undefined',
        hasCamera: typeof apis?.camera !== 'undefined',
        hasScanner: typeof apis?.scanner !== 'undefined',
      };
    });

    expect(electronAPIs.hasElectron).toBe(true);
    expect(electronAPIs.hasDatabase).toBe(true);
    expect(electronAPIs.hasCamera).toBe(true);
    expect(electronAPIs.hasScanner).toBe(true);
  });
});

// ============================================================================
// Session State IPC Tests - Zero Value Persistence
// ============================================================================

test.describe('Renderer Session IPC - Zero Value Persistence', () => {
  test('should persist waveNumber = 0 correctly', async () => {
    // Reset session first
    await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.reset();
    });

    // Set waveNumber to 0 (valid value that should persist)
    await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.set({
        waveNumber: 0,
      });
    });

    // Get session state back
    const session = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.get();
    });

    // waveNumber should be 0, not null
    expect(session.waveNumber).toBe(0);
  });

  test('should persist plantAgeDays = 0 correctly', async () => {
    // Reset session first
    await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.reset();
    });

    // Set plantAgeDays to 0 (valid value that should persist)
    await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.set({
        plantAgeDays: 0,
      });
    });

    // Get session state back
    const session = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.get();
    });

    // plantAgeDays should be 0, not null
    expect(session.plantAgeDays).toBe(0);
  });

  test('should persist both waveNumber and plantAgeDays as 0 together', async () => {
    // Reset session first
    await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.reset();
    });

    // Set both to 0
    await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.set({
        waveNumber: 0,
        plantAgeDays: 0,
        experimentId: 'test-experiment-id',
      });
    });

    // Get session state back
    const session = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.get();
    });

    // Both should be 0, not null
    expect(session.waveNumber).toBe(0);
    expect(session.plantAgeDays).toBe(0);
    expect(session.experimentId).toBe('test-experiment-id');
  });

  test('should distinguish between 0 and null', async () => {
    // Reset session first
    await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.reset();
    });

    // Verify initial state is null
    const initialSession = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.get();
    });
    expect(initialSession.waveNumber).toBeNull();
    expect(initialSession.plantAgeDays).toBeNull();

    // Set to 0
    await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.set({
        waveNumber: 0,
        plantAgeDays: 0,
      });
    });

    const afterSetSession = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.get();
    });
    expect(afterSetSession.waveNumber).toBe(0);
    expect(afterSetSession.plantAgeDays).toBe(0);

    // Set back to null explicitly
    await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.set({
        waveNumber: null,
        plantAgeDays: null,
      });
    });

    const finalSession = await window.evaluate(() => {
      return (window as WindowWithElectron).electron.session.get();
    });
    expect(finalSession.waveNumber).toBeNull();
    expect(finalSession.plantAgeDays).toBeNull();
  });
});
