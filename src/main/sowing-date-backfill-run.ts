/**
 * The `--backfill-sowing-dates` command (#407), without Electron so it can be
 * tested: run once by hand after installing the version that added start dates.
 * Waves scanned before then get the start date their scans imply (see
 * sowing-date-backfill.ts); `--dry-run` only reports. Every run, dry or not,
 * writes a report to ~/.bloom/logs so there's a record of what it did.
 */

import * as fs from 'fs';
import * as path from 'path';
import type {
  AgeMismatch,
  SowingDateBackfillResult,
  SowingDateBackfillWave,
} from '../types/cylinder-wave';
import {
  backfillSowingDates,
  type SowingDateBackfillDbLike,
} from './sowing-date-backfill';
import { describeOtherDates } from '../utils/sowing-date-backfill';
import { formatSowingDate } from '../utils/sowing-date';

export const BACKFILL_FLAG = '--backfill-sowing-dates';
export const DRY_RUN_FLAG = '--dry-run';
/** How many waves the message box lists before pointing to the report. */
export const MAX_WAVES_SHOWN = 20;

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

export interface SowingDateBackfillOutcome {
  report: SowingDateBackfillReport;
  /** Where the report was saved, or null if it couldn't be. */
  reportPath: string | null;
  /** Why the report couldn't be saved. */
  reportError?: string;
  /** The mismatched scans as CSV, for a spreadsheet; null when there are none or it wasn't saved. */
  mismatchesPath?: string | null;
}

/** The CSV's columns, in order: everything needed to find and fix each scan. */
export const MISMATCH_COLUMNS: (keyof AgeMismatch)[] = [
  'experiment',
  'experiment_id',
  'wave_number',
  'plant_id',
  'accession_name',
  'scan_id',
  'capture_date',
  'captured',
  'typed_age',
  'age_from_date',
  'implied_start_date',
  'wave_start_date',
  'wave_disputed',
  'phenotyper',
  'scanner_name',
  'path',
  'images_uploaded',
  'images_total',
];

function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The mismatched scans as CSV, one row per scan. */
export function mismatchesCsv(mismatches: AgeMismatch[]): string {
  const rows = [
    MISMATCH_COLUMNS.join(','),
    ...mismatches.map((m) =>
      MISMATCH_COLUMNS.map((c) => csvCell(m[c])).join(',')
    ),
  ];
  return `${rows.join('\r\n')}\r\n`;
}

/** "20261023-140512" in local time, for the report's file name. */
function stamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** Run the backfill (or the dry run) and save its report, even if some waves failed. */
export async function runSowingDateBackfill(
  request: SowingDateBackfillRequest,
  deps: SowingDateBackfillRunDeps
): Promise<SowingDateBackfillOutcome> {
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
  const base = path.join(
    deps.logsDir,
    `sowing-date-backfill-${stamp(ranAt)}${request.dryRun ? '-dry-run' : ''}`
  );
  const reportPath = `${base}.json`;
  try {
    await fs.promises.mkdir(deps.logsDir, { recursive: true });
    await fs.promises.writeFile(reportPath, JSON.stringify(report, null, 2));
    let mismatchesPath: string | null = null;
    if (report.ageMismatches.length > 0) {
      mismatchesPath = `${base}-age-mismatches.csv`;
      await fs.promises.writeFile(
        mismatchesPath,
        mismatchesCsv(report.ageMismatches)
      );
    }
    return { report, reportPath, mismatchesPath };
  } catch (error) {
    return {
      report,
      reportPath: null,
      reportError: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/** True when something needs attention: a wave couldn't be set, or the report wasn't saved. */
export function backfillHadProblems(
  outcome: SowingDateBackfillOutcome
): boolean {
  return outcome.report.failed.length > 0 || outcome.reportPath === null;
}

/** One wave, with the same other dates (and wording) as its log entry on the Experiments page. */
function waveLine(w: SowingDateBackfillWave): string {
  const base = `  ${w.experiment}, wave ${w.wave_number}: ${formatSowingDate(w.sowingDate)} (${w.agreeing} of ${w.scanCount} scans)`;
  const others = describeOtherDates(w);
  return others ? `${base}; others point to ${others}` : base;
}

/** At most MAX_WAVES_SHOWN lines, then a pointer to the report. */
function capped(lines: string[]): string[] {
  if (lines.length <= MAX_WAVES_SHOWN) return lines;
  return [
    ...lines.slice(0, MAX_WAVES_SHOWN),
    `  …and ${lines.length - MAX_WAVES_SHOWN} more (see the report)`,
  ];
}

/** A short summary for the message shown at the end. */
export function summarizeSowingDateBackfill(
  outcome: SowingDateBackfillOutcome
): string {
  const { report } = outcome;
  const lines: string[] = [];
  if (report.set.length === 0 && report.failed.length === 0) {
    lines.push(
      'Every wave with scans already has a start date. Nothing to do.'
    );
  } else if (report.set.length > 0) {
    const disputed = report.set.filter((w) => w.disputed).length;
    lines.push(
      `${report.dryRun ? 'Would set' : 'Set'} the start date of ${report.set.length} wave(s) from their earlier scans` +
        (disputed > 0
          ? `. In ${disputed} of them the scans disagree; the other dates are logged with the wave on the Experiments page.`
          : '.'),
      ...capped(report.set.map(waveLine))
    );
  }
  if (report.failed.length > 0) {
    lines.push(
      '',
      `Couldn't set ${report.failed.length} wave(s). Run this again to retry them:`,
      ...capped(
        report.failed.map(
          (f) => `  ${f.experiment}, wave ${f.wave_number}: ${f.error}`
        )
      )
    );
  }
  if (report.ageMismatches.length > 0) {
    const waves = new Set(
      report.ageMismatches.map((m) => `${m.experiment}\u0000${m.wave_number}`)
    ).size;
    // In a wave whose scans disagreed, the date chosen may be what's wrong, not the age.
    const inDisputed = report.ageMismatches.filter(
      (m) => m.wave_disputed
    ).length;
    const inAgreeing = report.ageMismatches.length - inDisputed;
    lines.push(
      '',
      `${report.ageMismatches.length} scan(s) in ${waves} wave(s) have a typed age that doesn't match their wave's date. They are listed in the report, with what's needed to find each one here and in Bloom; nothing was changed.`
    );
    if (inAgreeing > 0) {
      lines.push(
        `  ${inAgreeing} in waves whose other scans agree: the typed age was probably wrong.`
      );
    }
    if (inDisputed > 0) {
      lines.push(
        `  ${inDisputed} in waves whose scans disagreed: the wave's date may be what's wrong, not the age. Check those waves on the Experiments page.`
      );
    }
    if (outcome.mismatchesPath) {
      lines.push(`For a spreadsheet: ${outcome.mismatchesPath}`);
    }
  }
  lines.push(
    '',
    outcome.reportPath
      ? `Report: ${outcome.reportPath}`
      : `The report couldn't be saved (${outcome.reportError}). The waves above were ${report.dryRun ? 'not changed' : 'still set'}.`
  );
  return lines.join('\n');
}
