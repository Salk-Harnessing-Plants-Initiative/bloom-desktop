/**
 * Type definitions for the Electron API exposed to the renderer process.
 *
 * This file defines the `window.electron` API that is exposed via the preload script
 * using contextBridge.exposeInMainWorld().
 */

import { CameraSettings, CapturedImage, DetectedCamera } from './camera';
import { MachineConfig, ValidationResult, Scanner } from '../main/config-store';
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
  GraviScanPlateAssignment,
  GraviPlateAccession,
  GraviPlateSectionMapping,
  ExperimentCreateData,
  PhenotyperCreateData,
  ScientistCreateData,
  AccessionCreateData,
  ScanFilters,
  PaginatedScanFilters,
  PaginatedScansResponse,
} from './database';
import {
  DetectedScanner,
  GraviConfig,
  GraviConfigInput,
  GraviScanner,
  GraviScan,
  GraviScanSession,
  GraviImage,
  GraviScanPlatformInfo,
  ExperimentWithScans,
} from './graviscan';
import { UploadResult } from '../main/image-uploader';

/**
 * Python backend API
 */
export interface PythonAPI {
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
    attachAccession: (
      experimentId: string,
      accessionId: string
    ) => Promise<DatabaseResponse<ExperimentWithRelations>>;
  };
  scans: {
    list: {
      (
        filters: PaginatedScanFilters
      ): Promise<DatabaseResponse<PaginatedScansResponse>>;
      (filters?: ScanFilters): Promise<DatabaseResponse<ScanWithRelations[]>>;
    };
    get: (id: string) => Promise<DatabaseResponse<ScanWithRelations>>;
    create: (data: ScanCreateData) => Promise<DatabaseResponse<Scan>>;
    getMostRecentScanDate: (
      plantId: string,
      experimentId: string
    ) => Promise<DatabaseResponse<string | null>>;
    getRecent: (options?: {
      limit?: number;
      experimentId?: string;
    }) => Promise<DatabaseResponse<ScanWithRelations[]>>;
    /**
     * Soft delete a scan (sets deleted=true, does NOT delete images)
     * @param id - Scan ID to delete
     * @returns Promise resolving to delete result
     */
    delete: (id: string) => Promise<DatabaseResponse<Scan>>;
    /**
     * Upload a scan's images to Bloom remote storage
     * Uses credentials from ~/.bloom/.env (machine configuration)
     * @param scanId - Scan ID to upload
     * @returns Promise resolving to upload result with statistics
     */
    upload: (scanId: string) => Promise<DatabaseResponse<UploadResult>>;
    /**
     * Upload multiple scans' images to Bloom remote storage (batch)
     * Uses credentials from ~/.bloom/.env (machine configuration)
     * @param scanIds - Array of scan IDs to upload
     * @returns Promise resolving to array of upload results
     */
    uploadBatch: (
      scanIds: string[]
    ) => Promise<DatabaseResponse<UploadResult[]>>;
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
      mappings: { plant_barcode: string; accession_name?: string }[]
    ) => Promise<DatabaseResponse<Accessions & { mappingCount: number }>>;
    getMappings: (
      accessionId: string
    ) => Promise<
      DatabaseResponse<
        { id: string; plant_barcode: string; accession_name: string }[]
      >
    >;
    update: (
      id: string,
      data: { name: string }
    ) => Promise<DatabaseResponse<Accessions>>;
    delete: (id: string) => Promise<DatabaseResponse<Accessions>>;
    updateMapping: (
      mappingId: string,
      data: { accession_name: string }
    ) => Promise<
      DatabaseResponse<{
        id: string;
        plant_barcode: string;
        accession_name: string;
      }>
    >;
    getPlantBarcodes: (
      accessionId: string
    ) => Promise<DatabaseResponse<string[]>>;
    getAccessionNameByBarcode: (
      plantBarcode: string,
      experimentId: string
    ) => Promise<DatabaseResponse<string | null>>;
  };
  graviscanPlateAssignments: {
    list: (
      experimentId: string,
      scannerId: string
    ) => Promise<DatabaseResponse<GraviScanPlateAssignment[]>>;
    upsert: (
      experimentId: string,
      scannerId: string,
      plateIndex: string,
      data: { plate_barcode?: string | null; transplant_date?: string | null; custom_note?: string | null; selected?: boolean }
    ) => Promise<DatabaseResponse<GraviScanPlateAssignment>>;
    upsertMany: (
      experimentId: string,
      scannerId: string,
      assignments: { plate_index: string; plate_barcode?: string | null; transplant_date?: string | null; custom_note?: string | null; selected?: boolean }[]
    ) => Promise<DatabaseResponse<GraviScanPlateAssignment[]>>;
  };
  graviscans: {
    create: (data: {
      experiment_id: string;
      phenotyper_id: string;
      scanner_id: string;
      plate_barcode?: string | null;
      transplant_date?: string | null;
      custom_note?: string | null;
      path: string;
      grid_mode: string;
      plate_index: string;
      resolution: number;
      format?: string;
      session_id?: string | null;
      cycle_number?: number | null;
      wave_number?: number;
      scan_started_at?: string | null;
      scan_ended_at?: string | null;
    }) => Promise<DatabaseResponse<GraviScan>>;
    getMaxWaveNumber: (
      experimentId: string
    ) => Promise<DatabaseResponse<number>>;
    checkBarcodeUniqueInWave: (data: {
      experiment_id: string;
      wave_number: number;
      plate_barcode: string;
    }) => Promise<
      DatabaseResponse<{ isDuplicate: boolean; existingScanId?: string }>
    >;
    updateGridTimestamps: (data: {
      ids: string[];
      scan_started_at: string;
      scan_ended_at: string;
      renamed_files?: { oldPath: string; newPath: string }[];
    }) => Promise<DatabaseResponse<{ count: number }>>;
    browseByExperiment: (params?: {
      offset?: number;
      limit?: number;
      filters?: {
        dateFrom?: string;
        dateTo?: string;
        experimentName?: string;
        accession?: string;
        uploadStatus?: string;
      };
    }) => Promise<DatabaseResponse<ExperimentWithScans[]>>;
    getExperimentDetail: (experimentId: string) => Promise<DatabaseResponse<ExperimentWithScans>>;
  };
  graviimages: {
    create: (data: {
      graviscan_id: string;
      path: string;
      status?: string;
    }) => Promise<DatabaseResponse<GraviImage>>;
  };
  graviscanSessions: {
    create: (data: {
      experiment_id: string;
      phenotyper_id: string;
      scan_mode: string;
      interval_seconds?: number | null;
      duration_seconds?: number | null;
      total_cycles?: number | null;
    }) => Promise<DatabaseResponse<GraviScanSession>>;
    complete: (data: {
      session_id: string;
      cancelled?: boolean;
    }) => Promise<DatabaseResponse<GraviScanSession>>;
  };
  graviPlateAccessions: {
    createWithSections: (
      accessionData: { name: string },
      plates: {
        plate_id: string;
        accession: string;
        transplant_date?: string | null;
        custom_note?: string | null;
        sections: {
          plate_section_id: string;
          plant_qr: string;
          medium?: string | null;
        }[];
      }[]
    ) => Promise<
      DatabaseResponse<
        Accessions & { totalPlates: number; totalSections: number }
      >
    >;
    list: (
      metadataFileId: string
    ) => Promise<
      DatabaseResponse<
        (GraviPlateAccession & { sections: GraviPlateSectionMapping[] })[]
      >
    >;
    listFiles: () => Promise<
      DatabaseResponse<
        (Accessions & {
          experiments: { name: string }[];
          _count: { graviPlateAccessions: number };
        })[]
      >
    >;
    delete: (metadataFileId: string) => Promise<DatabaseResponse>;
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
 * GraviScan API
 */
export interface GraviScanAPI {
  /**
   * Detect connected USB scanners (refreshes detection)
   */
  detectScanners: () => Promise<{
    success: boolean;
    scanners: DetectedScanner[];
    count: number;
    error?: string;
  }>;

  /**
   * Get GraviScan configuration
   */
  getConfig: () => Promise<{
    success: boolean;
    config: GraviConfig | null;
    error?: string;
  }>;

  /**
   * Save GraviScan configuration
   */
  saveConfig: (config: GraviConfigInput) => Promise<{
    success: boolean;
    config?: GraviConfig;
    error?: string;
  }>;

  /**
   * Save scanners to database with USB port info for re-identification
   */
  saveScannersDb: (
    scanners: Array<{
      name: string;
      display_name?: string | null;
      vendor_id: string;
      product_id: string;
      usb_port?: string;
      usb_bus?: number;
      usb_device?: number;
    }>
  ) => Promise<{
    success: boolean;
    scanners: GraviScanner[];
    count: number;
    error?: string;
  }>;

  /**
   * Get platform support information
   */
  getPlatformInfo: () => Promise<{
    success: boolean;
  } & GraviScanPlatformInfo>;

  /**
   * Run scanner validation with cached scanner IDs
   */
  validateScanners: (cachedScannerIds: string[]) => Promise<{
    isValidating: boolean;
    isValidated: boolean;
    validationError: string | null;
    detectedScanners: DetectedScanner[];
    cachedScannerIds: string[];
    allScannersAvailable: boolean;
  }>;

  /**
   * Validate scanner configuration by matching saved USB ports with detected scanners.
   * Used on page load to determine if config is still valid or needs reconfiguration.
   */
  validateConfig: () => Promise<{
    success: boolean;
    status: 'valid' | 'mismatch' | 'no-config' | 'error';
    error?: string;
    matched: Array<{ saved: GraviScanner; detected: DetectedScanner }>;
    missing: GraviScanner[];
    new: DetectedScanner[];
    savedScanners: GraviScanner[];
    detectedScanners: DetectedScanner[];
  }>;



  /**
   * Get the scan output directory path
   */
  getOutputDir: () => Promise<{
    success: boolean;
    path: string | null;
    error?: string;
  }>;

  /**
   * Read a scan image file and return as base64 data URI
   */
  readScanImage: (filePath: string, options?: { full?: boolean }) => Promise<{
    success: boolean;
    dataUri?: string;
    error?: string;
  }>;

  // Per-scanner subprocess scanning (via ScanCoordinator)

  /**
   * Start a parallel scan using per-scanner subprocesses.
   * Supports both one-shot and continuous (interval) scanning.
   */
  startScan: (params: {
    scanners: Array<{
      scannerId: string;
      saneName: string;
      plates: Array<{
        plate_index: string;
        grid_mode: string;
        resolution: number;
        output_path: string;
        plate_barcode?: string | null;
      }>;
    }>;
    interval?: { intervalSeconds: number; durationSeconds: number };
    metadata?: {
      experimentId: string;
      phenotyperId: string;
      resolution: number;
      sessionId?: string;
      waveNumber?: number;
    };
  }) => Promise<{
    success: boolean;
    error?: string;
  }>;

  /**
   * Cancel an in-progress scan (one-shot or continuous).
   */
  cancelScan: () => Promise<{
    success: boolean;
    error?: string;
  }>;

  /**
   * Mark a scan job as DB-recorded so it won't be re-created on remount.
   */
  markJobRecorded: (jobKey: string) => Promise<void>;

  /**
   * Get current scan session status. Used to restore UI state after navigating away and back.
   */
  getScanStatus: () => Promise<{
    isActive: boolean;
    experimentId?: string;
    phenotyperId?: string;
    resolution?: number;
    sessionId?: string | null;
    jobs?: Record<string, {
      scannerId: string;
      plateIndex: string;
      outputPath: string;
      plantBarcode: string | null;
      transplantDate?: string | null;
      customNote?: string | null;
      gridMode: string;
      status: 'pending' | 'scanning' | 'complete' | 'error';
      imagePath?: string;
      error?: string;
      durationMs?: number;
      cycleNumber?: number;
      dbRecorded?: boolean;
    }>;
    // Continuous scan timing (for restoring UI across tab navigation)
    isContinuous?: boolean;
    currentCycle?: number;
    totalCycles?: number;
    intervalMs?: number;
    scanStartedAt?: number | null;
    scanDurationMs?: number;
    coordinatorState?: 'idle' | 'scanning' | 'waiting';
    nextScanAt?: number | null;
    waveNumber?: number;
  }>;

  /**
   * Register callback for when all scanners complete a cycle
   */
  onCycleComplete: (callback: (data: {
    cycle: number;
  }) => void) => () => void;

  /**
   * Register callback for interval waiting periods (between cycles in continuous mode)
   */
  onIntervalWaiting: (callback: (data: {
    cycle: number;
    totalCycles: number;
    nextScanMs: number;
  }) => void) => () => void;

  /**
   * Register callback for when scan session exceeds the original duration
   */
  onOvertime: (callback: (data: {
    cycle: number;
    totalCycles: number;
    overtimeMs: number;
  }) => void) => () => void;

  /**
   * Register callback for when the entire interval scan session completes
   */
  onIntervalComplete: (callback: (data: {
    cyclesCompleted: number;
    totalCycles: number;
    cancelled: boolean;
    overtimeMs: number;
  }) => void) => () => void;

  /**
   * Register callback for when a continuous scan session begins
   */
  onIntervalStart: (callback: (data: {
    totalCycles: number;
    intervalMs: number;
    durationMs: number;
    startedAt: number;
  }) => void) => () => void;

  /**
   * Register callback for scan started events (a subprocess began scanning a plate)
   */
  onScanStarted: (callback: (data: {
    jobId: string;
    scannerId: string;
    plateIndex: string;
  }) => void) => () => void;

  /**
   * Register callback for scan complete events
   */
  onScanComplete: (callback: (data: {
    jobId: string;
    scannerId: string;
    plateIndex: string;
    imagePath: string;
    durationMs?: number;
    cycleNumber?: number;
    scanStartedAt?: string | null;
  }) => void) => () => void;

  /**
   * Register callback for grid complete events (per-grid timestamps)
   */
  onGridComplete: (callback: (data: {
    cycle: number;
    gridIndex: string;
    scanStartedAt: string;
    scanEndedAt: string;
    renamedFiles: { oldPath: string; newPath: string; scannerId: string }[];
  }) => void) => () => void;

  /**
   * Register callback for scan error events
   */
  onScanError: (callback: (data: {
    jobId: string;
    scannerId: string;
    plateIndex?: string;
    error: string;
  }) => void) => () => void;

  /**
   * Upload all pending/failed scans across all experiments to Supabase cloud
   */
  uploadAllScans: () => Promise<{
    success: boolean;
    uploaded: number;
    skipped: number;
    failed: number;
    errors: string[];
  }>;

  /**
   * Register callback for upload progress events
   */
  onUploadProgress: (callback: (progress: {
    total: number;
    completed: number;
    failed: number;
    currentFile: string;
  }) => void) => () => void;

  /**
   * Register callback for Box backup progress events
   */
  onBoxBackupProgress: (callback: (progress: {
    totalImages: number;
    completedImages: number;
    failedImages: number;
    currentExperiment: string;
  }) => void) => () => void;

  /**
   * Download experiment images to a local folder
   */
  downloadImages: (params: {
    experimentId: string;
    experimentName: string;
    waveNumber?: number;
  }) => Promise<{
    success: boolean;
    total: number;
    copied: number;
    errors: string[];
  }>;

}

/**
 * Session State - persists across page navigation within a session
 */
export interface SessionState {
  phenotyperId: string | null;
  experimentId: string | null;
  waveNumber: number | null;
  plantAgeDays: number | null;
  accessionName: string | null;
}

/**
 * Session API - in-memory session state management
 */
export interface SessionAPI {
  /**
   * Get current session state
   * @returns Promise resolving to session state
   */
  get: () => Promise<SessionState>;

  /**
   * Update session state (partial update - merges with existing)
   * @param updates - Partial session state to merge
   * @returns Promise resolving to updated session state
   */
  set: (updates: Partial<SessionState>) => Promise<SessionState>;

  /**
   * Reset session state to initial values (all null)
   * @returns Promise resolving when reset is complete
   */
  reset: () => Promise<void>;
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
  graviscan: GraviScanAPI;
  session: SessionAPI;
}

/**
 * Extend the global Window interface
 */
declare global {
  interface Window {
    electron: ElectronAPI;
  }
}
