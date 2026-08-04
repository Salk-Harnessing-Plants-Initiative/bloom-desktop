/**
 * Cross-platform file URL utility
 *
 * Converts absolute file paths to bloom-scan:// URLs that work on macOS,
 * Windows, and Linux. Handles backslashes, drive letters, and special
 * characters like spaces.
 *
 * Uses the custom bloom-scan:// scheme (#93) rather than file://, since
 * loading file:// URLs from the renderer's http:// origin in development
 * required webSecurity: false — the custom scheme's permissions are
 * independent of the renderer's origin, so no such flag is needed. See
 * src/main/main.ts's protocol.handle('bloom-scan', ...) registration and
 * src/main/scan-protocol.ts's path-containment validation.
 *
 * The real path is carried as a `path` query parameter behind a fixed
 * `local-file` host — NOT embedded directly in the URL's authority/path
 * position (e.g. the file:// triple-slash convention `bloom-scan:///C:/foo`).
 * bloom-scan:// is registered with `standard: true`, so Chromium's WHATWG
 * "special scheme" URL parser applies to it, same as http/https/file. That
 * parser collapses extra leading slashes after `//` and reads the first
 * path segment as the host — but unlike the literal `file:` scheme, which
 * has spec-mandated drive-letter/host quirk handling, a *custom* standard
 * scheme gets none of that special-casing. A triple-slash URL like
 * `bloom-scan:///C:/foo/bar.png` was silently corrupted by Chromium into
 * host "c" (lowercased, colon dropped) + path "/foo/bar.png" — confirmed
 * via a real Electron E2E run (unit tests using Node's Request/URL never
 * caught this, since Node doesn't know bloom-scan is a "special" scheme).
 * Query parameters are untouched by authority/path parsing, so this class
 * of bug can't recur regardless of the path's shape.
 */

/**
 * Convert an absolute file path to a bloom-scan:// URL.
 *
 * @param filePath - Absolute file path (e.g., "/Users/foo/bar.png" or "C:\\Users\\foo\\bar.png")
 * @returns bloom-scan:// URL carrying the path as a query parameter
 */
export function pathToFileUrl(filePath: string): string {
  // Normalize backslashes to forward slashes (Windows)
  const normalized = filePath.replace(/\\/g, '/');

  return 'bloom-scan://local-file/?path=' + encodeURIComponent(normalized);
}
