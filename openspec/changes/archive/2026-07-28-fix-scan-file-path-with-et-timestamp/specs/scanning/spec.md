## MODIFIED Requirements

### Requirement: ScanCoordinator Multi-Scanner Orchestration

The system SHALL provide a `ScanCoordinator` class in `src/main/graviscan/scan-coordinator.ts` that orchestrates multiple `ScannerSubprocess` instances for parallel scanning, with staggered initialization, grid-based scan sequencing, interval/continuous mode timing, and graceful shutdown. The USB stagger delay SHALL be defined as a named module-level constant `USB_STAGGER_DELAY_MS = 5000`. File verification in `handleScanComplete()` SHALL use asynchronous filesystem operations (`fs.promises`) instead of synchronous calls to avoid blocking the Electron main process event loop during scan completion. Critical events (`grid-complete` with file paths) SHALL be logged via `scanLog()` for scientific traceability.

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
- **AND** each plate's final output path (already including the `_et_YYYYMMDDTHHMMSS` end-timestamp, composed by the Python scan worker at save time) SHALL be learned from that plate's `scan-complete` event — the coordinator SHALL NOT assume the path it sent to the worker is the path that was saved
- **AND** the coordinator SHALL emit `grid-start`, `grid-complete`, and `cycle-complete` events

#### Scenario: File verification after scan-complete uses async FS

- **GIVEN** a subprocess emits a `scan-complete` event with an output file path
- **WHEN** the coordinator processes the completion
- **THEN** the coordinator SHALL use `fs.promises.access()` to verify the output file exists
- **AND** SHALL use `fs.promises.stat()` to verify the file has non-zero size
- **AND** if the file is missing or zero-size, the coordinator SHALL emit a `scan-error` event for that scanner/plate

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
- **AND** the coordinator SHALL skip file verification for unfinished rows
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
- **THEN** the event payload (including scanned file paths and timestamps) SHALL be logged via `scanLog()`
- **AND** the log entry SHALL survive renderer crashes

### Requirement: GraviScan Coordinator Event Forwarding

The system SHALL forward `ScanCoordinator` events to the renderer process via IPC. The `setupCoordinatorEventForwarding()` function SHALL be exported from `src/main/graviscan/wiring.ts`. All forwarding SHALL use the `if (mainWindow && !mainWindow.isDestroyed())` guard pattern.

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

## ADDED Requirements

### Requirement: Scan File Saved with Final Filename

The scan worker SHALL save scan output files with both `_st_TIMESTAMP` (start) and `_et_TIMESTAMP` (end) in the filename at write time, via `compose_output_path()`. No post-save rename SHALL occur.

#### Scenario: Plate scan completes with final filename on disk

- **GIVEN** the worker receives `output_path = "..._st_20260413T120530_cy1_S1_00.tif"`
- **WHEN** the plate scan completes
- **THEN** the file SHALL be saved as `..._st_20260413T120530_et_20260413T120545_cy1_S1_00.tif`
- **AND** no rename operation SHALL occur after save
- **AND** the `scan-complete` event SHALL contain the final path (with `_et_`)

#### Scenario: Coordinator learns the real path from scan-complete, not the path it sent

- **GIVEN** a scan completes successfully
- **WHEN** the coordinator verifies and reports the output file
- **THEN** the path used SHALL be the one reported in the plate's `scan-complete` event
- **AND** SHALL NOT be assumed from the path the coordinator originally sent to the worker
