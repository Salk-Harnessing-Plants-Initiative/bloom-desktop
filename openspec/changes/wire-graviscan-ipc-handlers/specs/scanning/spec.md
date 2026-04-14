# Scanning Spec Delta: Wire GraviScan IPC Handlers

## ADDED Requirements

### Requirement: GraviScan IPC Handler Registration

The system SHALL provide a `registerGraviScanHandlers` function in `src/main/graviscan/register-handlers.ts` that registers all GraviScan IPC channels via `ipcMain.handle()`, delegating to the pure handler functions in `scanner-handlers.ts`, `session-handlers.ts`, and `image-handlers.ts`.

#### Scenario: All GraviScan IPC channels registered

- **GIVEN** `registerGraviScanHandlers(ipcMain, db, getMainWindow, sessionFns, getCoordinator)` is called
- **WHEN** the function completes
- **THEN** the following 15 IPC channels SHALL be registered:
  - `graviscan:detect-scanners`
  - `graviscan:get-config`
  - `graviscan:save-config`
  - `graviscan:save-scanners-db`
  - `graviscan:platform-info`
  - `graviscan:validate-scanners`
  - `graviscan:validate-config`
  - `graviscan:start-scan`
  - `graviscan:get-scan-status`
  - `graviscan:mark-job-recorded`
  - `graviscan:cancel-scan`
  - `graviscan:get-output-dir`
  - `graviscan:read-scan-image`
  - `graviscan:upload-all-scans`
  - `graviscan:download-images`

#### Scenario: Handler delegates to correct module function

- **GIVEN** `registerGraviScanHandlers` has been called
- **WHEN** the renderer invokes any of the 15 registered `graviscan:*` IPC channels
- **THEN** the handler SHALL delegate to the corresponding handler module function (see design.md channel mapping table) with the correct arguments
- **AND** return the result to the renderer

#### Scenario: Handler returns error on exception

- **GIVEN** `registerGraviScanHandlers` has been called
- **AND** a handler function throws an error
- **WHEN** the renderer invokes the corresponding channel
- **THEN** the handler SHALL return `{ success: false, error: <message> }`
- **AND** the error SHALL be logged via `console.error`

#### Scenario: Double registration throws

- **GIVEN** `registerGraviScanHandlers` has already been called once
- **WHEN** it is called a second time (e.g., during hot-reload)
- **THEN** the function SHALL throw an error indicating handlers are already registered
- **AND** the existing handlers SHALL remain intact

### Requirement: GraviScan Conditional Mode Registration

The system SHALL register GraviScan IPC handlers only when the configured scanner mode is `graviscan`. When mode is `cylinderscan` or empty, no GraviScan handlers SHALL be registered.

#### Scenario: GraviScan handlers registered in graviscan mode

- **GIVEN** `SCANNER_MODE=graviscan` in the `.env` config
- **WHEN** the app starts and `main.ts` initializes IPC handlers
- **THEN** `registerGraviScanHandlers` SHALL be called
- **AND** all 15 `graviscan:*` IPC channels SHALL be available

#### Scenario: GraviScan handlers not registered in cylinderscan mode

- **GIVEN** `SCANNER_MODE=cylinderscan` in the `.env` config
- **WHEN** the app starts
- **THEN** `registerGraviScanHandlers` SHALL NOT be called
- **AND** invoking any `graviscan:*` IPC channel SHALL result in an unhandled channel error

#### Scenario: GraviScan handlers not registered when mode is empty

- **GIVEN** `SCANNER_MODE` is not set or is an empty string in the `.env` config
- **WHEN** the app starts
- **THEN** `registerGraviScanHandlers` SHALL NOT be called

### Requirement: GraviScan Session State Management

The system SHALL maintain scan session state at module level in `main.ts` and expose it via getter/setter functions passed to handler modules through dependency injection. The session state type `ScanSessionState` SHALL be defined in `src/types/graviscan.ts`.

#### Scenario: Session state accessible via getters

- **GIVEN** the GraviScan session state is initialized in `main.ts`
- **WHEN** `sessionFns.getScanSession()` is called
- **THEN** it SHALL return the current `ScanSessionState` or `null` if no scan is active

#### Scenario: Session state updated by handlers

- **GIVEN** a scan is started via `graviscan:start-scan`
- **WHEN** `startScan()` calls `sessionFns.setScanSession(newState)`
- **THEN** `sessionFns.getScanSession()` SHALL return the updated state
- **AND** the state SHALL include `isActive`, `isContinuous`, `experimentId`, `phenotyperId`, `resolution`, `sessionId`, `jobs`, `currentCycle`, `totalCycles`, `intervalMs`, `scanStartedAt`, `scanEndedAt`, `scanDurationMs`, `coordinatorState`, `nextScanAt`, and `waveNumber` fields

#### Scenario: Session state cleared on cancel

- **GIVEN** an active scan session exists
- **WHEN** `graviscan:cancel-scan` is invoked
- **THEN** `cancelScan()` SHALL call `sessionFns.setScanSession(null)`
- **AND** `sessionFns.getScanSession()` SHALL return `null`

#### Scenario: Concurrent start-scan rejected when session active

- **GIVEN** an active scan session exists (`getScanSession()` returns non-null with `isActive: true`)
- **WHEN** the renderer invokes `graviscan:start-scan`
- **THEN** the handler SHALL return `{ success: false, error: 'Scan already in progress' }`
- **AND** the existing session SHALL NOT be modified

#### Scenario: markScanJobRecorded updates job status

- **GIVEN** an active scan session exists with a job keyed by `scannerId:plateIndex`
- **WHEN** `sessionFns.markScanJobRecorded('scanner1:00')` is called
- **THEN** the job's `status` field SHALL be set to `'recorded'`

#### Scenario: markScanJobRecorded ignores unknown job key

- **GIVEN** an active scan session exists
- **WHEN** `sessionFns.markScanJobRecorded('nonexistent:99')` is called
- **THEN** the session state SHALL NOT be modified
- **AND** no error SHALL be thrown

### Requirement: GraviScan Coordinator Lazy Instantiation

The `ScanCoordinator` SHALL be instantiated lazily — created only when `graviscan:start-scan` is invoked, not at app startup. This matches the CylinderScan pattern where `ScannerProcess` is created in the `scanner:initialize` handler.

#### Scenario: No coordinator at startup

- **GIVEN** the app starts in `graviscan` mode
- **WHEN** no scan has been initiated
- **THEN** no `ScanCoordinator` instance SHALL exist
- **AND** no Python subprocesses SHALL be spawned

#### Scenario: Coordinator created on start-scan

- **GIVEN** the app is in `graviscan` mode
- **WHEN** the renderer invokes `graviscan:start-scan` with valid parameters
- **THEN** a new `ScanCoordinator` SHALL be instantiated
- **AND** its events SHALL be wired to the renderer via `mainWindow.webContents.send()`

#### Scenario: Coordinator shutdown on app quit

- **GIVEN** a `ScanCoordinator` instance exists (scan was started)
- **WHEN** the app is quitting
- **THEN** the coordinator SHALL be shut down gracefully via `coordinator.shutdown()`
- **AND** `closeScanLog()` SHALL be called

### Requirement: GraviScan Coordinator Event Forwarding

The system SHALL forward `ScanCoordinator` events to the renderer process via IPC. All forwarding SHALL use the `if (mainWindow && !mainWindow.isDestroyed())` guard pattern.

#### Scenario: Scan events forwarded to renderer

- **GIVEN** a `ScanCoordinator` is active and `mainWindow` exists
- **WHEN** the coordinator emits `scan-event`, `grid-start`, `grid-complete`, `cycle-complete`, `interval-start`, `interval-waiting`, `interval-complete`, `overtime`, `cancelled`, or `scan-error`
- **THEN** the event SHALL be forwarded to the renderer via `mainWindow.webContents.send('graviscan:<event-name>', payload)`

#### Scenario: No crash when mainWindow is null

- **GIVEN** a `ScanCoordinator` is active
- **AND** `mainWindow` is `null`
- **WHEN** the coordinator emits an event
- **THEN** the event SHALL be silently dropped (no crash, no error log)

#### Scenario: No crash when mainWindow is destroyed

- **GIVEN** a `ScanCoordinator` is active
- **AND** `mainWindow.isDestroyed()` returns `true`
- **WHEN** the coordinator emits an event
- **THEN** the event SHALL be silently dropped (no crash, no error log)

### Requirement: GraviScan Preload Context Bridge

The preload script SHALL expose a `gravi` namespace on `window.electron` with methods for all GraviScan IPC channels and event listeners.

#### Scenario: Invoke methods available

- **GIVEN** the preload script has run
- **WHEN** renderer code accesses `window.electron.gravi`
- **THEN** the following 15 invoke methods SHALL be available: `detectScanners`, `getConfig`, `saveConfig`, `saveScannersToDB`, `getPlatformInfo`, `validateScanners`, `validateConfig`, `startScan`, `getScanStatus`, `markJobRecorded`, `cancelScan`, `getOutputDir`, `readScanImage`, `uploadAllScans`, `downloadImages`
- **AND** the following 12 event listener methods SHALL be available: `onScanEvent`, `onGridStart`, `onGridComplete`, `onCycleComplete`, `onIntervalStart`, `onIntervalWaiting`, `onIntervalComplete`, `onOvertime`, `onCancelled`, `onScanError`, `onUploadProgress`, `onDownloadProgress`

#### Scenario: Event listener registration

- **GIVEN** the preload script has run
- **WHEN** renderer code calls `window.electron.gravi.onScanEvent(callback)`
- **THEN** it SHALL register a listener for `graviscan:scan-event` via `ipcRenderer.on()`
- **AND** the callback SHALL be invoked when the main process sends a `graviscan:scan-event` message

#### Scenario: Event listener cleanup

- **GIVEN** renderer code has registered an event listener via `window.electron.gravi.onScanEvent(callback)`
- **AND** the call returned a cleanup function
- **WHEN** the cleanup function is called
- **THEN** the listener SHALL be removed via `ipcRenderer.removeListener()`
- **AND** subsequent `graviscan:scan-event` messages SHALL NOT invoke the callback

### Requirement: GraviScan Barrel Exports

The `src/main/graviscan/index.ts` barrel SHALL export `registerGraviScanHandlers` from `register-handlers`, `ScanCoordinator` from `scan-coordinator`, `ScannerSubprocess` from `scanner-subprocess`, and `scanLog`, `cleanupOldLogs`, `closeScanLog` from `scan-logger`, in addition to existing handler exports.

#### Scenario: All public symbols exported

- **GIVEN** a TypeScript file imports from `./graviscan`
- **WHEN** it references `registerGraviScanHandlers`, `ScanCoordinator`, `ScannerSubprocess`, `scanLog`, `cleanupOldLogs`, or `closeScanLog`
- **THEN** the imports SHALL resolve without TypeScript compilation errors

### Requirement: GraviScan Scan Log Lifecycle

The system SHALL call `cleanupOldLogs()` during app startup and `closeScanLog()` during app quit to manage scan log file lifecycle.

#### Scenario: Old logs cleaned on startup

- **GIVEN** the app starts in `graviscan` mode
- **AND** scan log files older than the retention window (default 180 days) exist in `~/.bloom/logs/`
- **WHEN** initialization completes
- **THEN** `cleanupOldLogs()` SHALL be called
- **AND** log files older than the retention window SHALL be deleted
- **AND** recent log files SHALL be preserved

#### Scenario: Log stream closed on quit

- **GIVEN** the app is quitting
- **AND** the scan log write stream is open
- **WHEN** the `before-quit` or `will-quit` event fires
- **THEN** `closeScanLog()` SHALL be called
- **AND** the write stream SHALL be flushed and closed
- **AND** subsequent `scanLog()` calls SHALL not throw

### Requirement: GraviScan IPC Path Validation

The `graviscan:read-scan-image` IPC handler SHALL validate that the resolved file path is within the configured scan output directory before reading the file. This prevents path traversal attacks from a compromised renderer.

#### Scenario: Valid path within output directory

- **GIVEN** `getOutputDir()` returns `/home/user/.bloom/graviscan/`
- **WHEN** the renderer invokes `graviscan:read-scan-image` with path `/home/user/.bloom/graviscan/exp1/scan.tiff`
- **THEN** the handler SHALL proceed with reading the image

#### Scenario: Path traversal attempt rejected

- **GIVEN** `getOutputDir()` returns `/home/user/.bloom/graviscan/`
- **WHEN** the renderer invokes `graviscan:read-scan-image` with path `/etc/passwd` or `../../etc/passwd`
- **THEN** the handler SHALL return `{ success: false, error: 'Path outside scan directory' }`
- **AND** the file SHALL NOT be read

#### Scenario: Path validation uses resolved paths

- **GIVEN** `getOutputDir()` returns a path that may contain symlinks or relative components
- **WHEN** the handler validates a candidate file path
- **THEN** both the output directory and the candidate path SHALL be resolved via `path.resolve()` before the `startsWith` comparison
- **AND** paths with `..` components SHALL be normalized before comparison

### Requirement: GraviScan Upload Guard

The `graviscan:upload-all-scans` IPC handler SHALL reject upload requests when the coordinator is actively scanning to prevent uploading partially written scan files.

#### Scenario: Upload rejected during active scan

- **GIVEN** a `ScanCoordinator` is active and `isScanning` is `true`
- **WHEN** the renderer invokes `graviscan:upload-all-scans`
- **THEN** the handler SHALL return `{ success: false, error: 'Cannot upload while scanning is in progress' }`

#### Scenario: Upload allowed when no scan active

- **GIVEN** no `ScanCoordinator` exists or `isScanning` is `false`
- **WHEN** the renderer invokes `graviscan:upload-all-scans`
- **THEN** the handler SHALL proceed with the upload

### Requirement: GraviScan Type Definitions for Preload API

The system SHALL define a `GraviAPI` interface in `src/types/electron.d.ts` and add `gravi: GraviAPI` to the `ElectronAPI` interface, providing type safety for renderer code accessing GraviScan IPC channels.

#### Scenario: GraviAPI type available in renderer

- **GIVEN** a renderer TypeScript file accesses `window.electron.gravi`
- **WHEN** the file is compiled with `npx tsc --noEmit`
- **THEN** the compiler SHALL recognize all 15 invoke methods and 12 event listener methods with correct parameter and return types

### Requirement: GraviScan IPC Integration Testing

The system SHALL include integration tests verifying the full IPC round-trip for GraviScan handlers, both via Vitest (mocked ipcMain) and Playwright E2E (real Electron app).

#### Scenario: Handler invocation returns wrapped response

- **GIVEN** `registerGraviScanHandlers` has been called with a mock database
- **WHEN** a registered handler is invoked (e.g., `graviscan:detect-scanners`)
- **THEN** the response SHALL be `{ success: true, data: <result> }` where `<result>` is the return value of the corresponding handler module function

#### Scenario: E2E round-trip from renderer via gravi namespace

- **GIVEN** the Electron app is running in `graviscan` mode with `GRAVISCAN_MOCK=true`
- **WHEN** renderer code calls `window.electron.gravi.detectScanners()`
- **THEN** the response SHALL contain mock scanner data
- **AND** `window.electron.gravi.getPlatformInfo()` SHALL return platform information
- **AND** `window.electron.gravi.getScanStatus()` SHALL return `null` (no active scan)

#### Scenario: E2E event listener cleanup

- **GIVEN** the Electron app is running in `graviscan` mode
- **WHEN** renderer code calls `window.electron.gravi.onScanEvent(callback)`
- **THEN** it SHALL return a function (cleanup)
- **AND** the cleanup function SHALL be callable without error

## MODIFIED Requirements

### Requirement: ScanCoordinator Multi-Scanner Orchestration

The system SHALL provide a `ScanCoordinator` class in `src/main/graviscan/scan-coordinator.ts` that orchestrates multiple `ScannerSubprocess` instances for parallel scanning, with staggered initialization, grid-based scan sequencing, interval/continuous mode timing, and graceful shutdown. The USB stagger delay SHALL be defined as a named module-level constant `USB_STAGGER_DELAY_MS = 5000`. File verification and renaming in `handleScanComplete()` SHALL use asynchronous filesystem operations (`fs.promises`) instead of synchronous calls to avoid blocking the Electron main process event loop during scan completion. Critical events (`grid-complete` with file paths, successful renames) SHALL be logged via `scanLog()` for scientific traceability.

#### Scenario: Staggered scanner initialization

- **GIVEN** a `ScanCoordinator` is constructed with a Python path and packaging flag
- **WHEN** `initialize(scanners)` is called with a list of `ScannerConfig` objects
- **THEN** the coordinator SHALL spawn one `ScannerSubprocess` per scanner
- **AND** subprocesses SHALL be initialized sequentially (one at a time) to prevent SANE global state contention
- **AND** existing subprocesses not in the new config SHALL be shut down
- **AND** existing subprocesses that are already ready SHALL be reused

#### Scenario: Initialize with zero scanners

- **GIVEN** a `ScanCoordinator` is constructed
- **WHEN** `initialize([])` is called with an empty list
- **THEN** the coordinator SHALL shut down any existing subprocesses
- **AND** the subprocess map SHALL be empty
- **AND** the coordinator SHALL resolve without error

#### Scenario: Single-cycle scan with grid sequencing

- **GIVEN** the coordinator is initialized with scanners
- **WHEN** `scanOnce(platesPerScanner)` is called with a `Map<string, PlateConfig[]>`
- **THEN** the coordinator SHALL scan grids sequentially (all scanners scan grid 0, then grid 1, etc.)
- **AND** within each grid, scanners SHALL be triggered with a `USB_STAGGER_DELAY_MS` (5-second) stagger delay
- **AND** each stagger delay SHALL be logged via `scanLog()` with the scanner ID and delay duration
- **AND** the coordinator SHALL wait for all scanners to complete a grid before proceeding to the next
- **AND** output files SHALL be renamed to append `_et_YYYYMMDDTHHMMSS` end-timestamp after grid completion (regex applied to `path.basename` only, not the full path)
- **AND** the coordinator SHALL emit `grid-start`, `grid-complete`, and `cycle-complete` events

#### Scenario: File verification after scan-complete uses async FS

- **GIVEN** a subprocess emits a `scan-complete` event with an output file path
- **WHEN** the coordinator processes the completion
- **THEN** the coordinator SHALL use `fs.promises.access()` to verify the output file exists
- **AND** SHALL use `fs.promises.stat()` to verify the file has non-zero size
- **AND** if the file is missing or zero-size, the coordinator SHALL emit a `scan-error` event for that scanner/plate

#### Scenario: Rename uses async FS and is logged

- **GIVEN** all scanners have completed a grid
- **WHEN** the coordinator renames output files to include end timestamps
- **THEN** the coordinator SHALL use `fs.promises.rename()` instead of `fs.renameSync()`
- **AND** renames SHALL remain sequential within each result set (not parallelized via `Promise.all`)
- **AND** row group N+1 SHALL NOT begin scanning until all renames for row group N have resolved or errored
- **AND** successful renames SHALL be logged via `scanLog()` with old and new file paths

#### Scenario: Rename failure surfaces as error event

- **GIVEN** all scanners have completed a grid
- **WHEN** the coordinator attempts to rename output files to include end timestamps
- **AND** a rename operation fails (e.g., disk full, permissions)
- **THEN** the coordinator SHALL emit a `rename-error` event with the failure details and affected file path
- **AND** the `grid-complete` event SHALL include a `renameErrors` array (empty on success)

#### Scenario: Partial scanner failure mid-grid

- **GIVEN** the coordinator is scanning a grid with multiple scanners
- **WHEN** one scanner emits a `scan-error` while others complete successfully
- **THEN** the coordinator SHALL mark the failed scanner's output as errored
- **AND** the coordinator SHALL still wait for remaining scanners to complete
- **AND** the coordinator SHALL proceed to the next grid

#### Scenario: Interval scanning with duration

- **GIVEN** the coordinator is initialized with scanners
- **WHEN** `scanInterval(platesPerScanner, intervalMs, durationMs)` is called
- **THEN** the coordinator SHALL repeat `scanOnce()` at the specified interval
- **AND** scanning SHALL stop when the duration is exceeded or `cancelAll()` is called
- **AND** the coordinator SHALL emit `interval-start`, `interval-waiting`, and `interval-complete` events
- **AND** if a cycle takes longer than the interval, the coordinator SHALL emit an `overtime` event

#### Scenario: Cancel all scanning

- **GIVEN** the coordinator is actively scanning
- **WHEN** `cancelAll()` is called
- **THEN** all active scans SHALL be cancelled
- **AND** any interval timer SHALL be cleared
- **AND** a `cancelled` event SHALL be emitted

#### Scenario: Cancel during interval wait resets state to idle

- **GIVEN** the coordinator is waiting between interval cycles (state is `waiting`)
- **WHEN** `cancelAll()` is called
- **THEN** the interval timer SHALL be cleared
- **AND** a `cancelled` event SHALL be emitted
- **AND** no further scan cycles SHALL be started
- **AND** after `scanInterval()` returns, `isScanning` SHALL be `false`

#### Scenario: Per-row scan timeout prevents infinite hang

- **GIVEN** the coordinator is scanning a grid row
- **AND** one or more subprocesses have not emitted `cycle-done` or `exit`
- **WHEN** a configurable per-row timeout (`SCAN_ROW_TIMEOUT_MS`) is exceeded
- **THEN** the timed-out subprocesses SHALL be treated as failed
- **AND** the coordinator SHALL proceed to the next row group
- **AND** a `scan-error` event SHALL be emitted for each timed-out subprocess

#### Scenario: Forwarded scan events do not include stale timestamps

- **GIVEN** the coordinator forwards subprocess events via `scan-event`
- **WHEN** a `scan-complete` event is emitted before the row has finished
- **THEN** the forwarded event SHALL include `scan_started_at` (the row start time)
- **AND** the forwarded event SHALL NOT include `scan_ended_at` (which is unknown until the row completes)

#### Scenario: Cancel during active scanOnce aborts cleanly

- **GIVEN** the coordinator is actively awaiting `scanOnce()` completion
- **WHEN** `cancelAll()` is called
- **THEN** the coordinator SHALL check `this.cancelled` after each row completes
- **AND** the coordinator SHALL skip file verification and renaming for unfinished rows
- **AND** `isScanning` SHALL return `false` after `scanOnce()` returns

#### Scenario: Graceful shutdown

- **GIVEN** the coordinator has active subprocesses
- **WHEN** `shutdown()` is called
- **THEN** the coordinator SHALL send quit commands to all subprocesses
- **AND** force-kill any subprocess that does not exit within 5 seconds
- **AND** clear the subprocess map

#### Scenario: Coordinator implements ScanCoordinatorLike

- **GIVEN** the `ScanCoordinatorLike` interface is defined in session-handlers.ts
- **WHEN** the `ScanCoordinator` class is compiled
- **THEN** it SHALL explicitly `implements ScanCoordinatorLike`
- **AND** the `isScanning` readonly property SHALL return `true` when state is `scanning` or `waiting`

#### Scenario: Grid-complete events logged to persistent storage

- **GIVEN** the coordinator completes a grid
- **WHEN** the `grid-complete` event is emitted
- **THEN** the event payload (including renamed file paths and timestamps) SHALL be logged via `scanLog()`
- **AND** the log entry SHALL survive renderer crashes

### Requirement: ScannerSubprocess Worker Management

The system SHALL provide a `ScannerSubprocess` class in `src/main/graviscan/scanner-subprocess.ts` that manages a single long-lived Python `scan_worker.py` subprocess per physical scanner, communicating via line-delimited JSON on stdin and `EVENT:`-prefixed JSON on stdout. The class SHALL store all readline interfaces as class fields and close them during shutdown and kill operations to prevent file descriptor leaks.

#### Scenario: Subprocess spawn and ready signal

- **GIVEN** a `ScannerSubprocess` is constructed with a scanner ID and SANE name
- **WHEN** `spawn()` is called
- **THEN** the subprocess SHALL spawn a Python process with appropriate arguments
- **AND** in development mode, SHALL use `python -m graviscan.scan_worker`
- **AND** in packaged mode, SHALL use `bloom-hardware --scan-worker`
- **AND** the subprocess SHALL wait for an `EVENT:ready` signal before resolving

#### Scenario: Spawn failure

- **GIVEN** a `ScannerSubprocess` is constructed
- **WHEN** `spawn()` is called and the Python binary is not found (ENOENT) or not executable (EACCES)
- **THEN** the spawn promise SHALL reject with a descriptive error
- **AND** the subprocess state SHALL transition to `dead`

#### Scenario: Send scan command

- **GIVEN** the subprocess is in the `ready` state
- **WHEN** `scan(plates)` is called with a list of `PlateConfig` objects
- **THEN** the subprocess SHALL write `{action: 'scan', plates}` as JSON to stdin
- **AND** the state SHALL transition to `scanning`

#### Scenario: Parse EVENT protocol messages

- **GIVEN** the subprocess stdout emits lines prefixed with `EVENT:`
- **WHEN** a line like `EVENT:{"type":"scan-complete","scanner_id":"..."}` is received
- **THEN** the subprocess SHALL parse the JSON payload
- **AND** emit typed events: `scan-started`, `scan-complete`, `scan-error`, `scan-cancelled`, `cycle-done`
- **AND** emit a generic `event` for the coordinator to forward

#### Scenario: Malformed EVENT protocol line

- **GIVEN** the subprocess stdout emits a line `EVENT:not-valid-json`
- **WHEN** the line is parsed
- **THEN** the malformed line SHALL be logged as a warning via `scanLog()`
- **AND** the subprocess SHALL NOT crash or change state

#### Scenario: Partial stdout line buffering

- **GIVEN** the subprocess stdout emits a JSON event split across multiple data chunks
- **WHEN** the chunks are received
- **THEN** the line reader SHALL reassemble complete lines before parsing
- **AND** no partial JSON SHALL be passed to the parser

#### Scenario: Cancel scan

- **GIVEN** the subprocess is scanning
- **WHEN** `cancel()` is called
- **THEN** the subprocess SHALL write `{action: 'cancel'}` to stdin
- **AND** the worker SHALL finish the current plate then return to idle

#### Scenario: Process exit with non-zero code

- **GIVEN** the subprocess is alive
- **WHEN** the process exits with a non-zero exit code or a signal
- **THEN** the subprocess SHALL emit an `exit` event with the code and signal
- **AND** the state SHALL transition to `dead`
- **AND** any pending operations SHALL be rejected

#### Scenario: Graceful subprocess shutdown

- **GIVEN** the subprocess is alive
- **WHEN** `shutdown(timeoutMs)` is called
- **THEN** the subprocess SHALL send a `quit` command
- **AND** force-kill with SIGKILL if the process does not exit within the timeout
- **AND** resolve when the process exits

#### Scenario: Readline interfaces cleaned up on shutdown

- **GIVEN** a `ScannerSubprocess` has been spawned
- **AND** both stdout readline (`this.rl`) and stderr readline (`this.stderrRl`) interfaces exist
- **WHEN** `shutdown()` is called
- **THEN** both `this.rl` and `this.stderrRl` SHALL be closed via `.close()`
- **AND** `this.stderrRl` SHALL be stored as a class field (not a local variable)

#### Scenario: Readline interfaces cleaned up on kill

- **GIVEN** a `ScannerSubprocess` has been spawned
- **WHEN** `kill()` is called
- **THEN** both `this.rl` and `this.stderrRl` SHALL be closed via `.close()`

#### Scenario: Double cleanup is safe

- **GIVEN** `shutdown()` has already been called and readline interfaces were closed
- **WHEN** `kill()` is subsequently called
- **THEN** the cleanup SHALL NOT throw an error (closing an already-closed readline is safe)
