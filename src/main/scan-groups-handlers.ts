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
  scan: {
    groupBy(args: {
      by: ['experiment_id'];
      where: { deleted: false };
      _count: { _all: true };
    }): Promise<Array<{ experiment_id: string; _count: { _all: number } }>>;
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

/** Experiments with non-deleted scans, with their counts, sorted by name. */
export async function listExperimentScanCounts(
  deps: ScanGroupsDeps
): Promise<DatabaseResponse<ExperimentScanCount[]>> {
  try {
    const counts = await deps.db.scan.groupBy({
      by: ['experiment_id'],
      where: { deleted: false },
      _count: { _all: true },
    });
    const experiments = await deps.db.experiment.findMany({
      where: { id: { in: counts.map((c) => c.experiment_id) } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(experiments.map((e) => [e.id, e.name]));
    const data = counts
      .map((c) => ({
        experiment_id: c.experiment_id,
        experiment_name: nameOf.get(c.experiment_id) ?? 'Unknown experiment',
        scan_count: c._count._all,
      }))
      .sort((a, b) => a.experiment_name.localeCompare(b.experiment_name));
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
