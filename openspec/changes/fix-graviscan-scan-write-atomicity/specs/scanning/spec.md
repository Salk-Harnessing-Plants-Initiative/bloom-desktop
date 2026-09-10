## MODIFIED Requirements

### Requirement: Scan File Saved with Final Filename

The scan worker SHALL save scan output files with both `_st_TIMESTAMP` (start) and `_et_TIMESTAMP` (end) in the filename at write time, via `compose_output_path()`. No post-save rename to a different final path SHALL occur. The worker SHALL write image data to a temporary file in the same directory as the final path and atomically replace the final path only after the image data has been fully and successfully written — a process termination (e.g., SIGKILL) at any point during the write SHALL NOT leave a truncated or invalid file at the final path.

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

#### Scenario: Interrupted write leaves no partial file at the final path

- **GIVEN** the worker is writing a plate's scan output
- **WHEN** the worker process is terminated (e.g., force-killed) before the write completes
- **THEN** no file SHALL exist at the plate's final output path
- **AND** any partial data SHALL exist only at a temporary path distinguishable from the final filename (e.g., a `.tmp`-prefixed name in the same directory)

#### Scenario: Successful write is atomic

- **GIVEN** the worker has fully captured and encoded a plate's image data
- **WHEN** the worker saves the file
- **THEN** the file SHALL first be written to a temporary path in the same directory as the final path
- **AND** SHALL be atomically renamed into the final path only after the write completes successfully
- **AND** at no point SHALL a partially-written file be visible at the final path

#### Scenario: Rename failure after a successful write is treated as a scan failure, not silently swallowed

- **GIVEN** the worker has fully and successfully written a plate's image data to a temporary path
- **WHEN** the atomic rename into the final path fails (e.g. a permissions error)
- **THEN** no partial or truncated file SHALL exist at the final path
- **AND** the failure SHALL propagate as a scan failure through the same retry path already used for other scan errors, rather than being caught and discarded silently

### Requirement: ScanCoordinator Multi-Scanner Orchestration

The system SHALL provide a `ScanCoordinator` class in `src/main/graviscan/scan-coordinator.ts` that orchestrates multiple `ScannerSubprocess` instances for parallel scanning, with concurrent initialization, grid-based scan sequencing, interval/continuous mode timing, and graceful shutdown. The USB stagger delay SHALL be defined as a named module-level constant `USB_STAGGER_DELAY_MS = 5000`. File verification in `handleScanComplete()` SHALL use asynchronous filesystem operations (`fs.promises`) instead of synchronous calls to avoid blocking the Electron main process event loop during scan completion. Critical events (`grid-complete` with file paths) SHALL be logged via `scanLog()` for scientific traceability. Per-job scan events SHALL be emitted on three granular channels — `scan-started`, `scan-complete`, `scan-error` — each carrying `jobId` (`` `${scannerId}:${plateIndex}` `` when a single plate applies, or `scannerId` alone for a whole-row failure with no single plate), `scannerId`, and `plateIndex` in addition to that event's existing fields. The generic `scan-event` channel (an embedded `type` field distinguishing these three cases) SHALL NOT be emitted. **Note on the bare-`scannerId` `jobId` shape**: it is a novel third shape relative to the per-plate `` `${scannerId}:${plateIndex}` `` shape used everywhere else, including `session-handlers.ts`'s existing `session.jobs` map — there is no existing single-key lookup pattern for it. A future consumer (e.g. a Tier 3/4 UI) that needs to mark every plate on a row as affected by a whole-row failure will have to enumerate all `` `${scannerId}:*` `` job-map entries for that scanner rather than perform a single key lookup. This is stated explicitly so a future implementer designs for it deliberately rather than discovering it during implementation.

Per-scanner spawns made by `initialize()` go through the same guarded, per-`scannerId` spawn path as `addScanner()` — see the "Coordinator Single-Scanner Spawn API" requirement for the concurrency-guard semantics shared by both entry points.

#### Scenario: Concurrent scanner initialization

- **GIVEN** a `ScanCoordinator` is constructed with a Python path and packaging flag
- **WHEN** `initialize(scanners)` is called with a list of `ScannerConfig` objects
- **THEN** the coordinator SHALL spawn one `ScannerSubprocess` per scanner
- **AND** subprocesses SHALL be initialized concurrently (via `Promise.allSettled`), not sequentially — each subprocess's own process isolation means SANE global-state contention does not apply across separate OS processes
- **AND** one scanner's spawn failure SHALL NOT prevent the others from initializing
- **AND** total initialization time SHALL be bounded by the slowest single scanner's spawn time, not the sum of all scanners' spawn times
- **AND** existing subprocesses not in the new config SHALL be shut down
- **AND** existing subprocesses that are already ready SHALL be reused

#### Scenario: Concurrent initialize calls do not race shared preamble state, and neither call's scanner list is dropped

- **GIVEN** a `ScanCoordinator` call to `initialize(scannersA)` is in
  progress (has not yet resolved)
- **WHEN** `initialize(scannersB)` is called before the first call
  resolves, where `scannersB` is a different list of scanners than
  `scannersA` (not merely a repeat of the same call)
- **THEN** the second call SHALL NOT independently run the
  stale-subprocess cleanup loop or clear `initErrors` while the first
  call's own run of that same preamble is still in progress
- **AND** the second call SHALL still run its own `doInitialize`
  against `scannersB` once the first call's run completes — it SHALL
  NOT be silently merged into or dropped by the first call's result
- **AND** after both calls resolve, every scanner unique to `scannersB`
  SHALL have been spawned (`hasWorker()` returns `true` for it),
  proving `scannersB` was actually processed and not discarded
- **AND** no subprocess SHALL be shut down or spawned twice as a result
  of the overlap

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
- **AND** if the file is missing or zero-size, the coordinator SHALL emit a `scan-error` event for that scanner/plate with a `jobId` of `` `${scannerId}:${plateIndex}` ``

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
- **AND** a `scan-error` event SHALL be emitted for each timed-out subprocess, with `jobId` equal to the bare `scannerId` (no single `plateIndex` applies to a whole-row timeout)

#### Scenario: Forwarded scan events use granular per-job channels, not a generic bus

- **GIVEN** a `ScannerSubprocess` emits a generic `event` with `type: 'scan-started'`, `'scan-complete'`, or `'scan-error'`
- **WHEN** the coordinator forwards it
- **THEN** the coordinator SHALL emit on the correspondingly-named channel (`scan-started`, `scan-complete`, or `scan-error`) — NOT on a generic `scan-event` channel with an embedded `type` field
- **AND** the forwarded payload SHALL include `jobId` (`` `${scannerId}:${plateIndex}` ``), `scannerId`, and `plateIndex` in addition to the source event's own fields
- **AND** a `scan-complete` event emitted before the row has finished SHALL include `scan_started_at` (the row start time) and SHALL NOT include `scan_ended_at` (which is unknown until the row completes)

#### Scenario: Cancel during active scanOnce aborts cleanly

- **GIVEN** the coordinator is actively awaiting `scanOnce()` completion
- **WHEN** `cancelAll()` is called
- **THEN** the coordinator SHALL check `this.cancelled` after each row completes
- **AND** the coordinator SHALL skip file verification for unfinished rows
- **AND** `isScanning` SHALL return `false` after `scanOnce()` returns

#### Scenario: A row ended by subprocess exit, outside a full cancellation, logs a diagnostic instead of silent skip

- **GIVEN** the coordinator is actively awaiting `scanOnce()`'s row completion
- **AND** `cancelAll()` has NOT been called (`this.cancelled` is `false`)
- **WHEN** one scanner's row promise resolves with outcome reason `exit` (its subprocess emitted `exit` before `cycle-done`, e.g. because `stopScanner()` was called for that scanner mid-row) — as distinct from outcome reason `timeout` (see the next scenario)
- **THEN** the coordinator SHALL NOT attempt to guess or verify a specific file path for that scanner's plates in this row
- **AND** the coordinator SHALL log, via `scanLog()`, one diagnostic line per expected plate identifying the cycle number, scanner ID, and plate index, and stating that no completion signal was received
- **AND** the coordinator SHALL NOT emit a `scan-error` event as a result of this diagnostic (to avoid feeding a synthetic error back into wedge-detection for a scanner that may have already been correctly auto-paused)
- **AND** this diagnostic SHALL NOT fire when `this.cancelled` is `true` (the existing "Cancel during active scanOnce aborts cleanly" silent-skip behavior for a deliberate, whole-session cancel is unchanged)

#### Scenario: A row ended by per-row timeout is not double-logged by the exit diagnostic

- **GIVEN** one scanner's row promise resolves with outcome reason `timeout` (the `SCAN_ROW_TIMEOUT_MS` per-row timeout fired, which already logs via `scanLog()` and emits a `scan-error` event at the moment it fires)
- **WHEN** the verification loop processes this row's results
- **THEN** the coordinator SHALL NOT log an additional "no completion signal received" diagnostic for this row
- **AND** SHALL NOT emit a second `scan-error` event for it

#### Scenario: Graceful shutdown

- **GIVEN** the coordinator has active subprocesses
- **WHEN** `shutdown()` is called
- **THEN** the coordinator SHALL send quit commands to all subprocesses
- **AND** force-kill any subprocess that does not exit within 5 seconds
- **AND** clear the subprocess map
- **AND** if a subprocess's exit could not be confirmed even after force-kill, the coordinator SHALL log a warning identifying that scanner rather than silently treating it as freed
- **AND** a subprocess still mid-spawn (not yet `ready`) at the time of shutdown SHALL NOT have that shutdown reported as an init failure — the coordinator SHALL strip that subprocess's listeners before forcing it down, so its own in-flight spawn attempt does not surface a spurious `scanner-init-status` `error` event for a scanner that was deliberately, cleanly shut down
- **AND** any in-flight spawn-guard entry for a torn-down scanner SHALL also be cleared, so a subsequent `initialize()`/`addScanner()` call for that same scanner starts a genuinely fresh spawn attempt instead of being handed the now-orphaned, listener-stripped attempt from before this shutdown (which could otherwise only settle after its own full spawn-ready timeout)

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

### Requirement: GraviScan Scan File Listing and Directory Creation

The system SHALL provide `graviscan:list-scan-files` and
`graviscan:ensure-dir` IPC handlers, backed by pure functions in
`src/main/graviscan/image-handlers.ts`, so the renderer can browse
previously-captured scan images and pre-create a session's output
directory before a scan cycle begins.

- `listScanFiles(dirPath?: string): { success: boolean; files:
Array<{ name, path, size, modifiedAt, folder }>; error?: string }`
  - When `dirPath` is omitted, the system SHALL resolve the default scan
    output directory and recurse one level into each of its subfolders
    (each subfolder treated as an experiment/session folder).
  - When `dirPath` is given, the system SHALL list image files directly
    inside that directory only (no recursion).
  - Only files with extension `.tif`, `.tiff`, `.png`, `.jpg`, or `.jpeg`
    SHALL be included, EXCEPT that a filename starting with the `.tmp-`
    prefix (used by the scan worker's atomic-write mechanism for an
    in-progress or interrupted save) SHALL be excluded regardless of its
    extension.
  - Results SHALL be sorted by modification time, newest first.
  - If the resolved directory does not exist, the system SHALL return
    `{ success: true, files: [] }` rather than an error.
- `ensureDir(dirPath: string): Promise<{ success: boolean; path?: string;
error?: string }>`
  - SHALL create the directory recursively (`fs.promises.mkdir(dirPath,
{ recursive: true })`) and SHALL be idempotent — a call for an
    already-existing directory SHALL still report success.
  - SHALL return `{ success: false, error: 'dirPath is required' }` when
    `dirPath` is missing or not a string, without attempting to create
    anything.

Both IPC handlers SHALL confine a caller-supplied path to the scan output
directory before touching the filesystem, applying the same
`fs.realpathSync`-based containment check the existing
`graviscan:read-scan-image` handler uses — symlinks resolved on both
sides, so a symlink inside the output directory cannot be used to escape
it. `ensure-dir` calls `mkdir` recursively and `list-scan-files` calls
`readdirSync`/`statSync`, so an unvalidated path would let a caller create
directory trees, or enumerate files, anywhere the app user can reach.

- A path that resolves outside the scan output directory SHALL be rejected
  with error `Path outside scan directory`, and the underlying
  `image-handlers.ts` function SHALL NOT be called.
- Because both handlers legitimately act on a directory that does not exist
  yet (`ensure-dir` creates it; `list-scan-files` reports an empty list for
  it), containment SHALL be judged against the deepest ancestor of the path
  that does exist, with the not-yet-existing tail re-appended to the
  resolved ancestor. A contained-but-missing path SHALL therefore still be
  accepted, preserving both documented contracts.
- The validated, resolved path SHALL be the one passed downstream, not the
  caller's original string.
- When the scan output directory cannot be resolved at all, the handler
  SHALL reject with error
  `Cannot determine scan directory for path validation`.
- `graviscan:list-scan-files` invoked with no `dirPath` (base-dir mode) has
  no untrusted path to validate and SHALL delegate directly.

#### Scenario: Lists image files in a given session directory

- **GIVEN** a directory containing `scan_00.tif`, `scan_01.png`, and
  `notes.txt`
- **WHEN** `listScanFiles(dirPath)` is called with that directory
- **THEN** the result SHALL include `scan_00.tif` and `scan_01.png`
- **AND** SHALL NOT include `notes.txt`

#### Scenario: Recurses into subfolders when no dirPath is given

- **GIVEN** the default output directory contains a subfolder `exp1` with
  an image file inside it
- **WHEN** `listScanFiles()` is called with no arguments
- **THEN** the result SHALL include that image file with `folder: 'exp1'`

#### Scenario: Creates a directory recursively and is idempotent

- **GIVEN** a session directory path that does not yet exist
- **WHEN** `ensureDir(dirPath)` is called
- **THEN** the directory (and any missing parent directories) SHALL be
  created
- **AND** a second call with the same `dirPath` SHALL still return
  `{ success: true, path: dirPath }`

#### Scenario: Rejects an ensure-dir path outside the scan output directory

- **GIVEN** a resolvable scan output directory
- **WHEN** `graviscan:ensure-dir` is invoked with a path that resolves
  outside it — whether directly, via `..` traversal, or via a symlink
  inside the output directory pointing elsewhere
- **THEN** the handler SHALL return
  `{ success: false, error: 'Path outside scan directory' }`
- **AND** SHALL NOT call `ensureDir()` / `mkdir`

#### Scenario: Rejects a list-scan-files path outside the scan output directory

- **GIVEN** a resolvable scan output directory
- **WHEN** `graviscan:list-scan-files` is invoked with a `dirPath` that
  resolves outside it — whether directly, via `..` traversal, or via a
  symlink inside the output directory pointing elsewhere
- **THEN** the handler SHALL return
  `{ success: false, files: [], error: 'Path outside scan directory' }`
- **AND** SHALL NOT call `listScanFiles()` / `readdirSync`

#### Scenario: Accepts a contained path that does not exist yet

- **GIVEN** a path inside the scan output directory whose final segment does
  not exist on disk
- **WHEN** `graviscan:ensure-dir` or `graviscan:list-scan-files` is invoked
  with it
- **THEN** containment SHALL be judged against its deepest existing
  ancestor and the path SHALL be accepted
- **AND** the resolved path SHALL be passed to the underlying
  `image-handlers.ts` function

#### Scenario: Stray temporary files from an interrupted write are excluded from the listing

- **GIVEN** a `.tmp-`-prefixed file exists in a scan output directory
  (left behind by an interrupted atomic write), alongside real `.tif`
  scan output
- **WHEN** `listScanFiles()` lists that directory
- **THEN** the `.tmp-`-prefixed file SHALL NOT be included in the result
- **AND** the real `.tif` files SHALL still be included, unaffected
