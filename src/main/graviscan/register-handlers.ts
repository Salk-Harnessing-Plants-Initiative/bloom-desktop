/**
 * GraviScan IPC Handler Registration
 *
 * Wraps pure handler functions with ipcMain.handle() for 15 IPC channels.
 * This is the ONLY file where ipcMain.handle() calls exist for GraviScan.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { IpcMain, BrowserWindow } from 'electron';
import type { PrismaClient } from '@prisma/client';
import * as scannerHandlers from './scanner-handlers';
import * as sessionHandlers from './session-handlers';
import * as imageHandlers from './image-handlers';
import type { SessionFns, ScanCoordinatorLike } from './session-handlers';

let registered = false;

export function registerGraviScanHandlers(
  ipcMain: IpcMain,
  db: PrismaClient,
  getMainWindow: () => BrowserWindow | null,
  sessionFns: SessionFns,
  getCoordinator: () => ScanCoordinatorLike | null,
  createCoordinator?: () => Promise<ScanCoordinatorLike>
): void {
  if (registered) {
    throw new Error('GraviScan IPC handlers are already registered');
  }
  registered = true;

  // Helper to wrap handlers with error handling
  function wrapHandler<T>(
    handler: () => Promise<T>
  ): () => Promise<
    { success: true; data: T } | { success: false; error: string }
  > {
    return async () => {
      try {
        const data = await handler();
        return { success: true, data };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[GraviScan IPC]', message);
        return { success: false, error: message };
      }
    };
  }

  // --- Scanner handlers ---
  ipcMain.handle('graviscan:detect-scanners', () =>
    wrapHandler(() => scannerHandlers.detectScanners(db))()
  );

  ipcMain.handle('graviscan:get-config', () =>
    wrapHandler(() => scannerHandlers.getConfig(db))()
  );

  ipcMain.handle('graviscan:save-config', (_event, config) =>
    wrapHandler(() => scannerHandlers.saveConfig(db, config))()
  );

  ipcMain.handle('graviscan:save-scanners-db', (_event, scanners) =>
    wrapHandler(() => scannerHandlers.saveScannersToDB(db, scanners))()
  );

  ipcMain.handle('graviscan:platform-info', () =>
    wrapHandler(() => scannerHandlers.getPlatformInfo())()
  );

  ipcMain.handle('graviscan:validate-scanners', (_event, cachedIds) =>
    wrapHandler(() =>
      scannerHandlers.runStartupScannerValidation(db, cachedIds)
    )()
  );

  ipcMain.handle('graviscan:validate-config', () =>
    wrapHandler(() => scannerHandlers.validateConfig(db))()
  );

  // --- Session handlers ---
  ipcMain.handle('graviscan:start-scan', async (_event, params) => {
    // Reject if scan already in progress
    const current = sessionFns.getScanSession();
    if (current?.isActive) {
      return { success: false, error: 'Scan already in progress' };
    }
    // Lazy coordinator creation — first start-scan creates + wires the coordinator
    let coordinator = getCoordinator();
    if (!coordinator && createCoordinator) {
      try {
        coordinator = await createCoordinator();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[GraviScan IPC] Failed to create coordinator:', msg);
        return {
          success: false,
          error: `Failed to initialize scanner coordinator: ${msg}`,
        };
      }
    }
    return wrapHandler(() =>
      sessionHandlers.startScan(coordinator, params, sessionFns, (error) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('graviscan:scan-error', {
            scannerId: null,
            plateIndex: null,
            error,
          });
        }
      })
    )();
  });

  ipcMain.handle('graviscan:get-scan-status', () =>
    wrapHandler(() =>
      Promise.resolve(sessionHandlers.getScanStatus(sessionFns))
    )()
  );

  ipcMain.handle('graviscan:mark-job-recorded', (_event, jobKey) =>
    wrapHandler(() => {
      sessionHandlers.markJobRecorded(sessionFns, jobKey);
      return Promise.resolve();
    })()
  );

  ipcMain.handle('graviscan:cancel-scan', () =>
    wrapHandler(() =>
      sessionHandlers.cancelScan(getCoordinator(), sessionFns)
    )()
  );

  // --- Image handlers ---
  ipcMain.handle('graviscan:get-output-dir', () =>
    wrapHandler(() => Promise.resolve(imageHandlers.getOutputDir()))()
  );

  ipcMain.handle(
    'graviscan:read-scan-image',
    async (_event, filePath, opts) => {
      // Path validation: ensure file is within scan output directory
      const outputDirResult = imageHandlers.getOutputDir();
      if (!outputDirResult.success || !outputDirResult.path) {
        return {
          success: false,
          error: 'Cannot determine scan directory for path validation',
        };
      }
      // Use realpath to resolve symlinks before comparing (prevents symlink escapes)
      let realOutput: string;
      let realFile: string;
      try {
        realOutput = fs.realpathSync(outputDirResult.path);
        realFile = fs.realpathSync(path.resolve(filePath));
      } catch {
        // File or directory doesn't exist — reject
        return { success: false, error: 'Path outside scan directory' };
      }
      if (
        !realFile.startsWith(realOutput + path.sep) &&
        realFile !== realOutput
      ) {
        return { success: false, error: 'Path outside scan directory' };
      }
      return wrapHandler(() => imageHandlers.readScanImage(realFile, opts))();
    }
  );

  ipcMain.handle('graviscan:upload-all-scans', () => {
    // Upload guard: reject when scanning
    const coordinator = getCoordinator();
    if (coordinator?.isScanning) {
      return {
        success: false,
        error: 'Cannot upload while scanning is in progress',
      };
    }
    // Check window at send-time, not registration-time (window may close mid-upload)
    const onProgress = (progress: unknown) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('graviscan:upload-progress', progress);
      }
    };
    return wrapHandler(() => imageHandlers.uploadAllScans(db, onProgress))();
  });

  ipcMain.handle('graviscan:download-images', (_event, params) => {
    // Check window at send-time, not registration-time
    const onProgress = (progress: unknown) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('graviscan:download-progress', progress);
      }
    };
    return wrapHandler(() =>
      imageHandlers.downloadImages(db, params, onProgress)
    )();
  });
}

/**
 * Reset registration state (for testing only).
 */
export function _resetRegistration(): void {
  registered = false;
}
