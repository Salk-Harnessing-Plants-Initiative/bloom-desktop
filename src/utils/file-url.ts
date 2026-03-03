/**
 * Cross-platform file URL utility
 *
 * Converts absolute file paths to proper file:// URLs that work
 * on macOS, Windows, and Linux. Handles backslashes, drive letters,
 * and special characters like spaces.
 */

/**
 * Convert an absolute file path to a file:// URL.
 *
 * @param filePath - Absolute file path (e.g., "/Users/foo/bar.png" or "C:\\Users\\foo\\bar.png")
 * @returns Properly formatted file:// URL
 */
export function pathToFileUrl(filePath: string): string {
  // Normalize backslashes to forward slashes (Windows)
  let normalized = filePath.replace(/\\/g, '/');

  // Windows drive letters need a leading slash: C:/foo → /C:/foo
  if (/^[A-Za-z]:/.test(normalized)) {
    normalized = '/' + normalized;
  }

  // Encode special characters (spaces, etc.) preserving path structure
  return 'file://' + encodeURI(normalized);
}
