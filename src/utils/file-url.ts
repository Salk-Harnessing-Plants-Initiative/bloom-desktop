/**
 * Cross-platform file URL utility
 *
 * Converts absolute file paths to proper bloom-scan:// URLs that work
 * on macOS, Windows, and Linux. Handles backslashes, drive letters,
 * and special characters like spaces.
 *
 * Uses the custom bloom-scan:// scheme (#93) rather than file://, since
 * loading file:// URLs from the renderer's http:// origin in development
 * required webSecurity: false — the custom scheme's permissions are
 * independent of the renderer's origin, so no such flag is needed. See
 * src/main/main.ts's protocol.handle('bloom-scan', ...) registration and
 * src/main/scan-protocol.ts's path-containment validation.
 */

/**
 * Convert an absolute file path to a bloom-scan:// URL.
 *
 * @param filePath - Absolute file path (e.g., "/Users/foo/bar.png" or "C:\\Users\\foo\\bar.png")
 * @returns Properly formatted bloom-scan:// URL
 */
export function pathToFileUrl(filePath: string): string {
  // Normalize backslashes to forward slashes (Windows)
  let normalized = filePath.replace(/\\/g, '/');

  // Windows drive letters need a leading slash: C:/foo → /C:/foo
  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = '/' + normalized;
  }

  // Encode special characters (spaces, etc.) preserving path structure
  return 'bloom-scan://' + encodeURI(normalized);
}
