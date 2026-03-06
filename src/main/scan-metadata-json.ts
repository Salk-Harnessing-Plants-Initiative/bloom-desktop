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
import type { ScannerSettings } from '../types/scanner';

/**
 * Metadata object written to metadata.json.
 * Contains all fields needed to reproduce or trace a scan.
 */
export interface ScanMetadataJson {
  experiment_id: string;
  phenotyper_id: string;
  scanner_name: string;
  plant_id: string;
  accession_name?: string;
  plant_age_days: number;
  wave_number: number;
  capture_date: string;
  num_frames: number;
  scan_path?: string;
  exposure_time: number;
  gain: number;
  brightness: number;
  contrast: number;
  gamma: number;
  seconds_per_rot: number;
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
    experiment_id: meta.experiment_id,
    phenotyper_id: meta.phenotyper_id,
    scanner_name: meta.scanner_name,
    plant_id: meta.plant_id,
    plant_age_days: meta.plant_age_days,
    wave_number: meta.wave_number,
    capture_date: captureDate.toISOString(),
    num_frames: settings.num_frames ?? settings.daq.num_frames,
    exposure_time: cam.exposure_time,
    gain: cam.gain,
    brightness: cam.brightness ?? 0,
    contrast: cam.contrast ?? 1,
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
  const json = JSON.stringify(metadata, null, 2);

  const finalPath = path.join(outputDir, 'metadata.json');
  const tmpPath = path.join(outputDir, 'metadata.json.tmp');

  // Atomic write: write to .tmp, then rename
  fs.writeFileSync(tmpPath, json, 'utf-8');
  fs.renameSync(tmpPath, finalPath);
}
