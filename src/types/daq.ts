/**
 * Type definitions for DAQ (Data Acquisition) hardware interface.
 *
 * These types are shared between the main process (TypeScript) and
 * Python backend (via JSON serialization).
 */

/**
 * DAQ settings for NI-DAQmx turntable control
 * Note: Uses snake_case to match Python backend convention
 */
export interface DAQSettings {
  /** NI-DAQ device name (e.g., "cDAQ1Mod1") */
  device_name: string;

  /** DAQ sampling rate in Hz */
  sampling_rate: number;

  /** Digital output line for stepper step signal */
  step_pin: number;

  /** Digital output line for stepper direction signal */
  dir_pin: number;

  /** Number of steps for full 360° rotation */
  steps_per_revolution: number;

  /** Number of frames to capture during rotation */
  num_frames: number;

  /** Time for one complete rotation in seconds */
  seconds_per_rot: number;
}

/**
 * Default DAQ settings matching Python backend defaults.
 *
 * These are the standard settings for the Bloom desktop turntable system.
 * Exported for use in tests, documentation, and as a reference for consumers
 * of the DAQ API.
 *
 * @example
 * ```typescript
 * // Use defaults directly
 * await window.electron.daq.initialize(DEFAULT_DAQ_SETTINGS);
 *
 * // Or override specific settings
 * await window.electron.daq.initialize({
 *   ...DEFAULT_DAQ_SETTINGS,
 *   num_frames: 36,  // Use 36 frames instead of 72
 * });
 * ```
 */
export const DEFAULT_DAQ_SETTINGS: DAQSettings = {
  device_name: 'cDAQ1Mod1',
  sampling_rate: 40_000,
  step_pin: 0,
  dir_pin: 1,
  steps_per_revolution: 6400,
  num_frames: 72,
  seconds_per_rot: 7.0, // Changed from 36.0 for faster scans - see docs/CONFIGURATION.md
};

/**
 * DAQ status information
 */
export interface DAQStatus {
  /** Whether DAQ is initialized and ready */
  initialized: boolean;

  /** Current turntable position in degrees (0-360) */
  position: number;

  /** Whether using mock DAQ (true) or real hardware (false) */
  mock: boolean;

  /** Whether DAQ module is available */
  available: boolean;

  /** Error message if initialization or operation failed */
  error?: string;
}

/**
 * DAQ command actions
 */
export type DAQAction =
  | 'initialize'
  | 'cleanup'
  | 'rotate'
  | 'step'
  | 'home'
  | 'status';

/**
 * DAQ command parameters for initialize action
 */
export interface DAQInitializeParams {
  action: 'initialize';
  settings: DAQSettings;
}

/**
 * DAQ command parameters for cleanup action
 */
export interface DAQCleanupParams {
  action: 'cleanup';
}

/**
 * DAQ command parameters for rotate action
 */
export interface DAQRotateParams {
  action: 'rotate';
  /** Degrees to rotate (positive = clockwise, negative = counter-clockwise) */
  degrees: number;
}

/**
 * DAQ command parameters for step action
 */
export interface DAQStepParams {
  action: 'step';
  /** Number of steps to execute */
  num_steps: number;
  /** Direction (1 = clockwise, -1 = counter-clockwise) */
  direction: 1 | -1;
}

/**
 * DAQ command parameters for home action
 */
export interface DAQHomeParams {
  action: 'home';
}

/**
 * DAQ command parameters for status action
 */
export interface DAQStatusParams {
  action: 'status';
}

/**
 * Union type for all DAQ command parameters
 */
export type DAQCommandParams =
  | DAQInitializeParams
  | DAQCleanupParams
  | DAQRotateParams
  | DAQStepParams
  | DAQHomeParams
  | DAQStatusParams;

/**
 * Response from DAQ initialize command
 */
export interface DAQInitializeResponse {
  success: boolean;
  initialized: boolean;
  error?: string;
}

/**
 * Response from DAQ cleanup command
 */
export interface DAQCleanupResponse {
  success: boolean;
  initialized: boolean;
  error?: string;
}

/**
 * Response from DAQ rotate command
 */
export interface DAQRotateResponse {
  success: boolean;
  position: number;
  error?: string;
}

/**
 * Response from DAQ step command
 */
export interface DAQStepResponse {
  success: boolean;
  position: number;
  error?: string;
}

/**
 * Response from DAQ home command
 */
export interface DAQHomeResponse {
  success: boolean;
  position: number;
  error?: string;
}

/**
 * Response from DAQ status command
 */
export interface DAQStatusResponse {
  success: boolean;
  initialized: boolean;
  position: number;
  mock: boolean;
  available: boolean;
  error?: string;
}

/**
 * Union type for all DAQ command responses
 */
export type DAQCommandResponse =
  | DAQInitializeResponse
  | DAQCleanupResponse
  | DAQRotateResponse
  | DAQStepResponse
  | DAQHomeResponse
  | DAQStatusResponse;
