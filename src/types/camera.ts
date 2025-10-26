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

  /** Gain (raw value) */
  gain: number;

  /** Camera IP address (e.g., "10.0.0.45"). Optional for mock camera. */
  camera_ip_address?: string;

  /** Brightness (0.0 - 1.0, optional) */
  brightness?: number;

  /** Gamma correction (typically 0.5 - 2.0) */
  gamma?: number;

  /** Number of frames to capture */
  num_frames?: number;

  /** Time for one complete rotation in seconds (for scanning) */
  seconds_per_rot?: number;

  /** Contrast (optional, not supported on all cameras) */
  contrast?: number;

  /** Image width in pixels (optional) */
  width?: number;

  /** Image height in pixels (optional) */
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
