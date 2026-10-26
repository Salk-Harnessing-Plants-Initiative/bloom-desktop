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
  /** What the new date is ("transfer", "sowing", …); null when not recorded. */
  start_date_basis: string | null;
  start_date_basis_other: string | null;
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
  /** What the date is ("transfer", "sowing", …); null only for a backfilled wave. */
  start_date_basis: string | null;
  start_date_basis_other: string | null;
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
  /** What the date is: required. */
  startDateBasis: string;
  /** Required when startDateBasis is "other". */
  startDateBasisOther?: string;
  /**
   * Required when the date is out of order with another wave's, or the wave number
   * skips ahead of the experiment's waves.
   */
  note?: string;
  /** Who is setting or changing the date: required, so the log can say who. */
  phenotyperId: string;
}

export interface CylinderWaveDateChangeInput {
  waveId: string;
  sowingDate: string;
  /** What the date is: required, and may change on its own. */
  startDateBasis: string;
  /** Required when startDateBasis is "other". */
  startDateBasisOther?: string;
  /** Required once the wave has scans, or when the new date conflicts with another wave. */
  reason?: string;
  /** Who is setting or changing the date: required, so the log can say who. */
  phenotyperId: string;
}
