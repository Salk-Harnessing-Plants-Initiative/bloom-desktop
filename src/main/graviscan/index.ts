/**
 * GraviScan Handler Modules
 *
 * Extracted from PR #138 (origin/graviscan/4-main-process) graviscan-handlers.ts.
 * Each module exports testable functions — no ipcMain dependency.
 * IPC wiring happens in Increment 3c (register-handlers.ts).
 *
 * IPC channel → function mapping (for 3c reference):
 *
 *   graviscan:detect-scanners    → scannerHandlers.detectScanners(db)
 *   graviscan:get-config         → scannerHandlers.getConfig(db)
 *   graviscan:save-config        → scannerHandlers.saveConfig(db, config)
 *   graviscan:save-scanners-db   → scannerHandlers.saveScannersToDB(db, scanners)
 *   graviscan:platform-info      → scannerHandlers.getPlatformInfo()
 *   graviscan:validate-scanners  → scannerHandlers.runStartupScannerValidation(db, ids)
 *   graviscan:validate-config    → scannerHandlers.validateConfig(db)
 *   graviscan:start-scan         → sessionHandlers.startScan(coordinator, params, fns, onError)
 *   graviscan:get-scan-status    → sessionHandlers.getScanStatus(fns)
 *   graviscan:mark-job-recorded  → sessionHandlers.markJobRecorded(fns, key)
 *   graviscan:cancel-scan        → sessionHandlers.cancelScan(coordinator, fns)
 *   graviscan:get-output-dir     → imageHandlers.getOutputDir()
 *   graviscan:read-scan-image    → imageHandlers.readScanImage(path, opts)
 *   graviscan:upload-all-scans   → imageHandlers.uploadAllScans(db, onProgress)
 *   graviscan:download-images    → imageHandlers.downloadImages(db, params, onProgress)
 *
 * webContents.send channels replaced by callbacks:
 *   graviscan:scan-error          → onError callback in startScan
 *   graviscan:box-backup-progress → onProgress callback in uploadAllScans
 *   graviscan:download-progress   → onProgress callback in downloadImages
 */

export * from './scanner-handlers';
export * from './session-handlers';
export * from './image-handlers';
