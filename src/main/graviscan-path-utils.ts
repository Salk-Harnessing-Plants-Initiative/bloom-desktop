/**
 * Shared path resolution utilities for GraviScan image files.
 *
 * Handles the case where the DB stores a path with only _st_ (start time)
 * but the file on disk has been renamed to include _et_ (end time).
 */

import * as fs from 'fs';
import * as path from 'path';

/**
 * Resolve a GraviScan image path that may be stale (missing _et_ timestamp).
 *
 * Tries in order:
 * 1. The path as-is
 * 2. Alternate extensions (.tif, .tiff)
 * 3. Files with _et_ inserted after _st_ timestamp
 *
 * Returns the resolved path, or null if the file cannot be found.
 */
export function resolveGraviScanPath(filePath: string): string | null {
  if (fs.existsSync(filePath)) return filePath;

  const ext = path.extname(filePath);
  const base = ext ? filePath.slice(0, -ext.length) : filePath;

  // Try alternate extensions
  const altExts = ['.tif', '.tiff'].filter((e) => e !== ext);
  for (const altExt of altExts) {
    if (fs.existsSync(base + altExt)) return base + altExt;
  }

  // Try finding renamed file with _et_ inserted after _st_ timestamp
  const dir = path.dirname(filePath);
  const basename = path.basename(filePath);
  const etMatch = basename.match(/^(.+_st_\d{8}T\d{6})(_cy.+)$/);
  if (etMatch && fs.existsSync(dir)) {
    const prefix = etMatch[1];
    const suffix = etMatch[2];
    const suffixNoExt = suffix.replace(/\.[^.]+$/, '');
    const candidates = fs
      .readdirSync(dir)
      .filter(
        (f) =>
          f.startsWith(prefix + '_et_') &&
          (f.endsWith(suffix) || f.includes(suffixNoExt))
      );
    if (candidates.length === 1) {
      console.warn(
        `[graviscan-path-utils] Fallback: resolved stale path via _et_ search: ${filePath} → ${candidates[0]}`
      );
      return path.join(dir, candidates[0]);
    }
    if (candidates.length > 1) {
      console.warn(
        `[graviscan-path-utils] Ambiguous match: ${filePath} matched ${candidates.length} _et_ variants: ${candidates.join(', ')}. Returning null.`
      );
    }
  }

  return null;
}
