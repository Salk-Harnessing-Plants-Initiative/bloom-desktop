/**
 * E2E Test: GraviScan IPC Round-Trip
 *
 * Tests the complete renderer → preload → IPC → main → handler path
 * for GraviScan operations. Launches the app in graviscan mode with
 * mock scanners (GRAVISCAN_MOCK=true).
 *
 * PREREQUISITES:
 * 1. Start Electron Forge dev server: `npm run start` (keep running)
 * 2. Run E2E tests: `npx playwright test tests/e2e/graviscan-ipc.e2e.ts`
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

// Test database (separate from other E2E tests)
const TEST_DB_PATH = path.join(__dirname, 'graviscan-ipc-test.db');
const TEST_DB_URL = `file:${TEST_DB_PATH}`;

// Bloom config paths
const BLOOM_DIR = path.join(os.homedir(), '.bloom');
const ENV_PATH = path.join(BLOOM_DIR, '.env');
let originalEnvContent: string | null = null;

/**
 * Create a graviscan-specific ~/.bloom/.env for E2E testing.
 *
 * Sets SCANNER_MODE=graviscan instead of cylinderscan so the app
 * initializes GraviScan handlers and exposes the gravi IPC namespace.
 */
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

/**
 * Restore the original ~/.bloom/.env or remove the test one.
 */
function cleanupGraviScanTestConfig(): void {
  if (originalEnvContent !== null) {
    fs.writeFileSync(ENV_PATH, originalEnvContent, 'utf-8');
    originalEnvContent = null;
  } else if (fs.existsSync(ENV_PATH)) {
    fs.unlinkSync(ENV_PATH);
  }
}

/**
 * Helper: Launch Electron app with test database and mock scanners
 */
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

/**
 * Test setup: Create fresh database and launch app in graviscan mode
 */
test.beforeEach(async () => {
  createGraviScanTestConfig();

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  // Push schema to test database
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

/**
 * Test teardown: Clean up resources
 */
test.afterEach(async () => {
  await closeElectronApp(electronApp);

  if (fs.existsSync(TEST_DB_PATH)) {
    fs.unlinkSync(TEST_DB_PATH);
  }

  cleanupGraviScanTestConfig();
});

test.describe('GraviScan IPC Round-Trip', () => {
  test('gravi namespace exists on window.electron', async () => {
    const hasGravi = await window.evaluate(() => {
      return (
        typeof (window as unknown as WindowWithElectron).electron.gravi ===
        'object'
      );
    });
    expect(hasGravi).toBe(true);
  });

  test('detectScanners returns mock scanner data', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.gravi.detectScanners();
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    // GRAVISCAN_MOCK=true should return mock scanners
    // Field is `scanners` (not `detectedScanners`) per scanner-handlers.ts
    expect(Array.isArray(result.data.scanners)).toBe(true);
    expect(result.data.scanners.length).toBeGreaterThan(0);
  });

  test('getPlatformInfo returns platform data', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.gravi.getPlatformInfo();
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    // Fields per scanner-handlers.ts: supported, backend, mock_enabled
    expect(result.data.backend).toBeDefined();
    expect(typeof result.data.supported).toBe('boolean');
  });

  test('getConfig returns null or config object', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.gravi.getConfig();
    });

    expect(result.success).toBe(true);
    // Config may be null (no config saved yet) or an object
  });

  test('getOutputDir returns a path', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.gravi.getOutputDir();
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.path).toBeDefined();
    expect(typeof result.data.path).toBe('string');
  });

  test('getScanStatus returns inactive when no scan active', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.gravi.getScanStatus();
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.isActive).toBe(false);
  });

  test('event listener returns cleanup function', async () => {
    const result = await window.evaluate(() => {
      const cleanup = (
        window as unknown as WindowWithElectron
      ).electron.gravi.onScanEvent(() => {});
      const isFunction = typeof cleanup === 'function';
      cleanup(); // Clean up the listener
      return isFunction;
    });

    expect(result).toBe(true);
  });

  test('validateConfig returns validation result', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.gravi.validateConfig();
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
  });

  // GraviScan DB read operations (database namespace)

  test('database.graviscans.list returns scans array', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.graviscans.list();
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });

  test('database.graviscans.getMaxWaveNumber returns number', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.graviscans.getMaxWaveNumber('nonexistent-exp');
    });

    expect(result.success).toBe(true);
    expect(typeof result.data).toBe('number');
  });

  test('database.graviscans.checkBarcodeUniqueInWave returns boolean', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.graviscans.checkBarcodeUniqueInWave({
        experiment_id: 'nonexistent-exp',
        wave_number: 1,
        plate_barcode: 'PLATE-001',
      });
    });

    expect(result.success).toBe(true);
    expect(typeof result.data).toBe('boolean');
  });

  test('database.graviscanPlateAssignments.list returns array', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.graviscanPlateAssignments.list(
        'nonexistent-exp',
        'nonexistent-scanner'
      );
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });

  test('database.graviscanPlateAssignments.upsert creates/updates assignment', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.graviscanPlateAssignments.upsert(
        'nonexistent-exp',
        'nonexistent-scanner',
        '00',
        { plate_barcode: 'TEST-001', selected: true }
      );
    });

    // Will fail with FK constraint (nonexistent experiment/scanner) — that's expected
    // The important thing is the IPC channel exists and responds
    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });

  test('database.graviscanPlateAssignments.upsertMany handles batch', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.graviscanPlateAssignments.upsertMany(
        'nonexistent-exp',
        'nonexistent-scanner',
        [{ plate_index: '00', plate_barcode: 'TEST-001', selected: true }]
      );
    });

    expect(result).toBeDefined();
    expect(typeof result.success).toBe('boolean');
  });

  test('database.graviPlateAccessions.list returns array', async () => {
    const result = await window.evaluate(() => {
      return (
        window as unknown as WindowWithElectron
      ).electron.database.graviPlateAccessions.list('nonexistent-accession');
    });

    expect(result.success).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });
});
