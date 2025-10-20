/**
 * Preload script - Electron context bridge
 *
 * This script runs in a privileged context and exposes a safe API
 * to the renderer process via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';
// eslint-disable-next-line import/no-unresolved
import { PythonAPI, CameraAPI } from '../types/electron';
// eslint-disable-next-line import/no-unresolved
import { CameraSettings, CapturedImage } from '../types/camera';

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
  onTrigger: (callback: () => void) => {
    ipcRenderer.on('camera:trigger', () => callback());
  },
  onImageCaptured: (callback: (image: CapturedImage) => void) => {
    ipcRenderer.on('camera:image-captured', (_event, image: CapturedImage) =>
      callback(image)
    );
  },
};

/**
 * Expose electron API to renderer process
 */
contextBridge.exposeInMainWorld('electron', {
  python: pythonAPI,
  camera: cameraAPI,
});
