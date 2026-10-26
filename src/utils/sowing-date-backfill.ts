/**
 * Working out an older wave's start date from its earlier scans (#407).
 *
 * Scans saved before start dates existed carry a typed age. Each one implies a start
 * date: its local capture date minus its age, so with that date as day 0 the scan's
 * age stays the same. A wave's date is the one most of its scans point to. When fewer
 * than 90% of them agree within a day, the wave is "disputed" and the other dates are
 * recorded with it. Scans more than a day off the chosen date probably had their age
 * typed wrongly (see #407 and #408), so they're listed for checking.
 */

import { formatSowingDate, plantAgeDays, toIsoDate } from './sowing-date';
import type { ImpliedStartDate } from '../types/cylinder-wave';

/** At least this share of a wave's scans must agree for its date not to be disputed. */
export const AGREEMENT_SHARE = 0.9;
/** Implied dates this many days apart still agree (a scan just after midnight). */
export const AGREEMENT_TOLERANCE_DAYS = 1;
/** How many of a disputed wave's other dates its log entry names. */
export const MAX_OTHER_DATES_NAMED = 3;

export interface EarlierScan {
  id: string;
  experiment_id: string;
  wave_number: number;
  plant_id: string;
  accession_name: string | null;
  phenotyper_id: string;
  scanner_name: string;
  path: string;
  capture_date: Date;
  plant_age_days: number;
}

/** A scan whose typed age is more than a day off its wave's date. */
export interface MismatchedScan {
  scan: EarlierScan;
  /** The local capture date, "YYYY-MM-DD". */
  captured: string;
  implied_start_date: string;
  age_from_date: number;
}

export interface WavePlan {
  experiment_id: string;
  wave_number: number;
  scanCount: number;
  /** Implied dates, most common first (ties: the earlier date). */
  candidates: ImpliedStartDate[];
  /** Scans within a day of the date set. */
  agreeing: number;
  /** The date to set: the most common implied date. */
  sowingDate: string;
  /** Fewer than AGREEMENT_SHARE of the scans agree. */
  disputed: boolean;
  mismatches: MismatchedScan[];
}

/** The local calendar date of `d`, "YYYY-MM-DD". */
function localDate(d: Date): string {
  return toIsoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate()));
}

/** The start date a scan implies: its local capture date minus its age. */
export function impliedSowingDate(
  scan: Pick<EarlierScan, 'capture_date' | 'plant_age_days'>
): string {
  const d = scan.capture_date;
  return toIsoDate(
    new Date(d.getFullYear(), d.getMonth(), d.getDate() - scan.plant_age_days)
  );
}

/** Whole days between two "YYYY-MM-DD" dates. */
function daysApart(a: string, b: string): number {
  const [y, m, d] = b.split('-').map(Number);
  return Math.abs(plantAgeDays(a, new Date(y, m - 1, d)));
}

/** The plan for one wave's scans (at least one, all from the same experiment and wave). */
export function planWave(scans: EarlierScan[]): WavePlan {
  const counts = new Map<string, number>();
  for (const scan of scans) {
    const date = impliedSowingDate(scan);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const candidates = [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));
  const sowingDate = candidates[0].date;
  const agreeing = candidates
    .filter((c) => daysApart(c.date, sowingDate) <= AGREEMENT_TOLERANCE_DAYS)
    .reduce((sum, c) => sum + c.count, 0);
  const mismatches = scans
    .filter(
      (s) =>
        daysApart(impliedSowingDate(s), sowingDate) > AGREEMENT_TOLERANCE_DAYS
    )
    .map((s) => ({
      scan: s,
      captured: localDate(s.capture_date),
      implied_start_date: impliedSowingDate(s),
      age_from_date: plantAgeDays(sowingDate, s.capture_date),
    }));
  return {
    experiment_id: scans[0].experiment_id,
    wave_number: scans[0].wave_number,
    scanCount: scans.length,
    candidates,
    agreeing,
    sowingDate,
    disputed: agreeing < AGREEMENT_SHARE * scans.length,
    mismatches,
  };
}

/** One plan per experiment and wave, in experiment then wave order. */
export function planBackfill(scans: EarlierScan[]): WavePlan[] {
  const groups = new Map<string, EarlierScan[]>();
  for (const scan of scans) {
    const key = `${scan.experiment_id}\u0000${scan.wave_number}`;
    const group = groups.get(key);
    if (group) group.push(scan);
    else groups.set(key, [scan]);
  }
  return [...groups.values()]
    .map(planWave)
    .sort(
      (a, b) =>
        a.experiment_id.localeCompare(b.experiment_id) ||
        a.wave_number - b.wave_number
    );
}

/**
 * The reason on the wave's first log entry, shown on the Experiments page, e.g.
 * "Set from earlier scans (capture date minus typed age): 80 of 100 point to
 * 12 Oct 2026; others point to 15 Oct 2026 (20 scans)."
 */
export function backfillReason(plan: WavePlan): string {
  const scans = (n: number) => `${n} ${n === 1 ? 'scan' : 'scans'}`;
  let reason =
    `Set from earlier scans (capture date minus typed age): ${plan.agreeing} of ` +
    `${plan.scanCount} point to ${formatSowingDate(plan.sowingDate)}`;
  const others = plan.candidates.filter(
    (c) => daysApart(c.date, plan.sowingDate) > AGREEMENT_TOLERANCE_DAYS
  );
  if (others.length > 0) {
    const named = others
      .slice(0, MAX_OTHER_DATES_NAMED)
      .map((c) => `${formatSowingDate(c.date)} (${scans(c.count)})`);
    const more = others.length - named.length;
    reason += `; others point to ${named.join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
  }
  return `${reason}.`;
}
