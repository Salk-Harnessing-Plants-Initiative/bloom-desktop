/**
 * Type definitions for camera hardware interface.
 *
 * These types are shared between the main process (TypeScript) and
 * Python backend (via JSON serialization).
 */

/**
 * Camera settings for Basler cameras
 */
export interface CameraSettings {
  /** Camera IP address (e.g., "10.0.0.45") */
  ipAddress: string;

  /** Exposure time in microseconds */
  exposure: number;

  /** Gain in dB */
  gain: number;

  /** Brightness (0.0 - 1.0) */
  brightness?: number;

  /** Gamma correction (typically 0.5 - 2.0) */
  gamma?: number;

  /** Image width in pixels */
  width?: number;

  /** Image height in pixels */
  height?: number;
}

/**
 * Camera status information
 */
export interface CameraStatus {
  /** Whether camera is connected */
  connected: boolean;

  /** Camera IP address if connected */
  ipAddress?: string;

  /** Current camera settings if connected */
  settings?: CameraSettings;

  /** Error message if connection failed */
  error?: string;
}

/**
 * Captured image data
 */
export interface CapturedImage {
  /** Base64-encoded image data URI (e.g., "data:image/png;base64,...") */
  dataUri: string;

  /** Timestamp when image was captured */
  timestamp: number;

  /** Image width in pixels */
  width: number;

  /** Image height in pixels */
  height: number;
}
