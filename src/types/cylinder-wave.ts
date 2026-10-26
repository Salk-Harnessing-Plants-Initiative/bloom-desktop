/**
 * Types for CylinderScan waves and their sowing dates (#407): Capture Scan
 * calculates the plant age from the wave's sowing date.
 */

/** One change to a wave's sowing date, for the log on the Experiments page. */
export interface CylinderWaveDateChange {
  id: string;
  /** Null for the wave's first date. */
  old_sowing_date: string | null;
  new_sowing_date: string;
  reason: string | null;
  changed_by_name: string | null;
  /** When the change was made (ISO 8601). */
  changed_at: string;
}

/** A wave of an experiment, with its sowing date ("YYYY-MM-DD", local). */
export interface CylinderWaveInfo {
  id: string;
  wave_number: number;
  sowing_date: string;
  note: string | null;
  /** Who set the current sowing date, when known. */
  set_by_name: string | null;
  /** When the current sowing date was set (ISO 8601). */
  set_at: string;
  /** Saved (not deleted) scans in this wave; the date needs a reason to change once > 0. */
  scanCount: number;
  /** Every change to the sowing date, oldest first. */
  changes: CylinderWaveDateChange[];
}

export interface CylinderWaveCreateInput {
  experimentId: string;
  waveNumber: number;
  sowingDate: string;
  /** Required when the date is on or before an earlier wave's (or on or after a later one's). */
  note?: string;
  /** Required when the wave number skips ahead of the experiment's waves. */
  waveConfirmed?: boolean;
  /** Who is setting or changing the date: required, so the log can say who. */
  phenotyperId: string;
}

export interface CylinderWaveDateChangeInput {
  waveId: string;
  sowingDate: string;
  /** Required once the wave has scans, or when the new date conflicts with another wave. */
  reason?: string;
  /** Who is setting or changing the date: required, so the log can say who. */
  phenotyperId: string;
}

/** A start date one or more earlier scans imply, and how many. */
export interface ImpliedStartDate {
  /** "YYYY-MM-DD" */
  date: string;
  count: number;
}

/** One wave in the start-date backfill's report. */
export interface SowingDateBackfillWave {
  experiment: string;
  wave_number: number;
  scanCount: number;
  /** Scans within a day of the date set. */
  agreeing: number;
  /** The date set: the one most of the wave's scans point to. */
  sowingDate: string;
  /** Fewer than 90% of the scans agree: the other dates are in the log entry's reason. */
  disputed: boolean;
  /** Implied dates, most common first. */
  candidates: ImpliedStartDate[];
}

/** A wave the backfill couldn't set, and why. */
export interface SowingDateBackfillFailure {
  experiment: string;
  wave_number: number;
  error: string;
}

/**
 * A scan whose typed age doesn't fit its wave's date (more than a day off), so it was
 * probably typed wrongly (or, in a wave whose scans disagreed, the wave's date is).
 * Listed only: saved scans keep their age. It carries what's
 * needed to find the scan here and in Bloom, and to decide the fix.
 */
export interface AgeMismatch {
  /** Bloom Desktop's Scan id. */
  scan_id: string;
  experiment_id: string;
  experiment: string;
  wave_number: number;
  plant_id: string;
  accession_name: string | null;
  phenotyper: string | null;
  scanner_name: string;
  /** The scan's folder, relative to the scans directory. */
  path: string;
  /** When it was captured (ISO 8601): Bloom's date_scanned for this scan. */
  capture_date: string;
  /** The local capture date, "YYYY-MM-DD". */
  captured: string;
  typed_age: number;
  /** The age the wave's date gives for that capture date. */
  age_from_date: number;
  /** The start date this scan's typed age implies. */
  implied_start_date: string;
  /** The start date the wave was given. */
  wave_start_date: string;
  /** The wave's scans disagreed: the chosen date, not this age, may be what's wrong. */
  wave_disputed: boolean;
  /** Of the scan's images, how many were uploaded to Bloom, and how many there are. */
  images_uploaded: number;
  images_total: number;
}

export interface SowingDateBackfillResult {
  set: SowingDateBackfillWave[];
  failed: SowingDateBackfillFailure[];
  ageMismatches: AgeMismatch[];
}
