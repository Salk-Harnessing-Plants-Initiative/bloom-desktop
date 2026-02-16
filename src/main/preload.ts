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
    list: (filters?: ScanFilters) =>
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
  session: sessionAPI,
});
