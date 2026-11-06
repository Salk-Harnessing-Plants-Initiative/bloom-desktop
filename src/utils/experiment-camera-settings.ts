/**
 * Rules for an experiment's camera settings (#483), shared by the main process and the
 * Set camera settings panel.
 */

import { cameraSettingsErrors } from '../types/camera';
import type {
  CameraSettingsReference,
  CameraValues,
} from '../types/experiment-camera-settings';
import { toIsoDate } from './wave-dates';

export const NOTE_REQUIRED =
  'Add a note saying why the camera settings changed.';
export const SETTINGS_CHANGED_MEANWHILE =
  "This experiment's camera settings were just changed. Check them again.";

/** Gamma is stored as a float: two decimals are as precise as the form gets. */
export function roundGamma(gamma: number): number {
  return Math.round(gamma * 100) / 100;
}

export function sameCameraValues(a: CameraValues, b: CameraValues): boolean {
  return (
    a.exposure_time === b.exposure_time &&
    a.gain === b.gain &&
    roundGamma(a.gamma) === roundGamma(b.gamma)
  );
}

export const GAMMA_ONE_DECIMAL = 'Gamma can have one decimal place, e.g. 1.1.';

/** Allowance for float noise (e.g. 1.100000023841858 from 32-bit storage), well below 0.01. */
const GAMMA_DECIMAL_TOLERANCE = 1e-4;

/** True when gamma has at most one decimal place (1.1, not 1.04). */
export function gammaHasOneDecimal(gamma: number): boolean {
  return (
    Math.abs(gamma * 10 - Math.round(gamma * 10)) < GAMMA_DECIMAL_TOLERANCE
  );
}

/**
 * Why the values can't be saved, or null. Exposure is stored as a whole number of µs.
 * Gamma is shown with one decimal, so new settings can have only one: otherwise 1.04
 * and 1.0 would look the same. Settings an experiment already has (e.g. 1.05, copied
 * from scans taken before this rule) can still be confirmed as they are, so checking
 * them never forces a change mid-experiment: pass oneDecimalGamma: false for those.
 * (Only for experiment settings: the station's saved settings keep the form's
 * limits, so an existing camera-settings.json stays valid.)
 */
export function cameraValuesError(
  values: Partial<CameraValues>,
  { oneDecimalGamma = true }: { oneDecimalGamma?: boolean } = {}
): string | null {
  const errors = Object.values(cameraSettingsErrors(values));
  if (errors.length > 0) return errors.join(' ');
  if (!Number.isInteger(values.exposure_time)) {
    return 'Exposure must be a whole number of µs.';
  }
  if (oneDecimalGamma && !gammaHasOneDecimal(values.gamma as number)) {
    return GAMMA_ONE_DECIMAL;
  }
  return null;
}

/** True when both times fall on the same calendar day on this station. */
export function sameLocalDay(a: Date, b: Date): boolean {
  return toIsoDate(a) === toIsoDate(b);
}

/** The settings scans were taken with, one group per setting. */
export interface ScanSettingsGroup extends CameraValues {
  scan_count: number;
  first_captured: Date;
  last_captured: Date;
  latest_image_path: string | null;
}

/**
 * Groups an experiment's live scans by their settings, comparing dates as times: scans
 * from the pilot app may store theirs as text, which the database would sort after any
 * date stored as a number, whatever the actual date. Each group keeps its latest scan.
 */
export function groupScansBySettings(
  scans: Array<CameraValues & { id: string; capture_date: Date }>
): Array<
  Omit<ScanSettingsGroup, 'latest_image_path'> & { latest_scan_id: string }
> {
  const groups = new Map<
    string,
    Omit<ScanSettingsGroup, 'latest_image_path'> & { latest_scan_id: string }
  >();
  for (const scan of scans) {
    const key = `${scan.exposure_time}/${scan.gain}/${scan.gamma}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        exposure_time: scan.exposure_time,
        gain: scan.gain,
        gamma: scan.gamma,
        scan_count: 1,
        first_captured: scan.capture_date,
        last_captured: scan.capture_date,
        latest_scan_id: scan.id,
      });
      continue;
    }
    group.scan_count += 1;
    if (scan.capture_date < group.first_captured) {
      group.first_captured = scan.capture_date;
    }
    if (scan.capture_date > group.last_captured) {
      group.last_captured = scan.capture_date;
      group.latest_scan_id = scan.id;
    }
  }
  return [...groups.values()];
}

/**
 * "Previous camera settings used in this experiment": the experiment's scan settings, plus saved settings
 * no scan used yet, most recently used first. Groups whose gamma differs only by float
 * noise are merged.
 */
export function referenceList(
  scanGroups: ScanSettingsGroup[],
  saved: Array<CameraValues & { created_at: Date }>,
  current: CameraValues | null
): CameraSettingsReference[] {
  const merged: ScanSettingsGroup[] = [];
  for (const group of scanGroups) {
    const same = merged.find((m) => sameCameraValues(m, group));
    if (!same) {
      merged.push({ ...group, gamma: roundGamma(group.gamma) });
      continue;
    }
    same.scan_count += group.scan_count;
    if (group.first_captured < same.first_captured) {
      same.first_captured = group.first_captured;
    }
    if (group.last_captured > same.last_captured) {
      same.last_captured = group.last_captured;
      same.latest_image_path = group.latest_image_path;
    }
  }
  const lines: Array<CameraSettingsReference & { usedAt: number }> = merged.map(
    (g) => ({
      exposure_time: g.exposure_time,
      gain: g.gain,
      gamma: g.gamma,
      scan_count: g.scan_count,
      first_captured: g.first_captured.toISOString(),
      last_captured: g.last_captured.toISOString(),
      latest_image_path: g.latest_image_path,
      is_current: current !== null && sameCameraValues(g, current),
      usedAt: g.last_captured.getTime(),
    })
  );
  for (const row of saved) {
    if (lines.some((l) => sameCameraValues(l, row))) continue;
    lines.push({
      exposure_time: row.exposure_time,
      gain: row.gain,
      gamma: roundGamma(row.gamma),
      scan_count: 0,
      first_captured: null,
      last_captured: null,
      latest_image_path: null,
      is_current: current !== null && sameCameraValues(row, current),
      usedAt: row.created_at.getTime(),
    });
  }
  lines.sort((a, b) => b.usedAt - a.usedAt);
  for (const line of lines) delete (line as Partial<typeof line>).usedAt;
  return lines;
}
