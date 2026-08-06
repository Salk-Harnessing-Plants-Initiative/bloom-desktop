/**
 * Scan Metadata JSON Writer
 *
 * Writes a metadata.json file alongside scan images so that scan data
 * is self-describing and portable without requiring the SQLite database.
 *
 * Uses atomic write pattern (write to .tmp, rename to final) to prevent
 * partial or corrupt files.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ScannerSettings } from '../../types/scanner';

/**
 * Metadata object written to metadata.json.
 * Contains all fields needed to reproduce or trace a scan.
 */
export interface ScanMetadataJson {
  metadata_version: number;
  experiment_id: string;
  phenotyper_id: string;
  scanner_name: string;
  plant_id: string;
  accession_name?: string;
  plant_age_days: number;
  wave_number: number;
  capture_date: string;
  num_frames: number;
  /**
   * Path to the scan directory. Prefers the relative path from
   * `metadata.scan_path` (e.g. `2026-03-04/PLANT-001/uuid`) for portability.
   * Falls back to the absolute `settings.output_path` when no relative path
   * is available. Consumers should handle both relative and absolute paths.
   */
  scan_path?: string;
  exposure_time: number;
  gain: number;
  brightness: number;
  contrast: number;
  gamma: number;
  seconds_per_rot: number;
  /**
   * Set to true when the scan is soft-deleted. Absent (or false) means
   * not deleted — use isScanMetadataDeleted() rather than reading this
   * field directly, since legacy files predate it.
   */
  deleted?: boolean;
}

/**
 * Returns whether a scan's metadata marks it as deleted. Treats an
 * absent `deleted` key (legacy metadata.json files) the same as `false`.
 */
export function isScanMetadataDeleted(json: ScanMetadataJson): boolean {
  return json.deleted === true;
}

/**
 * Build a metadata object from ScannerSettings.
 *
 * @param settings - Scanner settings including metadata, camera, and DAQ config
 * @param captureDate - Timestamp for the scan (defaults to now)
 * @returns Metadata object ready for JSON serialization
 */
export function buildMetadataObject(
  settings: ScannerSettings,
  captureDate: Date = new Date()
): ScanMetadataJson {
  if (!settings.metadata) {
    throw new Error('settings.metadata is required for buildMetadataObject');
  }
  const meta = settings.metadata;
  const cam = settings.camera;

  const result: ScanMetadataJson = {
    metadata_version: 1,
    experiment_id: meta.experiment_id,
    phenotyper_id: meta.phenotyper_id,
    scanner_name: meta.scanner_name,
    plant_id: meta.plant_id,
    plant_age_days: meta.plant_age_days,
    wave_number: meta.wave_number,
    capture_date: captureDate.toISOString(),
    // Top-level num_frames takes precedence over daq.num_frames (top-level
    // is the user-facing setting; DAQ value is the hardware default).
    num_frames: settings.num_frames ?? settings.daq.num_frames,
    exposure_time: cam.exposure_time,
    gain: cam.gain,
    // Defaults match Basler Pylon API identity values and pilot defaults.
    // Brightness/contrast are not supported on aca2000-50gm (ace Classic)
    // and are commented out in the pilot UI — users never change them.
    // See: bloom-desktop-pilot/app/src/main/scanner.ts:defaultCameraSettings()
    // Brightness/contrast removed from CameraSettings (unsupported on acA2000-50gm).
    // Always write identity defaults (0) for metadata backward compatibility.
    brightness: 0,
    contrast: 0,
    gamma: cam.gamma ?? 1,
    seconds_per_rot: settings.daq.seconds_per_rot,
  };

  // Include optional fields only when provided
  if (meta.accession_name !== undefined) {
    result.accession_name = meta.accession_name;
  }
  const scanPath = meta.scan_path ?? settings.output_path;
  if (scanPath !== undefined) {
    result.scan_path = scanPath;
  }

  return result;
}

/**
 * Write metadata.json to a scan output directory using atomic write pattern.
 *
 * Creates the directory if it doesn't exist. Writes to a .tmp file first,
 * then renames to metadata.json to prevent partial files.
 *
 * @param outputDir - Directory where metadata.json will be written
 * @param settings - Scanner settings to extract metadata from
 * @param captureDate - Timestamp for the scan (defaults to now)
 */
/**
 * Write a JSON value to `finalPath` atomically: write to a `.tmp` sibling
 * first, then rename over the final path. Prevents partial/corrupt files
 * from a crash mid-write. Cleans up a stale `.tmp` from a previous failed
 * write before starting.
 */
function atomicWriteJson(finalPath: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2) + '\n';
  const tmpPath = `${finalPath}.tmp`;

  if (fs.existsSync(tmpPath)) {
    fs.unlinkSync(tmpPath);
  }

  fs.writeFileSync(tmpPath, json, 'utf-8');
  fs.renameSync(tmpPath, finalPath);
}

export function writeMetadataJson(
  outputDir: string,
  settings: ScannerSettings,
  captureDate: Date = new Date()
): void {
  // Ensure output directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const metadata = buildMetadataObject(settings, captureDate);
  atomicWriteJson(path.join(outputDir, 'metadata.json'), metadata);
}

/**
 * Marks an existing metadata.json as deleted (`deleted: true`), preserving
 * all other fields. Throws if metadata.json doesn't exist at `outputDir` —
 * callers should catch this for legacy scans predating metadata.json
 * support and log a warning rather than fail the delete.
 */
export function markMetadataDeleted(outputDir: string): void {
  const finalPath = path.join(outputDir, 'metadata.json');
  const existing: ScanMetadataJson = JSON.parse(
    fs.readFileSync(finalPath, 'utf-8')
  );
  atomicWriteJson(finalPath, { ...existing, deleted: true });
}
