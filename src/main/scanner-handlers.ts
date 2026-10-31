/**
 * The scanner's IPC handlers. A scan hands the camera over in a fixed order, because
 * the preview and the scanner are separate processes and a real camera can only be
 * open in one (see camera-handoff.ts): close the preview's camera, start the scanner,
 * scan, close the scanner's camera, and only then tell the page, which starts the
 * preview again.
 */

import type { BrowserWindow, IpcMain } from 'electron';
import type { ScannerSettings } from '../types/scanner';
import { createCameraHandoff, type PreviewCameraLike } from './camera-handoff';
import { applyScannerCameraIp } from './cylinderscan/camera-ip';
import type { ScannerProcess } from './cylinderscan/scanner-process';
import type { PythonProcess } from './python-process';

export interface IdleTimerLike {
  resetTimer(): void;
  pauseForScan(): void;
  resumeAfterScan(): void;
}

export interface ScannerHandlersDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  getPythonProcess: () => PythonProcess | null;
  createScanner: (python: PythonProcess) => ScannerProcess;
  getPreview: () => PreviewCameraLike | null;
  getMainWindow: () => BrowserWindow | null;
  getIdleTimer: () => IdleTimerLike | null;
  getConfiguredCameraIp: () => string | null;
}

export function registerScannerHandlers(deps: ScannerHandlersDeps) {
  let scannerProcess: ScannerProcess | null = null;
  let scanInProgress = false;

  const cameraHandoff = createCameraHandoff({
    getPreview: deps.getPreview,
    getScanner: () => scannerProcess,
  });

  const sendToPage = (channel: string, ...args: unknown[]) => {
    const window = deps.getMainWindow();
    if (window && !window.isDestroyed()) {
      window.webContents.send(channel, ...args);
    }
  };

  const ensureScannerProcess = (): ScannerProcess => {
    if (scannerProcess) return scannerProcess;
    // Scanner uses the same Python process as other hardware
    const python = deps.getPythonProcess();
    if (!python) throw new Error('Python process not initialized');

    const scanner = deps.createScanner(python);
    scannerProcess = scanner;

    // Forward scanner events to renderer
    scanner.on('initialized', () => sendToPage('scanner:initialized'));
    scanner.on('progress', (progress) =>
      sendToPage('scanner:progress', progress)
    );
    scanner.on('complete', async (result) => {
      // Before the page hears of it, as it then starts the preview again.
      await cameraHandoff.releaseFromScanner();
      sendToPage('scanner:complete', result);
    });
    scanner.on('error', async (error: string) => {
      console.error('Scanner error:', error);
      await cameraHandoff.releaseFromScanner();
      sendToPage('scanner:error', error);
    });
    return scanner;
  };

  /**
   * Handle scanner:initialize - Initialize scanner with camera and DAQ settings
   */
  deps.ipcMain.handle(
    'scanner:initialize',
    async (_event, settings: ScannerSettings) => {
      try {
        deps.getIdleTimer()?.resetTimer();
        const scanner = ensureScannerProcess();
        await cameraHandoff.releaseFromPreview();
        return await scanner.initialize(
          applyScannerCameraIp(settings, deps.getConfiguredCameraIp())
        );
      } catch (error) {
        console.error('scanner:initialize error:', error);
        return {
          success: false,
          initialized: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  /**
   * Handle scanner:cleanup - Clean up scanner resources
   */
  deps.ipcMain.handle('scanner:cleanup', async () => {
    try {
      if (!scannerProcess) {
        return { success: true, initialized: false }; // Already cleaned up
      }
      return await scannerProcess.cleanup();
    } catch (error) {
      console.error('scanner:cleanup error:', error);
      return {
        success: false,
        initialized: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  /**
   * Handle scanner:scan - Perform a complete scan
   */
  deps.ipcMain.handle('scanner:scan', async () => {
    // Check precondition before any side effects: pausing and then resuming the idle
    // timer on a failed attempt would silently reset the 10-minute idle clock, letting
    // a previous operator's session persist longer in a shared lab environment.
    if (!scannerProcess) {
      const error = 'Scanner not initialized. Call initialize() first.';
      console.error('scanner:scan error:', error);
      return { success: false, frames_captured: 0, output_path: '', error };
    }
    deps.getIdleTimer()?.pauseForScan();
    scanInProgress = true;
    try {
      return await scannerProcess.scan();
    } catch (error) {
      console.error('scanner:scan error:', error);
      return {
        success: false,
        frames_captured: 0,
        output_path: '',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    } finally {
      scanInProgress = false;
      // Resume first: a stuck cleanup mustn't hold the idle clock. And release here too,
      // as a scan that was cancelled sends neither 'complete' nor 'error'.
      deps.getIdleTimer()?.resumeAfterScan();
      await cameraHandoff.releaseFromScanner();
    }
  });

  /**
   * Handle scanner:get-status - Get scanner status
   */
  deps.ipcMain.handle('scanner:get-status', async () => {
    const unknown = {
      initialized: false,
      camera_status: 'unknown',
      daq_status: 'unknown',
      position: 0,
      mock: true,
    };
    try {
      if (!scannerProcess) return { success: true, ...unknown };
      return await scannerProcess.getStatus();
    } catch (error) {
      console.error('scanner:get-status error:', error);
      return {
        success: false,
        ...unknown,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  });

  return { isScanInProgress: () => scanInProgress };
}
