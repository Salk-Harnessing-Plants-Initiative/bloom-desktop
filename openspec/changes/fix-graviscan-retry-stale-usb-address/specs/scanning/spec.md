# scanning — spec deltas

## ADDED Requirements

### Requirement: Scanner USB Port Matching

The system SHALL provide one pure function that, given a list of detected scanners and a saved
scanner row, returns the detected scanner whose `usb_port` exactly equals the row's `usb_port`,
or nothing when no such scanner exists. This function SHALL be the single implementation used by
`refreshScannerUsbAddress()` and by `resetUsb()`'s per-scanner loop, so those two paths cannot
diverge in how they identify a row's device.

A port value SHALL be considered unusable when it is `null` or the empty string, and an unusable
value SHALL match nothing — including another unusable value.

The function SHALL NOT mutate the detected-scanner list or its elements, and SHALL NOT read or
write the database.

This requirement governs only that pure function. It does not govern `matchDetectedToDb()`,
which carries a documented bus/device fallback, mutates its input by contract, and is specified
by the requirement "Scanner Identity Matching Precedence".

Where more than one detected scanner reports the same `usb_port`, the function SHALL return the
first such entry in list order, deterministically. Real detection deduplicates by port before
returning, so this arises only from synthesised mock-mode lists.

#### Scenario: A saved row matches the detected scanner occupying its port

- **GIVEN** a detected scanner with `usb_port: '1-2.3'`
- **AND** a saved row with `usb_port: '1-2.3'`
- **WHEN** the two are matched
- **THEN** the detected scanner SHALL be returned as the match

#### Scenario: A null port never matches

- **GIVEN** a detected list containing a scanner with `usb_port: '1-2.3'`
- **WHEN** a saved row with `usb_port: null` is matched against it
- **THEN** no match SHALL be returned

#### Scenario: An empty-string port never matches, including another empty-string port

- **GIVEN** a detected list containing a scanner with `usb_port: ''`
- **WHEN** a saved row with `usb_port: ''` is matched against it
- **THEN** no match SHALL be returned

#### Scenario: Duplicate detected ports resolve to the first in list order

- **GIVEN** a detected list containing two scanners both reporting `usb_port: '1-2'`
- **WHEN** a saved row with `usb_port: '1-2'` is matched against it
- **THEN** the first of the two SHALL be returned
- **AND** the result SHALL NOT depend on iteration order of any intermediate map

#### Scenario: Matching does not mutate its input

- **GIVEN** a detected list of two scanners
- **WHEN** matching is performed against any saved row
- **THEN** the detected list and its elements SHALL be unchanged

### Requirement: Scanner USB Address Refresh

The system SHALL re-resolve a single saved scanner's current USB address from live detection
before that address is used to build a SANE device name, so that no caller depends on
`usb_bus`/`usb_device` values persisted by an earlier operation.

Refresh SHALL resolve the scanner's live address by matching on `usb_port` (see "Scanner USB
Port Matching"), persist `usb_bus`/`usb_device` when they differ from the stored values, and
report exactly one of: `refreshed`, `not-detected`, `no-stable-port`, `unusable-address`,
`row-missing`, or `detection-failed`.

Each status SHALL be distinct in meaning, because each maps to a different operator-facing
message:

- `refreshed` — a live address was resolved. The outcome SHALL carry the resolved `usbBus`, the
  resolved `usbDevice`, and a `changed` flag.
- `not-detected` — the row has a usable `usb_port` but no device occupies it. The outcome SHALL
  carry that `usbPort`.
- `no-stable-port` — the row's `usb_port` is unusable, so the scanner cannot be re-identified.
- `unusable-address` — a device was resolved, or mock mode short-circuited, but the resulting
  `usb_bus`/`usb_device` is not a pair of integers. This SHALL NOT be reported as
  `no-stable-port`, which asserts something false about the row's port.
- `row-missing` — no row exists for the given scanner id.
- `detection-failed` — detection itself failed.

Refresh SHALL NOT construct SANE device names. Callers SHALL build the name from the reported
address using the shared name builder, so that a resolved address and a stored address cannot be
formatted by two different code paths.

Refresh SHALL write only `usb_bus` and `usb_device`. It SHALL NOT write `usb_port`, `name`,
`display_name` or `enabled`, so that refresh cannot become a second path that rewrites scanner
identity.

Refresh SHALL NOT block the Electron main-process event loop: detection SHALL be performed
through a non-blocking interface. Refresh runs while a scan session is active, where a
synchronous stall would delay the coordinator's cycle timers and per-row timeouts.

Refresh SHALL attempt detection at most three times per call, with a short backoff between
attempts, and SHALL report `detection-failed` only after the final attempt fails. Detection can
fail transiently under the USB-bus contention a wedged device creates, and the scanner itself
may be healthy in that case.

The system SHALL NOT perform a device-level USB reset as part of refresh.

#### Scenario: Refresh updates a scanner whose device number changed

- **GIVEN** a `GraviScanner` row for `sc-1` with `usb_port: '1-2.3'`, `usb_bus: 1`, `usb_device: 7`
- **AND** detection reports an Epson scanner at `usb_port: '1-2.3'` with `usb_bus: 1, usb_device: 8`
- **WHEN** the scanner's USB address is refreshed
- **THEN** the row SHALL be updated with `usb_bus: 1, usb_device: 8`
- **AND** the update payload SHALL contain only `usb_bus` and `usb_device`
- **AND** the outcome SHALL be `{ status: 'refreshed', usbBus: 1, usbDevice: 8, changed: true }`

#### Scenario: Refresh performs no write when the address is unchanged

- **GIVEN** a `GraviScanner` row for `sc-1` with `usb_port: '1-2.3'`, `usb_bus: 1`, `usb_device: 8`
- **AND** detection reports that scanner still at `usb_bus: 1, usb_device: 8`
- **WHEN** the scanner's USB address is refreshed
- **THEN** the outcome SHALL be `{ status: 'refreshed', usbBus: 1, usbDevice: 8, changed: false }`
- **AND** no database update SHALL be performed

#### Scenario: Refresh recovers an address the database does not hold at all

- **GIVEN** a `GraviScanner` row for `sc-1` with `usb_port: '1-2.3'` and `usb_bus: null, usb_device: null`
- **AND** detection reports that scanner at `usb_bus: 1, usb_device: 9`
- **WHEN** the scanner's USB address is refreshed
- **THEN** the row SHALL be updated with `usb_bus: 1, usb_device: 9`
- **AND** the outcome SHALL be `{ status: 'refreshed', usbBus: 1, usbDevice: 9, changed: true }`

#### Scenario: Refresh reports not-detected when no device occupies the saved port

- **GIVEN** a `GraviScanner` row for `sc-1` with `usb_port: '1-2.3'`
- **AND** detection succeeds but reports no scanner at `usb_port: '1-2.3'`
- **WHEN** the scanner's USB address is refreshed
- **THEN** the outcome SHALL be `{ status: 'not-detected', usbPort: '1-2.3' }`
- **AND** no database update SHALL be performed

#### Scenario: Refresh reports no-stable-port when the row has no usable usb_port

- **GIVEN** a `GraviScanner` row for `sc-1` whose `usb_port` is `null` or the empty string
- **WHEN** the scanner's USB address is refreshed
- **THEN** the outcome SHALL be `{ status: 'no-stable-port' }`
- **AND** the stored `usb_bus`/`usb_device` SHALL NOT be used as a substitute match
- **AND** no database update SHALL be performed

#### Scenario: Refresh reports row-missing distinctly from not-detected

- **GIVEN** no `GraviScanner` row exists for `sc-1`
- **WHEN** the scanner's USB address is refreshed
- **THEN** the outcome SHALL be `{ status: 'row-missing' }`
- **AND** detection SHALL NOT be attempted

#### Scenario: Refresh retries a transient detection failure before giving up

- **GIVEN** a `GraviScanner` row for `sc-1` with a populated `usb_port`
- **AND** detection fails on its first attempt and succeeds on its second
- **WHEN** the scanner's USB address is refreshed
- **THEN** the outcome SHALL be `refreshed`
- **AND** detection SHALL have been attempted exactly twice

#### Scenario: Refresh surfaces a detection failure after exhausting its attempts

- **GIVEN** a `GraviScanner` row for `sc-1` with a populated `usb_port`
- **AND** every detection attempt returns a failure carrying the message `'lsusb not available'`
- **WHEN** the scanner's USB address is refreshed
- **THEN** detection SHALL have been attempted three times
- **AND** the outcome SHALL be `{ status: 'detection-failed', error: 'lsusb not available' }`
- **AND** no database update SHALL be performed

#### Scenario: Refresh short-circuits in mock mode without calling detection

- **GIVEN** the environment variable `GRAVISCAN_MOCK` is set to `'true'`
- **AND** a `GraviScanner` row for `sc-1` with `usb_bus: 1, usb_device: 2`
- **WHEN** the scanner's USB address is refreshed
- **THEN** detection SHALL NOT be attempted
- **AND** the outcome SHALL be `{ status: 'refreshed', usbBus: 1, usbDevice: 2, changed: false }`
- **AND** no database update SHALL be performed

#### Scenario: Refresh reports unusable-address rather than a non-integer address

- **GIVEN** the environment variable `GRAVISCAN_MOCK` is set to `'true'`
- **AND** a `GraviScanner` row for `sc-1` with `usb_bus: null, usb_device: null` (the state a
  `reset-usb` leaves behind between clearing and repopulating the columns)
- **WHEN** the scanner's USB address is refreshed
- **THEN** the outcome SHALL be `{ status: 'unusable-address' }`
- **AND** it SHALL NOT be `no-stable-port`, which would assert falsely that the row has no port
- **AND** no address SHALL be reported that a caller could format into a SANE device name

#### Scenario: Refresh performs detection through a non-blocking interface

- **GIVEN** a refresh whose detection has been invoked and has not yet settled
- **WHEN** a task scheduled on the event loop before the refresh began becomes runnable
- **THEN** that task SHALL run while detection is still outstanding

### Requirement: Scanner Address Resolution at Spawn Time

The system SHALL resolve a scanner's SANE device name at the moment a worker is spawned, for
every spawn whose device name would otherwise have been captured before the spawn occurred.

This is required because a mid-scan `addScanner()` is queued until the next `cycle-complete`,
which can be a full scan interval later, while the USB device number a SANE device name encodes
is reassigned by the operating system on every reconnect.

The following spawn paths SHALL attach a resolver:

- the wedge-recovery retry path, whose whole purpose is to respawn after a power-cycle that has
  re-enumerated the device;
- the session-start path, whose device names come from a detection snapshot taken once when the
  scan page was mounted and which can therefore be arbitrarily old by the time the operator
  starts a scan.

The following spawn paths deliberately do not attach a resolver, and SHALL be documented as
such rather than left ambiguous: `resetUsb()`'s re-initialisation, which performs its own fresh
detection immediately beforehand, and the save-scanners spawn-on-discovery path, whose names
come from a detection pass in the same operation.

Resolution SHALL be logged whenever it changes the name, and whenever it fails and falls back —
see "Coordinator Single-Scanner Spawn API". A silent fallback would reproduce the exact defect
this requirement exists to remove, while the operator has already been told the retry succeeded.

#### Scenario: A session started from a stale detection snapshot spawns on live addresses

- **GIVEN** the scan page was mounted while a scanner was at `usb_device: 7`
- **AND** the device has since re-enumerated at `usb_device: 8`
- **AND** the operator now starts a scan session
- **THEN** the worker for that scanner SHALL be spawned with `epkowa:interpreter:001:008`
- **AND** it SHALL NOT be spawned with the snapshot's `epkowa:interpreter:001:007`

#### Scenario: Paths that perform their own fresh detection do not resolve again

- **GIVEN** `resetUsb()` has just completed a detection pass and is re-initialising the coordinator
- **WHEN** its scanner configurations are spawned
- **THEN** no additional per-scanner resolution SHALL be performed

## MODIFIED Requirements

### Requirement: GraviScan Retry-Scanner Action

The system SHALL provide a `graviscan:retry-scanner` IPC handler that, given a `scannerId`,
**re-resolves that scanner's current USB address from live detection**, then stops that
scanner's worker (`stopScanner`, a no-op if already stopped by auto-pause) and respawns it
(`addScanner`) using a `saneName` built from the **refreshed** `usb_bus`/`usb_device`.

The refresh SHALL be performed as described in "Scanner USB Address Refresh". A fresh
*database* read is NOT sufficient: `usb_bus`/`usb_device` are written only by `resetUsb()` and
`upsertScannerRow()`, neither of which is on the retry path, and a physical power-cycle — the
precondition the operator has just satisfied — always re-enumerates the device at a new number.
The handler SHALL NOT reuse a refresh result obtained during an earlier retry, and SHALL NOT
use a value cached from session start.

The handler SHALL also attach a spawn-time resolver, per "Scanner Address Resolution at Spawn
Time", because a mid-scan respawn is queued until the next cycle boundary and the address
resolved when the operator clicked Retry can be stale by the time the worker is spawned.

The refresh SHALL run **before** `stopScanner()`, so that a scanner which cannot be re-resolved
is left running rather than stopped and unrecoverable. The handler SHALL NOT call `stopScanner`
unless the refresh succeeded.

The action SHALL require an active scan session and a live coordinator. The handler SHALL fail
without calling `addScanner` when the scanner row cannot be found, when the row's `enabled`
field is `false`, or when the refresh outcome is any status other than `refreshed`. It SHALL
NOT fall back to the stored `usb_bus`/`usb_device`, which after a power-cycle is known to be
stale.

Each failure SHALL carry an operator-actionable message. Those messages SHALL identify the
scanner in terms an operator can act on, preferring `display_name`, then `usb_port`, and using
the `scanner_id` only when neither is recorded. `display_name` is nullable and is null on real
installations; the `name` column holds the USB model string (`'Perfection V600 Photo'`), which
is identical across every scanner on a multi-scanner rig and so SHALL NOT be used to
distinguish one. A bare `scanner_id` SHALL NOT be the only identifier in an operator-facing
message where a `usb_port` is available, because the port corresponds to a physical, labellable
location and the identifier does not.

No failure message SHALL direct the operator to run scanner detection while a scan session is
active. Scanner detection disables every saved scanner not present in the current detection
set, which for a wedged scanner that is powered off — the most likely reason a retry fails —
would remove it from the run permanently.

A null `usb_bus`/`usb_device` SHALL NOT by itself fail the retry: when the row carries a usable
`usb_port`, refresh SHALL recover the address and the retry SHALL proceed.

After `addScanner` resolves, the handler SHALL check `coordinator.getScannerStatuses()` for the
retried `scannerId` and SHALL resolve `{ success: false, error }` if that scanner is not
reported with status `'ready'` — `addScanner`/`spawnSingleScanner` do not throw on spawn
failure, so a resolved promise alone does not indicate the worker came online. The handler
SHALL write a durable log entry (via `scanLog()`) recording the retry attempt and its outcome,
including the silent-failure case. That entry SHALL identify the scanner and its `usb_port`,
SHALL record the session identifier, and for a changed address SHALL record both the previous
and the newly resolved `usb_bus`/`usb_device`, so a later reader can reconstruct what the
address was before the refresh rather than only what it became.

A concurrent retry for the same `scannerId` SHALL be rejected while a prior retry for that
`scannerId` is still in flight.

#### Scenario: Retry respawns the worker with a fresh saneName

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_bus: 1, usb_device: 7, usb_port: '1-2.3', enabled: true`
- **AND** the scanner has since been power-cycled and live detection reports it at `usb_bus: 1, usb_device: 8` on `usb_port: '1-2.3'`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the row SHALL be updated to `usb_bus: 1, usb_device: 8` before the respawn
- **AND** `coordinator.stopScanner('sc-1')` SHALL be called
- **AND** `coordinator.addScanner` SHALL be called with `saneName: 'epkowa:interpreter:001:008'`
- **AND** `coordinator.addScanner` SHALL NOT be called with the stale `'epkowa:interpreter:001:007'`
- **AND** `coordinator.getScannerStatuses()` SHALL be checked for `sc-1`
- **AND**, given that status is `'ready'`, the handler SHALL resolve `{ success: true }`
- **AND** a log entry recording the successful retry, the previous address and the refreshed address SHALL be written

#### Scenario: Retry succeeds unchanged when the address did not move

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_bus: 3, usb_device: 7, usb_port: '3-1', enabled: true`
- **AND** live detection reports that scanner still at `usb_bus: 3, usb_device: 7`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** `coordinator.addScanner` SHALL be called with `saneName: 'epkowa:interpreter:003:007'`
- **AND** no database update SHALL be performed
- **AND** the handler SHALL resolve `{ success: true }` when the status is `'ready'`

#### Scenario: Retry fails without respawning when USB identity is unknown

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_port: null` (or `''`) and `enabled: true`,
  so the scanner cannot be re-identified from live detection
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error }` stating that no stable USB port
  is recorded for the scanner and that it cannot be recovered during this session
- **AND** `error` SHALL NOT instruct the operator to run scanner detection while the session is active
- **AND** the stored `usb_bus`/`usb_device` SHALL NOT be used to build a `saneName`
- **AND** neither `coordinator.stopScanner` nor `coordinator.addScanner` SHALL be called

#### Scenario: Retry recovers when the database holds no USB address but the port is known

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_bus: null, usb_device: null, usb_port: '1-2.3', enabled: true`
- **AND** live detection reports that scanner at `usb_bus: 1, usb_device: 9`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the retry SHALL proceed rather than failing on the null columns
- **AND** `coordinator.addScanner` SHALL be called with `saneName: 'epkowa:interpreter:001:009'`

#### Scenario: Retry fails without respawning when the scanner is not detected

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_port: '1-2.3', display_name: 'Bench 3', enabled: true`
- **AND** live detection succeeds but reports no scanner on `usb_port: '1-2.3'` (the operator
  clicked Retry before reconnecting or powering the scanner back on)
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error }` where `error` names `'Bench 3'`
  and `'1-2.3'` and states that no scanner was detected at that port
- **AND** `error` SHALL NOT instruct the operator to run scanner detection
- **AND** neither `coordinator.stopScanner` nor `coordinator.addScanner` SHALL be called
- **AND** a log entry recording the failed retry SHALL be written

#### Scenario: A scanner with no display_name is identified by its port, not its identifier

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `display_name: null`,
  `name: 'Perfection V600 Photo'` and `usb_port: '1-8'` (the state of a real installation, where
  `display_name` is unset and `name` is the USB model string shared by every scanner on the rig)
- **AND** live detection reports no scanner on `usb_port: '1-8'`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the error message SHALL name `'1-8'`
- **AND** it SHALL NOT identify the scanner solely by its `scanner_id`
- **AND** it SHALL NOT rely on `name` to distinguish the scanner

#### Scenario: Retry fails without respawning when USB detection itself fails

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_port: '1-2.3', enabled: true`
- **AND** every USB detection attempt fails
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error }` surfacing the detection error
- **AND** neither `coordinator.stopScanner` nor `coordinator.addScanner` SHALL be called

#### Scenario: Retry fails without respawning on an unusable resolved address

- **GIVEN** an active scan session with a running coordinator
- **AND** refreshing `sc-1` reports `unusable-address`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error }`
- **AND** no `saneName` SHALL be constructed from the unusable address
- **AND** neither `coordinator.stopScanner` nor `coordinator.addScanner` SHALL be called

#### Scenario: Retry in mock mode respawns without USB detection

- **GIVEN** the environment variable `GRAVISCAN_MOCK` is set to `'true'`
- **AND** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_bus: 1, usb_device: 2, enabled: true`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** USB detection SHALL NOT be invoked
- **AND** `coordinator.addScanner` SHALL be called with `saneName: 'epkowa:interpreter:001:002'`

#### Scenario: Retry fails without respawning a disabled scanner

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `enabled: false` (the operator disabled it via ConfigureScanner's "Remove" action)
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error: '...' }`
- **AND** `coordinator.addScanner` SHALL NOT be called
- **AND** USB detection SHALL NOT be invoked

#### Scenario: Retry fails when the scanner row cannot be found

- **GIVEN** an active scan session with a running coordinator
- **AND** no `GraviScanner` row exists for `sc-1`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error: '...' }`
- **AND** the message SHALL state that the scanner was not found, and SHALL NOT refer to a USB port
- **AND** neither `coordinator.stopScanner` nor `coordinator.addScanner` SHALL be called
- **AND** USB detection SHALL NOT be invoked

#### Scenario: Retry fails cleanly with no active session or no coordinator

- **GIVEN** either no active scan session (or a session with `isActive: false`), or no live coordinator
- **WHEN** `graviscan:retry-scanner` is invoked with any `scannerId`
- **THEN** the handler SHALL resolve `{ success: false, error: '...' }` without throwing
- **AND** the database SHALL NOT be queried and `coordinator.addScanner` SHALL NOT be called
- **AND** USB detection SHALL NOT be invoked

#### Scenario: A rejected respawn is caught and surfaced, not left unhandled

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` refreshes to a valid address with `enabled: true`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **AND** `coordinator.addScanner()` rejects
- **THEN** the handler SHALL resolve `{ success: false, error: msg }` (the rejection SHALL be caught, not left as an unhandled promise rejection)
- **AND** a log entry recording the failed retry SHALL be written

#### Scenario: Retry reports failure when the respawned worker silently fails to come online

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` refreshes to a valid address with `enabled: true`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **AND** `coordinator.addScanner()` resolves without throwing
- **AND** `coordinator.getScannerStatuses()` reports `sc-1` with status `'error'` or `'dead'`, or does not include `sc-1` at all
- **THEN** the handler SHALL resolve `{ success: false, error }`, where `error` is the status's recorded `error` message when present, or a message stating the scanner did not come online
- **AND** a log entry recording the failed retry SHALL be written

#### Scenario: A concurrent retry for the same scanner is rejected

- **GIVEN** an active scan session with a running coordinator
- **AND** a retry for `sc-1` is in flight and has not yet settled
- **WHEN** `graviscan:retry-scanner` is invoked again with `scannerId: 'sc-1'`
- **THEN** the second call SHALL resolve `{ success: false, error }` stating a retry is already in progress
- **AND** a second `coordinator.addScanner` call for `sc-1` SHALL NOT be made
- **AND** once the first retry settles, a subsequent retry for `sc-1` SHALL be permitted

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

`ScannerConfig` MAY additionally carry an optional `resolveSaneName`
function returning a device name, or a promise of one. Where present,
the shared spawn path SHALL call it immediately before constructing the
`ScannerSubprocess` and SHALL use the name it returns in place of
`config.saneName`. Resolving at the point of use makes the mid-scan
queueing delay irrelevant to address correctness — see "Scanner Address
Resolution at Spawn Time" for which paths attach a resolver and why.

Resolution SHALL NOT be attempted when an already-ready worker is
reused, since that path constructs no subprocess and a resolution there
would cost a USB detection per no-op.

Resolution SHALL be bounded by its own timeout, separate from the
spawn-readiness timeout, which covers only `spawn()`. A resolver that
never settles SHALL NOT be able to strand the in-flight-spawn guard for
its `scannerId`: without a bound, that `scannerId` would become
un-spawnable for the remainder of the session and every later caller
would await a promise that never resolves.

Where `resolveSaneName` is absent, returns no name, returns a name that
fails the device-name validation applied at spawn, rejects, throws, or
exceeds its timeout, the spawn path SHALL fall back to
`config.saneName` and proceed as it otherwise would. Resolution SHALL
NOT be able to fail a spawn that would otherwise have been attempted.

Every fallback caused by a resolution *failure* SHALL be recorded in the
durable scan log with its cause, distinctly from the ordinary case of no
resolver being attached. A silent fallback would spawn the worker on a
known-stale address — the precise defect resolution exists to prevent —
after the operator has already been told the retry succeeded.

Because resolution introduces an `await` between entering the spawn
path and registering the subprocess in the coordinator's map, the spawn
path SHALL carry a per-`scannerId` generation token, captured before
resolution and re-checked after it. Where the token no longer matches,
the attempt SHALL abort without constructing a subprocess. `stopScanner`
and `shutdown` SHALL invalidate the token for the scanners they affect.
Without this, an attempt suspended in resolution is registered in
neither the in-flight-spawn guard's effective reach nor the subprocess
map, so a concurrent `stopScanner` cannot cancel it and a later
`shutdown` cannot await it — permitting two live workers for one
scanner, or a worker spawned against an already-shut-down coordinator.

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
- **AND** the recorded message SHALL explicitly identify that the
  failure was a spawn-ready timeout (naming the timeout duration),
  distinguishable from an immediate spawn failure's message (e.g. an
  ENOENT or exit-before-ready message)
- **AND** the failure SHALL also be written via `scanLog()` so it
  survives in the persistent log in a packaged app, not only via
  `console.error`
- **AND** `hasWorker('Z')` SHALL return `false`

#### Scenario: A settled spawn attempt does not block a later, independent spawn for the same id

- **GIVEN** a spawn attempt for `scannerId` `'W'` has already settled
  (the subprocess is `ready`, or the attempt failed and the entry was
  removed)
- **WHEN** a later, unrelated call to spawn `'W'` again is made (e.g.
  after the worker later exits and a new `initialize()`/`addScanner()`
  call runs)
- **THEN** the later call SHALL NOT be handed the earlier, already-
  settled attempt's `Promise`
- **AND** SHALL perform its own fresh reuse/respawn decision

#### Scenario: An orphaned reclaim does not evict or falsely fail-report a newer replacement

- **GIVEN** a spawn attempt for `scannerId` `'A'` is orphaned (its
  guard entry was cleared by a concurrent `stopScanner('A')` while it
  was still mid-connect, per "stopScanner clears an in-flight spawn")
  and is still running toward its own spawn-ready timeout
- **AND** a subsequent `addScanner({scannerId: 'A', ...})` call has
  already installed a healthy, `ready` replacement `ScannerSubprocess`
  at `'A'` before the orphaned attempt's timeout elapses
- **WHEN** the orphaned attempt's spawn-ready timeout fires and its
  reclaim runs
- **THEN** the reclaim SHALL NOT remove the replacement from the
  subprocess map
- **AND** SHALL NOT record an `initErrors` entry or emit a
  `scanner-init-status` `error` event for `'A'`
- **AND** `hasWorker('A')` SHALL continue to return `true` for the
  healthy replacement, unaffected by the orphaned attempt's outcome


#### Scenario: A queued spawn resolves its device name at spawn time, not enqueue time

- **GIVEN** a `ScanCoordinator` with `isScanning === true`
- **AND** `addScanner()` is called with `saneName: 'epkowa:interpreter:001:008'`
  and a `resolveSaneName` that returns `'epkowa:interpreter:001:009'`
- **WHEN** the spawn is queued and later executes on `cycle-complete`
- **THEN** `resolveSaneName` SHALL be called at that point
- **AND** the `ScannerSubprocess` SHALL be constructed with
  `'epkowa:interpreter:001:009'`
- **AND** it SHALL NOT be constructed with the enqueue-time
  `'epkowa:interpreter:001:008'`

#### Scenario: A failing resolver falls back and is logged with its cause

- **GIVEN** a `ScannerConfig` with `saneName: 'epkowa:interpreter:001:008'`
- **WHEN** its `resolveSaneName` rejects, throws, returns no name, returns a
  name that fails device-name validation, or exceeds its timeout
- **THEN** the `ScannerSubprocess` SHALL be constructed with
  `'epkowa:interpreter:001:008'`
- **AND** the spawn SHALL proceed exactly as it does without a resolver
- **AND** the fallback and its cause SHALL be recorded in the durable scan log

#### Scenario: An absent resolver is not reported as a failure

- **GIVEN** a `ScannerConfig` carrying no `resolveSaneName`
- **WHEN** it is spawned
- **THEN** the `ScannerSubprocess` SHALL be constructed with `config.saneName`
- **AND** no resolution-failure entry SHALL be written to the scan log

#### Scenario: Resolution is skipped when an already-ready worker is reused

- **GIVEN** a `ScanCoordinator` with a `ready` worker for `'A'`
- **WHEN** `addScanner({scannerId: 'A', ..., resolveSaneName})` is called
- **THEN** the call SHALL be a no-op
- **AND** `resolveSaneName` SHALL NOT be called

#### Scenario: A stopScanner during resolution aborts the spawn

- **GIVEN** a spawn for `'A'` suspended awaiting its `resolveSaneName`
- **WHEN** `stopScanner('A')` is called before resolution settles
- **AND** resolution then settles
- **THEN** no `ScannerSubprocess` SHALL be constructed for `'A'`
- **AND** the coordinator's subprocess map SHALL contain no entry for `'A'`

#### Scenario: A shutdown during resolution spawns no worker

- **GIVEN** a spawn for `'A'` suspended awaiting its `resolveSaneName`
- **WHEN** `shutdown()` completes before resolution settles
- **AND** resolution then settles
- **THEN** no `ScannerSubprocess` SHALL be constructed
- **AND** no worker process SHALL outlive the shut-down coordinator

#### Scenario: A never-settling resolver does not strand the scanner

- **GIVEN** a `ScannerConfig` whose `resolveSaneName` never settles
- **WHEN** it is spawned
- **THEN** resolution SHALL be abandoned once its timeout elapses
- **AND** the spawn SHALL proceed on `config.saneName`
- **AND** the in-flight-spawn guard for that `scannerId` SHALL be cleared, so a
  later spawn for the same `scannerId` is not blocked
