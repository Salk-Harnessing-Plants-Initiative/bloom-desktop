/**
 * Type definitions for DAQ (Data Acquisition) hardware interface.
 *
 * These types are shared between the main process (TypeScript) and
 * Python backend (via JSON serialization).
 */

/**
 * DAQ device configuration
 */
export interface DaqConfig {
  /** Device ID (e.g., "Dev1") */
  deviceId: string;

  /** Steps per full rotation (360 degrees) */
  stepsPerRevolution?: number;

  /** Step delay in milliseconds */
  stepDelay?: number;
}

/**
 * DAQ status information
 */
export interface DaqStatus {
  /** Whether DAQ is connected */
  connected: boolean;

  /** Device ID if connected */
  deviceId?: string;

  /** Current rotation position in degrees (0-360) */
  position?: number;

  /** Whether DAQ is currently moving */
  moving?: boolean;

  /** Error message if connection failed */
  error?: string;
}

/**
 * Rotation command parameters
 */
export interface RotationCommand {
  /** Degrees to rotate (positive = clockwise, negative = counter-clockwise) */
  degrees: number;

  /** Optional: Speed multiplier (1.0 = normal speed) */
  speed?: number;
}

/**
 * Scan configuration for 360-degree scanning
 */
export interface ScanConfig {
  /** Total number of frames to capture */
  numFrames: number;

  /** Degrees per frame (calculated from numFrames if not provided) */
  degreesPerFrame?: number;

  /** Whether to return to home position after scan */
  returnHome?: boolean;
}
