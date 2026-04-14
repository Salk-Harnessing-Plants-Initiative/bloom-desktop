## ADDED Requirements

### Requirement: ScanCoordinator Multi-Scanner Orchestration

The system SHALL provide a `ScanCoordinator` class in `src/main/graviscan/scan-coordinator.ts` that orchestrates multiple `ScannerSubprocess` instances for parallel scanning, with staggered initialization, grid-based scan sequencing, interval/continuous mode timing, and graceful shutdown. The USB stagger delay SHALL be defined as a named module-level constant `USB_STAGGER_DELAY_MS = 5000`.

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
- **AND** output files SHALL be renamed to append `_et_YYYYMMDDTHHMMSS` end-timestamp after grid completion
- **AND** the coordinator SHALL emit `grid-start`, `grid-complete`, and `cycle-complete` events

#### Scenario: File verification after scan-complete

- **GIVEN** a subprocess emits a `scan-complete` event with an output file path
- **WHEN** the coordinator processes the completion
- **THEN** the coordinator SHALL verify the output file exists and has non-zero size
- **AND** if the file is missing or zero-size, the coordinator SHALL emit a `scan-error` event for that scanner/plate

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

#### Scenario: Cancel during interval wait

- **GIVEN** the coordinator is waiting between interval cycles (not actively scanning)
- **WHEN** `cancelAll()` is called
- **THEN** the interval timer SHALL be cleared
- **AND** a `cancelled` event SHALL be emitted
- **AND** no further scan cycles SHALL be started

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

### Requirement: ScannerSubprocess Worker Management

The system SHALL provide a `ScannerSubprocess` class in `src/main/graviscan/scanner-subprocess.ts` that manages a single long-lived Python `scan_worker.py` subprocess per physical scanner, communicating via line-delimited JSON on stdin and `EVENT:`-prefixed JSON on stdout.

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

### Requirement: GraviScan Persistent Scan Logging

The system SHALL provide scan logging in `src/main/graviscan/scan-logger.ts` that writes timestamped entries to `~/.bloom/logs/graviscan-YYYY-MM-DD.log` with configurable log retention (default 180 days).

#### Scenario: Write scan log entry

- **GIVEN** the scan logger is available
- **WHEN** `scanLog(message)` is called
- **THEN** the message SHALL be written with an ISO timestamp to the daily log file
- **AND** the log directory SHALL be created if it does not exist

#### Scenario: Configurable log retention

- **GIVEN** `LOG_RETENTION_DAYS` is set to N days (default 180)
- **WHEN** `cleanupOldLogs()` is called
- **THEN** log files older than N days SHALL be deleted
- **AND** recent log files SHALL be preserved

#### Scenario: Close scan log stream

- **GIVEN** the scan logger has an open write stream
- **WHEN** `closeScanLog()` is called
- **THEN** the write stream SHALL be flushed and closed
- **AND** subsequent calls to `scanLog()` SHALL open a new stream

### Requirement: GraviScan Shared Type Definitions

The `PlateConfig` and `ScannerConfig` interfaces SHALL be defined in `src/types/graviscan.ts` (moved from local definitions in session-handlers.ts) so they can be shared across session-handlers, scan-coordinator, and scanner-subprocess modules.

#### Scenario: PlateConfig available as shared type

- **GIVEN** the `PlateConfig` interface is defined in `src/types/graviscan.ts`
- **WHEN** any GraviScan module needs plate configuration
- **THEN** it SHALL import `PlateConfig` from `../../types/graviscan` (or appropriate relative path)
- **AND** `PlateConfig` SHALL have fields: `plate_index: string`, `grid_mode: string`, `resolution: number`, `output_path: string`

#### Scenario: ScannerConfig available as shared type

- **GIVEN** the `ScannerConfig` interface is defined in `src/types/graviscan.ts`
- **WHEN** any GraviScan module needs scanner configuration
- **THEN** it SHALL import `ScannerConfig` from `../../types/graviscan` (or appropriate relative path)
- **AND** `ScannerConfig` SHALL have fields: `scannerId: string`, `saneName: string`, `plates: PlateConfig[]`

#### Scenario: Session-handlers imports shared types

- **GIVEN** `PlateConfig` and `ScannerConfig` are defined in `src/types/graviscan.ts`
- **WHEN** `session-handlers.ts` is compiled
- **THEN** it SHALL import both types from `../../types/graviscan`
- **AND** the local type definitions SHALL be removed
- **AND** the `ScanCoordinatorLike` interface SHALL remain in session-handlers.ts
