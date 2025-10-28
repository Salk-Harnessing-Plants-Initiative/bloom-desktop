/**
 * Preload script - Electron context bridge
 *
 * This script runs in a privileged context and exposes a safe API
 * to the renderer process via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';
// eslint-disable-next-line import/no-unresolved
import { PythonAPI, CameraAPI, DAQAPI, DatabaseAPI } from '../types/electron';
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
  onProgress: (callback: (progress: ScanProgress) => void) => {
    ipcRenderer.on('scanner:progress', (_event, progress: ScanProgress) =>
      callback(progress)
    );
  },
  onComplete: (callback: (result: ScanResult) => void) => {
    ipcRenderer.on('scanner:complete', (_event, result: ScanResult) =>
      callback(result)
    );
  },
  onError: (callback: (error: string) => void) => {
    ipcRenderer.on('scanner:error', (_event, error: string) => callback(error));
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
  },
  scans: {
    list: (filters?: ScanFilters) =>
      ipcRenderer.invoke('db:scans:list', filters),
    get: (id: string) => ipcRenderer.invoke('db:scans:get', id),
    create: (data: ScanCreateData) =>
      ipcRenderer.invoke('db:scans:create', data),
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
  },
  images: {
    create: (data: any) => ipcRenderer.invoke('db:images:create', data),
  },
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
});
