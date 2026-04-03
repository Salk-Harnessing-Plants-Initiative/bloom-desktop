/**
 * Type definitions for camera hardware interface.
 *
 * These types are shared between the main process (TypeScript) and
 * Python backend (via JSON serialization).
 */

/**
 * Camera settings for Basler cameras
 * Note: Uses snake_case to match Python backend convention
 */
export interface CameraSettings {
  /** Exposure time in microseconds */
  exposure_time: number;

  /** Gain (GainRaw integer value, 36-512 for acA2000-50gm) */
  gain: number;

  /** Camera IP address (e.g., "10.0.0.45"). Optional for mock camera. */
  camera_ip_address?: string;

  /** Gamma correction (typically 0.5 - 2.0) */
  gamma?: number;

  /** Number of frames to capture */
  num_frames?: number;

  /** Time for one complete rotation in seconds (for scanning) */
  seconds_per_rot?: number;
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
  /** Base64-encoded image data URI (e.g., "data:image/jpeg;base64,..." for streaming, "data:image/png;base64,..." for capture) */
  dataUri: string;

  /** Timestamp when image was captured */
  timestamp: number;

  /** Image width in pixels */
  width: number;

  /** Image height in pixels */
  height: number;
}

/**
 * Detected camera information
 */
export interface DetectedCamera {
  /** IP address or "mock" for mock camera */
  ip_address: string;

  /** Camera model name */
  model_name: string;

  /** Camera serial number */
  serial_number: string;

  /** MAC address (empty for mock) */
  mac_address: string;

  /** User-defined name (if set) */
  user_defined_name: string;

  /** Display-friendly name */
  friendly_name: string;

  /** Whether this is the mock camera */
  is_mock: boolean;
}

/**
 * Camera detection response
 */
export interface CameraDetectionResponse {
  cameras: DetectedCamera[];
  count: number;
}

/**
 * Default camera settings
 *
 * These are sensible default values for the Basler camera.
 * Exported for use in initialization and testing.
 */
export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  exposure_time: 10000, // 10ms
  gain: 100, // ~9.9 dB for acA2000-50gm (GainRaw integer)
  camera_ip_address: 'mock',
  gamma: 1.0,
};
