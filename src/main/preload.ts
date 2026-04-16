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
import type { MachineConfig } from './config-store';
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
  ExperimentUpdateData,
  ScanCreateData,
  PhenotyperCreateData,
  ScientistCreateData,
  AccessionCreateData,
  ImageCreateData,
  ScanFilters,
  PaginatedScanFilters,
} from '../types/database';

/**
 * Python backend API exposed to renderer
 */
const pythonAPI: PythonAPI = {
  sendCommand: (command: object) =>
    ipcRenderer.invoke('python:send-command', command),
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
    update: (id: string, data: ExperimentUpdateData) =>
      ipcRenderer.invoke('db:experiments:update', id, data),
    delete: (id: string) => ipcRenderer.invoke('db:experiments:delete', id),
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
  images: {
    create: (data: ImageCreateData[]) =>
      ipcRenderer.invoke('db:images:create', data),
  },
  // GraviScan DB read operations + plate assignment CRUD
  graviscans: {
    list: (filters?: { experiment_id?: string }) =>
      ipcRenderer.invoke('db:graviscans:list', filters),
    getMaxWaveNumber: (experimentId: string) =>
      ipcRenderer.invoke('db:graviscans:getMaxWaveNumber', experimentId),
    checkBarcodeUniqueInWave: (params: {
      experiment_id: string;
      wave_number: number;
      plate_barcode: string;
    }) => ipcRenderer.invoke('db:graviscans:checkBarcodeUniqueInWave', params),
  },
  graviscanPlateAssignments: {
    list: (experimentId: string, scannerId: string) =>
      ipcRenderer.invoke('db:graviscanPlateAssignments:list', {
        experiment_id: experimentId,
        scanner_id: scannerId,
      }),
    upsert: (
      experimentId: string,
      scannerId: string,
      plateIndex: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: any
    ) =>
      ipcRenderer.invoke('db:graviscanPlateAssignments:upsert', {
        experiment_id: experimentId,
        scanner_id: scannerId,
        plate_index: plateIndex,
        data,
      }),
    upsertMany: (
      experimentId: string,
      scannerId: string,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assignments: any[]
    ) =>
      ipcRenderer.invoke('db:graviscanPlateAssignments:upsertMany', {
        experiment_id: experimentId,
        scanner_id: scannerId,
        assignments,
      }),
  },
  graviPlateAccessions: {
    list: (accessionId: string) =>
      ipcRenderer.invoke('db:graviPlateAccessions:list', accessionId),
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
  getMode: () => ipcRenderer.invoke('config:get-mode'),
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
  onIdleReset: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('session:idle-reset', listener);
    return () => ipcRenderer.removeListener('session:idle-reset', listener);
  },
  checkIdleReset: () => ipcRenderer.invoke('session:check-idle-reset'),
};

/**
 * GraviScan API exposed to renderer
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
const graviAPI = {
  // Scanner operations
  detectScanners: () => ipcRenderer.invoke('graviscan:detect-scanners'),
  getConfig: () => ipcRenderer.invoke('graviscan:get-config'),
  saveConfig: (config: any) =>
    ipcRenderer.invoke('graviscan:save-config', config),
  saveScannersToDB: (scanners: any) =>
    ipcRenderer.invoke('graviscan:save-scanners-db', scanners),
  getPlatformInfo: () => ipcRenderer.invoke('graviscan:platform-info'),
  validateScanners: (ids: string[]) =>
    ipcRenderer.invoke('graviscan:validate-scanners', ids),
  validateConfig: () => ipcRenderer.invoke('graviscan:validate-config'),

  // Session operations
  startScan: (params: any) =>
    ipcRenderer.invoke('graviscan:start-scan', params),
  getScanStatus: () => ipcRenderer.invoke('graviscan:get-scan-status'),
  markJobRecorded: (jobKey: string) =>
    ipcRenderer.invoke('graviscan:mark-job-recorded', jobKey),
  cancelScan: () => ipcRenderer.invoke('graviscan:cancel-scan'),

  // Image operations
  getOutputDir: () => ipcRenderer.invoke('graviscan:get-output-dir'),
  readScanImage: (filePath: string, opts?: any) =>
    ipcRenderer.invoke('graviscan:read-scan-image', filePath, opts),
  uploadAllScans: () => ipcRenderer.invoke('graviscan:upload-all-scans'),
  downloadImages: (params: any) =>
    ipcRenderer.invoke('graviscan:download-images', params),

  // Event listeners with cleanup functions
  onScanEvent: (callback: (event: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('graviscan:scan-event', listener);
    return () => ipcRenderer.removeListener('graviscan:scan-event', listener);
  },
  onGridStart: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('graviscan:grid-start', listener);
    return () => ipcRenderer.removeListener('graviscan:grid-start', listener);
  },
  onGridComplete: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('graviscan:grid-complete', listener);
    return () =>
      ipcRenderer.removeListener('graviscan:grid-complete', listener);
  },
  onCycleComplete: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('graviscan:cycle-complete', listener);
    return () =>
      ipcRenderer.removeListener('graviscan:cycle-complete', listener);
  },
  onIntervalStart: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('graviscan:interval-start', listener);
    return () =>
      ipcRenderer.removeListener('graviscan:interval-start', listener);
  },
  onIntervalWaiting: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('graviscan:interval-waiting', listener);
    return () =>
      ipcRenderer.removeListener('graviscan:interval-waiting', listener);
  },
  onIntervalComplete: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('graviscan:interval-complete', listener);
    return () =>
      ipcRenderer.removeListener('graviscan:interval-complete', listener);
  },
  onOvertime: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('graviscan:overtime', listener);
    return () => ipcRenderer.removeListener('graviscan:overtime', listener);
  },
  onCancelled: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on('graviscan:cancelled', listener);
    return () => ipcRenderer.removeListener('graviscan:cancelled', listener);
  },
  onScanError: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('graviscan:scan-error', listener);
    return () => ipcRenderer.removeListener('graviscan:scan-error', listener);
  },
  onRenameError: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('graviscan:rename-error', listener);
    return () => ipcRenderer.removeListener('graviscan:rename-error', listener);
  },
  onUploadProgress: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('graviscan:upload-progress', listener);
    return () =>
      ipcRenderer.removeListener('graviscan:upload-progress', listener);
  },
  onDownloadProgress: (callback: (data: any) => void) => {
    const listener = (_event: unknown, data: any) => callback(data);
    ipcRenderer.on('graviscan:download-progress', listener);
    return () =>
      ipcRenderer.removeListener('graviscan:download-progress', listener);
  },
};
/* eslint-enable @typescript-eslint/no-explicit-any */

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
  session: sessionAPI,
  gravi: graviAPI,
});
