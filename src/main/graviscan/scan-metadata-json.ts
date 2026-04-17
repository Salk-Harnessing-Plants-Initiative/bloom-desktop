/**
 * GraviScan Metadata JSON Writer
 *
 * Writes a metadata.json file alongside scan images so that scan data
 * is self-describing and portable without requiring the SQLite database.
 *
 * Uses atomic write pattern (write to .tmp, rename to final) to prevent
 * partial or corrupt files.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { GraviScanMetadataJson } from '../../types/graviscan';

/**
 * Context needed to build a GraviScan metadata object.
 * Gathered from scan settings, session state, and plate assignment.
 */
export interface GraviScanMetadataContext {
  experiment_id: string;
  phenotyper_id: string;
  scanner_id: string;
  scanner_name: string;
  grid_mode: string;
  resolution_dpi: number;
  format: string;
  plate_index: string;
  plate_barcode: string | null;
  transplant_date: string | null;
  custom_note: string | null;
  wave_number: number;
  cycle_number: number;
  session_id: string | null;
  scan_started_at: string; // ISO 8601
  interval_seconds?: number | null;
  duration_seconds?: number | null;
}

/**
 * Build a metadata object from a GraviScan context.
 *
 * @param context - Scan context with all required fields
 * @param captureDate - Timestamp for the scan (defaults to now)
 * @returns Metadata object ready for JSON serialization
 */
export function buildGraviMetadataObject(
  context: GraviScanMetadataContext,
  captureDate: Date = new Date()
): GraviScanMetadataJson {
  const result: Record<string, unknown> = {
    metadata_version: 1,
    scan_type: 'graviscan',
    experiment_id: context.experiment_id,
    phenotyper_id: context.phenotyper_id,
    scanner_id: context.scanner_id,
    scanner_name: context.scanner_name,
    grid_mode: context.grid_mode,
    resolution_dpi: context.resolution_dpi,
    format: context.format,
    plate_index: context.plate_index,
    wave_number: context.wave_number,
    cycle_number: context.cycle_number,
    session_id: context.session_id,
    scan_started_at: context.scan_started_at,
    capture_date: captureDate.toISOString(),
  };

  // Include optional fields only when not null/undefined
  if (context.plate_barcode != null) {
    result.plate_barcode = context.plate_barcode;
  }
  if (context.transplant_date != null) {
    result.transplant_date = context.transplant_date;
  }
  if (context.custom_note != null) {
    result.custom_note = context.custom_note;
  }

  // Include interval scan fields only when present
  if (context.interval_seconds != null) {
    result.interval_seconds = context.interval_seconds;
  }
  if (context.duration_seconds != null) {
    result.duration_seconds = context.duration_seconds;
  }

  return result as unknown as GraviScanMetadataJson;
}

/**
 * Write metadata.json to a scan output directory using atomic write pattern.
 *
 * Creates the directory if it doesn't exist. Writes to a .tmp file first,
 * then renames to metadata.json to prevent partial files.
 *
 * On failure, logs a warning and returns without throwing — scan images
 * are more important than metadata and should not be blocked by a write error.
 *
 * @param outputDir - Directory where metadata.json will be written
 * @param context - Scan context to extract metadata from
 * @param captureDate - Timestamp for the scan (defaults to now)
 */
export function writeGraviMetadataJson(
  outputDir: string,
  context: GraviScanMetadataContext,
  captureDate: Date = new Date()
): void {
  try {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const metadata = buildGraviMetadataObject(context, captureDate);
    const json = JSON.stringify(metadata, null, 2) + '\n';

    const finalPath = path.join(outputDir, 'metadata.json');
    const tmpPath = path.join(outputDir, 'metadata.json.tmp');

    // Clean up stale .tmp from a previous failed write
    if (fs.existsSync(tmpPath)) {
      fs.unlinkSync(tmpPath);
    }

    // Atomic write: write to .tmp, then rename
    fs.writeFileSync(tmpPath, json, 'utf-8');
    fs.renameSync(tmpPath, finalPath);
  } catch (error) {
    console.warn('Failed to write metadata.json:', error);
  }
}
