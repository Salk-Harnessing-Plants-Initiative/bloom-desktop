/**
 * Scanner Process Wrapper
 *
 * Manages communication with the Python backend for scanner operations.
 * Coordinates camera and DAQ for automated cylinder scanning.
 */

import { EventEmitter } from 'events';
import { PythonProcess } from './python-process';
import { getDatabase } from './database';
import * as fs from 'fs';
import * as path from 'path';
import type {
  ScannerSettings,
  ScanResult,
  ScannerStatus,
  ScanProgress,
} from '../types/scanner';

/**
 * Scanner process manager for coordinated scanning operations.
 *
 * Extends PythonProcess to provide scanner-specific functionality.
 */
export class ScannerProcess extends EventEmitter {
  private pythonProcess: PythonProcess;
  private currentSettings: ScannerSettings | null = null;
  private progressEvents: ScanProgress[] = [];

  constructor(pythonProcess: PythonProcess) {
    super();
    this.pythonProcess = pythonProcess;

    // Listen to our own progress events to collect them for database
    this.on('progress', (progress: ScanProgress) => {
      this.progressEvents.push(progress);
    });
  }

  /**
   * Initialize scanner with camera and DAQ settings.
   *
   * @param settings - Scanner configuration
   * @returns Promise resolving to initialization result
   */
  async initialize(
    settings: ScannerSettings
  ): Promise<{ success: boolean; initialized: boolean }> {
    // Store settings for database persistence
    this.currentSettings = settings;

    const result = await this.pythonProcess.sendCommand({
      command: 'scanner',
      action: 'initialize',
      settings,
    });

    if (result.success) {
      this.emit('initialized', result);
    }

    return result;
  }

  /**
   * Cleanup scanner resources.
   *
   * @returns Promise resolving to cleanup result
   */
  async cleanup(): Promise<{ success: boolean; initialized: boolean }> {
    const result = await this.pythonProcess.sendCommand({
      command: 'scanner',
      action: 'cleanup',
    });

    if (result.success) {
      this.emit('cleanup', result);
    }

    return result;
  }

  /**
   * Perform a complete scan of the cylinder.
   *
   * This executes the full scanning workflow:
   * 1. Home turntable to 0°
   * 2. For each frame: rotate, stabilize, capture
   * 3. Return to home position
   * 4. Save to database (if metadata provided)
   *
   * @returns Promise resolving to scan result (includes scan_id if saved to database)
   */
  async scan(): Promise<ScanResult> {
    // Reset progress events for new scan
    this.progressEvents = [];

    const result = await this.pythonProcess.sendCommand({
      command: 'scanner',
      action: 'scan',
    });

    if (result.success) {
      // Save to database if metadata was provided
      if (this.currentSettings?.metadata) {
        try {
          const scanId = await this.saveScanToDatabase(result);
          result.scan_id = scanId;
          console.log('[Scanner] Scan saved to database:', scanId);
        } catch (error) {
          console.error('[Scanner] Failed to save scan to database:', error);
          // Don't fail the scan itself if database save fails
          // The images were captured successfully
        }
      }

      this.emit('complete', result);
    } else if (result.error) {
      this.emit('error', result.error);
    }

    return result;
  }

  /**
   * Get current scanner status.
   *
   * @returns Promise resolving to scanner status
   */
  async getStatus(): Promise<ScannerStatus> {
    return this.pythonProcess.sendCommand({
      command: 'scanner',
      action: 'status',
    });
  }

  /**
   * Register a callback for progress updates during scanning.
   *
   * Note: Progress events are emitted during scan execution.
   *
   * @param callback - Function called with progress updates
   */
  onProgress(callback: (progress: ScanProgress) => void): void {
    this.on('progress', callback);
  }

  /**
   * Register a callback for scan completion.
   *
   * @param callback - Function called when scan completes
   */
  onComplete(callback: (result: ScanResult) => void): void {
    this.on('complete', callback);
  }

  /**
   * Register a callback for scanner errors.
   *
   * @param callback - Function called on errors
   */
  onError(callback: (error: string) => void): void {
    this.on('error', callback);
  }

  /**
   * Save scan and images to database using nested create pattern.
   *
   * This method follows the pilot implementation pattern:
   * - Extracts metadata from current settings
   * - Maps progress events to image records
   * - Uses nested create for atomic transaction
   *
   * @param scanResult - Result from Python scan command
   * @returns Promise resolving to database scan ID
   * @private
   */
  private async saveScanToDatabase(scanResult: ScanResult): Promise<string> {
    if (!this.currentSettings?.metadata) {
      throw new Error('No metadata available for database save');
    }

    const metadata = this.currentSettings.metadata;
    const settings = this.currentSettings;

    console.log('[Scanner] Saving scan to database:', {
      metadata,
      frames: this.progressEvents.length,
      output_path: scanResult.output_path,
    });

    // Read actual image files from output directory
    // This is more reliable than progress events since files are guaranteed to exist
    const images = [];
    if (fs.existsSync(scanResult.output_path)) {
      const files = fs
        .readdirSync(scanResult.output_path)
        .filter((f) => f.endsWith('.png') || f.endsWith('.jpg'))
        .sort(); // Sort to ensure correct order

      for (const file of files) {
        const imagePath = path.join(scanResult.output_path, file);
        // Extract frame number from filename (e.g., "frame_0000.png" -> 0)
        const frameMatch = file.match(/frame_(\d+)/);
        if (frameMatch) {
          const frameNumber = parseInt(frameMatch[1], 10);
          images.push({
            frame_number: frameNumber + 1, // Convert 0-indexed to 1-indexed (pilot compatible)
            path: imagePath,
            status: 'CAPTURED',
          });
        }
      }
    }

    // Get camera settings for database record
    const cameraSettings = settings.camera;

    // Create scan with nested images using Prisma nested create pattern (pilot pattern)
    const prisma = getDatabase();
    const newScan = await prisma.scan.create({
      data: {
        // Metadata fields
        experiment_id: metadata.experiment_id,
        phenotyper_id: metadata.phenotyper_id,
        scanner_name: metadata.scanner_name,
        plant_id: metadata.plant_id,
        accession_name: metadata.accession_name,
        plant_age_days: metadata.plant_age_days,
        wave_number: metadata.wave_number,

        // Scan parameters
        path: scanResult.output_path,
        num_frames: scanResult.frames_captured,
        exposure_time: cameraSettings.exposure_time,
        gain: cameraSettings.gain,
        brightness: cameraSettings.brightness ?? 0,
        contrast: cameraSettings.contrast ?? 1,
        gamma: cameraSettings.gamma ?? 1,
        seconds_per_rot: settings.daq.seconds_per_rot,

        // Nested image creation (atomic transaction)
        images: {
          create: images,
        },
      },
    });

    console.log('[Scanner] Successfully saved scan to database:', {
      scan_id: newScan.id,
      image_count: images.length,
    });

    return newScan.id;
  }
}
