/**
 * When each experiment was last scanned, so the Experiments page can list the ones in
 * use first: CylinderScan scans and GraviScan scans alike. One grouped query over
 * non-deleted scans, with no scan rows sent.
 */

import type { IpcMain } from 'electron';
import type { DatabaseResponse } from '../types/database';
import type { ExperimentLatestScan } from '../types/experiment-recency';
import { capturedMsSql } from './capture-date-sql';

const LATEST_SCANS_SQL = `
SELECT "experiment_id", MAX("captured_ms") AS "latest_ms"
FROM (
  SELECT "experiment_id", ${capturedMsSql()} AS "captured_ms"
  FROM "Scan" WHERE "deleted" = 0
  UNION ALL
  SELECT "experiment_id", ${capturedMsSql()} AS "captured_ms"
  FROM "GraviScan" WHERE "deleted" = 0
)
GROUP BY "experiment_id"`;

/** The part of the Prisma client used here, so tests can pass a fake. */
export interface ExperimentRecencyDbLike {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

interface LatestScanRow {
  experiment_id: string;
  latest_ms: number | bigint | null;
}

/** Each experiment with non-deleted scans, and its newest scan's capture time. */
export async function listExperimentLatestScans(deps: {
  db: ExperimentRecencyDbLike;
}): Promise<DatabaseResponse<ExperimentLatestScan[]>> {
  try {
    const rows =
      await deps.db.$queryRawUnsafe<LatestScanRow[]>(LATEST_SCANS_SQL);
    const data = rows
      .filter((r) => r.latest_ms !== null)
      .map((r) => ({
        experiment_id: r.experiment_id,
        latest_ms: Number(r.latest_ms),
      }));
    return { success: true, data };
  } catch (error) {
    console.error('[ExperimentRecency]', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export function registerExperimentRecencyHandlers(deps: {
  ipcMain: Pick<IpcMain, 'handle'>;
  db: ExperimentRecencyDbLike;
}): void {
  deps.ipcMain.handle('db:experiments:latestScans', () =>
    listExperimentLatestScans(deps)
  );
}
