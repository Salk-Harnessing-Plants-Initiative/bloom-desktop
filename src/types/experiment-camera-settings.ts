/**
 * An experiment's camera settings (#483), as Capture Scan, the Set camera settings panel
 * and the experiment page use them.
 */

/** The three settings kept per experiment. */
export interface CameraValues {
  exposure_time: number;
  gain: number;
  gamma: number;
}

/** One saved setting of an experiment, newest first in the history. */
export interface ExperimentCameraSettingsInfo extends CameraValues {
  id: string;
  note: string;
  /** Who saved it; "admin" for the rows copied from scans when the update was installed. */
  set_by_name: string | null;
  created_at: string;
  last_confirmed_at: string | null;
  last_confirmed_by_name: string | null;
}

/** A change saved today by someone other than the phenotyper now scanning. */
export interface CameraSettingsChangedToday {
  by_name: string | null;
  at: string;
  /** The settings before the change; null when it was the experiment's first. */
  from: CameraValues | null;
  to: CameraValues;
  note: string;
}

/** What Capture Scan needs to decide whether to ask for a check. */
export interface ExperimentCameraSettingsStatus {
  /** The settings scans use: the newest row. Null when none were ever saved. */
  current: ExperimentCameraSettingsInfo | null;
  /** True when the phenotyper asked about confirmed the current settings today. */
  confirmedToday: boolean;
  changedToday: CameraSettingsChangedToday | null;
}

/** One line of "Used before in this experiment". */
export interface CameraSettingsReference extends CameraValues {
  scan_count: number;
  /** ISO times of the first and latest scan; null for saved settings no scan used yet. */
  first_captured: string | null;
  last_captured: string | null;
  /** Frame 1 of the latest scan taken with these settings, as stored on the scan. */
  latest_image_path: string | null;
  is_current: boolean;
}

/** Confirm and continue: the values on the panel, and the settings it was opened with. */
export interface ConfirmCameraSettingsInput extends CameraValues {
  experimentId: string;
  phenotyperId: string;
  /** The current settings' id when the panel opened, or null; guards against a change in between. */
  currentSettingsId: string | null;
  note?: string;
}

/** Where a new experiment's form starts: the most used setting in Bloom. Nothing scans with it until saved. */
export const STARTING_CAMERA_VALUES: CameraValues = {
  exposure_time: 10000,
  gain: 100,
  gamma: 1,
};

/** The note stored when an experiment's first settings are saved without one. */
export const INITIAL_SETTINGS_NOTE = 'Initial settings';
