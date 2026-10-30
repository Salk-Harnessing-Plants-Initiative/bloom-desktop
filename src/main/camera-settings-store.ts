/**
 * The camera settings last applied on Camera Settings, kept across restarts in
 * ~/.bloom/camera-settings.json (#440). Only exposure, gain and gamma are kept: the
 * camera IP comes from Machine Configuration, and frames and rotation from .env.
 */

import { promises as fs } from 'fs';
import type { CameraSettings } from '../types/camera';

/** The file's name, in the station's ~/.bloom folder. */
export const CAMERA_SETTINGS_FILE = 'camera-settings.json';

/** The same limits the Camera Settings form allows (CameraSettingsForm.tsx). */
export const EXPOSURE_TIME_RANGE_US = { min: 100, max: 50000 } as const;
export const GAIN_RANGE = { min: 36, max: 512 } as const;
export const GAMMA_RANGE = { min: 0.5, max: 2.0 } as const;

export type SavedCameraSettings = Required<
  Pick<CameraSettings, 'exposure_time' | 'gain' | 'gamma'>
>;

function inRange(value: unknown, range: { min: number; max: number }) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= range.min &&
    value <= range.max
  );
}

/** The saved settings in `raw`, or null when anything is missing or out of range. */
export function parseSavedCameraSettings(
  raw: unknown
): SavedCameraSettings | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { exposure_time, gain, gamma } = raw as Record<string, unknown>;
  if (
    !inRange(exposure_time, EXPOSURE_TIME_RANGE_US) ||
    !inRange(gain, GAIN_RANGE) ||
    !inRange(gamma, GAMMA_RANGE)
  ) {
    return null;
  }
  return {
    exposure_time: exposure_time as number,
    gain: gain as number,
    gamma: gamma as number,
  };
}

/**
 * The saved settings, or null when there are none. A missing file is normal (settings
 * never applied); an unreadable or invalid one is logged and treated the same way.
 */
export async function loadSavedCameraSettings(
  file: string,
  log: (message: string) => void = console.warn
): Promise<SavedCameraSettings | null> {
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      log(
        `[Camera] Couldn't read ${CAMERA_SETTINGS_FILE}: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    }
    return null;
  }
  try {
    const saved = parseSavedCameraSettings(JSON.parse(text));
    if (!saved) {
      log(
        `[Camera] Ignoring ${CAMERA_SETTINGS_FILE}: values missing or out of range`
      );
    }
    return saved;
  } catch (error) {
    log(
      `[Camera] Ignoring ${CAMERA_SETTINGS_FILE}: ${
        error instanceof Error ? error.message : 'Unknown error'
      }`
    );
    return null;
  }
}

/** Save exposure, gain and gamma (temp file + rename, so a crash never leaves half a file). */
export async function saveCameraSettings(
  file: string,
  settings: Partial<CameraSettings>
): Promise<void> {
  const saved = parseSavedCameraSettings(settings);
  if (!saved) {
    throw new Error('Camera settings are missing or out of range');
  }
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(saved, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
}

export type CameraSettingsSource = 'saved' | 'applied';

export interface CameraSettingsSessionDeps {
  /** ~/.bloom/camera-settings.json */
  file: string;
  /** The built-in defaults, under the saved values. */
  defaults: CameraSettings;
  /** Adds the camera IP from Machine Configuration. */
  withCameraIp: (settings: CameraSettings) => CameraSettings;
  log?: (message: string) => void;
}

/**
 * The camera settings for this run of the app: the saved ones, loaded the first time
 * they're asked for, until settings are applied; applied settings are saved for the
 * next run.
 */
export function createCameraSettingsSession(deps: CameraSettingsSessionDeps) {
  const log = deps.log ?? console.warn;
  let current: CameraSettings | null = null;
  let source: CameraSettingsSource | null = null;
  let checked = false;

  return {
    /** The current settings and where they came from, or null when there are none. */
    async get(): Promise<
      (CameraSettings & { source: CameraSettingsSource | null }) | null
    > {
      if (!checked) {
        checked = true;
        const saved = await loadSavedCameraSettings(deps.file, log);
        if (saved && !current) {
          current = deps.withCameraIp({ ...deps.defaults, ...saved });
          source = 'saved';
        }
      }
      return current ? { ...current, source } : null;
    },

    /** Record settings the camera accepted, and save them for the next run. */
    async applied(settings: Partial<CameraSettings>): Promise<CameraSettings> {
      current = {
        ...(current ?? deps.defaults),
        ...settings,
      } as CameraSettings;
      source = 'applied';
      // A first load after this must not replace what was just applied.
      checked = true;
      try {
        await saveCameraSettings(deps.file, current);
      } catch (error) {
        log(
          `[Camera] Couldn't save the camera settings: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`
        );
      }
      return current;
    },
  };
}
