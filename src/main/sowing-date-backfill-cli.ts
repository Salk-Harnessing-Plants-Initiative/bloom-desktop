/**
 * Runs `Bloom Desktop.exe --backfill-sowing-dates [--dry-run]` from main.ts with
 * the station's own database, shows the result and exits. Kept apart from
 * sowing-date-backfill-run.ts so that module is testable without Electron.
 *
 * It refuses to run while Bloom Desktop is open: two copies of the app writing
 * the same database is unsafe.
 */

import * as os from 'os';
import * as path from 'path';
import { app, dialog } from 'electron';
import type { PrismaClient } from '@prisma/client';
import {
  runSowingDateBackfill,
  summarizeSowingDateBackfill,
  type SowingDateBackfillRequest,
} from './sowing-date-backfill-run';

const EXIT_OK = 0;
const EXIT_FAILED = 1;
const TITLE = 'Bloom Desktop: start dates';

function show(type: 'info' | 'error', message: string): void {
  console.log(`[SowingDateBackfill] ${message}`);
  dialog.showMessageBoxSync({ type, title: TITLE, message });
}

/** Runs the backfill and exits the app. Called once from main.ts, before 'ready'. */
export async function startSowingDateBackfill(
  request: SowingDateBackfillRequest
): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    await app.whenReady();
    show('error', 'Close Bloom Desktop first, then run this again.');
    app.exit(EXIT_FAILED);
    return;
  }
  await app.whenReady();
  const { initializeDatabaseAsync, getDatabasePath, closeDatabase } =
    await import('./database');
  let code = EXIT_OK;
  try {
    const db = (await initializeDatabaseAsync()) as PrismaClient;
    const { report, reportPath } = await runSowingDateBackfill(request, {
      db,
      databasePath: getDatabasePath(),
      logsDir: path.join(os.homedir(), '.bloom', 'logs'),
      appVersion: app.getVersion(),
      now: () => new Date(),
    });
    show('info', summarizeSowingDateBackfill(report, reportPath));
  } catch (error) {
    show(
      'error',
      `Couldn't work out the start dates: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
    code = EXIT_FAILED;
  } finally {
    await closeDatabase().catch((): undefined => undefined);
  }
  app.exit(code);
}
