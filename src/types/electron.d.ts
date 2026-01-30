/**
 * Type definitions for the Electron API exposed to the renderer process.
 *
 * This file defines the `window.electron` API that is exposed via the preload script
 * using contextBridge.exposeInMainWorld().
 */

import { CameraSettings, CapturedImage, DetectedCamera } from './camera';
import {
  MachineConfig,
  MachineCredentials,
  ValidationResult,
  Scanner,
} from '../main/config-store';
import {
  DAQSettings,
  DAQInitializeResponse,
  DAQCleanupResponse,
  DAQRotateResponse,
  DAQStepResponse,
  DAQHomeResponse,
  DAQStatusResponse,
} from './daq';
import { ScannerAPI } from './scanner';
import {
  DatabaseResponse,
  ExperimentWithRelations,
  ScanWithRelations,
  Experiment,
  Scan,
  Phenotyper,
  Scientist,
  Accessions,
  ExperimentCreateData,
  ExperimentUpdateData,
  ScanCreateData,
  PhenotyperCreateData,
  ScientistCreateData,
  AccessionCreateData,
  ImageCreateData,
  ScanFilters,
} from './database';

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
   * Get current camera settings
   * @returns Promise resolving to current camera settings (or null if not configured)
   */
  getSettings: () => Promise<CameraSettings | null>;

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

  /**
   * Start streaming frames from the camera
   * Frames will be delivered via onFrame callback at ~30 FPS
   * @param settings - Optional camera settings to apply before streaming
   * @returns Promise resolving to streaming start success
   */
  startStream: (
    settings?: Partial<CameraSettings>
  ) => Promise<{ success: boolean; error?: string }>;

  /**
   * Stop streaming frames from the camera
   * @returns Promise resolving to streaming stop success
   */
  stopStream: () => Promise<{ success: boolean; error?: string }>;

  /**
   * Register callback for streaming frames
   * @param callback - Function to call with each frame (called at ~30 FPS during streaming)
   * @returns Cleanup function to remove the listener
   */
  onFrame: (callback: (image: CapturedImage) => void) => () => void;

  /**
   * Detect available cameras on the network
   * @returns Promise resolving to list of detected cameras
   */
  detectCameras: () => Promise<{
    success: boolean;
    cameras: DetectedCamera[];
    error?: string;
  }>;
}

/**
 * DAQ API
 */
export interface DAQAPI {
  /**
   * Initialize DAQ with settings
   * @param settings - DAQ configuration settings
   * @returns Promise resolving to initialization response
   */
  initialize: (settings: DAQSettings) => Promise<DAQInitializeResponse>;

  /**
   * Clean up DAQ resources
   * @returns Promise resolving to cleanup response
   */
  cleanup: () => Promise<DAQCleanupResponse>;

  /**
   * Rotate turntable by degrees
   * @param degrees - Degrees to rotate (positive = clockwise, negative = counter-clockwise)
   * @returns Promise resolving to rotation response with new position
   */
  rotate: (degrees: number) => Promise<DAQRotateResponse>;

  /**
   * Execute specific number of stepper motor steps
   * @param numSteps - Number of steps to execute
   * @param direction - Direction (1 = clockwise, -1 = counter-clockwise)
   * @returns Promise resolving to step response with new position
   */
  step: (numSteps: number, direction?: 1 | -1) => Promise<DAQStepResponse>;

  /**
   * Return turntable to home position (0 degrees)
   * @returns Promise resolving to home response
   */
  home: () => Promise<DAQHomeResponse>;

  /**
   * Get DAQ status
   * @returns Promise resolving to DAQ status
   */
  getStatus: () => Promise<DAQStatusResponse>;

  /**
   * Register callback for DAQ initialization events
   * @param callback - Function to call when DAQ is initialized
   */
  onInitialized: (callback: () => void) => void;

  /**
   * Register callback for position change events
   * @param callback - Function to call with new position in degrees
   */
  onPositionChanged: (callback: (position: number) => void) => void;

  /**
   * Register callback for home events
   * @param callback - Function to call when turntable reaches home position
   */
  onHome: (callback: () => void) => void;

  /**
   * Register callback for DAQ errors
   * @param callback - Function to call with error messages
   */
  onError: (callback: (error: string) => void) => void;
}

/**
 * Database API
 */
export interface DatabaseAPI {
  experiments: {
    list: () => Promise<DatabaseResponse<ExperimentWithRelations[]>>;
    get: (id: string) => Promise<DatabaseResponse<ExperimentWithRelations>>;
    create: (
      data: ExperimentCreateData
    ) => Promise<DatabaseResponse<Experiment>>;
    update: (
      id: string,
      data: ExperimentUpdateData
    ) => Promise<DatabaseResponse<Experiment>>;
    delete: (id: string) => Promise<DatabaseResponse>;
    attachAccession: (
      experimentId: string,
      accessionId: string
    ) => Promise<DatabaseResponse<ExperimentWithRelations>>;
  };
  scans: {
    list: (
      filters?: ScanFilters
    ) => Promise<DatabaseResponse<ScanWithRelations[]>>;
    get: (id: string) => Promise<DatabaseResponse<ScanWithRelations>>;
    create: (data: ScanCreateData) => Promise<DatabaseResponse<Scan>>;
    getMostRecentScanDate: (
      plantId: string,
      experimentId: string
    ) => Promise<DatabaseResponse<string | null>>;
  };
  phenotypers: {
    list: () => Promise<DatabaseResponse<Phenotyper[]>>;
    create: (
      data: PhenotyperCreateData
    ) => Promise<DatabaseResponse<Phenotyper>>;
  };
  scientists: {
    list: () => Promise<DatabaseResponse<Scientist[]>>;
    create: (data: ScientistCreateData) => Promise<DatabaseResponse<Scientist>>;
  };
  accessions: {
    list: () => Promise<DatabaseResponse<Accessions[]>>;
    create: (
      data: AccessionCreateData
    ) => Promise<DatabaseResponse<Accessions>>;
    createWithMappings: (
      accessionData: { name: string },
      mappings: { plant_barcode: string; genotype_id?: string }[]
    ) => Promise<DatabaseResponse<Accessions & { mappingCount: number }>>;
    getMappings: (
      accessionId: string
    ) => Promise<
      DatabaseResponse<
        { id: string; plant_barcode: string; genotype_id: string }[]
      >
    >;
    update: (
      id: string,
      data: { name: string }
    ) => Promise<DatabaseResponse<Accessions>>;
    delete: (id: string) => Promise<DatabaseResponse<Accessions>>;
    updateMapping: (
      mappingId: string,
      data: { genotype_id: string }
    ) => Promise<
      DatabaseResponse<{
        id: string;
        plant_barcode: string;
        genotype_id: string;
      }>
    >;
    getPlantBarcodes: (
      accessionId: string
    ) => Promise<DatabaseResponse<string[]>>;
    getGenotypeByBarcode: (
      plantBarcode: string,
      experimentId: string
    ) => Promise<DatabaseResponse<string | null>>;
  };
  images: {
    create: (data: ImageCreateData[]) => Promise<DatabaseResponse>;
  };
}

/**
 * Machine Configuration API
 */
export interface ConfigAPI {
  /**
   * Get current machine configuration (unified - includes credentials)
   * @returns Promise resolving to unified config (password masked)
   */
  get: () => Promise<{
    config: MachineConfig; // Now includes credential fields
    hasCredentials: boolean;
  }>;

  /**
   * Save unified machine configuration
   * @param config - Unified configuration to save (includes credentials)
   * @returns Promise resolving to save result
   */
  set: (
    config: MachineConfig
  ) => Promise<{ success: boolean; errors?: ValidationResult['errors'] }>;

  /**
   * Test camera connection
   * @param ipAddress - Camera IP address to test
   * @returns Promise resolving to connection test result
   */
  testCamera: (
    ipAddress: string
  ) => Promise<{ success: boolean; error?: string }>;

  /**
   * Open native folder picker dialog
   * @returns Promise resolving to selected path or null if cancelled
   */
  browseDirectory: () => Promise<string | null>;

  /**
   * Check if configuration exists (for first-run detection)
   * @returns Promise resolving to whether config exists
   */
  exists: () => Promise<boolean>;

  /**
   * Fetch list of valid scanners from Bloom API
   * @param apiUrl - Bloom API URL
   * @param credentials - Bloom API credentials from form
   * @returns Promise resolving to scanner list or error
   */
  fetchScanners: (
    apiUrl: string,
    credentials: {
      bloom_scanner_username: string;
      bloom_scanner_password: string;
      bloom_anon_key: string;
    }
  ) => Promise<{
    success: boolean;
    scanners?: Scanner[];
    error?: string;
  }>;
}

/**
 * Main Electron API exposed to renderer
 */
export interface ElectronAPI {
  python: PythonAPI;
  camera: CameraAPI;
  daq: DAQAPI;
  scanner: ScannerAPI;
  database: DatabaseAPI;
  config: ConfigAPI;
}

/**
 * Extend the global Window interface
 */
declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
