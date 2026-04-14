# Design: Wire GraviScan IPC Handlers

## Architecture

### IPC Registration Pattern

```
main.ts (orchestrator)
  ├── loadUnifiedConfig() → gets scanner_mode
  ├── registerDatabaseHandlers()                [always]
  ├── [CylinderScan IPC handlers]               [if cylinderscan]  (existing, implicit)
  └── registerGraviScanHandlers(ipcMain, db, getMainWindow, sessionFns)  [if graviscan] (NEW)
        ├── scanner-handlers IPC wrappers (7 channels)
        ├── session-handlers IPC wrappers (4 channels)
        └── image-handlers IPC wrappers (4 channels)
```

Note: `ScannerMode` is `'cylinderscan' | 'graviscan'` (no `'full'` mode exists). If a future increment adds `'full'` mode, registration logic can be updated then.

### New File: `src/main/graviscan/register-handlers.ts`

This file is the **only** place where `ipcMain.handle()` calls exist for GraviScan. It imports pure handler functions and wraps them with IPC plumbing.

```typescript
export function registerGraviScanHandlers(
  ipcMain: Electron.IpcMain,
  db: PrismaClient,
  getMainWindow: () => BrowserWindow | null,
  sessionFns: SessionFns,
  getCoordinator: () => ScanCoordinator | null
): void;
```

**Parameters:**

- `ipcMain` — Electron IPC main
- `db` — Prisma client instance
- `getMainWindow` — getter for event forwarding (avoids stale reference)
- `sessionFns` — session state accessor callbacks (getter/setter/markRecorded)
- `getCoordinator` — getter for the current ScanCoordinator instance (needed for upload guard and start-scan/cancel-scan delegation)

**Why a getter for mainWindow?** The `mainWindow` reference changes across reloads. A getter ensures event forwarding always uses the current window. This matches the frame-forwarder pattern in `createFrameForwarder()`.

### IPC Channel → Handler Mapping

| IPC Channel                   | Handler Function                                      | Module           |
| ----------------------------- | ----------------------------------------------------- | ---------------- |
| `graviscan:detect-scanners`   | `detectScanners(db)`                                  | scanner-handlers |
| `graviscan:get-config`        | `getConfig(db)`                                       | scanner-handlers |
| `graviscan:save-config`       | `saveConfig(db, config)`                              | scanner-handlers |
| `graviscan:save-scanners-db`  | `saveScannersToDB(db, scanners)`                      | scanner-handlers |
| `graviscan:platform-info`     | `getPlatformInfo()`                                   | scanner-handlers |
| `graviscan:validate-scanners` | `runStartupScannerValidation(db, cachedIds)`          | scanner-handlers |
| `graviscan:validate-config`   | `validateConfig(db)`                                  | scanner-handlers |
| `graviscan:start-scan`        | `startScan(coordinator, params, sessionFns, onError)` | session-handlers |
| `graviscan:get-scan-status`   | `getScanStatus(sessionFns)`                           | session-handlers |
| `graviscan:mark-job-recorded` | `markJobRecorded(sessionFns, jobKey)`                 | session-handlers |
| `graviscan:cancel-scan`       | `cancelScan(coordinator, sessionFns)`                 | session-handlers |
| `graviscan:get-output-dir`    | `getOutputDir()`                                      | image-handlers   |
| `graviscan:read-scan-image`   | `readScanImage(filePath, opts)`                       | image-handlers   |
| `graviscan:upload-all-scans`  | `uploadAllScans(db, onProgress)`                      | image-handlers   |
| `graviscan:download-images`   | `downloadImages(db, params, onProgress)`              | image-handlers   |

### Session State

Module-level state in `main.ts`, exposed via closures matching the actual `SessionFns` interface from `session-handlers.ts`:

```typescript
let scanSession: ScanSessionState | null = null;
let scanCoordinator: ScanCoordinator | null = null;

const sessionFns: SessionFns = {
  getScanSession: () => scanSession,
  setScanSession: (s) => {
    scanSession = s;
  },
  markScanJobRecorded: (key) => {
    if (scanSession?.jobs[key]) {
      scanSession.jobs[key].status = 'recorded';
    }
  },
};
```

### ScanSessionState Type

New type in `src/types/graviscan.ts` (does not exist yet, derived from `startScan` in session-handlers.ts lines 140-157):

```typescript
export interface ScanSessionJob {
  scannerId: string;
  plateIndex: string;
  outputPath: string;
  plantBarcode: string | null;
  transplantDate: string | null;
  customNote: string | null;
  gridMode: string;
  status: 'pending' | 'scanning' | 'complete' | 'error' | 'recorded';
  imagePath?: string;
  error?: string;
  durationMs?: number;
}

export interface ScanSessionState {
  isActive: boolean;
  isContinuous: boolean;
  experimentId: string;
  phenotyperId: string;
  resolution: number;
  sessionId: string | null;
  jobs: Record<string, ScanSessionJob>;
  currentCycle: number;
  totalCycles: number;
  intervalMs: number;
  scanStartedAt: number;
  scanEndedAt: number | null;
  scanDurationMs: number;
  coordinatorState: 'idle' | 'scanning' | 'waiting';
  nextScanAt: number | null;
  waveNumber: number;
}
```

### Coordinator Lifecycle

**Lazy instantiation** — matches CylinderScan's `ScannerProcess` pattern:

- `ScannerProcess` created in `scanner:initialize` handler, not at startup
- `ScanCoordinator` created in `graviscan:start-scan` handler, not at startup
- Coordinator reference stored at module level in main.ts
- Passed to `startScan()` and `cancelScan()` via the IPC wrapper
- Shutdown called on app quit (if active)

### Event Forwarding

Coordinator events forwarded to renderer for UI updates:

| Coordinator Event   | IPC Channel                   | Payload                                                                                                                      |
| ------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `scan-event`        | `graviscan:scan-event`        | `ScanWorkerEvent` (note: includes `scan_started_at` but NOT `scan_ended_at` — end timestamp only available in grid-complete) |
| `grid-start`        | `graviscan:grid-start`        | `{ scannerId, plateIndex, timestamp }`                                                                                       |
| `grid-complete`     | `graviscan:grid-complete`     | `{ scannerId, plateIndex, timestamp }`                                                                                       |
| `cycle-complete`    | `graviscan:cycle-complete`    | `{ cycleNumber }`                                                                                                            |
| `interval-start`    | `graviscan:interval-start`    | `{ cycleNumber }`                                                                                                            |
| `interval-waiting`  | `graviscan:interval-waiting`  | `{ nextScanAt }`                                                                                                             |
| `interval-complete` | `graviscan:interval-complete` | `{}`                                                                                                                         |
| `overtime`          | `graviscan:overtime`          | `{ elapsed, expected }`                                                                                                      |
| `cancelled`         | `graviscan:cancelled`         | `{}`                                                                                                                         |
| `scan-error`        | `graviscan:scan-error`        | `{ error }`                                                                                                                  |

All use the `if (mainWindow && !mainWindow.isDestroyed())` guard.

**Per-plate timing reconstruction:** To reconstruct full timing for a plate, the renderer must join per-plate `scan-event` records (which include `scan_started_at`) with the corresponding `grid-complete` event (which includes `scanEndedAt`). This is because the per-plate end time is unknown until the entire row group completes.

### Persistent Logging for Critical Events

In addition to forwarding events to the renderer, the following events SHALL be logged via `scanLog()` for scientific traceability:

- `grid-complete` events (with renamed file paths and timestamps)
- Successful file renames (`old_path -> new_path`)
- `scan-error` events from the coordinator

This ensures critical metadata survives renderer crashes.

### Security: Path Validation

The `graviscan:read-scan-image` IPC handler SHALL validate that the resolved file path starts with the configured scan output directory (`getOutputDir()`) before allowing the read. Both paths must be resolved via `path.resolve()` before comparison to handle `..` components and symlinks. This prevents path traversal attacks from a compromised renderer.

### Security: Upload Guard

The `graviscan:upload-all-scans` IPC handler SHALL check whether the coordinator is actively scanning (`getCoordinator()?.isScanning`) and reject the request if so. This prevents uploading partially written scan files.

### Preload Context Bridge

```typescript
const graviAPI: GraviAPI = {
  // Scanner operations (invoke)
  detectScanners: () => ipcRenderer.invoke('graviscan:detect-scanners'),
  getConfig: () => ipcRenderer.invoke('graviscan:get-config'),
  saveConfig: (config) => ipcRenderer.invoke('graviscan:save-config', config),
  saveScannersToDB: (scanners) => ipcRenderer.invoke('graviscan:save-scanners-db', scanners),
  getPlatformInfo: () => ipcRenderer.invoke('graviscan:platform-info'),
  validateScanners: (ids) => ipcRenderer.invoke('graviscan:validate-scanners', ids),
  validateConfig: () => ipcRenderer.invoke('graviscan:validate-config'),

  // Session operations (invoke)
  startScan: (params) => ipcRenderer.invoke('graviscan:start-scan', params),
  getScanStatus: () => ipcRenderer.invoke('graviscan:get-scan-status'),
  markJobRecorded: (jobKey) => ipcRenderer.invoke('graviscan:mark-job-recorded', jobKey),
  cancelScan: () => ipcRenderer.invoke('graviscan:cancel-scan'),

  // Image operations (invoke)
  getOutputDir: () => ipcRenderer.invoke('graviscan:get-output-dir'),
  readScanImage: (path, opts) => ipcRenderer.invoke('graviscan:read-scan-image', path, opts),
  uploadAllScans: () => ipcRenderer.invoke('graviscan:upload-all-scans'),
  downloadImages: (params) => ipcRenderer.invoke('graviscan:download-images', params),

  // Event listeners (on* with cleanup)
  onScanEvent: (cb) => { ... return cleanup; },
  onGridStart: (cb) => { ... return cleanup; },
  onGridComplete: (cb) => { ... return cleanup; },
  onCycleComplete: (cb) => { ... return cleanup; },
  onIntervalStart: (cb) => { ... return cleanup; },
  onIntervalWaiting: (cb) => { ... return cleanup; },
  onIntervalComplete: (cb) => { ... return cleanup; },
  onOvertime: (cb) => { ... return cleanup; },
  onCancelled: (cb) => { ... return cleanup; },
  onScanError: (cb) => { ... return cleanup; },
  onUploadProgress: (cb) => { ... return cleanup; },
  onDownloadProgress: (cb) => { ... return cleanup; },
};

contextBridge.exposeInMainWorld('electron', {
  ...existingAPIs,
  gravi: graviAPI,
});
```

### Async FS Fixes (#187)

**scan-coordinator.ts** — Replace synchronous FS calls in `handleScanComplete()`:

- `fs.existsSync()` → `fs.promises.access()` with try/catch
- `fs.statSync()` → `fs.promises.stat()`
- `fs.renameSync()` → `fs.promises.rename()`

**Important:** Renames must remain sequential within each result set (not parallelized via `Promise.all`). The sequential `for` loop with `await` preserves the guarantee that row group N+1 does not begin until all renames for row group N complete.

**scanner-subprocess.ts** — Fix readline resource leak:

- Store `stderrRl` as class field (alongside existing `this.rl`)
- Close both `this.rl` and `this.stderrRl` in `shutdown()` and `kill()`

### Testing Strategy

**Unit tests (TDD):**

- `register-handlers.test.ts` — parametric/table-driven test over all 15 channels, verify delegation, error handling, path validation, upload guard
- Async FS fix tests in existing `scan-coordinator.test.ts` (must update existing mocks from sync to async)
- Readline cleanup tests in existing `scanner-subprocess.test.ts`

**Integration tests (Vitest with mocked ipcMain):**

- Conditional registration based on scanner_mode
- Session state lifecycle: start → status → mark → cancel
- Coordinator lazy instantiation: not created until startScan
- Event forwarding: coordinator emit → webContents.send called
- Gravi IPC invoked in cylinderscan mode → graceful error

**Regression:**

- All existing CylinderScan tests must pass
- Pre-merge checks (lint, type check, unit, integration, E2E)

## Trade-offs

| Decision                             | Alternative                 | Rationale                                                    |
| ------------------------------------ | --------------------------- | ------------------------------------------------------------ |
| Separate `register-handlers.ts`      | Inline in main.ts           | Keeps main.ts manageable; testable in isolation              |
| Lazy coordinator                     | Eager at startup            | Matches CylinderScan pattern; no wasted subprocess resources |
| `getMainWindow` getter               | Direct reference            | Handles window recreation across reloads                     |
| No database-handlers CRUD            | Extend database-handlers.ts | Handler modules are self-sufficient; avoids duplication      |
| Skip registration when wrong mode    | Register as no-op           | Cleaner; no dead handlers in IPC namespace                   |
| Sequential renames (not Promise.all) | Parallel renames            | Preserves scan ordering guarantee; error attribution clearer |
