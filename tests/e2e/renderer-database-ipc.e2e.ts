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

  // Close Electron app
  if (electronApp) {
    await electronApp.close();
  }

  // Clean up test database
  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }
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
          name: 'Invalid Accession',
          // Missing required species field
        } as { name: string }
      );
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
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
        scientist_id: scientistId,
      });
    }, scientist.id);

    expect(result.success).toBe(true);
    expect(result.data.name).toBe('New Experiment');

    // Verify in database
    const experiment = await prisma.experiment.findFirst({
      where: { name: 'New Experiment' },
    });
    expect(experiment).toBeDefined();
    expect(experiment?.scientist_id).toBe(scientist.id);
  });

  test('should handle error when creating experiment with invalid foreign key', async () => {
    const result = await window.evaluate(() => {
      return (
        window as WindowWithElectron
      ).electron.database.experiments.create({
        name: 'Invalid Experiment',
        scientist_id: 'invalid-uuid',
      });
    });

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
