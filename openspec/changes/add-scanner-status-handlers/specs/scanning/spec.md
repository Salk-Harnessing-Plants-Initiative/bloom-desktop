## ADDED Requirements

### Requirement: Coordinator Scanner Status Query API

The `ScanCoordinator` class SHALL expose a `getScannerStatuses()` method
that returns the current status of every managed scanner subprocess,
merging live subprocess state with recorded initialization failures.

- `getScannerStatuses(): Array<{ scannerId: string; status: 'ready' |
'starting' | 'error' | 'dead'; error?: string }>`
- For each entry currently in the subprocess map: `status` SHALL be
  `'ready'` if the subprocess is in the ready state, `'starting'` if it is
  alive but not yet ready, or `'dead'` otherwise.
- For each `scannerId` recorded in the internal `initErrors` map that is
  NOT currently in the subprocess map (i.e. the spawn failed and the entry
  was removed), an entry with `status: 'error'` and the recorded failure
  message SHALL be included.
- A `scannerId` present in the subprocess map SHALL NOT also produce a
  duplicate `'error'` entry from `initErrors`, even if a stale entry exists
  for that id.

`initialize()` SHALL clear the `initErrors` map at the start of the
method, before repopulating it, so a scanner that failed to initialize
once and later succeeds does not keep reporting a stale `'error'` status
forever.

#### Scenario: Reports ready and error statuses together

- **GIVEN** a `ScanCoordinator` has one scanner (`A`) that spawned
  successfully and one scanner (`B`) whose spawn failed with message
  `"SANE device not found"`
- **WHEN** `getScannerStatuses()` is called
- **THEN** the result SHALL include `{ scannerId: 'A', status: 'ready' }`
- **AND** SHALL include `{ scannerId: 'B', status: 'error', error: 'SANE
device not found' }`

#### Scenario: Stale error clears after a later successful initialize()

- **GIVEN** `initialize([A])` was called once and `A`'s spawn failed,
  so `getScannerStatuses()` reports `{ scannerId: 'A', status: 'error' }`
- **WHEN** `initialize([A])` is called again and this time `A` spawns
  successfully
- **THEN** `getScannerStatuses()` SHALL report only
  `{ scannerId: 'A', status: 'ready' }`, with no lingering `'error'` entry

#### Scenario: No subprocesses and no init errors

- **GIVEN** a freshly-constructed `ScanCoordinator` that has never been
  initialized
- **WHEN** `getScannerStatuses()` is called
- **THEN** the result SHALL be an empty array

### Requirement: GraviScan Scanner Status IPC

The system SHALL provide a `graviscan:get-scanner-status` IPC handler,
backed by `getScannerStatus(coordinator, db)` in
`src/main/graviscan/scanner-handlers.ts`, that merges live coordinator
subprocess status with saved, enabled `GraviScanner` database rows so the
renderer can show per-scanner status on page mount — including scanners
that are configured but currently disconnected.

- For each enabled `GraviScanner` row (ordered by `createdAt` ascending),
  the response SHALL include `scannerId`, `displayName` (the row's
  `display_name`, falling back to `name` when not set), `usbPort`,
  `gridMode`, `status`, and `error` (when applicable).
- `status` SHALL be the matching entry from
  `coordinator.getScannerStatuses()` when one exists for that
  `scannerId`, or `'disconnected'` when no live subprocess status exists
  for it (including when `coordinator` is `null`, e.g. before any scan has
  ever started).
- **Deviation from production**: production's equivalent handler reads
  `grid_mode` directly off the per-scanner `GraviScanner` database row.
  `main`'s `GraviScanner` Prisma model has no `grid_mode` column (it exists
  only on `GraviScan`, a per-scan record, and `GraviConfig`, a global
  singleton config row) — see `design.md` for the rationale. This handler
  SHALL instead query the `GraviConfig` singleton once per call and apply
  its `grid_mode` value uniformly to every scanner in the response,
  defaulting to `'2grid'` when no `GraviConfig` row exists yet.
- On a database error, the handler SHALL return
  `{ success: false, scanners: [], error: <message> }` rather than
  throwing.

#### Scenario: Merges live status onto saved scanner rows

- **GIVEN** an enabled `GraviScanner` row with id `s1`
- **AND** `coordinator.getScannerStatuses()` returns
  `[{ scannerId: 's1', status: 'ready' }]`
- **WHEN** `graviscan:get-scanner-status` is invoked
- **THEN** the response SHALL include a scanner entry for `s1` with
  `status: 'ready'`

#### Scenario: Reports disconnected for a saved scanner with no live subprocess

- **GIVEN** an enabled `GraviScanner` row with id `s1`
- **AND** the coordinator (or a `null` coordinator) reports no status for
  `s1`
- **WHEN** `graviscan:get-scanner-status` is invoked
- **THEN** the response SHALL include a scanner entry for `s1` with
  `status: 'disconnected'`

#### Scenario: gridMode is sourced from the GraviConfig singleton, not per-row

- **GIVEN** two enabled `GraviScanner` rows and a `GraviConfig` singleton
  row with `grid_mode: '4grid'`
- **WHEN** `graviscan:get-scanner-status` is invoked
- **THEN** every scanner entry in the response SHALL have
  `gridMode: '4grid'`
- **AND** the `GraviConfig` table SHALL be queried exactly once regardless
  of scanner count

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
    SHALL be included.
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

## MODIFIED Requirements

### Requirement: Coordinator Single-Scanner Spawn API

The `ScanCoordinator` class SHALL expose `addScanner(config)` and
`hasWorker(scannerId)` public methods.

- `addScanner(config: ScannerConfig): Promise<void>` — spawns a
  `ScannerSubprocess` for the given config and adds it to the
  subprocess map. If a worker for `config.scannerId` is already in
  the map and in `ready` state, this is a no-op. The `ScannerConfig`
  type is the existing shared type at `src/types/graviscan.ts`. When
  `isScanning === true`, the spawn request SHALL be queued internally
  and executed on the next `cycle-complete` event so that mid-scan
  event-loop traffic is not disrupted. Queued requests SHALL be
  deduplicated per `scannerId`: a mid-scan call for a `scannerId` that
  already has a queued spawn SHALL return that pending request's own
  `Promise` instead of queueing a second spawn. This prevents two
  concurrent `addScanner()` calls for the same `scannerId` from each
  constructing a subprocess within the same `cycle-complete` tick and
  racing to shut one another down mid-spawn, while still guaranteeing
  that a queued spawn actually executes. The queued request's record
  SHALL be cleared once its spawn settles, so a later call for the same
  `scannerId` is not handed an already-settled `Promise`.
  - Deduplication SHALL NOT be implemented by having the queued handler
    re-invoke the public `addScanner(config)` method: `scanOnce()` emits
    `cycle-complete` before it resets its state to `'idle'`, so
    `isScanning` is still `true` at the synchronous instant every
    listener runs, and a re-entrant call would re-queue itself
    indefinitely instead of ever spawning (see `design.md`).
- `hasWorker(scannerId: string): boolean` — returns `true` if the
  subprocess map contains a worker for that scanner_id AND the
  worker is in `ready` state. Returns `false` otherwise (missing,
  `initializing`, or `dead`).

The existing `initialize(scanners[])` method SHALL be refactored to
use `addScanner()` internally so worker spawn logic lives in one
place.

#### Scenario: addScanner spawns one worker without disturbing existing

- **GIVEN** a `ScanCoordinator` with workers in `ready` state for
  scannerIds `[A, B]`
- **WHEN** `addScanner({scannerId: 'C', ...})` is called
- **THEN** a new `ScannerSubprocess` SHALL be spawned for `C`
- **AND** workers for `A` and `B` SHALL NOT be torn down or respawned
- **AND** after the spawn settles, `hasWorker('A')`, `hasWorker('B')`,
  and `hasWorker('C')` all return `true`

#### Scenario: addScanner is idempotent for already-ready workers

- **GIVEN** a `ScanCoordinator` has a `ready` worker for scannerId `A`
- **WHEN** `addScanner({scannerId: 'A', ...})` is called
- **THEN** the existing worker SHALL be reused (no new subprocess
  spawned)
- **AND** the method SHALL resolve without error

#### Scenario: hasWorker semantics

- **GIVEN** a `ScanCoordinator` has subprocesses in different states
- **WHEN** `hasWorker(scannerId)` is queried
- **THEN** it SHALL return `true` only if the worker is in `ready`
  state
- **AND** it SHALL return `false` for `initializing`, `dead`, or
  missing workers

#### Scenario: addScanner during active scan is queued

- **GIVEN** a `ScanCoordinator` with `isScanning === true` (a cycle
  is in flight)
- **WHEN** `addScanner({scannerId: 'C', ...})` is called
- **THEN** the coordinator SHALL NOT immediately spawn a new
  subprocess
- **AND** the request SHALL be recorded in an internal per-`scannerId`
  pending-add map
- **AND** after the next `cycle-complete` event, the queued spawn
  SHALL execute and `hasWorker('C')` SHALL return `true`
- **AND** the method's returned `Promise` SHALL resolve once that spawn
  has settled

#### Scenario: Two concurrent addScanner calls for the same id spawn exactly one subprocess

- **GIVEN** a `ScanCoordinator` with `isScanning === true` (a cycle is in
  flight) and no worker yet for `scannerId` `'NEW'`
- **WHEN** `addScanner({scannerId: 'NEW', ...})` is called twice,
  concurrently, before the cycle completes
- **AND** the in-flight cycle's `cycle-complete` event then fires
- **THEN** the coordinator SHALL construct exactly one
  `ScannerSubprocess` for `'NEW'` — neither zero (a never-executed
  queued spawn) nor two
- **AND** SHALL NOT call `shutdown()` on a subprocess that is still
  mid-spawn as a side effect of the second call
- **AND** both returned `Promise`s SHALL resolve

### Requirement: GraviScan IPC Handler Registration

The system SHALL provide a `registerGraviScanHandlers` function in `src/main/graviscan/register-handlers.ts` that registers all GraviScan IPC channels via `ipcMain.handle()`, delegating to the pure handler functions in `scanner-handlers.ts`, `session-handlers.ts`, and `image-handlers.ts`.

#### Scenario: All GraviScan IPC channels registered

- **GIVEN** `registerGraviScanHandlers(ipcMain, db, getMainWindow, sessionFns, getCoordinator)` is called
- **WHEN** the function completes
- **THEN** the following 20 IPC channels SHALL be registered:
  - `graviscan:detect-scanners`
  - `graviscan:get-config`
  - `graviscan:save-config`
  - `graviscan:save-scanners-db`
  - `graviscan:disable-scanner`
  - `graviscan:platform-info`
  - `graviscan:validate-scanners`
  - `graviscan:validate-config`
  - `graviscan:reset-usb`
  - `graviscan:get-scanner-status`
  - `graviscan:start-scan`
  - `graviscan:get-scan-status`
  - `graviscan:mark-job-recorded`
  - `graviscan:cancel-scan`
  - `graviscan:get-output-dir`
  - `graviscan:read-scan-image`
  - `graviscan:upload-all-scans`
  - `graviscan:ensure-dir`
  - `graviscan:list-scan-files`
  - `graviscan:download-images`

#### Scenario: Handler delegates to correct module function

- **GIVEN** `registerGraviScanHandlers` has been called
- **WHEN** the renderer invokes any of the 20 registered `graviscan:*` IPC channels
- **THEN** the handler SHALL delegate to the corresponding handler module function with the correct arguments
- **AND** return the result to the renderer
- **AND** `graviscan:get-scanner-status`, `graviscan:ensure-dir`, and
  `graviscan:list-scan-files` SHALL return their handler function's result
  shape directly (matching production's un-nested `{ success, ... }`
  contract), the same convention already used for `graviscan:disable-scanner`
  — not wrapped in the generic `wrapHandler`'s `{ success: true, data }`
  envelope used by most other channels

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
