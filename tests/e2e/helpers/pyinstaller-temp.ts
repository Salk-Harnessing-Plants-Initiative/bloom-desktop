/**
 * E2E Test Helper: PyInstaller temp folders
 *
 * `bloom-hardware` is a PyInstaller one-file build: each start unpacks it into a
 * new `_MEI<random>` folder in the temp directory, which it deletes only when it
 * exits normally. closeElectronApp() force-kills leftover processes after each
 * test, so those folders were left behind, one per launch, until a CI runner's
 * disk filled up ("There is not enough space on the disk").
 *
 * Only folders created during this Playwright run are removed (global-setup.ts
 * records when the run started), so a real bloom-hardware's folder is never touched.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/** Set by global-setup.ts: when this Playwright run started, in ms since the epoch. */
export const RUN_STARTED_ENV = 'BLOOM_E2E_RUN_STARTED_MS';

const PYINSTALLER_DIR_PREFIX = '_MEI';

/** Remove `_MEI*` folders created since the run started; returns how many. */
export function removeLeakedPyInstallerDirs(): number {
  const startedMs = Number(process.env[RUN_STARTED_ENV]);
  if (!Number.isFinite(startedMs) || startedMs <= 0) return 0;
  const tmp = os.tmpdir();
  let removed = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(tmp, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      !entry.name.startsWith(PYINSTALLER_DIR_PREFIX)
    ) {
      continue;
    }
    const dir = path.join(tmp, entry.name);
    try {
      const stat = fs.statSync(dir);
      // Some Linux file systems report no birth time (0); fall back to ctime.
      if ((stat.birthtimeMs || stat.ctimeMs) < startedMs) continue;
      // A folder still in use (Windows keeps its files locked) is skipped.
      fs.rmSync(dir, { recursive: true, force: true });
      removed++;
    } catch {
      // In use or already gone: leave it for the next test's cleanup.
    }
  }
  return removed;
}
