/**
 * Launches the staged packaged app binary via Playwright's Electron driver
 * and verifies: a real window renders, the app's own database connection
 * and IPC handlers actually work (not just that a pre-seeded file exists —
 * see the note on verifyDatabaseIpcWorks() below), and the expected database
 * tables exist.
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
import { _electron as electron, Page } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import os from 'os';
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
  // os.homedir() queries the OS directly, matching what the app itself gets
  // from Electron's app.getPath('home') (database.ts:192) — process.env.HOME
  // isn't consulted by the app on Windows at all, and a shell environment
  // (e.g. Git Bash) can set HOME to a value that differs from the OS profile
  // dir, which would silently point this check at a path the app never
  // touches.
  return path.join(os.homedir(), '.bloom', 'data', 'bloom.db');
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

interface DatabaseResponse {
  success: boolean;
  error?: string;
}

/**
 * Proves the app's OWN database connection and IPC handlers actually work —
 * not just that a file with the right schema exists on disk.
 *
 * The schema is seeded externally via applySchemaExternally() BEFORE launch
 * (matching production: the app never runs migrations itself). Because of
 * that, checking the file's schema after launch is not, by itself, evidence
 * the app did anything — the file would look identical whether the app's
 * initializeDatabaseAsync()/registerDatabaseHandlers() succeeded, failed, or
 * never ran at all (main.ts creates the window and continues regardless of
 * DB-init outcome). A real IPC round-trip through the running renderer
 * requires registerDatabaseHandlers() to have actually run (an unregistered
 * handler makes ipcRenderer.invoke() reject) and the Prisma connection to
 * actually work (a broken connection makes the handler return
 * `{ success: false }`, per database-handlers.ts's try/catch convention) —
 * so this is the load-bearing assertion, not the file check below it.
 */
async function verifyDatabaseIpcWorks(page: Page): Promise<void> {
  const result = await page.evaluate(async () => {
    const bridge = (
      window as unknown as {
        electron?: {
          database?: {
            phenotypers?: { list?: () => Promise<DatabaseResponse> };
          };
        };
      }
    ).electron;
    if (!bridge?.database?.phenotypers?.list) {
      throw new Error(
        'window.electron.database.phenotypers.list is not exposed'
      );
    }
    return bridge.database.phenotypers.list();
  });

  if (!result || result.success !== true) {
    throw new Error(
      `db:phenotypers:list IPC call did not succeed: ${JSON.stringify(result)}`
    );
  }
}

async function main(): Promise<void> {
  const dbPath = resolveDbPath();
  applySchemaExternally(dbPath);

  const appPath = resolveStagedAppPath(process.platform, process.arch);
  console.log(`[INFO] Launching packaged app: ${appPath}`);

  const electronApp = await electron.launch({ executablePath: appPath });

  try {
    console.log('[INFO] Waiting for a window to render...');
    const mainWindow = await electronApp.firstWindow({
      timeout: WINDOW_TIMEOUT_MS,
    });
    console.log('[PASS] Window rendered');

    console.log(
      "[INFO] Verifying the app's own database connection and IPC handlers work..."
    );
    await verifyDatabaseIpcWorks(mainWindow);
    console.log('[PASS] Database IPC round-trip succeeded');

    // Defense-in-depth on top of the IPC check above: confirms the schema
    // seeded by applySchemaExternally() is still intact (the IPC check alone
    // only proves the Phenotyper table's handler works, not every table).
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
