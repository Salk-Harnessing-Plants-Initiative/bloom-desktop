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
 * Outcome of a containment check.
 *
 * The two failure reasons are deliberately distinguished for *logging*, not
 * for the caller's decision: both are rejections. `unresolvable` means the
 * path could not be resolved at all (it does not exist yet, was removed, or
 * is not readable) — usually benign. `outside` means it resolved cleanly and
 * lands outside the base directory — that is a real containment violation and
 * deserves a louder log line.
 *
 * Callers that answer an untrusted caller (e.g. an IPC handler) SHALL still
 * return the same generic error for both, so the response does not leak
 * whether a path exists.
 */
export type ContainmentResult =
  | { ok: true; path: string }
  | { ok: false; reason: 'unresolvable' | 'outside' };

/**
 * Resolve `candidatePath` and confirm it is `baseDir` itself or lives beneath
 * it, following symlinks on both sides.
 *
 * @param baseDir - Directory the path must be contained in (e.g. the scan
 *                  output directory).
 * @param candidatePath - Untrusted path to check.
 * @returns `{ ok: true, path }` with the resolved real path when contained.
 *          Callers should use the returned path rather than the original, so
 *          the value that was checked is the value that gets used.
 */
export function resolveContainedPath(
  baseDir: string,
  candidatePath: string
): ContainmentResult {
  let realBase: string;
  let realCandidate: string;

  try {
    realBase = fs.realpathSync(path.resolve(baseDir));
    realCandidate = fs.realpathSync(path.resolve(candidatePath));
  } catch {
    // Missing, removed, or unreadable — cannot be proven contained, so it is
    // still rejected, but this is not evidence of a traversal attempt.
    return { ok: false, reason: 'unresolvable' };
  }

  if (
    realCandidate === realBase ||
    realCandidate.startsWith(realBase + path.sep)
  ) {
    return { ok: true, path: realCandidate };
  }

  return { ok: false, reason: 'outside' };
}
