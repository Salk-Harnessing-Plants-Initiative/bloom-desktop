/**
 * Working out an older wave's sowing date from its earlier scans (#407).
 *
 * Scans saved before sowing dates existed carry a typed age. Each one implies a
 * sowing date: its local capture date minus its age. When nearly all of a wave's
 * scans agree, that date is the wave's sowing date; when they don't (typed ages
 * were sometimes wrong, see #407 and #408), the operator chooses, seeing what the
 * scans point to. Shared by the main process (start-up backfill, checks when a
 * date is saved) and Capture Scan (showing the candidates).
 */

import { formatSowingDate, plantAgeDays, toIsoDate } from './sowing-date';

/** At least this share of a wave's scans must agree for its date to be set automatically. */
export const AGREEMENT_SHARE = 0.9;
/** Implied dates this many days apart still agree (a scan just after midnight). */
export const AGREEMENT_TOLERANCE_DAYS = 1;

export interface EarlierScan {
  experiment_id: string;
  wave_number: number;
  capture_date: Date;
  plant_age_days: number;
}

export interface ImpliedDateCount {
  /** "YYYY-MM-DD" */
  date: string;
  /** Scans that imply exactly this date. */
  count: number;
}

export interface WavePlan {
  experiment_id: string;
  wave_number: number;
  scanCount: number;
  /** Implied dates, most common first. */
  candidates: ImpliedDateCount[];
  /** Scans within a day of the most common date. */
  agreeing: number;
  /** The date to set automatically, or null to leave the wave for the operator. */
  sowingDate: string | null;
}

/** The sowing date a scan implies: its local capture date minus its age. */
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

/** True when `date` is within a day of the earlier scans' most common date (or there are none). */
export function agreesWithEarlierScans(
  date: string,
  plan: Pick<WavePlan, 'candidates'>
): boolean {
  const top = plan.candidates[0];
  return !top || daysApart(date, top.date) <= AGREEMENT_TOLERANCE_DAYS;
}

/** The plan for one wave's scans (all from the same experiment and wave). */
export function planWave(scans: EarlierScan[]): WavePlan {
  const counts = new Map<string, number>();
  for (const scan of scans) {
    const date = impliedSowingDate(scan);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const candidates = [...counts.entries()]
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => b.count - a.count || a.date.localeCompare(b.date));
  const top = candidates[0];
  const agreeing = top
    ? candidates
        .filter((c) => daysApart(c.date, top.date) <= AGREEMENT_TOLERANCE_DAYS)
        .reduce((sum, c) => sum + c.count, 0)
    : 0;
  return {
    experiment_id: scans[0]?.experiment_id ?? '',
    wave_number: scans[0]?.wave_number ?? 0,
    scanCount: scans.length,
    candidates,
    agreeing,
    sowingDate:
      top && agreeing >= AGREEMENT_SHARE * scans.length ? top.date : null,
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

/** What earlier scans point to, for the operator. */
export function describeEarlierScans(
  waveNumber: number,
  plan: Pick<WavePlan, 'candidates' | 'scanCount'>
): string {
  const shown = plan.candidates
    .slice(0, 3)
    .map(
      (c) =>
        `${formatSowingDate(c.date)} (${c.count} ${c.count === 1 ? 'scan' : 'scans'})`
    );
  return `Earlier scans in wave ${waveNumber} (${plan.scanCount}) point to a start date of ${shown.join(' or ')}.`;
}

/** Why a date far from what the earlier scans point to needs a note. */
export function earlierScansDisagree(
  waveNumber: number,
  plan: Pick<WavePlan, 'candidates' | 'scanCount'>
): string {
  return `${describeEarlierScans(waveNumber, plan)} Add a note saying why this date is different.`;
}
