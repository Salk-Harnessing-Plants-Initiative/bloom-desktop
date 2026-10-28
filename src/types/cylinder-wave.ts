/**
 * Types for CylinderScan waves, their plants, and their dates (#407, #428). Each plant
 * in a wave has a sowing, germination and transfer-to-cylinder date, and Capture Scan
 * computes the plant age from its germination date (days after germination). When all
 * a wave's plants share their dates, they're entered once on the wave; otherwise
 * (dates_per_plant) each plant's are entered before its first scan. Dates are local
 * calendar dates, "YYYY-MM-DD".
 */

/** One set or change of a wave's dates, for the log on the Experiments page. */
export interface CylinderWaveDateChange {
  id: string;
  /** The "old" dates are null when the wave was first set. */
  old_germination_date: string | null;
  /** Null for a wave whose dates are per plant. */
  new_germination_date: string | null;
  old_sowing_date: string | null;
  new_sowing_date: string | null;
  /** Null means the same day as germination. */
  old_transfer_date: string | null;
  new_transfer_date: string | null;
  /** The germination colour before and after (#429); null for none. */
  old_germ_day_color: string | null;
  new_germ_day_color: string | null;
  reason: string | null;
  changed_by_name: string | null;
  /** When the change was made (ISO 8601). */
  changed_at: string;
}

/** A wave of an experiment, with its dates. */
export interface CylinderWaveInfo {
  id: string;
  wave_number: number;
  /** The plants' dates differ, so each plant's are entered before its first scan. */
  dates_per_plant: boolean;
  /** Every plant's germination date; null when the dates are per plant. */
  germination_date: string | null;
  /** Null when the dates are per plant, or for a wave the backfill set. */
  sowing_date: string | null;
  /** Null means the same day as germination. */
  transfer_date: string | null;
  /** Every plant's germination colour (#429); null when per plant, or none. */
  germ_day_color: string | null;
  note: string | null;
  /** Who set the current dates, when known. */
  set_by_name: string | null;
  /** When the current dates were set (ISO 8601). */
  set_at: string;
  /** Saved (not deleted) scans with this wave number, older ones included (shown). */
  scanCount: number;
  /**
   * Saved scans taken with this wave's dates (saved under its plants); the dates are
   * final once > 0. Scans from before the dates were recorded don't count.
   */
  datedScanCount: number;
  /** Every set or change of the dates, oldest first. */
  changes: CylinderWaveDateChange[];
  /** The wave's plants that have their own dates, by barcode. */
  plantsWithOwnDates: CylinderPlantInfo[];
}

/** One change to a plant's own dates. */
export interface CylinderPlantDateChange {
  id: string;
  /** The "old" dates are null when a plant in a per-plant wave was first set. */
  old_germination_date: string | null;
  new_germination_date: string;
  old_sowing_date: string | null;
  new_sowing_date: string | null;
  old_transfer_date: string | null;
  new_transfer_date: string | null;
  /** The germination colour before and after (#429); null for none. */
  old_germ_day_color: string | null;
  new_germ_day_color: string | null;
  reason: string | null;
  changed_by_name: string | null;
  /** ISO 8601. */
  changed_at: string;
}

/** A plant in a wave, with its dates; the plant age is computed from its germination date. */
export interface CylinderPlantInfo {
  id: string;
  wave_id: string;
  plant_barcode: string;
  germination_date: string;
  sowing_date: string | null;
  /** Null means the same day as germination. */
  transfer_date: string | null;
  /** Still the wave's dates (they follow a correction to the wave's). */
  uses_wave_dates: boolean;
  /** Why this plant's dates differ from its wave's. */
  reason: string | null;
  /** The lab's germination colour (#429), camel case; null when none. */
  germ_day_color: string | null;
  set_by_name: string | null;
  /** ISO 8601. */
  set_at: string;
  /** Saved (not deleted) scans of this plant in this wave. */
  scanCount: number;
  /** Every change to this plant's dates, oldest first. */
  changes: CylinderPlantDateChange[];
}

/** A plant's own dates, from "Different dates for this plant" or a per-plant wave. */
export interface CylinderPlantDatesInput extends WaveDatesInput {
  waveId: string;
  plantBarcode: string;
  /** Why this plant's dates differ (required unless the wave's dates are per plant). */
  reason?: string;
  phenotyperId: string;
}

/** Give a per-plant wave one set of dates for all its plants (e.g. "No" was chosen by mistake). */
export interface CylinderWaveSameDatesInput extends WaveDatesInput {
  waveId: string;
  /** Required when the germination date is out of order with another wave's. */
  reason?: string;
  phenotyperId: string;
}

/** Make a wave's dates per plant: each plant's are asked for before its first scan. */
export interface CylinderWaveDatesPerPlantInput {
  waveId: string;
  reason?: string;
  phenotyperId: string;
}

/** Put a plant back on its wave's dates. */
export interface CylinderPlantUseWaveDatesInput {
  waveId: string;
  plantBarcode: string;
  reason?: string;
  phenotyperId: string;
}

/** A wave's three dates, as Capture Scan sends them. */
export interface WaveDatesInput {
  germinationDate: string;
  sowingDate: string;
  /** Left out (or empty) when it's the same day as germination. */
  transferDate?: string;
  /** The lab's germination colour (#429), optional; cleaned to camel case when saved. */
  germDayColor?: string;
}

export interface CylinderWaveCreateInput extends Partial<WaveDatesInput> {
  experimentId: string;
  waveNumber: number;
  /** The plants' dates differ: none are entered on the wave (the dates are then left out). */
  datesPerPlant?: boolean;
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
