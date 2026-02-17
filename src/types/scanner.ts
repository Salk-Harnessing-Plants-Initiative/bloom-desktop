/**
 * Type definitions for Scanner API
 *
 * The Scanner coordinates camera and DAQ for automated cylinder scanning.
 */

import { CameraSettings } from './camera';
import { DAQSettings } from './daq';

/**
 * Metadata for a scan that will be saved to the database.
 * All fields are required for database persistence.
 */
export interface ScanMetadata {
  /** ID of the experiment this scan belongs to */
  experiment_id: string;

  /** ID of the phenotyper performing the scan */
  phenotyper_id: string;

  /** Name/ID of the scanner hardware */
  scanner_name: string;

  /** Plant identifier (barcode, QR code, or manual ID) */
  plant_id: string;

  /** Optional accession name if known (e.g., "Col-0") */
  accession_name?: string;

  /** Age of the plant in days at time of scan */
  plant_age_days: number;

  /** Wave number for this scan (typically 1-4 for multiple time points) */
  wave_number: number;
}

/**
 * Scanner configuration settings.
 */
export interface ScannerSettings {
  /** Camera configuration settings */
  camera: CameraSettings;

  /** DAQ configuration settings */
  daq: DAQSettings;

  /**
   * Number of frames to capture during full rotation.
   * Optional - defaults to 72 if not specified.
   */
  num_frames?: number;

  /**
   * Directory path for saving captured images.
   * Optional - defaults to "./scans" if not specified.
   */
  output_path?: string;

  /**
   * Metadata for database persistence.
   * If provided, scan will be automatically saved to database on completion.
   */
  metadata?: ScanMetadata;
}

/**
 * Progress information for an ongoing scan.
 */
export interface ScanProgress {
  /** Current frame number (0-indexed) */
  frame_number: number;

  /** Total number of frames in the scan */
  total_frames: number;

  /** Current turntable position in degrees */
  position: number;

  /** Path to the captured image (if available) */
  image_path?: string;
}

/**
 * Result information from a completed scan.
 */
export interface ScanResult {
  /** Whether the scan completed successfully */
  success: boolean;

  /** Number of frames successfully captured */
  frames_captured: number;

  /** Directory path where images were saved */
  output_path: string;

  /** Database scan ID if metadata was provided and save was successful */
  scan_id?: string;

  /** Error message if scan failed (undefined if successful) */
  error?: string;
}

/**
 * Scanner status information.
 */
export interface ScannerStatus {
  /** Whether the operation was successful */
  success: boolean;

  /** Whether scanner is initialized */
  initialized: boolean;

  /** Camera status (connected, disconnected, unknown) */
  camera_status: 'connected' | 'disconnected' | 'unknown';

  /** DAQ status (initialized, not_initialized, unknown) */
  daq_status: 'initialized' | 'not_initialized' | 'unknown';

  /** Current turntable position in degrees */
  position: number;

  /** Whether using mock hardware */
  mock: boolean;
}

/**
 * Scanner API interface for IPC communication.
 */
export interface ScannerAPI {
  /**
   * Initialize scanner with camera and DAQ.
   *
   * @param settings - Scanner configuration settings
   * @returns Promise resolving to success status
   */
  initialize: (
    settings: ScannerSettings
  ) => Promise<{ success: boolean; initialized: boolean }>;

  /**
   * Cleanup scanner resources.
   *
   * @returns Promise resolving to success status
   */
  cleanup: () => Promise<{ success: boolean; initialized: boolean }>;

  /**
   * Perform a complete scan of the cylinder.
   *
   * @returns Promise resolving to scan result
   */
  scan: () => Promise<ScanResult>;

  /**
   * Get current scanner status.
   *
   * @returns Promise resolving to scanner status
   */
  getStatus: () => Promise<ScannerStatus>;

  /**
   * Get the current scanner identity (name).
   *
   * Returns the scanner's configured name from runtime state.
   * Returns empty string if scanner not configured.
   *
   * @returns Promise resolving to scanner name
   */
  getScannerId: () => Promise<string>;

  /**
   * Event listener for scan progress updates.
   *
   * @param callback - Function called with progress updates
   * @returns Cleanup function to remove the listener
   */
  onProgress: (callback: (progress: ScanProgress) => void) => () => void;

  /**
   * Event listener for scan completion.
   *
   * @param callback - Function called when scan completes
   * @returns Cleanup function to remove the listener
   */
  onComplete: (callback: (result: ScanResult) => void) => () => void;

  /**
   * Event listener for scanner errors.
   *
   * @param callback - Function called on errors
   * @returns Cleanup function to remove the listener
   */
  onError: (callback: (error: string) => void) => () => void;
}

/**
 * Default scanner settings (partial).
 *
 * These are the standard default values for the Bloom desktop scanning system.
 * Camera and DAQ settings must be provided by the caller based on hardware configuration.
 *
 * Note: num_frames and output_path are optional in ScannerSettings and will default
 * to these values if not specified. The Python backend handles these defaults.
 *
 * Exported for use in tests, documentation, and as a reference for consumers
 * of the Scanner API.
 *
 * @example
 * ```typescript
 * import { DEFAULT_CAMERA_SETTINGS } from './camera';
 * import { DEFAULT_DAQ_SETTINGS } from './daq';
 *
 * // Minimal settings - num_frames and output_path use defaults
 * await window.electron.scanner.initialize({
 *   camera: DEFAULT_CAMERA_SETTINGS,
 *   daq: DEFAULT_DAQ_SETTINGS,
 * });
 *
 * // Or override default values
 * await window.electron.scanner.initialize({
 *   camera: DEFAULT_CAMERA_SETTINGS,
 *   daq: DEFAULT_DAQ_SETTINGS,
 *   num_frames: 36,  // Override default of 72
 *   output_path: './my-scans',  // Override default of './scans'
 * });
 * ```
 */
export const DEFAULT_SCANNER_SETTINGS: Partial<ScannerSettings> = {
  num_frames: 72,
  output_path: './scans',
};
