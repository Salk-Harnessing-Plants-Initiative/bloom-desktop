/**
 * Type definitions for the Electron API exposed to the renderer process.
 *
 * This file defines the `window.electron` API that is exposed via the preload script
 * using contextBridge.exposeInMainWorld().
 */

/**
 * Python backend API
 */
export interface PythonAPI {
  /**
   * Send a command to the Python backend
   * @param command - Command object to send
   * @returns Promise resolving to the response data
   */
  sendCommand: (command: object) => Promise<any>;

  /**
   * Get Python backend version
   * @returns Promise resolving to version info
   */
  getVersion: () => Promise<{ version: string }>;

  /**
   * Check hardware availability
   * @returns Promise resolving to hardware status
   */
  checkHardware: () => Promise<{ camera: boolean; daq: boolean }>;

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
 * Main Electron API exposed to renderer
 */
export interface ElectronAPI {
  python: PythonAPI;
  // Additional APIs will be added here (camera, daq, etc.)
}

/**
 * Extend the global Window interface
 */
declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
