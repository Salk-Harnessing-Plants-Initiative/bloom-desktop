/**
 * E2E Test Helper: Bloom Machine Configuration
 *
 * Creates and cleans up the ~/.bloom/.env configuration file required for E2E tests.
 *
 * **Why this is needed:**
 * When ~/.bloom/.env doesn't exist, the Home page redirects to Machine Configuration.
 * E2E tests that expect to land on the Home page need this file to exist.
 *
 * **Root cause of E2E test failures (Feb 2025):**
 * The Machine Configuration feature (commit a6d3cd6) added a redirect in Home.tsx
 * that checks for config existence. Tests that don't create this file timeout
 * waiting for Home content that never appears.
 *
 * @see openspec/changes/remove-database-auto-init/proposal.md
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Path to the Bloom config directory and env file
const BLOOM_DIR = path.join(os.homedir(), '.bloom');
const ENV_PATH = path.join(BLOOM_DIR, '.env');

// Backup path for original .env if it exists
let originalEnvContent: string | null = null;

/**
 * Create a minimal ~/.bloom/.env file for E2E testing.
 *
 * This creates the minimal configuration required to bypass the
 * Machine Configuration redirect on app launch.
 *
 * @param testScansDir - Optional custom scans directory (default: ~/.bloom/e2e-test-scans)
 */
export function createTestBloomConfig(testScansDir?: string): void {
  // Ensure ~/.bloom directory exists
  if (!fs.existsSync(BLOOM_DIR)) {
    fs.mkdirSync(BLOOM_DIR, { recursive: true });
  }

  // Backup existing .env if present
  if (fs.existsSync(ENV_PATH)) {
    originalEnvContent = fs.readFileSync(ENV_PATH, 'utf-8');
  }

  // Default test scans directory
  const scansDir = testScansDir || path.join(BLOOM_DIR, 'e2e-test-scans');

  // Create scans directory if it doesn't exist
  if (!fs.existsSync(scansDir)) {
    fs.mkdirSync(scansDir, { recursive: true });
  }

  // Create minimal .env configuration
  // These values are sufficient to bypass the Machine Config redirect
  // and satisfy config validation without requiring real API credentials
  const envContent = `# E2E Test Configuration (auto-generated)
SCANNER_NAME=TestScanner
CAMERA_IP_ADDRESS=mock
SCANS_DIR=${scansDir}
BLOOM_API_URL=https://api.bloom.salk.edu/proxy

# Empty credentials (not needed for local E2E tests)
BLOOM_SCANNER_USERNAME=
BLOOM_SCANNER_PASSWORD=
BLOOM_ANON_KEY=
`;

  fs.writeFileSync(ENV_PATH, envContent, 'utf-8');
}

/**
 * Clean up the test ~/.bloom/.env file.
 *
 * Restores the original .env if one existed, or removes the test file.
 */
export function cleanupTestBloomConfig(): void {
  if (originalEnvContent !== null) {
    // Restore original .env
    fs.writeFileSync(ENV_PATH, originalEnvContent, 'utf-8');
    originalEnvContent = null;
  } else if (fs.existsSync(ENV_PATH)) {
    // Remove test .env
    fs.unlinkSync(ENV_PATH);
  }
}

/**
 * Get the path to the Bloom config directory.
 */
export function getBloomDir(): string {
  return BLOOM_DIR;
}

/**
 * Get the path to the Bloom .env file.
 */
export function getEnvPath(): string {
  return ENV_PATH;
}
