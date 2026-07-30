/**
 * Realpath-based path containment for GraviScan file access.
 *
 * Any handler that takes a filesystem path from the renderer (or from a DB
 * row that the renderer influenced) must confirm the path really lives inside
 * the configured scan output directory before touching it. Comparing the
 * strings alone is not enough: a symlink inside the output directory can
 * point anywhere, so both sides are resolved with `fs.realpathSync` first.
 *
 * This lives in its own module rather than inside `register-handlers.ts`
 * because `verify-plates.ts` needs it too, and `register-handlers.ts` imports
 * `verify-plates.ts` — importing back the other way would be circular. It
 * also deliberately depends on nothing but `fs`/`path`, so importing it does
 * not drag Electron into an otherwise Electron-free handler module.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve `candidatePath` and confirm it is `baseDir` itself or lives beneath
 * it, following symlinks on both sides.
 *
 * @param baseDir - Directory the path must be contained in (e.g. the scan
 *                  output directory).
 * @param candidatePath - Untrusted path to check.
 * @returns The resolved real path when contained, otherwise `null`. Callers
 *          should use the returned path rather than the original, so the
 *          value that was checked is the value that gets used.
 *
 * A path that does not exist on disk resolves to `null` — `realpathSync`
 * throws for a missing file, and a path that cannot be resolved cannot be
 * proven contained.
 */
export function resolveContainedPath(
  baseDir: string,
  candidatePath: string
): string | null {
  let realBase: string;
  let realCandidate: string;

  try {
    realBase = fs.realpathSync(path.resolve(baseDir));
    realCandidate = fs.realpathSync(path.resolve(candidatePath));
  } catch {
    // File or directory doesn't exist — reject rather than guess.
    return null;
  }

  if (realCandidate === realBase) return realCandidate;
  if (realCandidate.startsWith(realBase + path.sep)) return realCandidate;

  return null;
}
