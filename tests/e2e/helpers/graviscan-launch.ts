/**
 * E2E Test Helper: GraviScan Electron Launch
 *
 * Shared setup for GraviScan E2E tests. Creates ~/.bloom/.env with
 * SCANNER_MODE=graviscan and GRAVISCAN_MOCK=true, sets up test database,
 * and provides cleanup functions.
 *
 * Usage:
 *   import { setupGraviScanE2E, cleanupGraviScanE2E } from './helpers/graviscan-launch';
 *
 *   test.beforeEach(async () => {
 *     await setupGraviScanE2E();
 *   });
 *
 *   test.afterEach(async () => {
 *     await cleanupGraviScanE2E();
 *   });
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const BLOOM_DIR = path.join(os.homedir(), '.bloom');
const ENV_PATH = path.join(BLOOM_DIR, '.env');

let originalEnvContent: string | null = null;

/**
 * Create a GraviScan-specific ~/.bloom/.env for E2E testing.
 * Sets SCANNER_MODE=graviscan and GRAVISCAN_MOCK=true.
 *
 * @param testScansDir - Optional custom scans directory
 */
export function createGraviScanTestConfig(testScansDir?: string): void {
  if (!fs.existsSync(BLOOM_DIR)) {
    fs.mkdirSync(BLOOM_DIR, { recursive: true });
  }

  if (fs.existsSync(ENV_PATH)) {
    originalEnvContent = fs.readFileSync(ENV_PATH, 'utf-8');
  }

  const scansDir =
    testScansDir || path.join(BLOOM_DIR, 'e2e-test-graviscan');

  if (!fs.existsSync(scansDir)) {
    fs.mkdirSync(scansDir, { recursive: true });
  }

  const envContent = `# GraviScan E2E Test Configuration (auto-generated)
SCANNER_MODE=graviscan
SCANNER_NAME=TestGraviScanner
SCANS_DIR=${scansDir}
BLOOM_API_URL=https://api.bloom.salk.edu/proxy
GRAVISCAN_MOCK=true

# Empty credentials (not needed for local E2E tests)
BLOOM_SCANNER_USERNAME=
BLOOM_SCANNER_PASSWORD=
BLOOM_ANON_KEY=
`;

  fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
}

/**
 * Clean up the GraviScan test configuration.
 * Restores the original .env if one existed.
 */
export function cleanupGraviScanTestConfig(): void {
  if (originalEnvContent !== null) {
    fs.writeFileSync(ENV_PATH, originalEnvContent, 'utf-8');
    originalEnvContent = null;
  } else if (fs.existsSync(ENV_PATH)) {
    fs.unlinkSync(ENV_PATH);
  }
}

/**
 * Get the path to the GraviScan test scans directory.
 */
export function getGraviScanTestScansDir(): string {
  return path.join(BLOOM_DIR, 'e2e-test-graviscan');
}
