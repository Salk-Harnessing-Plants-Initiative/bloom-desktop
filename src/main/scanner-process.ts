/**
 * Scanner Process Wrapper
 *
 * Manages communication with the Python backend for scanner operations.
 * Coordinates camera and DAQ for automated cylinder scanning.
 */

import { EventEmitter } from 'events';
import { PythonProcess } from './python-process';
import type {
  ScannerSettings,
  ScanResult,
  ScannerStatus,
  ScanProgress,
} from '../types/scanner';

/**
 * Scanner process manager for coordinated scanning operations.
 *
 * Extends PythonProcess to provide scanner-specific functionality.
 */
export class ScannerProcess extends EventEmitter {
  private pythonProcess: PythonProcess;

  constructor(pythonProcess: PythonProcess) {
    super();
    this.pythonProcess = pythonProcess;
  }

  /**
   * Initialize scanner with camera and DAQ settings.
   *
   * @param settings - Scanner configuration
   * @returns Promise resolving to initialization result
   */
  async initialize(
    settings: ScannerSettings
  ): Promise<{ success: boolean; initialized: boolean }> {
    const result = await this.pythonProcess.sendCommand({
      command: 'scanner',
      action: 'initialize',
      settings,
    });

    if (result.success) {
      this.emit('initialized', result);
    }

    return result;
  }

  /**
   * Cleanup scanner resources.
   *
   * @returns Promise resolving to cleanup result
   */
  async cleanup(): Promise<{ success: boolean; initialized: boolean }> {
    const result = await this.pythonProcess.sendCommand({
      command: 'scanner',
      action: 'cleanup',
    });

    if (result.success) {
      this.emit('cleanup', result);
    }

    return result;
  }

  /**
   * Perform a complete scan of the cylinder.
   *
   * This executes the full scanning workflow:
   * 1. Home turntable to 0°
   * 2. For each frame: rotate, stabilize, capture
   * 3. Return to home position
   *
   * @returns Promise resolving to scan result
   */
  async scan(): Promise<ScanResult> {
    const result = await this.pythonProcess.sendCommand({
      command: 'scanner',
      action: 'scan',
    });

    if (result.success) {
      this.emit('complete', result);
    } else if (result.error) {
      this.emit('error', result.error);
    }

    return result;
  }

  /**
   * Get current scanner status.
   *
   * @returns Promise resolving to scanner status
   */
  async getStatus(): Promise<ScannerStatus> {
    return this.pythonProcess.sendCommand({
      command: 'scanner',
      action: 'status',
    });
  }

  /**
   * Register a callback for progress updates during scanning.
   *
   * Note: Progress events are emitted during scan execution.
   *
   * @param callback - Function called with progress updates
   */
  onProgress(callback: (progress: ScanProgress) => void): void {
    this.on('progress', callback);
  }

  /**
   * Register a callback for scan completion.
   *
   * @param callback - Function called when scan completes
   */
  onComplete(callback: (result: ScanResult) => void): void {
    this.on('complete', callback);
  }

  /**
   * Register a callback for scanner errors.
   *
   * @param callback - Function called on errors
   */
  onError(callback: (error: string) => void): void {
    this.on('error', callback);
  }
}
