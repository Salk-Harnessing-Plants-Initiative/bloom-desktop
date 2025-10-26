/**
 * Camera Process Manager
 *
 * Manages camera subprocess communication for Basler camera control.
 * Extends PythonProcess to handle camera-specific commands and events.
 */

import { PythonProcess } from './python-process';

/**
 * Camera settings interface
 */
export interface CameraSettings {
  exposure_time: number; // microseconds
  gain: number;
  camera_ip_address?: string; // Optional for mock camera
  gamma?: number;
  num_frames?: number;
  seconds_per_rot?: number;
  brightness?: number;
  contrast?: number;
  width?: number;
  height?: number;
}

/**
 * Camera status interface
 */
export interface CameraStatus {
  connected: boolean;
  mock: boolean;
  available: boolean;
}

/**
 * Camera capture response interface
 */
export interface CameraCaptureResponse {
  success: boolean;
  image?: string; // data URI: data:image/png;base64,...
  width?: number;
  height?: number;
  error?: string;
}

/**
 * Camera process events:
 *   - 'camera-trigger': () => void - Camera was triggered
 *   - 'image-captured': (dataUri: string) => void - Image was captured
 *   - 'frame': (dataUri: string) => void - Streaming frame received
 *   - Plus all PythonProcess events (status, error, data, etc.)
 */
export class CameraProcess extends PythonProcess {
  private captureCallback?: (image: string) => void;

  /**
   * Parse protocol lines, including camera-specific messages.
   *
   * @param line - Line to parse
   */
  protected parseLine(line: string): void {
    // Handle camera-specific protocol messages
    if (line.startsWith('TRIGGER_CAMERA')) {
      this.emit('camera-trigger');
    } else if (line.startsWith('FRAME:')) {
      // Streaming frame: "FRAME:data:image/png;base64,..."
      const dataUri = line.substring(6); // Remove "FRAME:" prefix
      this.emit('frame', dataUri);
    } else if (line.startsWith('IMAGE ')) {
      // Image data: "IMAGE data:image/png;base64,..."
      const dataUri = line.substring(6); // Remove "IMAGE " prefix
      this.emit('image-captured', dataUri);

      // Call capture callback if waiting for image
      if (this.captureCallback) {
        this.captureCallback(dataUri);
        this.captureCallback = undefined;
      }
    } else if (line.startsWith('IMAGE_PATH ')) {
      // Image file path from batch capture
      const imagePath = line.substring(11); // Remove "IMAGE_PATH " prefix
      this.emit('image-path', imagePath);
    } else {
      // Delegate to parent class for standard protocol messages
      super.parseLine(line);
    }
  }

  /**
   * Connect to the camera.
   *
   * @param settings - Camera configuration settings
   * @returns Promise that resolves when camera is connected
   */
  async connect(settings: CameraSettings): Promise<boolean> {
    const response = await this.sendCommand({
      command: 'camera',
      action: 'connect',
      settings,
    });

    return response.success === true;
  }

  /**
   * Disconnect from the camera.
   *
   * @returns Promise that resolves when camera is disconnected
   */
  async disconnect(): Promise<boolean> {
    const response = await this.sendCommand({
      command: 'camera',
      action: 'disconnect',
    });

    return response.success === true;
  }

  /**
   * Configure camera settings.
   *
   * @param settings - Camera configuration settings
   * @returns Promise that resolves when settings are applied
   */
  async configure(settings: Partial<CameraSettings>): Promise<boolean> {
    const response = await this.sendCommand({
      command: 'camera',
      action: 'configure',
      settings,
    });

    return response.configured === true;
  }

  /**
   * Capture a single frame from the camera.
   *
   * @param settings - Optional camera settings to apply before capture
   * @returns Promise that resolves with the captured image data
   */
  async capture(
    settings?: Partial<CameraSettings>
  ): Promise<CameraCaptureResponse> {
    const response = await this.sendCommand({
      command: 'camera',
      action: 'capture',
      settings: settings || {},
    });

    return response as CameraCaptureResponse;
  }

  /**
   * Get camera status.
   *
   * @returns Promise that resolves with camera status
   */
  async getStatus(): Promise<CameraStatus> {
    const response = await this.sendCommand({
      command: 'camera',
      action: 'status',
    });

    return response as CameraStatus;
  }

  /**
   * Start streaming images from the camera.
   * Frames will be emitted via 'frame' events at ~30 FPS.
   *
   * @param settings - Camera settings for streaming
   * @returns Promise that resolves when streaming starts
   */
  async startStream(settings?: Partial<CameraSettings>): Promise<boolean> {
    const response = await this.sendCommand({
      command: 'camera',
      action: 'start_stream',
      settings: settings || {},
    });

    return response.success === true;
  }

  /**
   * Stop streaming images from the camera.
   *
   * @returns Promise that resolves when streaming stops
   */
  async stopStream(): Promise<boolean> {
    const response = await this.sendCommand({
      command: 'camera',
      action: 'stop_stream',
    });

    return response.success === true;
  }

  /**
   * Detect available cameras on the network.
   *
   * @returns Promise that resolves to list of detected cameras
   */
  async detectCameras(): Promise<
    Array<{
      ip_address: string;
      model_name: string;
      serial_number: string;
      mac_address: string;
      user_defined_name: string;
      friendly_name: string;
      is_mock: boolean;
    }>
  > {
    const response = await this.sendCommand({
      command: 'camera',
      action: 'detect_cameras',
    });

    // Handle both direct array response and wrapped response
    if (Array.isArray(response)) {
      return response;
    }

    if (response && response.cameras) {
      return response.cameras;
    }

    throw new Error(`Failed to detect cameras: ${JSON.stringify(response)}`);
  }
}
