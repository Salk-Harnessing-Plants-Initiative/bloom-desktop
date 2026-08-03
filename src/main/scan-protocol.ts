/**
 * Path-traversal + containment validation for the bloom-scan:// custom
 * protocol handler (#93), replacing what `webSecurity: false` used to
 * implicitly bypass.
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve a requested scan path against the configured scans directory,
 * returning the resolved absolute path if (and only if) it is genuinely
 * contained within `scansDir`, or `null` if it would escape it.
 *
 * @param requestedPath - The path requested via bloom-scan://
 * @param scansDir - The currently-configured scans root directory
 * @param pathModule - The `path` module to use for resolution (defaults
 *   to the ambient `path`, which is correctly `path.win32` at runtime when
 *   actually running on Windows). Tests inject `path.win32`/`path.posix`
 *   explicitly so Windows-specific behavior (drive letters,
 *   case-insensitivity) is deterministic on any CI host OS — production
 *   code never needs to pass this argument.
 */
export function resolveScanPath(
  requestedPath: string,
  scansDir: string,
  pathModule: typeof path = path
): string | null {
  const resolvedRequested = pathModule.resolve(requestedPath);
  const resolvedScansDir = pathModule.resolve(scansDir);

  const isWindows = pathModule === path.win32;
  const requestedForCompare = isWindows
    ? resolvedRequested.toLowerCase()
    : resolvedRequested;
  const scansDirForCompare = isWindows
    ? resolvedScansDir.toLowerCase()
    : resolvedScansDir;

  // Boundary-aware containment check: an exact match, or a match followed
  // by a path separator. A plain string prefix check would incorrectly
  // accept a sibling directory sharing a name prefix (e.g. `scansDir`
  // "/bloom-scans" would wrongly match "/bloom-scans-archive/x.png").
  const isContained =
    requestedForCompare === scansDirForCompare ||
    requestedForCompare.startsWith(scansDirForCompare + pathModule.sep);

  return isContained ? resolvedRequested : null;
}

/**
 * Convert a bloom-scan:// URL's path portion back to a native filesystem
 * path, undoing the leading-slash-before-drive-letter convention
 * `pathToFileUrl()` (src/utils/file-url.ts) adds — the standard file://
 * URL convention, e.g. "/C:/Users/foo/bar.png" — since `path.resolve()`
 * would otherwise treat "C:" as a literal path segment under root instead
 * of a drive letter.
 */
function urlPathToNativePath(requestUrl: string): string {
  let requestedPath = decodeURIComponent(
    requestUrl.replace('bloom-scan://', '')
  );
  if (/^\/[A-Za-z]:/.test(requestedPath)) {
    requestedPath = requestedPath.slice(1);
  }
  return requestedPath;
}

/**
 * Build the bloom-scan:// protocol.handle() callback.
 *
 * @param getScansDir - Called fresh on every request (not cached), since
 *   `scans_dir` can change at runtime via Configure Scanner / Machine
 *   Configuration. Extracted as a parameter (rather than reading
 *   config-store directly here) so this factory's freshness behavior is
 *   unit-testable without importing main.ts, which has heavy top-level
 *   side effects (app lifecycle registration).
 */
export function createScanProtocolHandler(
  getScansDir: () => string
): (request: Request) => Promise<Response> {
  return async (request: Request): Promise<Response> => {
    const scansDir = getScansDir();
    const requestedPath = urlPathToNativePath(request.url);
    const resolvedPath = resolveScanPath(requestedPath, scansDir);

    if (!resolvedPath) {
      return new Response('Forbidden', { status: 403 });
    }

    try {
      const data = await fs.promises.readFile(resolvedPath);
      const ext = path.extname(resolvedPath).toLowerCase();
      const contentType =
        ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';
      return new Response(new Uint8Array(data), {
        headers: { 'Content-Type': contentType },
      });
    } catch {
      return new Response('Not Found', { status: 404 });
    }
  };
}
