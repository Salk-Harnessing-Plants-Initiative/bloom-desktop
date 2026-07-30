## ADDED Requirements

### Requirement: GraviScan Database Handlers — graviscans.*

The system SHALL provide `database.graviscans.*` IPC handlers in `src/main/database-handlers.ts` (`create`, `getMaxWaveNumber`, `checkBarcodeUniqueInWave`, `updateGridTimestamps`, `browseByExperiment`, `experimentDetail`), following the existing `db:{model}:{action}` naming convention and `DatabaseResponse` return shape used by every other handler in that file. Every handler that accepts an `experiment_id` (directly or via an id that resolves to one) SHALL scope its query or write to that `experiment_id` — no handler SHALL read or write `GraviScan` rows belonging to a different experiment than the one identified in its arguments, except `browseByExperiment`, which is deliberately cross-experiment by design (a listing view). A future caller (Tier 4/5) writing `GraviScan.resolution` from a completed scan MUST source it from that scan's `achieved_resolution` (the field added by the "GraviScan Scan-Worker Achieved-Resolution Readback" requirement below, threaded through the `scan-complete` event payload) rather than the pre-scan requested value `create` persisted — otherwise the #232 fix never reaches the queryable database record.

#### Scenario: create validates id fields are strings

- **GIVEN** `graviscans.create` is called with a payload where `experiment_id` is a number or object instead of a string
- **WHEN** the handler processes the request
- **THEN** the handler SHALL reject the request (return `{success: false}` or throw a caught, descriptive error) rather than passing the malformed value through to Prisma
- **AND** no `GraviScan` row SHALL be created

#### Scenario: getMaxWaveNumber is scoped per experiment

- **GIVEN** two experiments, A and B, where B has a `GraviScan` row with a higher `wave_number` than any row in A
- **WHEN** `graviscans.getMaxWaveNumber(A.id)` is called
- **THEN** the result SHALL reflect only experiment A's rows
- **AND** SHALL be `-1` if experiment A has zero non-deleted `GraviScan` rows

#### Scenario: checkBarcodeUniqueInWave is case-insensitive and wave/experiment scoped

- **GIVEN** a `GraviScan` row in experiment A, wave 2, with `plate_barcode = "ABC123"`
- **WHEN** `checkBarcodeUniqueInWave({experiment_id: A.id, wave_number: 2, plate_barcode: "abc123"})` is called
- **THEN** the result SHALL report `isDuplicate: true`
- **AND** the same check against experiment B (a different experiment) or wave 3 of experiment A SHALL report `isDuplicate: false`
- **AND** rows with `deleted: true` SHALL be excluded from the comparison

#### Scenario: updateGridTimestamps only updates rows in the given experiment

- **GIVEN** a set of `GraviScan` ids where one id belongs to a different experiment than the `experiment_id` argument
- **WHEN** `updateGridTimestamps({experiment_id, ids, scan_started_at, scan_ended_at})` is called
- **THEN** only the rows whose `experiment_id` matches the argument SHALL be updated
- **AND** the returned count SHALL reflect only the rows actually updated, not `ids.length`

#### Scenario: browseByExperiment paginates and filters across experiments

- **GIVEN** multiple experiments with non-deleted `GraviScan` rows
- **WHEN** `browseByExperiment({offset, limit, filters})` is called
- **THEN** the result SHALL return at most `limit` experiments starting at `offset`, each including its non-deleted scans
- **AND** each experiment entry SHALL include `hasNeedsReview: true` when any of its plate assignments has `verification_status === 'needs_review'`
- **AND** `dateFrom`/`dateTo` SHALL each filter on non-deleted `GraviScan.capture_date` values and SHALL both be inclusive: `dateFrom` as `capture_date >= dateFrom`, `dateTo` as `capture_date <= dateTo` with `dateTo`'s time advanced to 23:59:59.999 of that calendar day (so scans captured anywhere in that day are included, not just up to midnight)
- **AND** `experimentName` SHALL match by substring against `Experiment.name` (not exact-match)
- **AND** `accession` SHALL match by substring against the linked `Accessions.name` (via `Experiment.accession`) — not by `Accessions.id`
- **AND** `uploadStatus` SHALL be evaluated per experiment over the aggregated `GraviImage.status` values across all of that experiment's non-deleted scans: an experiment with zero images SHALL match only `uploadStatus: 'pending'`; `'uploaded'` SHALL require every image's `status` to be `'uploaded'`; `'failed'` SHALL require at least one image's `status` to be `'failed'`; `'pending'` SHALL require every image's `status` to be `'pending'`; any other `uploadStatus` value SHALL pass every experiment through unfiltered

#### Scenario: experimentDetail never leaks another experiment's data

- **GIVEN** two experiments sharing the same `GraviScanner`
- **WHEN** `experimentDetail(experimentId)` is called for one of them
- **THEN** the returned `scans` and `verificationStatusMap` SHALL include only rows belonging to the requested experiment
- **AND** SHALL return an error result (not throw) when `experimentId` does not exist

### Requirement: GraviScan Database Handlers — graviscanSessions.*

The system SHALL provide `database.graviscanSessions.*` IPC handlers (`create`, `complete`) in `src/main/database-handlers.ts`, following the existing convention.

#### Scenario: create persists a new session with defaults

- **GIVEN** `graviscanSessions.create` is called with only the required fields (`experiment_id`, `phenotyper_id`, `scan_mode`)
- **WHEN** the handler processes the request
- **THEN** a `GraviScanSession` row SHALL be created with `interval_seconds`, `duration_seconds`, and `total_cycles` set to `null`

#### Scenario: complete marks a session finished

- **GIVEN** an existing `GraviScanSession` row
- **WHEN** `graviscanSessions.complete({session_id, cancelled})` is called
- **THEN** the row's `completed_at` SHALL be set to the current time
- **AND** `cancelled` SHALL be set to the passed value, defaulting to `false` when omitted

#### Scenario: complete on a nonexistent session fails cleanly

- **GIVEN** a `session_id` that does not correspond to any `GraviScanSession` row
- **WHEN** `graviscanSessions.complete({session_id})` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** SHALL NOT throw an unhandled error across the IPC boundary

### Requirement: GraviScan Database Handlers — graviscanPlateAssignments.*

The system SHALL provide `database.graviscanPlateAssignments.*` IPC handlers (`list`, `upsertMany`) in `src/main/database-handlers.ts`, following the existing convention. `upsertMany` SHALL perform all writes inside a single `db.$transaction` so a partial failure leaves no partial state.

#### Scenario: list is scoped to experiment and scanner together

- **GIVEN** a `GraviScanner` shared across two experiments, each with its own `GraviScanPlateAssignment` rows for that scanner
- **WHEN** `list(experimentId, scannerId)` is called for one experiment
- **THEN** only that experiment's assignments for the given scanner SHALL be returned, ordered by `plate_index`

#### Scenario: upsertMany validates id fields are strings

- **GIVEN** `upsertMany` is called with `experimentId` or `scannerId` that is not a string
- **WHEN** the handler processes the request
- **THEN** the handler SHALL reject the request rather than passing the malformed value through to Prisma

#### Scenario: upsertMany is atomic

- **GIVEN** a batch of assignments where one entry would violate a database constraint
- **WHEN** `upsertMany(experimentId, scannerId, assignments)` is called
- **THEN** none of the batch's rows SHALL be persisted (the whole transaction rolls back)
- **AND** the handler SHALL return `{success: false, error: <message>}`

### Requirement: GraviScan Database Handlers — graviPlateAccessions.*

The system SHALL provide `database.graviPlateAccessions.*` IPC handlers (`createWithSections`, `list`, `listFiles`, `delete`) in `src/main/database-handlers.ts`, following the existing convention. `createWithSections` and `delete` SHALL perform all writes inside a single `db.$transaction`. `listFiles` accepts no filesystem path argument — it queries `Accessions` rows with linked `GraviPlateAccession` children, not a directory listing.

#### Scenario: createWithSections is atomic across the whole batch

- **GIVEN** a `plates` array where one plate's sections would violate the `(gravi_plate_id, plant_qr)` uniqueness constraint
- **WHEN** `createWithSections(accessionData, plates)` is called
- **THEN** no `Accessions`, `GraviPlateAccession`, or `GraviPlateSectionMapping` row from the batch SHALL be persisted
- **AND** the handler SHALL return `{success: false, error: <message>}`

#### Scenario: list returns natural-sorted plates and sections

- **GIVEN** a metadata file with plates named `"P2"` and `"P10"`
- **WHEN** `list(metadataFileId)` is called
- **THEN** `"P2"` SHALL sort before `"P10"` (natural order, not lexicographic)
- **AND** each plate's `sections` SHALL be sorted the same way by `plate_section_id`

#### Scenario: listFiles takes no path and lists linked accession files only

- **GIVEN** a mix of `Accessions` rows, some with linked `GraviPlateAccession` children and some without
- **WHEN** `listFiles()` is called with no arguments
- **THEN** only the rows with at least one linked `GraviPlateAccession` SHALL be returned, each annotated with linked experiment names and a plate count

#### Scenario: delete is blocked while linked to an experiment

- **GIVEN** a metadata file (`Accessions` row) referenced by `Experiment.accession_id` on at least one experiment
- **WHEN** `delete(metadataFileId)` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}` and delete nothing

#### Scenario: delete cascades its own children when unlinked

- **GIVEN** an unlinked metadata file with `GraviPlateAccession` and `GraviPlateSectionMapping` children
- **WHEN** `delete(metadataFileId)` is called
- **THEN** the `Accessions` row and all of its `GraviPlateAccession`/`GraviPlateSectionMapping` children SHALL be deleted
- **AND** no orphaned section rows SHALL remain

### Requirement: GraviScan Scan-Worker Achieved-Resolution Readback

The `python/graviscan/scan_worker.py` worker SHALL read back the SANE device's actual `x_resolution`/`y_resolution` after setting them and before scanning, log a warning when the achieved value differs from the requested value, and include the achieved value as `achieved_resolution` in both the TIFF metadata and the emitted `scan-complete` event payload.

#### Scenario: achieved resolution matches request

- **GIVEN** the SANE device accepts the requested resolution exactly
- **WHEN** a scan completes
- **THEN** the `scan-complete` event payload SHALL include `achieved_resolution` equal to the requested value
- **AND** no warning SHALL be logged

#### Scenario: achieved resolution differs from request

- **GIVEN** the SANE device reports a different `x_resolution`/`y_resolution` than requested after being set
- **WHEN** a scan completes
- **THEN** a warning SHALL be logged including both the requested and achieved values
- **AND** the `scan-complete` event payload's `achieved_resolution` SHALL reflect the device-reported value, not the requested value
- **AND** the TIFF's embedded resolution metadata SHALL reflect the achieved value

## MODIFIED Requirements

### Requirement: ScanCoordinator Multi-Scanner Orchestration

The system SHALL provide a `ScanCoordinator` class in `src/main/graviscan/scan-coordinator.ts` that orchestrates multiple `ScannerSubprocess` instances for parallel scanning, with staggered initialization, grid-based scan sequencing, interval/continuous mode timing, and graceful shutdown. The USB stagger delay SHALL be defined as a named module-level constant `USB_STAGGER_DELAY_MS = 5000`. File verification in `handleScanComplete()` SHALL use asynchronous filesystem operations (`fs.promises`) instead of synchronous calls to avoid blocking the Electron main process event loop during scan completion. Critical events (`grid-complete` with file paths) SHALL be logged via `scanLog()` for scientific traceability. Per-job scan events SHALL be emitted on three granular channels — `scan-started`, `scan-complete`, `scan-error` — each carrying `jobId` (`` `${scannerId}:${plateIndex}` `` when a single plate applies, or `scannerId` alone for a whole-row failure with no single plate), `scannerId`, and `plateIndex` in addition to that event's existing fields. The generic `scan-event` channel (an embedded `type` field distinguishing these three cases) SHALL NOT be emitted. **Note on the bare-`scannerId` `jobId` shape**: it is a novel third shape relative to the per-plate `` `${scannerId}:${plateIndex}` `` shape used everywhere else, including `session-handlers.ts`'s existing `session.jobs` map — there is no existing single-key lookup pattern for it. A future consumer (e.g. a Tier 3/4 UI) that needs to mark every plate on a row as affected by a whole-row failure will have to enumerate all `` `${scannerId}:*` `` job-map entries for that scanner rather than perform a single key lookup. This is stated explicitly so a future implementer designs for it deliberately rather than discovering it during implementation.

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
- **WHEN** the coordinator emits `scan-started`, `scan-complete`, `scan-error`, `grid-start`, `grid-complete`, `cycle-complete`, `interval-start`, `interval-waiting`, `interval-complete`, `overtime`, `cancelled`, or `scanner-init-status`
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
- **AND** the following 13 event listener methods SHALL be available: `onScanStarted`, `onScanComplete`, `onGridStart`, `onGridComplete`, `onCycleComplete`, `onIntervalStart`, `onIntervalWaiting`, `onIntervalComplete`, `onOvertime`, `onCancelled`, `onScanError`, `onUploadProgress`, `onDownloadProgress`
- **AND** `onScanEvent` SHALL NOT be present

#### Scenario: Granular event listener registration

- **GIVEN** the preload script has run
- **WHEN** renderer code calls `window.electron.gravi.onScanStarted(callback)`, `onScanComplete(callback)`, or `onScanError(callback)`
- **THEN** each SHALL register a listener for its correspondingly-named channel (`graviscan:scan-started`, `graviscan:scan-complete`, `graviscan:scan-error`) via `ipcRenderer.on()`
- **AND** the callback SHALL be invoked when the main process sends the matching message, with a payload including `jobId`, `scannerId`, and `plateIndex`

#### Scenario: Event listener cleanup

- **GIVEN** renderer code has registered an event listener via `window.electron.gravi.onScanStarted(callback)` (or `onScanComplete`/`onScanError`)
- **AND** the call returned a cleanup function
- **WHEN** the cleanup function is called
- **THEN** the listener SHALL be removed via `ipcRenderer.removeListener()`
- **AND** subsequent messages on that channel SHALL NOT invoke the callback
