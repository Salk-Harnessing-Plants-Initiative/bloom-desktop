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
  /** Image filename this metadata describes (e.g. "plate_00_st_...cy1.tiff"). */
  image_filename?: string;
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
  const result: GraviScanMetadataJson = {
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

  // Include image_filename when present so each per-image metadata file
  // is self-identifying (B4 fix — one JSON per scan, not per directory).
  if (context.image_filename) {
    result.image_filename = context.image_filename;
  }

  return result;
}

/**
 * Write a metadata JSON file for a single scan image using atomic write pattern.
 *
 * Writes one `<image_basename>.metadata.json` per image rather than a single
 * shared `metadata.json` per directory. Fixes B4 from PR #196 review —
 * multiple plates/cycles would otherwise overwrite each other's metadata.
 *
 * Creates the directory if it doesn't exist. Writes to a .tmp file first,
 * then renames atomically to prevent partial files.
 *
 * On failure, logs a warning and returns without throwing — scan images
 * are more important than metadata and should not be blocked by a write error.
 *
 * @param outputDir - Directory where the metadata file will be written
 * @param imageBasename - Scan image filename (e.g. "plate_00_st_20260416T143000_cy1.tiff"),
 *                       or "metadata" for the legacy shared file
 * @param context - Scan context to extract metadata from
 * @param captureDate - Timestamp for the scan (defaults to now)
 */
export function writeGraviMetadataJson(
  outputDir: string,
  imageBasename: string,
  context: GraviScanMetadataContext,
  captureDate: Date = new Date()
): void {
  try {
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Strip extension from image basename to derive JSON filename
    // e.g. "plate_00_st_...cy1.tiff" -> "plate_00_st_...cy1.metadata.json"
    const stem = imageBasename.replace(/\.[^.]+$/, '');
    const jsonFilename =
      stem === imageBasename && stem === 'metadata'
        ? 'metadata.json'
        : `${stem}.metadata.json`;

    // Include image_filename in the metadata so each file is self-identifying
    const metadata = buildGraviMetadataObject(
      { ...context, image_filename: imageBasename },
      captureDate
    );
    const json = JSON.stringify(metadata, null, 2) + '\n';

    const finalPath = path.join(outputDir, jsonFilename);
    const tmpPath = path.join(outputDir, `${jsonFilename}.tmp`);

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
