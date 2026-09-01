## MODIFIED Requirements

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
- **AND** if a subprocess's exit could not be confirmed even after force-kill, the coordinator SHALL log a warning identifying that scanner rather than silently treating it as freed

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

### Requirement: Coordinator Single-Scanner Spawn API

The `ScanCoordinator` class SHALL expose `addScanner(config)` and
`hasWorker(scannerId)` public methods. Both `addScanner()` and the
`initialize()` orchestration method (see "ScanCoordinator Multi-Scanner
Orchestration") spawn workers through one shared private method that
maintains a per-`scannerId` in-flight-spawn guard: while a spawn attempt
for a given `scannerId` is already in progress (from either entry point),
any other caller for that same `scannerId` SHALL await the in-flight
attempt's own outcome rather than independently inspecting subprocess
state and deciding to reuse, respawn, or shut down.

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
  - This mid-scan queueing dedup is independent of, and in addition to,
    the shared spawn-choke-point guard described above: the latter
    covers `addScanner()` racing `initialize()` (or another `addScanner()`
    call) while the coordinator is idle/initializing; the former covers
    `addScanner()` racing itself while a scan is in flight.
- `hasWorker(scannerId: string): boolean` — returns `true` if the
  subprocess map contains a worker for that scanner_id AND the
  worker is in `ready` state. Returns `false` otherwise (missing,
  `starting`, or `dead` — `starting` is the actual `ScannerSubprocess`
  state name for "spawn in progress, not yet confirmed ready").

The existing `initialize(scanners[])` method SHALL be refactored to
use `addScanner()` internally so worker spawn logic lives in one
place.

If a spawn attempt cannot confirm the subprocess became ready within a
bounded timeout, and a subsequent attempt to reclaim it cannot confirm
the process actually exited, the coordinator SHALL NOT spawn a
replacement for that `scannerId` in the same call. It SHALL instead
record the failure in `initErrors` and emit `scanner-init-status` with
`status: 'error'` for that `scannerId`, using the same plain-diagnostic
error-reporting shape already used for other spawn failures (no new
user-facing messaging surface).

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
- **AND** it SHALL return `false` for `starting`, `dead`, or
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

#### Scenario: Concurrent addScanner and initialize calls for the same id spawn exactly one subprocess

- **GIVEN** a `ScanCoordinator` with `isScanning === false` and no
  worker yet for `scannerId` `'X'`
- **WHEN** `initialize([{scannerId: 'X', ...}])` is called
- **AND**, before that call's spawn for `'X'` has settled,
  `addScanner({scannerId: 'X', ...})` is also called
- **THEN** the coordinator SHALL construct exactly one
  `ScannerSubprocess` for `'X'`
- **AND** the `addScanner()` call SHALL NOT call `shutdown()` on the
  subprocess `initialize()` is still spawning
- **AND** both `initialize()` and `addScanner()` SHALL resolve once the
  single underlying spawn attempt settles

#### Scenario: A still-connecting worker is awaited, not respawned, by a second initialize call

- **GIVEN** a `ScanCoordinator` has begun spawning a subprocess for
  `scannerId` `'Y'` (the subprocess is in `starting` state, not yet
  `ready`)
- **WHEN** a second `initialize([{scannerId: 'Y', ...}])` call is made
  before the first spawn attempt for `'Y'` has settled
- **THEN** the second call SHALL NOT call `shutdown()` on the
  still-connecting subprocess
- **AND** SHALL NOT construct a second `ScannerSubprocess` for `'Y'`
- **AND** once the in-flight spawn attempt resolves (the subprocess
  becomes `ready`), `hasWorker('Y')` SHALL return `true` and only one
  subprocess SHALL exist for `'Y'`

#### Scenario: A spawn attempt that never confirms readiness or death does not produce a duplicate

- **GIVEN** a subprocess for `scannerId` `'Z'` has been spawned and
  neither becomes `ready` nor emits `exit`/`process-error` within the
  spawn-ready timeout
- **WHEN** the coordinator's spawn attempt for `'Z'` gives up waiting
- **THEN** the coordinator SHALL attempt to shut down the unresponsive
  subprocess
- **AND** regardless of whether that shutdown attempt confirms the
  process exited, the coordinator SHALL NOT construct a replacement
  `ScannerSubprocess` for `'Z'` within the same spawn attempt
- **AND** the coordinator SHALL record an entry in `initErrors` for
  `'Z'` and emit `scanner-init-status` with `status: 'error'`
- **AND** `hasWorker('Z')` SHALL return `false`

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
- **AND** if the process exits within `timeoutMs`, `shutdown()` SHALL resolve `true`
- **AND** if the process does not exit within `timeoutMs`, the subprocess SHALL be force-killed with SIGKILL
- **AND** after force-killing, `shutdown()` SHALL wait a further bounded confirmation window for the process's actual `exit` event
- **AND** if that `exit` event is observed within the confirmation window, `shutdown()` SHALL resolve `true`
- **AND** if the `exit` event is NOT observed within the confirmation window, `shutdown()` SHALL resolve `false` rather than assuming the process exited

#### Scenario: Shutdown of an already-dead or never-started subprocess

- **GIVEN** a `ScannerSubprocess` whose state is `dead` or `idle` (never spawned, or already confirmed exited)
- **WHEN** `shutdown(timeoutMs)` is called
- **THEN** `shutdown()` SHALL resolve `true` immediately without sending a quit command or starting any timers

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
