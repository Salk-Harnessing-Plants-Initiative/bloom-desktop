/**
 * Export Scans' experiment and day lists (#436): scan counts per experiment, and the
 * days one experiment has scans on, so the page can open without loading every scan.
 * A day's scans then come from db:scans:list with a one-day range.
 */

import type { IpcMain } from 'electron';
import type { DatabaseResponse } from '../types/database';
import type {
  ExperimentScanCount,
  ExperimentScanDay,
} from '../types/scan-groups';
import { toIsoDate } from '../utils/wave-dates';

/** The part of the Prisma client these handlers use, so tests can pass a fake. */
export interface ScanGroupsDbLike {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  scan: {
    findMany(args: {
      where: { experiment_id: string; deleted: false };
      select: { capture_date: true };
    }): Promise<Array<{ capture_date: Date }>>;
  };
  experiment: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; name: true };
    }): Promise<Array<{ id: string; name: string }>>;
  };
}

export interface ScanGroupsDeps {
  db: ScanGroupsDbLike;
}

function fail(error: unknown): DatabaseResponse<never> {
  console.error('[ScanGroups]', error);
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  };
}

/**
 * A scan's capture time in ms. The pilot app stored capture_date as text, newer scans
 * store a number, and SQLite ranks any text above any number, so MAX over the raw
 * column would put every pilot experiment first. Text is read as UTC: hours off at
 * most, which is enough to order experiments.
 */
const CAPTURED_MS = `CASE typeof("capture_date")
    WHEN 'integer' THEN "capture_date"
    WHEN 'real' THEN CAST("capture_date" AS INTEGER)
    WHEN 'text' THEN CAST(ROUND((julianday("capture_date") - 2440587.5) * 86400000) AS INTEGER)
    ELSE NULL
  END`;

/** Non-deleted scans counted per experiment, with each one's most recent capture. */
const EXPERIMENT_COUNTS_SQL = `
SELECT "experiment_id", COUNT(*) AS "scan_count", MAX(${CAPTURED_MS}) AS "latest_ms"
FROM "Scan"
WHERE "deleted" = 0
GROUP BY "experiment_id"`;

interface ExperimentCountRow {
  experiment_id: string;
  scan_count: number | bigint;
  latest_ms: number | bigint | null;
}

/**
 * Experiments with non-deleted scans, with their counts, the one with the most recent
 * scan first (ties by name). Sorted by name, a station's many older experiments came
 * first and the ones being scanned now were at the bottom of a long list.
 */
export async function listExperimentScanCounts(
  deps: ScanGroupsDeps
): Promise<DatabaseResponse<ExperimentScanCount[]>> {
  try {
    const counts = await deps.db.$queryRawUnsafe<ExperimentCountRow[]>(
      EXPERIMENT_COUNTS_SQL
    );
    const experiments = await deps.db.experiment.findMany({
      where: { id: { in: counts.map((c) => c.experiment_id) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(experiments.map((e) => [e.id, e.name]));
    const latestOf = new Map(
      counts.map((c) => [
        c.experiment_id,
        c.latest_ms === null ? 0 : Number(c.latest_ms),
      ])
    );
    const data = counts
      .map((c) => ({
        experiment_id: c.experiment_id,
        experiment_name: nameOf.get(c.experiment_id) ?? 'Unknown experiment',
        scan_count: Number(c.scan_count),
      }))
      .sort(
        (a, b) =>
          (latestOf.get(b.experiment_id) ?? 0) -
            (latestOf.get(a.experiment_id) ?? 0) ||
          a.experiment_name.localeCompare(b.experiment_name)
      );
    return { success: true, data };
  } catch (error) {
    return fail(error);
  }
}

/**
 * The local days one experiment has non-deleted scans on, newest first. Grouped here,
 * not in SQL: databases from the pilot app can mix text and number dates, which SQL
 * date functions and Prisma's groupBy don't handle. Same local-day rule as the
 * day filter of db:scans:list, so a day's count matches what opening it loads.
 */
export async function listExperimentScanDays(
  deps: ScanGroupsDeps,
  experimentId: string
): Promise<DatabaseResponse<ExperimentScanDay[]>> {
  const experiment =
    typeof experimentId === 'string' ? experimentId.trim() : '';
  if (!experiment) {
    return { success: false, error: 'experimentId must be a non-empty string' };
  }
  try {
    const scans = await deps.db.scan.findMany({
      where: { experiment_id: experiment, deleted: false },
      select: { capture_date: true },
    });
    const perDay = new Map<string, number>();
    for (const { capture_date } of scans) {
      const day = toIsoDate(new Date(capture_date));
      perDay.set(day, (perDay.get(day) ?? 0) + 1);
    }
    const data = [...perDay]
      .map(([day, scan_count]) => ({ day, scan_count }))
      .sort((a, b) => b.day.localeCompare(a.day));
    return { success: true, data };
  } catch (error) {
    return fail(error);
  }
}

export function registerScanGroupsHandlers(
  deps: ScanGroupsDeps & { ipcMain: Pick<IpcMain, 'handle'> }
): void {
  deps.ipcMain.handle('db:scans:experimentCounts', () =>
    listExperimentScanCounts(deps)
  );
  deps.ipcMain.handle(
    'db:scans:experimentDays',
    (_event, experimentId: string) => listExperimentScanDays(deps, experimentId)
  );
}
