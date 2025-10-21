/**
 * Type definitions for the Electron API exposed to the renderer process.
 *
 * This file defines the `window.electron` API that is exposed via the preload script
 * using contextBridge.exposeInMainWorld().
 */

import { CameraSettings, CapturedImage } from './camera';

/**
 * Python backend API
 */
export interface PythonAPI {
  /**
   * Send a command to the Python backend
   * @param command - Command object to send
   * @returns Promise resolving to the response data
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendCommand: (command: object) => Promise<any>;

  /**
   * Get Python backend version
   * @returns Promise resolving to version info
   */
  getVersion: () => Promise<{ version: string }>;

  /**
   * Check hardware availability
   * @returns Promise resolving to hardware status with detailed info
   */
  checkHardware: () => Promise<{
    camera: {
      library_available: boolean;
      devices_found: number;
      available: boolean;
    };
    daq: {
      library_available: boolean;
      devices_found: number;
      available: boolean;
    };
  }>;

  /**
   * Restart the Python subprocess
   * @returns Promise resolving when restart is complete
   */
  restart: () => Promise<{ success: boolean }>;

  /**
   * Register callback for Python status updates
   * @param callback - Function to call with status messages
   */
  onStatus: (callback: (status: string) => void) => void;

  /**
   * Register callback for Python errors
   * @param callback - Function to call with error messages
   */
  onError: (callback: (error: string) => void) => void;
}

/**
 * Camera API
 */
export interface CameraAPI {
  /**
   * Connect to the camera
   * @param settings - Camera configuration settings
   * @returns Promise resolving to connection success
   */
  connect: (settings: CameraSettings) => Promise<boolean>;

  /**
   * Disconnect from the camera
   * @returns Promise resolving to disconnection success
   */
  disconnect: () => Promise<boolean>;

  /**
   * Configure camera settings
   * @param settings - Camera settings to apply
   * @returns Promise resolving to configuration success
   */
  configure: (settings: Partial<CameraSettings>) => Promise<boolean>;

  /**
   * Capture a single frame
   * @param settings - Optional camera settings to apply before capture
   * @returns Promise resolving to captured image data
   */
  capture: (settings?: Partial<CameraSettings>) => Promise<CapturedImage>;

  /**
   * Get camera status
   * @returns Promise resolving to camera status
   */
  getStatus: () => Promise<{
    connected: boolean;
    mock: boolean;
    available: boolean;
  }>;

  /**
   * Register callback for camera trigger events
   * @param callback - Function to call when camera is triggered
   */
  onTrigger: (callback: () => void) => void;

  /**
   * Register callback for captured images
   * @param callback - Function to call with captured image data
   */
  onImageCaptured: (callback: (image: CapturedImage) => void) => void;
}

/**
 * Main Electron API exposed to renderer
 */
export interface ElectronAPI {
  python: PythonAPI;
  camera: CameraAPI;
}

/**
 * Extend the global Window interface
 */
declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
