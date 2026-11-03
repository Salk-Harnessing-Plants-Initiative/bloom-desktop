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
} from './config-store';

export const STATION_ENV_PATH = path.join(os.homedir(), '.bloom', '.env');

export interface StationConfigState {
  config: MachineConfig;
  /** Why the file couldn't be read, or null. The config is then the built-in defaults. */
  error: string | null;
}

export interface StationConfig {
  /** The copy, read from the file the first time it's needed. */
  get(): StationConfigState;
  /** Reads the file again: Retry, and after Machine Configuration saves it. */
  reload(): StationConfigState;
}

export function createStationConfig(
  envPath: string,
  read: (envPath: string) => MachineConfig = (p) =>
    loadEnvConfig(p, { strict: true })
): StationConfig {
  let state: StationConfigState | null = null;

  const reload = (): StationConfigState => {
    try {
      state = { config: read(envPath), error: null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.error('[StationConfig] Could not read', envPath, reason);
      state = {
        config: getDefaultConfig(),
        error: `Couldn't read this station's settings (${envPath}): ${reason}`,
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
