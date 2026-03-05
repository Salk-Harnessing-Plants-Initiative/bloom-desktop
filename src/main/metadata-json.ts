/**
 * Metadata JSON file writer for scan directories.
 *
 * Writes a metadata.json file alongside scan images, matching the
 * pilot implementation format (bloom-desktop-pilot scanner.ts:277-292).
 *
 * The metadata file is written BEFORE image capture begins for crash recovery.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { ScannerSettings } from '../types/scanner';

/**
 * Metadata JSON structure matching pilot's ScanMetadata type.
 * Fields are flat (camera settings not nested), matching pilot convention.
 *
 * Reference: bloom-desktop-pilot/app/src/types/custom.types.ts:10-28
 */
export interface ScanMetadataJson {
  id: string;
  phenotyper_id: string;
  experiment_id: string;
  scanner_name: string;
  plant_id: string;
  accession_name?: string;
  path: string;
  capture_date: string;
  wave_number: number;
  plant_age_days: number;
  num_frames: number;
  exposure_time: number;
  gain: number;
  brightness: number;
  contrast: number;
  gamma: number;
  seconds_per_rot: number;
}

/**
 * Build metadata JSON object from scanner settings.
 *
 * Assembles all metadata and camera settings into a flat object
 * matching the pilot's captureMetadata() output (scanner.ts:202-214).
 *
 * @param settings - Current scanner settings (with metadata and camera)
 * @param scanId - Pre-generated UUID for this scan
 * @returns Metadata object ready for JSON serialization
 */
export function buildScanMetadataJson(
  settings: ScannerSettings,
  scanId: string
): ScanMetadataJson {
  const metadata = settings.metadata!;
  const camera = settings.camera;

  return {
    id: scanId,
    phenotyper_id: metadata.phenotyper_id,
    experiment_id: metadata.experiment_id,
    scanner_name: metadata.scanner_name,
    plant_id: metadata.plant_id,
    accession_name: metadata.accession_name,
    path: settings.output_path || '',
    capture_date: new Date().toISOString(),
    wave_number: metadata.wave_number,
    plant_age_days: metadata.plant_age_days,
    num_frames: settings.num_frames ?? settings.daq.num_frames,
    exposure_time: camera.exposure_time,
    gain: camera.gain,
    brightness: camera.brightness ?? 0,
    contrast: camera.contrast ?? 1,
    gamma: camera.gamma ?? 1,
    seconds_per_rot: settings.daq.seconds_per_rot,
  };
}

/**
 * Write metadata object to metadata.json atomically.
 *
 * Uses temp-file-then-rename pattern to prevent partial files on crash.
 * Creates the output directory if it doesn't exist.
 *
 * Reference: pilot scanner.ts:277-292 (non-atomic), improved here.
 *
 * @param metadata - Metadata object to write
 * @param outputDir - Directory to write metadata.json into
 * @throws If write or rename fails (caller should handle gracefully)
 */
export function writeMetadataJsonAtomic(
  metadata: ScanMetadataJson | Record<string, unknown>,
  outputDir: string
): void {
  // Create directory if it doesn't exist (matching pilot scanner.ts:279)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const tmpPath = path.join(outputDir, 'metadata.json.tmp');
  const finalPath = path.join(outputDir, 'metadata.json');

  // Write to temp file, then rename (atomic on local filesystems)
  fs.writeFileSync(tmpPath, JSON.stringify(metadata, null, 2));
  fs.renameSync(tmpPath, finalPath);
}
