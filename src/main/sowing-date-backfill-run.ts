/**
 * The `--backfill-sowing-dates` command (#407), without Electron so it can be
 * tested: run once by hand after installing the version that added sowing dates.
 * Waves scanned before then get the sowing date their scans imply (see
 * sowing-date-backfill.ts); `--dry-run` only reports. Every run, dry or not,
 * writes a report to ~/.bloom/logs so there's a record of what it did.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { SowingDateBackfillResult } from '../types/cylinder-wave';
import {
  backfillSowingDates,
  type SowingDateBackfillDbLike,
} from './sowing-date-backfill';

export const BACKFILL_FLAG = '--backfill-sowing-dates';
export const DRY_RUN_FLAG = '--dry-run';

export interface SowingDateBackfillRequest {
  dryRun: boolean;
}

/** The request when the app was started with `--backfill-sowing-dates`, else null. */
export function parseSowingDateBackfillArgs(
  argv: string[]
): SowingDateBackfillRequest | null {
  if (!argv.includes(BACKFILL_FLAG)) return null;
  return { dryRun: argv.includes(DRY_RUN_FLAG) };
}

export interface SowingDateBackfillReport extends SowingDateBackfillResult {
  ranAt: string;
  dryRun: boolean;
  appVersion: string;
  databasePath: string;
}

export interface SowingDateBackfillRunDeps {
  db: SowingDateBackfillDbLike;
  databasePath: string;
  logsDir: string;
  appVersion: string;
  now: () => Date;
  log?: (message: string) => void;
}

/** "20261023-140512" in local time, for the report's file name. */
function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Run the backfill (or the dry run) and write its report; returns the report and its path. */
export async function runSowingDateBackfill(
  request: SowingDateBackfillRequest,
  deps: SowingDateBackfillRunDeps
): Promise<{ report: SowingDateBackfillReport; reportPath: string }> {
  const ranAt = deps.now();
  const result = await backfillSowingDates(deps.db, deps.log ?? console.log, {
    dryRun: request.dryRun,
  });
  const report: SowingDateBackfillReport = {
    ranAt: ranAt.toISOString(),
    dryRun: request.dryRun,
    appVersion: deps.appVersion,
    databasePath: deps.databasePath,
    ...result,
  };
  await fs.promises.mkdir(deps.logsDir, { recursive: true });
  const reportPath = path.join(
    deps.logsDir,
    `sowing-date-backfill-${stamp(ranAt)}${request.dryRun ? '-dry-run' : ''}.json`
  );
  await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2));
  return { report, reportPath };
}

/** A short summary for the message shown at the end. */
export function summarizeSowingDateBackfill(
  report: SowingDateBackfillReport,
  reportPath: string
): string {
  const verb = report.dryRun ? 'Would set' : 'Set';
  const lines = [
    `${verb} the start date of ${report.set.length} wave(s) from their earlier scans.`,
    ...report.set.map(
      (w) =>
        `  ${w.experiment}, wave ${w.wave_number}: ${w.sowingDate} (${w.agreeing} of ${w.scanCount} scans)`
    ),
  ];
  if (report.leftForOperator.length > 0) {
    lines.push(
      `${report.leftForOperator.length} wave(s) left for the operator (earlier scans disagree):`,
      ...report.leftForOperator.map(
        (w) =>
          `  ${w.experiment}, wave ${w.wave_number}: ` +
          w.candidates.map((c) => `${c.date} (${c.count})`).join(', ')
      )
    );
  }
  if (report.set.length === 0 && report.leftForOperator.length === 0) {
    lines.splice(
      0,
      lines.length,
      'Every wave with scans already has a start date. Nothing to do.'
    );
  }
  lines.push('', `Report: ${reportPath}`);
  return lines.join('\n');
}
