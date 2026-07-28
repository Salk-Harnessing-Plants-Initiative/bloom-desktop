/**
 * Resolve the GraviScan scan-output directory.
 *
 * Reads `GRAVISCAN_OUTPUT_DIR` from `~/.bloom/.env` in production so
 * operators can redirect scan output (e.g. onto a larger data partition)
 * without editing the app. Falls back to the hardcoded `~/.bloom/graviscan/`
 * path if the env file is missing or `GRAVISCAN_OUTPUT_DIR` is unset/empty.
 * Dev mode is unchanged: it always writes to `<appPath>/.graviscan/` so
 * local development doesn't pollute the production scan directory.
 *
 * Note: this intentionally does NOT reuse `SCANS_DIR` — that key is
 * already used by `config-store.ts` for the unrelated, pre-existing
 * `MachineConfig.scans_dir` setting (used by `image-uploader.ts`, required
 * for every machine regardless of scanner mode). Reusing it here would
 * silently redirect GraviScan output on every properly-configured machine.
 *
 * Kept as a pure function (no Electron imports) so the resolution
 * rules can be unit-tested without spinning up the app.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Read the `GRAVISCAN_OUTPUT_DIR` value from a .env-style file.
 *
 * Returns the trimmed value if present and non-empty, otherwise
 * `undefined`. Lines starting with `#` are treated as comments.
 */
export function readGraviscanOutputDirFromEnv(
  envPath: string
): string | undefined {
  if (!fs.existsSync(envPath)) return undefined;

  const content = fs.readFileSync(envPath, 'utf-8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;

    const key = trimmed.substring(0, eqIndex).trim();
    if (key !== 'GRAVISCAN_OUTPUT_DIR') continue;

    const value = trimmed.substring(eqIndex + 1).trim();
    return value || undefined;
  }

  return undefined;
}

export interface GraviscanOutputDirOpts {
  /** Path to the `.env` file (typically `~/.bloom/.env`). */
  envPath: string;
  /** User home directory (`app.getPath('home')`). */
  homeDir: string;
  /** Application root path (`app.getAppPath()`). */
  appPath: string;
  /** True when `NODE_ENV === 'development'`. */
  isDev: boolean;
}

/**
 * Compute the GraviScan scan output directory.
 *
 * Precedence:
 *  - Dev → `<appPath>/.graviscan`
 *  - Prod + `GRAVISCAN_OUTPUT_DIR` set in `.env` → that value
 *  - Prod + no `GRAVISCAN_OUTPUT_DIR` → `<homeDir>/.bloom/graviscan`
 */
export function getGraviscanOutputDir(opts: GraviscanOutputDirOpts): string {
  if (opts.isDev) {
    return path.join(opts.appPath, '.graviscan');
  }

  const fromEnv = readGraviscanOutputDirFromEnv(opts.envPath);
  if (fromEnv) return fromEnv;

  return path.join(opts.homeDir, '.bloom', 'graviscan');
}
