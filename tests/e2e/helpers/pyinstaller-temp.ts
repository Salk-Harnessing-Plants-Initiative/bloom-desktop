/**
 * E2E Test Helper: the run's temp folder, and PyInstaller's leftovers in it
 *
 * `bloom-hardware` is a PyInstaller one-file build: each start unpacks it (about
 * 400 MB) into a new `_MEI<random>` folder in the temp directory, which it deletes
 * only when it exits normally. closeElectronApp() force-kills leftover processes
 * after each test, so those folders were left behind, one per launch, until a CI
 * runner's disk filled up ("There is not enough space on the disk").
 *
 * global-setup.ts therefore gives the run its own temp folder (TEMP, TMP and TMPDIR,
 * which the app and bloom-hardware inherit): under RUNNER_TEMP in CI, which on
 * Windows runners is the large D: drive rather than C:. After each test the
 * `_MEI*` folders in it are removed; only processes the tests started use it.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Set by global-setup.ts: the run's own temp folder. */
export const RUN_TEMP_ENV = 'BLOOM_E2E_TMPDIR';

const PYINSTALLER_DIR_PREFIX = '_MEI';

/** Create the run's temp folder and make it the temp directory for everything the run starts. */
export function useRunTempDir(): string {
  const base = process.env.RUNNER_TEMP || os.tmpdir();
  const dir = path.join(base, `bloom-e2e-tmp-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of ['TEMP', 'TMP', 'TMPDIR']) process.env[name] = dir;
  process.env[RUN_TEMP_ENV] = dir;
  return dir;
}

/** Remove the `_MEI*` folders in the run's temp folder; returns how many. */
export function removeLeakedPyInstallerDirs(): number {
  const runTemp = process.env[RUN_TEMP_ENV];
  if (!runTemp) return 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(runTemp, { withFileTypes: true });
  } catch (error) {
    console.warn(
      `[E2E] Could not read the run's temp folder ${runTemp}:`,
      error instanceof Error ? error.message : 'Unknown error'
    );
    return 0;
  }
  let removed = 0;
  for (const entry of entries) {
    // Dirent types don't follow links, so a linked _MEI entry is never descended into.
    if (
      !entry.isDirectory() ||
      !entry.name.startsWith(PYINSTALLER_DIR_PREFIX)
    ) {
      continue;
    }
    try {
      fs.rmSync(path.join(runTemp, entry.name), {
        recursive: true,
        force: true,
      });
      removed++;
    } catch {
      // Still locked on Windows by a process that hasn't exited: retried after the next test.
    }
  }
  return removed;
}
