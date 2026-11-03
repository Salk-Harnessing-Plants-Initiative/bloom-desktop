/**
 * The station's configuration (~/.bloom/.env), read once when the app starts and kept
 * here (#477). Everything in the main process reads this copy rather than the file.
 * Saving Machine Configuration and Retry read the file again.
 *
 * A file that exists but can't be read is an error the renderer can show, not an
 * empty configuration. A missing file isn't an error: it's first-run setup, and the
 * built-in defaults apply.
 */

import * as os from 'os';
import * as path from 'path';
import {
  getDefaultConfig,
  loadEnvConfig,
  type MachineConfig,
  type ValidationResult,
} from './config-store';
import { saveSubmittedConfig, type SaveConfigResult } from './config-password';

export const STATION_ENV_PATH = path.join(os.homedir(), '.bloom', '.env');

export interface StationConfigState {
  config: MachineConfig;
  /** Why the file couldn't be read, or null. The config is then the built-in defaults. */
  error: string | null;
}

export interface StationConfigLike {
  /** The copy, read from the file the first time it's needed. */
  get(): StationConfigState;
  /** Reads the file again: Retry, and after Machine Configuration saves it. */
  reload(): StationConfigState;
}

export function createStationConfig(
  envPath: string,
  read: (envPath: string) => MachineConfig = (p) =>
    loadEnvConfig(p, { strict: true })
): StationConfigLike {
  let state: StationConfigState | null = null;

  const reload = (): StationConfigState => {
    try {
      state = { config: read(envPath), error: null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown error';
      console.error('[StationConfig] Could not read', envPath, reason);
      // The code (EBUSY, EACCES…) is enough for the operator; the message repeats the path.
      const code = (error as NodeJS.ErrnoException | null)?.code;
      state = {
        config: getDefaultConfig(),
        error: `Couldn't read this station's settings file (${envPath}): ${code ?? reason}`,
      };
    }
    return state;
  };

  return { get: () => state ?? reload(), reload };
}

/** The app's copy of ~/.bloom/.env. */
export const stationConfig = createStationConfig(STATION_ENV_PATH);

/** The configured scans folder, or ~/.bloom/scans when it's blank. */
export function stationScansDir(): string {
  return (
    stationConfig.get().config.scans_dir ||
    path.join(os.homedir(), '.bloom', 'scans')
  );
}

/** Why Machine Configuration won't save while the file can't be read. */
export function saveBlockedMessage(loadError: string): string {
  return `${loadError}. Nothing was saved, so the station's settings are unchanged. Press Retry, and if this keeps happening, contact the Bloom team.`;
}

export interface StationConfigSaveDeps {
  station: StationConfigLike;
  save: (config: MachineConfig) => void;
  validate: (config: MachineConfig) => ValidationResult;
}

/**
 * Machine Configuration's save. The file is read again first, so a password left blank
 * ("keep the saved one") comes from the file as it is now, not from a copy taken when
 * the file couldn't be read. If it still can't be read, nothing is saved: a save would
 * write the form, defaults included, over settings the app can't see (#485).
 */
export function saveStationConfig(
  submitted: MachineConfig,
  deps: StationConfigSaveDeps
): SaveConfigResult & { saved?: MachineConfig } {
  const fresh = deps.station.reload();
  if (fresh.error) {
    return {
      success: false,
      errors: { general: saveBlockedMessage(fresh.error) },
    };
  }
  const result = saveSubmittedConfig(submitted, {
    load: () => fresh.config,
    save: deps.save,
    validate: deps.validate,
  });
  // The file now holds the form merged with what was there: keep that.
  if (result.success) deps.station.reload();
  return result;
}
