/**
 * Type definitions for Scanner API
 *
 * The Scanner coordinates camera and DAQ for automated cylinder scanning.
 */

import { CameraSettings } from './camera';
import { DAQSettings } from './daq';

/**
 * Scanner configuration settings.
 */
export interface ScannerSettings {
  /** Camera configuration settings */
  camera: CameraSettings;

  /** DAQ configuration settings */
  daq: DAQSettings;

  /** Number of frames to capture during full rotation (default: 72) */
  num_frames: number;

  /** Directory path for saving captured images (default: "./scans") */
  output_path: string;
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
  initialize: (settings: ScannerSettings) => Promise<{ success: boolean; initialized: boolean }>;

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
   * Event listener for scan progress updates.
   *
   * @param callback - Function called with progress updates
   */
  onProgress: (callback: (progress: ScanProgress) => void) => void;

  /**
   * Event listener for scan completion.
   *
   * @param callback - Function called when scan completes
   */
  onComplete: (callback: (result: ScanResult) => void) => void;

  /**
   * Event listener for scanner errors.
   *
   * @param callback - Function called on errors
   */
  onError: (callback: (error: string) => void) => void;
}

/**
 * Default scanner settings matching Python backend defaults.
 *
 * These are the standard settings for the Bloom desktop scanning system.
 * Exported for use in tests, documentation, and as a reference for consumers
 * of the Scanner API.
 *
 * Note: Camera and DAQ settings should be provided based on hardware configuration.
 *
 * @example
 * ```typescript
 * import { DEFAULT_CAMERA_SETTINGS } from './camera';
 * import { DEFAULT_DAQ_SETTINGS } from './daq';
 * import { DEFAULT_SCANNER_SETTINGS } from './scanner';
 *
 * // Use defaults directly
 * await window.electron.scanner.initialize({
 *   ...DEFAULT_SCANNER_SETTINGS,
 *   camera: DEFAULT_CAMERA_SETTINGS,
 *   daq: DEFAULT_DAQ_SETTINGS,
 * });
 *
 * // Or override specific settings
 * await window.electron.scanner.initialize({
 *   ...DEFAULT_SCANNER_SETTINGS,
 *   camera: DEFAULT_CAMERA_SETTINGS,
 *   daq: DEFAULT_DAQ_SETTINGS,
 *   num_frames: 36,  // Use 36 frames instead of 72
 *   output_path: './my-scans',
 * });
 * ```
 */
export const DEFAULT_SCANNER_SETTINGS = {
  num_frames: 72,
  output_path: './scans',
};
