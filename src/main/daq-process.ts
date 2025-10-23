/**
 * DAQ Process Manager
 *
 * Manages DAQ subprocess communication for turntable control.
 * Extends PythonProcess to handle DAQ-specific commands and events.
 */

import { PythonProcess } from './python-process';
import type {
  DAQSettings,
  DAQInitializeResponse,
  DAQCleanupResponse,
  DAQRotateResponse,
  DAQStepResponse,
  DAQHomeResponse,
  DAQStatusResponse,
} from '../types/daq';

/**
 * DAQ process events:
 *   - 'daq-initialized': () => void - DAQ was initialized
 *   - 'daq-position-changed': (position: number) => void - Position changed
 *   - 'daq-home': () => void - Returned to home position
 *   - Plus all PythonProcess events (status, error, data, etc.)
 */
export class DAQProcess extends PythonProcess {
  /**
   * Parse protocol lines, including DAQ-specific messages.
   *
   * @param line - Line to parse
   */
  protected parseLine(line: string): void {
    // Handle DAQ-specific protocol messages
    if (line.startsWith('DAQ_INITIALIZED')) {
      this.emit('daq-initialized');
    } else if (line.startsWith('DAQ_POSITION ')) {
      // Position update: "DAQ_POSITION 45.0"
      const position = parseFloat(line.substring(13));
      this.emit('daq-position-changed', position);
    } else if (line.startsWith('DAQ_HOME')) {
      this.emit('daq-home');
    } else {
      // Delegate to parent class for standard protocol messages
      super.parseLine(line);
    }
  }

  /**
   * Initialize the DAQ with specified settings.
   *
   * @param settings - DAQ configuration settings
   * @returns Promise that resolves when DAQ is initialized
   */
  async initialize(settings: DAQSettings): Promise<DAQInitializeResponse> {
    const response = await this.sendCommand({
      command: 'daq',
      action: 'initialize',
      settings,
    });

    return response as DAQInitializeResponse;
  }

  /**
   * Clean up and close the DAQ connection.
   *
   * @returns Promise that resolves when DAQ is cleaned up
   */
  async cleanup(): Promise<DAQCleanupResponse> {
    const response = await this.sendCommand({
      command: 'daq',
      action: 'cleanup',
    });

    return response as DAQCleanupResponse;
  }

  /**
   * Rotate the turntable by specified degrees.
   *
   * @param degrees - Degrees to rotate (positive = clockwise, negative = counter-clockwise)
   * @returns Promise that resolves with new position
   */
  async rotate(degrees: number): Promise<DAQRotateResponse> {
    const response = await this.sendCommand({
      command: 'daq',
      action: 'rotate',
      degrees,
    });

    return response as DAQRotateResponse;
  }

  /**
   * Execute a specific number of stepper motor steps.
   *
   * @param numSteps - Number of steps to execute
   * @param direction - Direction (1 = clockwise, -1 = counter-clockwise)
   * @returns Promise that resolves with new position
   */
  async step(
    numSteps: number,
    direction: 1 | -1 = 1
  ): Promise<DAQStepResponse> {
    const response = await this.sendCommand({
      command: 'daq',
      action: 'step',
      num_steps: numSteps,
      direction,
    });

    return response as DAQStepResponse;
  }

  /**
   * Return turntable to home position (0 degrees).
   *
   * @returns Promise that resolves with position (should be 0.0)
   */
  async home(): Promise<DAQHomeResponse> {
    const response = await this.sendCommand({
      command: 'daq',
      action: 'home',
    });

    return response as DAQHomeResponse;
  }

  /**
   * Get DAQ status.
   *
   * @returns Promise that resolves with DAQ status
   */
  async getStatus(): Promise<DAQStatusResponse> {
    const response = await this.sendCommand({
      command: 'daq',
      action: 'status',
    });

    return response as DAQStatusResponse;
  }

  /**
   * Perform a complete 360° scan with synchronized camera capture.
   *
   * Note: This is a placeholder for future synchronized scanning implementation.
   * Will require coordination with camera process for frame capture at each position.
   *
   * @param settings - DAQ settings for the scan
   * @param onFramePosition - Callback when DAQ reaches each frame position
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async performScan(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _settings: DAQSettings,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _onFramePosition?: (position: number, frameIndex: number) => Promise<void>
  ): Promise<void> {
    // Future implementation
    // This will coordinate DAQ rotation with camera capture:
    // 1. Calculate degrees per frame (360 / num_frames)
    // 2. For each frame:
    //    a. Rotate to position
    //    b. Wait for stabilization
    //    c. Trigger camera capture via callback
    //    d. Wait for capture completion
    // 3. Return to home position
    throw new Error('Synchronized scanning not yet implemented');
  }
}
