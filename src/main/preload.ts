/**
 * Preload script - Electron context bridge
 *
 * This script runs in a privileged context and exposes a safe API
 * to the renderer process via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';
/* eslint-disable import/no-unresolved */
import {
  PythonAPI,
  CameraAPI,
  DAQAPI,
  DatabaseAPI,
  ConfigAPI,
} from '../types/electron';
/* eslint-enable import/no-unresolved */
// eslint-disable-next-line import/no-unresolved
import { MachineConfig, MachineCredentials } from './config-store';
// eslint-disable-next-line import/no-unresolved
import { CameraSettings, CapturedImage } from '../types/camera';
// eslint-disable-next-line import/no-unresolved
import { DAQSettings } from '../types/daq';
// eslint-disable-next-line import/no-unresolved
import {
  ScannerAPI,
  ScannerSettings,
  ScanProgress,
  ScanResult,
} from '../types/scanner';
// eslint-disable-next-line import/no-unresolved
import type {
  ExperimentCreateData,
  PhenotyperCreateData,
  ScientistCreateData,
  AccessionCreateData,
  ImageCreateData,
  ScanCreateData,
  ScanFilters,
  PaginatedScanFilters,
} from '../types/database';
// eslint-disable-next-line import/no-unresolved
import type { GraviConfigInput } from '../types/graviscan';

/**
 * Python backend API exposed to renderer
 */
const pythonAPI: PythonAPI = {
  getVersion: () => ipcRenderer.invoke('python:get-version'),
  checkHardware: () => ipcRenderer.invoke('python:check-hardware'),
  restart: () => ipcRenderer.invoke('python:restart'),
  onStatus: (callback: (status: string) => void) => {
    ipcRenderer.on('python:status', (_event, status: string) =>
      callback(status)
    );
  },
  onError: (callback: (error: string) => void) => {
    ipcRenderer.on('python:error', (_event, error: string) => callback(error));
  },
};

/**
 * Camera API exposed to renderer
 */
const cameraAPI: CameraAPI = {
  connect: (settings: CameraSettings) =>
    ipcRenderer.invoke('camera:connect', settings),
  disconnect: () => ipcRenderer.invoke('camera:disconnect'),
  configure: (settings: Partial<CameraSettings>) =>
    ipcRenderer.invoke('camera:configure', settings),
  capture: (settings?: Partial<CameraSettings>) =>
    ipcRenderer.invoke('camera:capture', settings),
  getStatus: () => ipcRenderer.invoke('camera:get-status'),
  getSettings: () => ipcRenderer.invoke('camera:get-settings'),
  onTrigger: (callback: () => void) => {
    ipcRenderer.on('camera:trigger', () => callback());
  },
  onImageCaptured: (callback: (image: CapturedImage) => void) => {
    ipcRenderer.on('camera:image-captured', (_event, image: CapturedImage) =>
      callback(image)
    );
  },
  startStream: (settings?: Partial<CameraSettings>) =>
    ipcRenderer.invoke('camera:start-stream', settings),
  stopStream: () => ipcRenderer.invoke('camera:stop-stream'),
  onFrame: (callback: (image: CapturedImage) => void) => {
    const listener = (_event: unknown, image: CapturedImage) => callback(image);
    ipcRenderer.on('camera:frame', listener);
    // Return cleanup function to remove listener
    return () => ipcRenderer.removeListener('camera:frame', listener);
  },
  detectCameras: () => ipcRenderer.invoke('camera:detect-cameras'),
};

/**
 * DAQ API exposed to renderer
 */
const daqAPI: DAQAPI = {
  initialize: (settings: DAQSettings) =>
    ipcRenderer.invoke('daq:initialize', settings),
  cleanup: () => ipcRenderer.invoke('daq:cleanup'),
  rotate: (degrees: number) => ipcRenderer.invoke('daq:rotate', degrees),
  step: (numSteps: number, direction?: 1 | -1) =>
    ipcRenderer.invoke('daq:step', numSteps, direction),
  home: () => ipcRenderer.invoke('daq:home'),
  getStatus: () => ipcRenderer.invoke('daq:get-status'),
  onInitialized: (callback: () => void) => {
    ipcRenderer.on('daq:initialized', () => callback());
  },
  onPositionChanged: (callback: (position: number) => void) => {
    ipcRenderer.on(
      'daq:position-changed',
      (_event, data: { position: number }) => callback(data.position)
    );
  },
  onHome: (callback: () => void) => {
    ipcRenderer.on('daq:home', () => callback());
  },
  onError: (callback: (error: string) => void) => {
    ipcRenderer.on('daq:error', (_event, error: string) => callback(error));
  },
};

/**
 * Scanner API exposed to renderer
 */
const scannerAPI: ScannerAPI = {
  initialize: (settings: ScannerSettings) =>
    ipcRenderer.invoke('scanner:initialize', settings),
  cleanup: () => ipcRenderer.invoke('scanner:cleanup'),
  scan: () => ipcRenderer.invoke('scanner:scan'),
  getStatus: () => ipcRenderer.invoke('scanner:get-status'),
  /**
   * Get the current scanner identity (name).
   *
   * Returns the scanner's configured name from runtime state.
   * Returns empty string if scanner not configured.
   *
   * @returns {Promise<string>} Scanner name
   */
  getScannerId: () => ipcRenderer.invoke('scanner:get-scanner-id'),
  onProgress: (callback: (progress: ScanProgress) => void) => {
    const listener = (_event: unknown, progress: ScanProgress) =>
      callback(progress);
    ipcRenderer.on('scanner:progress', listener);
    // Return cleanup function to remove listener
    return () => ipcRenderer.removeListener('scanner:progress', listener);
  },
  onComplete: (callback: (result: ScanResult) => void) => {
    const listener = (_event: unknown, result: ScanResult) => callback(result);
    ipcRenderer.on('scanner:complete', listener);
    // Return cleanup function to remove listener
    return () => ipcRenderer.removeListener('scanner:complete', listener);
  },
  onError: (callback: (error: string) => void) => {
    const listener = (_event: unknown, error: string) => callback(error);
    ipcRenderer.on('scanner:error', listener);
    // Return cleanup function to remove listener
    return () => ipcRenderer.removeListener('scanner:error', listener);
  },
};

/**
 * Database API exposed to renderer
 */
const databaseAPI: DatabaseAPI = {
  experiments: {
    list: () => ipcRenderer.invoke('db:experiments:list'),
    get: (id: string) => ipcRenderer.invoke('db:experiments:get', id),
    create: (data: ExperimentCreateData) =>
      ipcRenderer.invoke('db:experiments:create', data),
    attachAccession: (experimentId: string, accessionId: string) =>
      ipcRenderer.invoke(
        'db:experiments:attachAccession',
        experimentId,
        accessionId
      ),
  },
  scans: {
    list: (filters?: ScanFilters | PaginatedScanFilters) =>
      ipcRenderer.invoke('db:scans:list', filters),
    get: (id: string) => ipcRenderer.invoke('db:scans:get', id),
    create: (data: ScanCreateData) =>
      ipcRenderer.invoke('db:scans:create', data),
    getMostRecentScanDate: (plantId: string, experimentId: string) =>
      ipcRenderer.invoke(
        'db:scans:getMostRecentScanDate',
        plantId,
        experimentId
      ),
    getRecent: (options?: { limit?: number; experimentId?: string }) =>
      ipcRenderer.invoke('db:scans:getRecent', options),
    delete: (id: string) => ipcRenderer.invoke('db:scans:delete', id),
    upload: (scanId: string) => ipcRenderer.invoke('db:scans:upload', scanId),
    uploadBatch: (scanIds: string[]) =>
      ipcRenderer.invoke('db:scans:uploadBatch', scanIds),
  },
  phenotypers: {
    list: () => ipcRenderer.invoke('db:phenotypers:list'),
    create: (data: PhenotyperCreateData) =>
      ipcRenderer.invoke('db:phenotypers:create', data),
  },
  scientists: {
    list: () => ipcRenderer.invoke('db:scientists:list'),
    create: (data: ScientistCreateData) =>
      ipcRenderer.invoke('db:scientists:create', data),
  },
  accessions: {
    list: () => ipcRenderer.invoke('db:accessions:list'),
    create: (data: AccessionCreateData) =>
      ipcRenderer.invoke('db:accessions:create', data),
    createWithMappings: (
      accessionData: { name: string },
      mappings: { plant_barcode: string; accession_name?: string }[]
    ) =>
      ipcRenderer.invoke(
        'db:accessions:createWithMappings',
        accessionData,
        mappings
      ),
    getMappings: (accessionId: string) =>
      ipcRenderer.invoke('db:accessions:getMappings', accessionId),
    update: (id: string, data: { name: string }) =>
      ipcRenderer.invoke('db:accessions:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('db:accessions:delete', id),
    updateMapping: (mappingId: string, data: { accession_name: string }) =>
      ipcRenderer.invoke('db:accessions:updateMapping', mappingId, data),
    getPlantBarcodes: (accessionId: string) =>
      ipcRenderer.invoke('db:accessions:getPlantBarcodes', accessionId),
    getAccessionNameByBarcode: (plantBarcode: string, experimentId: string) =>
      ipcRenderer.invoke(
        'db:accessions:getAccessionNameByBarcode',
        plantBarcode,
        experimentId
      ),
  },
  graviscanPlateAssignments: {
    list: (experimentId: string, scannerId: string) =>
      ipcRenderer.invoke('db:graviscanPlateAssignments:list', experimentId, scannerId),
    upsert: (
      experimentId: string,
      scannerId: string,
      plateIndex: string,
      data: { plate_barcode?: string | null; transplant_date?: string | null; custom_note?: string | null; selected?: boolean }
    ) =>
      ipcRenderer.invoke(
        'db:graviscanPlateAssignments:upsert',
        experimentId,
        scannerId,
        plateIndex,
        data
      ),
    upsertMany: (
      experimentId: string,
      scannerId: string,
      assignments: { plate_index: string; plate_barcode?: string | null; transplant_date?: string | null; custom_note?: string | null; selected?: boolean }[]
    ) =>
      ipcRenderer.invoke(
        'db:graviscanPlateAssignments:upsertMany',
        experimentId,
        scannerId,
        assignments
      ),
  },
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
    }) => ipcRenderer.invoke('db:graviscans:create', data),
    getMaxWaveNumber: (experimentId: string) =>
      ipcRenderer.invoke('db:graviscans:get-max-wave-number', experimentId),
    checkBarcodeUniqueInWave: (data: {
      experiment_id: string;
      wave_number: number;
      plate_barcode: string;
    }) =>
      ipcRenderer.invoke(
        'db:graviscans:check-barcode-unique-in-wave',
        data
      ),
    updateGridTimestamps: (data: {
      ids: string[];
      scan_started_at: string;
      scan_ended_at: string;
      renamed_files?: { oldPath: string; newPath: string }[];
    }) => ipcRenderer.invoke('db:graviscans:update-grid-timestamps', data),
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
    }) => ipcRenderer.invoke('db:graviscans:browse-by-experiment', params || {}),
    getExperimentDetail: (experimentId: string) =>
      ipcRenderer.invoke('db:graviscans:experiment-detail', { experimentId }),
  },
  graviimages: {
    create: (data: { graviscan_id: string; path: string; status?: string }) =>
      ipcRenderer.invoke('db:graviimages:create', data),
  },
  graviscanSessions: {
    create: (data: {
      experiment_id: string;
      phenotyper_id: string;
      scan_mode: string;
      interval_seconds?: number | null;
      duration_seconds?: number | null;
      total_cycles?: number | null;
    }) => ipcRenderer.invoke('db:graviscan-sessions:create', data),
    complete: (data: {
      session_id: string;
      cancelled?: boolean;
    }) => ipcRenderer.invoke('db:graviscan-sessions:complete', data),
  },
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
    ) =>
      ipcRenderer.invoke(
        'db:graviPlateAccessions:createWithSections',
        accessionData,
        plates
      ),
    list: (metadataFileId: string) =>
      ipcRenderer.invoke('db:graviPlateAccessions:list', metadataFileId),
    listFiles: () =>
      ipcRenderer.invoke('db:graviPlateAccessions:listFiles'),
    delete: (metadataFileId: string) =>
      ipcRenderer.invoke('db:graviPlateAccessions:delete', metadataFileId),
  },
};

/**
 * Config API exposed to renderer
 */
const configAPI: ConfigAPI = {
  get: () => ipcRenderer.invoke('config:get'),
  set: (config: MachineConfig) => ipcRenderer.invoke('config:set', config),
  testCamera: (ipAddress: string) =>
    ipcRenderer.invoke('config:test-camera', ipAddress),
  browseDirectory: () => ipcRenderer.invoke('config:browse-directory'),
  exists: () => ipcRenderer.invoke('config:exists'),
  fetchScanners: (
    apiUrl: string,
    credentials: {
      bloom_scanner_username: string;
      bloom_scanner_password: string;
      bloom_anon_key: string;
    }
  ) => ipcRenderer.invoke('config:fetch-scanners', apiUrl, credentials),
};

/**
 * GraviScan API exposed to renderer
 */
const graviscanAPI = {
  detectScanners: () => ipcRenderer.invoke('graviscan:detect-scanners'),
  getConfig: () => ipcRenderer.invoke('graviscan:get-config'),
  saveConfig: (config: GraviConfigInput) =>
    ipcRenderer.invoke('graviscan:save-config', config),
  saveScannersDb: (scanners: Array<{
    name: string;
    display_name?: string | null;
    vendor_id: string;
    product_id: string;
    usb_port?: string;
    usb_bus?: number;
    usb_device?: number;
  }>) => ipcRenderer.invoke('graviscan:save-scanners-db', scanners),
  getPlatformInfo: () => ipcRenderer.invoke('graviscan:platform-info'),
  validateScanners: (cachedScannerIds: string[]) =>
    ipcRenderer.invoke('graviscan:validate-scanners', cachedScannerIds),
  // Config validation (Phase 3) - matches saved USB ports with detected scanners
  validateConfig: () => ipcRenderer.invoke('graviscan:validate-config'),
  // Scan output
  getOutputDir: () => ipcRenderer.invoke('graviscan:get-output-dir'),
  // Read a scan image as base64 data URI for preview
  readScanImage: (filePath: string, options?: { full?: boolean }) =>
    ipcRenderer.invoke('graviscan:read-scan-image', filePath, options),
  // Per-scanner subprocess scanning
  startScan: (params: {
    scanners: Array<{
      scannerId: string;
      saneName: string;
      plates: Array<{
        plate_index: string;
        grid_mode: string;
        resolution: number;
        output_path: string;
      }>;
    }>;
    interval?: { intervalSeconds: number; durationSeconds: number };
    metadata?: {
      experimentId?: string;
      phenotyperId?: string;
      resolution?: number;
      sessionId?: string;
      waveNumber?: number;
    };
  }) => ipcRenderer.invoke('graviscan:start-scan', params),
  cancelScan: () => ipcRenderer.invoke('graviscan:cancel-scan'),
  markJobRecorded: (jobKey: string) => ipcRenderer.invoke('graviscan:mark-job-recorded', jobKey),
  getScanStatus: () => ipcRenderer.invoke('graviscan:get-scan-status') as Promise<{
    isActive: boolean;
    experimentId?: string;
    phenotyperId?: string;
    resolution?: number;
    sessionId?: string | null;
    jobs?: Record<string, {
      scannerId: string; plateIndex: string; outputPath: string;
      plantBarcode: string | null; gridMode: string;
      status: 'pending' | 'scanning' | 'complete' | 'error';
      imagePath?: string; error?: string; durationMs?: number;
      dbRecorded?: boolean;
    }>;
    // Continuous scan timing
    isContinuous?: boolean;
    currentCycle?: number;
    totalCycles?: number;
    intervalMs?: number;
    scanStartedAt?: number | null;
    scanDurationMs?: number;
    coordinatorState?: 'idle' | 'scanning' | 'waiting';
    nextScanAt?: number | null;
    waveNumber?: number;
  }>,

  // Event listeners for async scan events (push-based from scanner subprocesses)
  onScanStarted: (callback: (data: { jobId: string; scannerId: string; plateIndex: string }) => void) => {
    const listener = (_event: unknown, data: { jobId: string; scannerId: string; plateIndex: string }) => callback(data);
    ipcRenderer.on('graviscan:scan-started', listener);
    return () => ipcRenderer.removeListener('graviscan:scan-started', listener);
  },
  onScanComplete: (callback: (data: { jobId: string; scannerId: string; plateIndex: string; imagePath: string; durationMs?: number; cycleNumber?: number; scanStartedAt?: string | null }) => void) => {
    const listener = (_event: unknown, data: { jobId: string; scannerId: string; plateIndex: string; imagePath: string; durationMs?: number; cycleNumber?: number; scanStartedAt?: string | null }) => callback(data);
    ipcRenderer.on('graviscan:scan-complete', listener);
    return () => ipcRenderer.removeListener('graviscan:scan-complete', listener);
  },
  onScanError: (callback: (data: { jobId: string; scannerId: string; plateIndex?: string; error: string }) => void) => {
    const listener = (_event: unknown, data: { jobId: string; scannerId: string; plateIndex?: string; error: string }) => callback(data);
    ipcRenderer.on('graviscan:scan-error', listener);
    return () => ipcRenderer.removeListener('graviscan:scan-error', listener);
  },
  onGridComplete: (callback: (data: { cycle: number; gridIndex: string; scanStartedAt: string; scanEndedAt: string; renamedFiles: { oldPath: string; newPath: string; scannerId: string }[] }) => void) => {
    const listener = (_event: unknown, data: { cycle: number; gridIndex: string; scanStartedAt: string; scanEndedAt: string; renamedFiles: { oldPath: string; newPath: string; scannerId: string }[] }) => callback(data);
    ipcRenderer.on('graviscan:grid-complete', listener);
    return () => ipcRenderer.removeListener('graviscan:grid-complete', listener);
  },
  onCycleComplete: (callback: (data: { cycle: number }) => void) => {
    const listener = (_event: unknown, data: { cycle: number }) => callback(data);
    ipcRenderer.on('graviscan:cycle-complete', listener);
    return () => ipcRenderer.removeListener('graviscan:cycle-complete', listener);
  },
  onIntervalWaiting: (callback: (data: { cycle: number; totalCycles: number; nextScanMs: number }) => void) => {
    const listener = (_event: unknown, data: { cycle: number; totalCycles: number; nextScanMs: number }) => callback(data);
    ipcRenderer.on('graviscan:interval-waiting', listener);
    return () => ipcRenderer.removeListener('graviscan:interval-waiting', listener);
  },
  onOvertime: (callback: (data: { cycle: number; totalCycles: number; overtimeMs: number }) => void) => {
    const listener = (_event: unknown, data: { cycle: number; totalCycles: number; overtimeMs: number }) => callback(data);
    ipcRenderer.on('graviscan:overtime', listener);
    return () => ipcRenderer.removeListener('graviscan:overtime', listener);
  },
  onIntervalComplete: (callback: (data: { cyclesCompleted: number; totalCycles: number; cancelled: boolean; overtimeMs: number }) => void) => {
    const listener = (_event: unknown, data: { cyclesCompleted: number; totalCycles: number; cancelled: boolean; overtimeMs: number }) => callback(data);
    ipcRenderer.on('graviscan:interval-complete', listener);
    return () => ipcRenderer.removeListener('graviscan:interval-complete', listener);
  },
  onIntervalStart: (callback: (data: { totalCycles: number; intervalMs: number; durationMs: number; startedAt: number }) => void) => {
    const listener = (_event: unknown, data: { totalCycles: number; intervalMs: number; durationMs: number; startedAt: number }) => callback(data);
    ipcRenderer.on('graviscan:interval-start', listener);
    return () => ipcRenderer.removeListener('graviscan:interval-start', listener);
  },

  // Cloud upload
  uploadAllScans: () =>
    ipcRenderer.invoke('graviscan:upload-all-scans'),
  onUploadProgress: (callback: (progress: { total: number; completed: number; failed: number; currentFile: string }) => void) => {
    const listener = (_event: unknown, progress: { total: number; completed: number; failed: number; currentFile: string }) => callback(progress);
    ipcRenderer.on('graviscan:upload-progress', listener);
    return () => ipcRenderer.removeListener('graviscan:upload-progress', listener);
  },
  onBoxBackupProgress: (callback: (progress: { totalImages: number; completedImages: number; failedImages: number; currentExperiment: string }) => void) => {
    const listener = (_event: unknown, progress: { totalImages: number; completedImages: number; failedImages: number; currentExperiment: string }) => callback(progress);
    ipcRenderer.on('graviscan:box-backup-progress', listener);
    return () => ipcRenderer.removeListener('graviscan:box-backup-progress', listener);
  },
  downloadImages: (params: {
    experimentId: string;
    experimentName: string;
    waveNumber?: number;
  }) => ipcRenderer.invoke('graviscan:download-images', params),

};

/**
 * Session API exposed to renderer
 * Manages in-memory session state that persists across page navigation
 */
const sessionAPI = {
  get: () => ipcRenderer.invoke('session:get'),
  set: (updates: {
    phenotyperId?: string | null;
    experimentId?: string | null;
    waveNumber?: number | null;
    plantAgeDays?: number | null;
    accessionName?: string | null;
  }) => ipcRenderer.invoke('session:set', updates),
  reset: () => ipcRenderer.invoke('session:reset'),
};

/**
 * Expose electron API to renderer process
 */
contextBridge.exposeInMainWorld('electron', {
  python: pythonAPI,
  camera: cameraAPI,
  daq: daqAPI,
  scanner: scannerAPI,
  database: databaseAPI,
  config: configAPI,
  graviscan: graviscanAPI,
  session: sessionAPI,
});
