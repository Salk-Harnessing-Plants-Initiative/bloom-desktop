/**
 * Scan path builder utility.
 *
 * Generates pilot-compatible scan directory paths in the format:
 *   YYYY-MM-DD/<plant_qr_code>/<scan_uuid>
 *
 * Reference: bloom-desktop-pilot/app/src/main/scanner.ts lines 50-54
 */

import { getLocalDateYYYYMMDD } from './date-helpers';
import { sanitizePathComponent } from './path-sanitizer';

/**
 * Build a relative scan directory path in pilot-compatible format.
 *
 * @param plantQrCode - Plant QR code (will be sanitized for filesystem safety)
 * @param scanUuid - Unique scan identifier (UUID, used as-is)
 * @param date - Capture date (defaults to current date)
 * @returns Relative path string: YYYY-MM-DD/<sanitized_plant_qr_code>/<scan_uuid>
 */
export function buildScanPath(
  plantQrCode: string,
  scanUuid: string,
  date?: Date
): string {
  const dateStr = getLocalDateYYYYMMDD(date);
  const sanitizedPlant = sanitizePathComponent(plantQrCode);
  return `${dateStr}/${sanitizedPlant}/${scanUuid}`;
}

/**
 * Extract the relative scan path from an absolute path by stripping the scansDir prefix.
 *
 * @param absolutePath - The absolute path to the scan directory
 * @param scansDir - The base scans directory to strip
 * @returns Relative path (e.g., "2026-03-04/PLANT-001/abc-uuid")
 */
export function toRelativeScanPath(
  absolutePath: string,
  scansDir: string
): string {
  // Normalize separators and ensure no trailing slash on scansDir
  const normalizedAbsolute = absolutePath.replace(/\\/g, '/');
  const normalizedScansDir = scansDir.replace(/\\/g, '/').replace(/\/$/, '');

  if (normalizedAbsolute.startsWith(normalizedScansDir + '/')) {
    return normalizedAbsolute.slice(normalizedScansDir.length + 1);
  }

  // If the path doesn't start with scansDir, return as-is
  return normalizedAbsolute;
}

/**
 * Check if a path is absolute on any platform.
 *
 * Detects Unix absolute paths (starting with `/`) and Windows absolute paths
 * (starting with a drive letter like `C:\` or `D:/`). Pure string check with
 * no Node `path` dependency, safe for use in the renderer process.
 */
export function isAbsolutePath(filePath: string): boolean {
  if (!filePath) return false;
  // Unix absolute
  if (filePath.startsWith('/')) return true;
  // Windows drive letter: e.g. C:\ or D:/
  return /^[A-Za-z]:[/\\]/.test(filePath);
}
