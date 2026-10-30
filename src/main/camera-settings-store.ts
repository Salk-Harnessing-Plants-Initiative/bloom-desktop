/**
 * The camera settings last applied on Camera Settings, kept across restarts in
 * ~/.bloom/camera-settings.json (#440). Only exposure, gain and gamma are kept: the
 * camera IP comes from Machine Configuration, and frames and rotation from .env.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import {
  cameraSettingsErrors,
  CAMERA_SETTINGS_SAVE_ERRORS,
  type CameraSettings,
  type CameraSettingsSaveErrorCode,
  type CameraSettingsSource,
  type CameraSettingsWithSource,
} from '../types/camera';

/** The file's name, in the station's ~/.bloom folder. */
export const CAMERA_SETTINGS_FILE = 'camera-settings.json';

export type SavedCameraSettings = Required<
  Pick<CameraSettings, 'exposure_time' | 'gain' | 'gamma'>
>;

/** The saved settings in `raw`, or null when anything is missing or out of range. */
export function parseSavedCameraSettings(
  raw: unknown
): SavedCameraSettings | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { exposure_time, gain, gamma } = raw as Record<string, unknown>;
  // The same limits as the form (CAMERA_SETTING_LIMITS); gain must be whole.
  const errors = cameraSettingsErrors({
    exposure_time: exposure_time as number,
    gain: gain as number,
    gamma: gamma as number,
  });
  if (Object.keys(errors).length > 0) return null;
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

/** A failed save, with the code shown on Camera Settings (CAMERA_SETTINGS_SAVE_ERRORS). */
export class CameraSettingsSaveError extends Error {
  constructor(
    readonly code: CameraSettingsSaveErrorCode,
    detail?: string
  ) {
    super(
      detail
        ? `${CAMERA_SETTINGS_SAVE_ERRORS[code].title}: ${detail}`
        : CAMERA_SETTINGS_SAVE_ERRORS[code].title
    );
  }
}

/** The code for a file-system error while saving. */
export function saveErrorCode(error: unknown): CameraSettingsSaveErrorCode {
  switch ((error as NodeJS.ErrnoException)?.code) {
    case 'EACCES':
    case 'EPERM':
    case 'EROFS':
      return 'CAM-SAVE-02';
    case 'ENOSPC':
      return 'CAM-SAVE-03';
    case 'EBUSY':
      return 'CAM-SAVE-04';
    default:
      return 'CAM-SAVE-99';
  }
}

let tmpCounter = 0;

/**
 * Save exposure, gain and gamma: into the folder (created if missing) through a temp
 * file of its own and a rename, so a crash or a second Apply never leaves half a file.
 * Throws a CameraSettingsSaveError.
 */
export async function saveCameraSettings(
  file: string,
  settings: Partial<CameraSettings>
): Promise<void> {
  const saved = parseSavedCameraSettings(settings);
  if (!saved) throw new CameraSettingsSaveError('CAM-SAVE-01');
  const tmp = `${file}.${process.pid}-${++tmpCounter}.tmp`;
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(tmp, JSON.stringify(saved, null, 2) + '\n', 'utf8');
    await fs.rename(tmp, file);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch((): undefined => undefined);
    throw new CameraSettingsSaveError(
      saveErrorCode(error),
      error instanceof Error ? error.message : 'Unknown error'
    );
  }
}

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
  let loading: Promise<void> | null = null;

  return {
    /** The current settings and where they came from, or null when there are none. */
    async get(): Promise<CameraSettingsWithSource | null> {
      if (!checked) {
        // Callers that arrive during the first load wait for it.
        loading ??= loadSavedCameraSettings(deps.file, log).then((saved) => {
          checked = true;
          if (saved && !current) {
            current = deps.withCameraIp({ ...deps.defaults, ...saved });
            source = 'saved';
          }
        });
        await loading;
      }
      return current ? { ...current, source } : null;
    },

    /**
     * Record settings the camera accepted, and save them for the next run. Says whether
     * they were saved, and why not (with its code) if they weren't.
     */
    async applied(settings: Partial<CameraSettings>): Promise<{
      settings: CameraSettings;
      saved: boolean;
      saveError?: { code: CameraSettingsSaveErrorCode; message: string };
    }> {
      current = {
        ...(current ?? deps.defaults),
        ...settings,
      } as CameraSettings;
      source = 'applied';
      // A first load after this must not replace what was just applied.
      checked = true;
      try {
        await saveCameraSettings(deps.file, current);
        return { settings: current, saved: true };
      } catch (error) {
        const code =
          error instanceof CameraSettingsSaveError ? error.code : 'CAM-SAVE-99';
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        log(`[Camera] Couldn't save the camera settings (${code}): ${message}`);
        return {
          settings: current,
          saved: false,
          saveError: { code, message },
        };
      }
    },
  };
}
