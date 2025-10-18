/**
 * Preload script - Electron context bridge
 *
 * This script runs in a privileged context and exposes a safe API
 * to the renderer process via contextBridge.
 */

import { contextBridge, ipcRenderer } from 'electron';
// eslint-disable-next-line import/no-unresolved
import { PythonAPI } from '../types/electron';

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
 * Expose electron API to renderer process
 */
contextBridge.exposeInMainWorld('electron', {
  python: pythonAPI,
});
