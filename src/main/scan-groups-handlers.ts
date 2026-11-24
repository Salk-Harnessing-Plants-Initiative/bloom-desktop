/**
 * Export Scans' experiment and day lists (#436): scan counts per experiment, the days
 * one experiment has scans on, and one day's scans, so the page can open without
 * loading every scan. All three take the same filter (#471), applied by one matcher,
 * so a count always equals what opening the row lists.
 */

import type { IpcMain } from 'electron';
import type { DatabaseResponse, ScanSummary } from '../types/database';
import type {
  ExperimentScanCount,
  ExperimentScanDay,
  ScanFilter,
} from '../types/scan-groups';
import { isIsoDate, toIsoDate } from '../utils/wave-dates';
import { capturedMsSql } from './capture-date-sql';
import {
  isEmptyFilter,
  scanMatcher,
  type FilterableScan,
} from '../utils/scan-search';

/** A scan as the filter and the day list need it. */
const SCAN_ROW_SELECT = {
  id: true,
  experiment_id: true,
  plant_id: true,
  capture_date: true,
  scanner_name: true,
  experiment: { select: { name: true } },
  phenotyper: { select: { name: true } },
} as const;

interface ScanRow {
  id: string;
  experiment_id: string;
  plant_id: string;
  capture_date: Date;
  scanner_name: string;
  experiment: { name: string };
  phenotyper: { name: string };
}

/** The part of the Prisma client these handlers use, so tests can pass a fake. */
export interface ScanGroupsDbLike {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
  scan: {
    findMany(args: {
      where: {
        deleted: false;
        experiment_id?: string;
        id?: { in: string[] };
      };
      select: typeof SCAN_ROW_SELECT;
    }): Promise<ScanRow[]>;
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

/**
 * The filter from the renderer, checked: the search a string, dates "YYYY-MM-DD".
 * Returns an error message for anything else.
 */
export function readFilter(value: unknown): ScanFilter | string {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object') return 'filter must be an object';
  const raw = value as Record<string, unknown>;
  const filter: ScanFilter = {};
  if (raw.search !== undefined && raw.search !== '') {
    if (typeof raw.search !== 'string') return 'search must be a string';
    filter.search = raw.search;
  }
  for (const key of ['dateFrom', 'dateTo'] as const) {
    const part = raw[key];
    if (part === undefined || part === '') continue;
    if (!isIsoDate(part)) return `${key} must be a date (YYYY-MM-DD)`;
    filter[key] = part;
  }
  return filter;
}

/**
 * Non-deleted scans matching the filter, optionally of one experiment only, and
 * optionally only among the given scan ids.
 */
async function matchingScans(
  deps: ScanGroupsDeps,
  filter: ScanFilter,
  experimentId?: string,
  ids?: string[]
): Promise<ScanRow[]> {
  const rows = await deps.db.scan.findMany({
    where: {
      deleted: false,
      ...(experimentId ? { experiment_id: experimentId } : {}),
      ...(ids ? { id: { in: ids } } : {}),
    },
    select: SCAN_ROW_SELECT,
  });
  const matches = scanMatcher(filter);
  return rows.filter((row) => {
    const scan: FilterableScan = {
      ...row,
      capture_date: new Date(row.capture_date),
      experiment_name: row.experiment.name,
      phenotyper_name: row.phenotyper.name,
    };
    return matches(scan);
  });
}

function fail(error: unknown): DatabaseResponse<never> {
  console.error('[ScanGroups]', error);
  return {
    success: false,
    error: error instanceof Error ? error.message : 'Unknown error',
  };
}

/** A scan's capture time in ms, for pilot text dates and newer number dates alike. */
const CAPTURED_MS = capturedMsSql();

/** Non-deleted scans counted per experiment, with each one's most recent capture. */
const EXPERIMENT_COUNTS_SQL = `
SELECT "experiment_id", COUNT(*) AS "scan_count", MAX(${CAPTURED_MS}) AS "latest_ms"
FROM "Scan"
WHERE "deleted" = 0
GROUP BY "experiment_id"`;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The ids of an experiment's non-deleted scans captured within a day either side of
 * a local day. The margin covers any time zone and pilot text dates read as UTC; the
 * exact local day is then checked in JS, the same way the day list counts it.
 */
const SCAN_IDS_NEAR_DAY_SQL = `
SELECT "id" FROM "Scan"
WHERE "deleted" = 0 AND "experiment_id" = ?
  AND ${CAPTURED_MS} >= ? AND ${CAPTURED_MS} < ?`;

async function scanIdsNearDay(
  deps: ScanGroupsDeps,
  experimentId: string,
  day: string
): Promise<string[]> {
  const dayStartMs = new Date(`${day}T00:00:00`).getTime();
  const rows = await deps.db.$queryRawUnsafe<Array<{ id: string }>>(
    SCAN_IDS_NEAR_DAY_SQL,
    experimentId,
    dayStartMs - DAY_MS,
    dayStartMs + 2 * DAY_MS
  );
  return rows.map((row) => row.id);
}

interface ExperimentCountRow {
  experiment_id: string;
  scan_count: number | bigint;
  latest_ms: number | bigint | null;
}

/** The filtered scans counted per experiment, as the grouped query counts them. */
function countRows(rows: ScanRow[]): ExperimentCountRow[] {
  const groups = new Map<string, ExperimentCountRow>();
  for (const row of rows) {
    const captured = new Date(row.capture_date).getTime();
    const group = groups.get(row.experiment_id);
    if (!group) {
      groups.set(row.experiment_id, {
        experiment_id: row.experiment_id,
        scan_count: 1,
        latest_ms: captured,
      });
    } else {
      group.scan_count = Number(group.scan_count) + 1;
      group.latest_ms = Math.max(Number(group.latest_ms), captured);
    }
  }
  return [...groups.values()];
}

/**
 * Experiments with non-deleted scans, with their counts, the one with the most recent
 * scan first (ties by name). Sorted by name, a station's many older experiments came
 * first and the ones being scanned now were at the bottom of a long list.
 */
export async function listExperimentScanCounts(
  deps: ScanGroupsDeps,
  filterInput?: unknown
): Promise<DatabaseResponse<ExperimentScanCount[]>> {
  const filter = readFilter(filterInput);
  if (typeof filter === 'string') return { success: false, error: filter };
  try {
    const counts = isEmptyFilter(filter)
      ? await deps.db.$queryRawUnsafe<ExperimentCountRow[]>(
          EXPERIMENT_COUNTS_SQL
        )
      : countRows(await matchingScans(deps, filter));
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

/** The experiment id from the renderer, trimmed; '' when missing. */
const readExperimentId = (value: unknown) =>
  typeof value === 'string' ? value.trim() : '';

/**
 * The local days one experiment has matching non-deleted scans on, newest first.
 * Grouped here, not in SQL: databases from the pilot app can mix text and number
 * dates, which SQL date functions and Prisma's groupBy don't handle.
 */
export async function listExperimentScanDays(
  deps: ScanGroupsDeps,
  experimentIdInput: unknown,
  filterInput?: unknown
): Promise<DatabaseResponse<ExperimentScanDay[]>> {
  const experiment = readExperimentId(experimentIdInput);
  if (!experiment) {
    return { success: false, error: 'experimentId must be a non-empty string' };
  }
  const filter = readFilter(filterInput);
  if (typeof filter === 'string') return { success: false, error: filter };
  try {
    const scans = await matchingScans(deps, filter, experiment);
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

/**
 * One experiment's matching scans on one local day, newest first; with day null,
 * of every day, so ticking an experiment reads it once rather than once per day.
 */
export async function listDayScans(
  deps: ScanGroupsDeps,
  experimentIdInput: unknown,
  dayInput: unknown,
  filterInput?: unknown
): Promise<DatabaseResponse<ScanSummary[]>> {
  const experiment = readExperimentId(experimentIdInput);
  if (!experiment) {
    return { success: false, error: 'experimentId must be a non-empty string' };
  }
  // null: every day of the experiment.
  if (dayInput !== null && !isIsoDate(dayInput)) {
    return { success: false, error: 'day must be a date (YYYY-MM-DD) or null' };
  }
  const day = dayInput as string | null;
  const filter = readFilter(filterInput);
  if (typeof filter === 'string') return { success: false, error: filter };
  try {
    // One day reads only the scans near it, not the whole experiment.
    const ids =
      day === null ? undefined : await scanIdsNearDay(deps, experiment, day);
    const scans = await matchingScans(deps, filter, experiment, ids);
    const data = scans
      .filter(
        (s) => day === null || toIsoDate(new Date(s.capture_date)) === day
      )
      .sort(
        (a, b) =>
          new Date(b.capture_date).getTime() -
          new Date(a.capture_date).getTime()
      )
      .map((s) => ({
        id: s.id,
        experiment_id: s.experiment_id,
        plant_id: s.plant_id,
        capture_date: s.capture_date,
        scanner_name: s.scanner_name,
        experiment: { name: s.experiment.name },
      }));
    return { success: true, data };
  } catch (error) {
    return fail(error);
  }
}

export function registerScanGroupsHandlers(
  deps: ScanGroupsDeps & { ipcMain: Pick<IpcMain, 'handle'> }
): void {
  deps.ipcMain.handle('db:scans:experimentCounts', (_event, filter: unknown) =>
    listExperimentScanCounts(deps, filter)
  );
  deps.ipcMain.handle(
    'db:scans:experimentDays',
    (_event, experimentId: unknown, filter: unknown) =>
      listExperimentScanDays(deps, experimentId, filter)
  );
  deps.ipcMain.handle(
    'db:scans:dayScans',
    (_event, experimentId: unknown, day: unknown, filter: unknown) =>
      listDayScans(deps, experimentId, day, filter)
  );
}
