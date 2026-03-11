/**
 * Type definitions for camera hardware interface.
 *
 * These types are shared between the main process (TypeScript) and
 * Python backend (via JSON serialization).
 */

/**
 * Camera settings for the Basler acA2000-50gm (ace Classic GigE)
 *
 * Contains only parameters supported by this camera model.
 * Note: Uses snake_case to match Python backend convention.
 *
 * Removed fields (not supported on ace Classic):
 * - brightness/contrast: BslBrightness/BslContrast are ace 2+ only
 * - width/height: Never applied to hardware in _configure_camera()
 * - num_frames/seconds_per_rot: Moved to MachineConfig (DAQ parameters)
 */
export interface CameraSettings {
  /** Exposure time in microseconds (Pylon: ExposureTimeAbs, IFloat) */
  exposure_time: number;

  /** Gain raw value (Pylon: GainRaw, IInteger, range 36-512 for acA2000-50gm) */
  gain: number;

  /** Camera IP address (e.g., "10.0.0.45"). Optional for mock camera. */
  camera_ip_address?: string;

  /** Gamma correction (Pylon: Gamma, IFloat, typically 0.5-2.0) */
  gamma?: number;
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

/**
 * Default camera settings for the Basler acA2000-50gm
 *
 * - gain: 100 (~9.9 dB, pilot default for GainRaw on CMV2000 sensor)
 * - gamma: 1.0 (linear, Basler identity value)
 */
export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  exposure_time: 10000, // 10ms
  gain: 100, // GainRaw ~9.9 dB (pilot default)
  camera_ip_address: 'mock',
  gamma: 1.0,
};
