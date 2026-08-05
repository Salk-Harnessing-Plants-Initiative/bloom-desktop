/**
 * Launches the staged packaged app binary via Playwright's Electron driver
 * and verifies: a real window renders, the database initializes, and the
 * expected database tables exist.
 *
 * Run with: npm run test:package:launch
 * Prerequisites: npm run make (or npm run package) must have been run.
 */

// MUST run before any Playwright import/call. VS Code's and Claude Code's
// integrated terminals set ELECTRON_RUN_AS_NODE, which breaks Playwright's
// Electron driver (--remote-debugging-port=0 bug, microsoft/playwright#32027).
// playwright.config.ts already deletes this env var for `npx playwright test`
// runs, but this script runs standalone via ts-node and bypasses that fix
// entirely — see openspec/changes/add-cylinderscan-packaging-ci/design.md
// Decision 2a.
delete process.env.ELECTRON_RUN_AS_NODE;

// eslint-disable-next-line import/order
import { _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { resolveStagedAppPath } from './lib/resolve-staged-app-path';
import { verifyDbTables } from './lib/verify-db-tables';
import { waitForCondition } from './lib/wait-for-condition';

const WINDOW_TIMEOUT_MS = 30_000;
// The app never runs migrations itself in production (see database.ts:
// "Database schema should be set up externally via `prisma migrate
// deploy`") — initializeDatabaseAsync() only lazily constructs a Prisma
// Client, it never connects. Schema must be applied externally before
// launch, mirroring scripts/test-package-database-full.sh's Step 1.
const DB_READY_TIMEOUT_MS = 30_000;
const DB_READY_POLL_INTERVAL_MS = 500;

function resolveDbPath(): string {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  return path.join(home, '.bloom', 'data', 'bloom.db');
}

function applySchemaExternally(dbPath: string): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath);
  }
  console.log(`[INFO] Applying database schema externally at ${dbPath}...`);
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, BLOOM_DATABASE_URL: `file:${dbPath}` },
    stdio: 'inherit',
  });
}

async function main(): Promise<void> {
  const dbPath = resolveDbPath();
  applySchemaExternally(dbPath);

  const appPath = resolveStagedAppPath(process.platform, process.arch);
  console.log(`[INFO] Launching packaged app: ${appPath}`);

  const electronApp = await electron.launch({ executablePath: appPath });

  try {
    console.log('[INFO] Waiting for a window to render...');
    await electronApp.firstWindow({ timeout: WINDOW_TIMEOUT_MS });
    console.log('[PASS] Window rendered');

    // The schema was already applied above; this confirms the app opened
    // the existing database without crashing or corrupting it — the same
    // outcome scripts/test-package-database-full.sh verifies, checked here
    // via the real file/schema instead of a transient log line, which can
    // race with Playwright's own internal stdout consumption (see
    // design.md Decision 2b).
    console.log(`[INFO] Verifying database at ${dbPath} is still intact...`);
    let lastMissingTables: string[] = [];
    await waitForCondition(
      () => {
        if (!fs.existsSync(dbPath)) {
          return false;
        }
        const { allPresent, missingTables } = verifyDbTables(dbPath);
        lastMissingTables = missingTables;
        return allPresent;
      },
      DB_READY_TIMEOUT_MS,
      DB_READY_POLL_INTERVAL_MS
    ).catch((error) => {
      const detail =
        lastMissingTables.length > 0
          ? ` (last seen missing tables: ${lastMissingTables.join(', ')})`
          : '';
      throw new Error(
        `${error instanceof Error ? error.message : String(error)}${detail}`
      );
    });
    console.log('[PASS] Database intact with all expected tables');
  } finally {
    await electronApp.close();
  }
}

if (require.main === module) {
  main()
    .then(() => {
      console.log('[PASS] Packaged app launch verification passed');
      process.exit(0);
    })
    .catch((error) => {
      console.error(
        `[FAIL] ${error instanceof Error ? error.message : String(error)}`
      );
      process.exit(1);
    });
}
