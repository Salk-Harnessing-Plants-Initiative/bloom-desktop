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

/**
 * The limits the Camera Settings form allows, shared by the form (sliders, number
 * boxes, Apply) and by the file that keeps the settings across restarts (#440).
 */
export const CAMERA_SETTING_LIMITS = {
  exposure_time: { label: 'Exposure', min: 100, max: 50000, unit: ' µs' },
  gain: { label: 'Gain', min: 36, max: 512, unit: '', wholeNumber: true },
  gamma: { label: 'Gamma', min: 0.5, max: 2.0, unit: '' },
} as const;

export type LimitedCameraSetting = keyof typeof CAMERA_SETTING_LIMITS;

/** Why a setting can't be used, in words for the operator, or null when it's fine. */
export function cameraSettingError(
  field: LimitedCameraSetting,
  value: unknown
): string | null {
  const limit = CAMERA_SETTING_LIMITS[field];
  const whole = 'wholeNumber' in limit && limit.wholeNumber;
  const ok =
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= limit.min &&
    value <= limit.max &&
    (!whole || Number.isInteger(value));
  if (ok) return null;
  return `${limit.label} must be ${whole ? 'a whole number ' : ''}between ${limit.min.toLocaleString(
    'en-US'
  )} and ${limit.max.toLocaleString('en-US')}${limit.unit}.`;
}

/** Every setting that can't be used, with the reason. Empty when all are fine. */
export function cameraSettingsErrors(
  settings: Partial<CameraSettings>
): Partial<Record<LimitedCameraSetting, string>> {
  const errors: Partial<Record<LimitedCameraSetting, string>> = {};
  for (const field of Object.keys(
    CAMERA_SETTING_LIMITS
  ) as LimitedCameraSetting[]) {
    const error = cameraSettingError(field, settings[field]);
    if (error) errors[field] = error;
  }
  return errors;
}

/** Why the settings couldn't be kept for future sessions (shown with the code on Camera Settings). */
export const CAMERA_SETTINGS_SAVE_ERRORS = {
  'CAM-SAVE-01': {
    title: 'Settings out of range',
    help: 'A value is outside the limits shown on this page. Fix it and apply again.',
  },
  'CAM-SAVE-02': {
    title: 'No permission to write the settings file',
    help: "Windows refused to write .bloom\\camera-settings.json in this account's folder. Check the folder isn't read-only, then apply again.",
  },
  'CAM-SAVE-03': {
    title: 'Disk full',
    help: 'The C: drive has no space for the settings file. Free some space, then apply again.',
  },
  'CAM-SAVE-04': {
    title: 'Settings file in use',
    help: 'Another program (often antivirus or backup) had the file open. Apply again in a moment.',
  },
  'CAM-SAVE-99': {
    title: "Couldn't save the settings",
    help: 'An unexpected error. Apply again; if it keeps happening, send the message below to the Bloom team.',
  },
} as const;

export type CameraSettingsSaveErrorCode =
  keyof typeof CAMERA_SETTINGS_SAVE_ERRORS;

/** The result of Apply: whether the camera took the settings, and whether they were kept. */
export interface CameraConfigureResult {
  success: boolean;
  error?: string;
  /** Kept for future sessions in ~/.bloom/camera-settings.json. */
  saved?: boolean;
  saveError?: { code: CameraSettingsSaveErrorCode; message: string };
}
