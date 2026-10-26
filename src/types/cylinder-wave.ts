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
