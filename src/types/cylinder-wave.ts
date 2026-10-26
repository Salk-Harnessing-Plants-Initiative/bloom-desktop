/**
 * Types for CylinderScan waves and their dates (#407, #428): each wave has a sowing,
 * germination and transfer-to-cylinder date, and Capture Scan computes the plant age
 * from the germination date (days after germination). Dates are local calendar dates,
 * "YYYY-MM-DD".
 */

/** One set or change of a wave's dates, for the log on the Experiments page. */
export interface CylinderWaveDateChange {
  id: string;
  /** The "old" dates are null when the wave was first set. */
  old_germination_date: string | null;
  new_germination_date: string;
  old_sowing_date: string | null;
  new_sowing_date: string | null;
  /** Null means the same day as germination. */
  old_transfer_date: string | null;
  new_transfer_date: string | null;
  reason: string | null;
  changed_by_name: string | null;
  /** When the change was made (ISO 8601). */
  changed_at: string;
}

/** A wave of an experiment, with its dates. */
export interface CylinderWaveInfo {
  id: string;
  wave_number: number;
  /** The plant age is computed from this date. */
  germination_date: string;
  /** Null only for a wave the backfill set. */
  sowing_date: string | null;
  /** Null means the same day as germination. */
  transfer_date: string | null;
  note: string | null;
  /** Who set the current dates, when known. */
  set_by_name: string | null;
  /** When the current dates were set (ISO 8601). */
  set_at: string;
  /** Saved (not deleted) scans in this wave; the dates need a reason to change once > 0. */
  scanCount: number;
  /** Every set or change of the dates, oldest first. */
  changes: CylinderWaveDateChange[];
}

/** A wave's three dates, as Capture Scan sends them. */
export interface WaveDatesInput {
  germinationDate: string;
  sowingDate: string;
  /** Left out (or empty) when it's the same day as germination. */
  transferDate?: string;
}

export interface CylinderWaveCreateInput extends WaveDatesInput {
  experimentId: string;
  waveNumber: number;
  /**
   * Required when the germination date is out of order with another wave's, or the
   * wave number skips ahead of the experiment's waves.
   */
  note?: string;
  /** Who is setting or changing the dates: required, so the log can say who. */
  phenotyperId: string;
}

export interface CylinderWaveDateChangeInput extends WaveDatesInput {
  waveId: string;
  /** Required once the wave has scans, or when the new germination date conflicts with another wave. */
  reason?: string;
  /** Who is setting or changing the dates: required, so the log can say who. */
  phenotyperId: string;
}
