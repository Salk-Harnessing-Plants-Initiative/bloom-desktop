# scanning — spec deltas

## ADDED Requirements

### Requirement: Scanner USB Port Matching

The system SHALL match a detected USB scanner to a saved `GraviScanner` row by comparing
the row's `usb_port` to the detected scanner's `usb_port` for exact string equality,
treating `null` and the empty string as unmatchable on either side. This matching SHALL
have a single implementation, shared by every caller that needs it, so that the retry
path, the reset-usb path and the detection paths cannot diverge.

A port value SHALL be considered unusable when it is `null` or the empty string. Two
unusable values SHALL NOT be treated as equal to each other.

Matching SHALL NOT mutate the detected-scanner list it is given.

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

- **GIVEN** a detected list containing a scanner with `usb_port: ''` (recorded because
  `lsusb -t` was unavailable)
- **WHEN** a saved row with `usb_port: ''` is matched against it
- **THEN** no match SHALL be returned

#### Scenario: Matching does not mutate its input

- **GIVEN** a detected list of two scanners
- **WHEN** matching is performed against any saved row
- **THEN** the detected list and its elements SHALL be unchanged

### Requirement: Scanner USB Address Refresh

The system SHALL re-resolve a single saved scanner's current USB address from live
detection before that address is used to build a SANE device name, so that no caller
depends on `usb_bus`/`usb_device` values persisted by an earlier operation.

Refresh SHALL read the scanner's row, resolve its live address by matching on `usb_port`
(see "Scanner USB Port Matching"), persist `usb_bus`/`usb_device` when they differ from
the stored values, and report one of the following outcomes: `refreshed`, `not-detected`,
`no-stable-port`, `row-missing`, or `detection-failed`. `row-missing` SHALL be distinct
from `not-detected`, because the two produce different operator-facing messages and only
one of them can name a port.

A `refreshed` outcome SHALL carry the resolved `usbBus`, the resolved `usbDevice`, and a
`changed` flag. Refresh SHALL NOT construct SANE device names; callers SHALL build the
name from the reported address, so that the name format keeps a single definition.

Refresh SHALL write only `usb_bus` and `usb_device`. It SHALL NOT write `usb_port`,
`name`, `display_name` or `enabled`, so that refresh cannot become a second path that
rewrites scanner identity.

Refresh SHALL NOT block the Electron main-process event loop. Detection SHALL be
performed asynchronously, because refresh runs during an active scan session where a
synchronous stall would delay the coordinator's cycle timers and per-row timeouts.

Refresh SHALL attempt detection at most three times per call, with a short backoff
between attempts, and SHALL report `detection-failed` only after the final attempt fails.
Detection can fail transiently under the USB-bus contention that a wedged device creates,
and the scanner itself may be healthy in that case.

Refresh SHALL NOT report a `refreshed` outcome built from a non-integer `usb_bus` or
`usb_device`, in any mode including mock mode, because such values yield a malformed SANE
device name that mock-mode spawning does not validate.

Where more than one saved row holds the same non-empty `usb_port`, refresh SHALL select
deterministically, preferring an `enabled` row and then the most recently updated row, and
SHALL record the ambiguity in the durable scan log. Duplicate `usb_port` values are
reachable on existing installations because the schema carries no uniqueness constraint and
the defect this change fixes can itself produce them.

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
- **AND** every detection attempt returns `{ success: false, error: 'lsusb not available' }`
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

#### Scenario: Refresh refuses a non-integer address in mock mode

- **GIVEN** the environment variable `GRAVISCAN_MOCK` is set to `'true'`
- **AND** a `GraviScanner` row for `sc-1` with `usb_bus: null, usb_device: null` (the state
  `reset-usb` leaves behind between clearing and repopulating the columns)
- **WHEN** the scanner's USB address is refreshed
- **THEN** the outcome SHALL be `{ status: 'no-stable-port' }`
- **AND** no SANE device name of the form `epkowa:interpreter:null:null` SHALL be produced

#### Scenario: Refresh does not block the main-process event loop

- **GIVEN** an active scan session with other scanners mid-cycle
- **WHEN** a scanner's USB address is refreshed and the underlying detection call is slow
- **THEN** detection SHALL be awaited asynchronously
- **AND** the event loop SHALL remain free to service coordinator timers, subprocess output
  and other IPC while detection is outstanding

#### Scenario: Refresh resolves duplicate saved ports deterministically

- **GIVEN** two `GraviScanner` rows both holding `usb_port: '1-2.3'`, one `enabled: true` and
  one `enabled: false`
- **WHEN** a refresh resolves that port
- **THEN** the `enabled` row SHALL be selected
- **AND** the ambiguity SHALL be recorded in the durable scan log

### Requirement: Scanner Identity Matching Precedence

The system SHALL match a detected USB scanner to its saved `GraviScanner` row on `usb_port`
first, and SHALL consult `usb_bus`+`usb_device` only when the **detected** scanner carries
no usable `usb_port`. `usb_bus`+`usb_device` SHALL NOT be treated as primary identity: the
operating system reassigns `usb_device` on every reconnect, so a coincidental reuse of a
device number can match an unrelated saved row.

The fallback SHALL NOT be reached merely because a port lookup found no match. A detected
scanner that carries a usable `usb_port` which matches no saved row SHALL be treated as a
new scanner, never matched onto a saved row by its device number — otherwise a scanner
moved to a new port would silently take over the identity of whichever row happens to
share its current device number.

This precedence SHALL apply to `matchDetectedToDb()` and `upsertScannerRow()`. It does not
extend to `validateConfig()` and `resetUsb()`, which match on `usb_port` only and have no
bus/device fallback; that port-only behaviour is intentional and unchanged, and a row with
no usable `usb_port` SHALL continue to be reported as missing or disconnected by those two
paths respectively.

Where a lookup by `usb_port` can match more than one saved row, the system SHALL select
deterministically, preferring an `enabled` row and then the most recently updated row.
The schema carries no uniqueness constraint on `usb_port`, and the defect this change
fixes can itself have produced duplicate-port rows on existing installations.

`usb_port` identifies a physical **port**, not a physical scanner. The Epson Perfection
V600 exposes no USB serial number, so if two same-model scanners are physically swapped
between ports, the system SHALL bind each row to the scanner now occupying its port, and
SHALL NOT claim to detect the swap. This is a recorded non-guarantee, not an oversight
(see issue #203).

#### Scenario: A reused device number does not bind a detected scanner to the wrong row

- **GIVEN** saved rows `sc-A` with `usb_port: '1-2.3', usb_device: 8` and `sc-B` with `usb_port: '1-4', usb_device: 5`
- **AND** a re-enumeration moves the scanner at port `1-4` to `usb_device: 8`
- **WHEN** detection results are matched against the saved rows
- **THEN** the detected scanner at `usb_port: '1-4'` SHALL bind to `sc-B`
- **AND** it SHALL NOT bind to `sc-A` on the strength of the coincident `usb_device: 8`

#### Scenario: Upsert updates the row owning the port, not the row owning the device number

- **GIVEN** a saved row `sc-A` with `usb_port: '1-2.3'`, `usb_bus: 1`, `usb_device: 8`
- **AND** a saved row `sc-B` with `usb_port: '1-4'`, `usb_bus: 1`, `usb_device: 5`
- **WHEN** an upsert is performed for `{ usb_port: '1-4', usb_bus: 1, usb_device: 8 }`
- **THEN** `sc-B` SHALL be updated
- **AND** `sc-A`'s `usb_port`, `name` and `display_name` SHALL be left unchanged
- **AND** no new `GraviScanner` row SHALL be created

#### Scenario: A scanner on an unknown port is not matched by its device number

- **GIVEN** a saved row `sc-A` with `usb_port: '1-2.3'`, `usb_bus: 1`, `usb_device: 8`
- **AND** a detected scanner with a usable `usb_port: '1-9'` and `usb_bus: 1`, `usb_device: 8`
- **WHEN** the detected scanner is matched against the saved rows
- **THEN** it SHALL NOT bind to `sc-A`
- **AND** it SHALL be treated as a new scanner
- **AND** an upsert for it SHALL create a new row rather than overwriting `sc-A`'s `usb_port`

#### Scenario: Matching falls back to bus and device only when the detected port is unusable

- **GIVEN** a saved row `sc-1` with `usb_port: null`, `usb_bus: 1`, `usb_device: 4`
- **AND** a detected scanner with `usb_port: ''` (because `lsusb -t` was unavailable), `usb_bus: 1`, `usb_device: 4`
- **WHEN** the detected scanner is matched against the saved rows
- **THEN** it SHALL bind to `sc-1` via the `usb_bus`+`usb_device` fallback
- **AND** an empty-string `usb_port` SHALL NOT be treated as matching another row's empty-string `usb_port`

#### Scenario: A duplicate-port lookup prefers the enabled, most recent row

- **GIVEN** two saved rows both holding `usb_port: '1-2.3'`, one `enabled: false` created earlier
  and one `enabled: true` updated more recently
- **WHEN** an upsert resolves that port
- **THEN** the `enabled`, most recently updated row SHALL be updated
- **AND** the other row SHALL be left unchanged

### Requirement: Scan Worker Device-Name Re-resolution on Reopen

The `scan_worker` subprocess SHALL re-resolve its SANE device name from its stable USB port
immediately before each attempt to reopen the device during error recovery, rather than
reusing the device name supplied when it was spawned. A scan failure can itself cause the
device to re-enumerate at a new USB device number, so the name captured at spawn time is
not reliable for recovery.

The worker SHALL accept its stable USB port as a startup parameter. Re-resolution SHALL read
the current bus and device numbers for that port from the operating system's USB device
information, and SHALL verify that the device at that port still reports the expected USB
vendor and product identifiers before using it.

Where the port is unknown, the port no longer has a device, the device at the port reports
different vendor or product identifiers, or re-resolution fails for any reason, the worker
SHALL fall back to the device name it was given at spawn time and proceed as it does today.
Re-resolution SHALL be a recovery improvement that can only widen the set of recoverable
failures; it SHALL NOT introduce a new failure mode of its own.

The worker SHALL record each re-resolution attempt and its result, including the previous
and newly resolved device names when they differ, so that a recovery can be reconstructed
from the logs afterwards.

Re-resolution SHALL NOT perform a device-level USB reset, per the requirement "USBDEVFS_RESET
Removed from Recovery Path".

#### Scenario: Reopen uses the re-resolved device name after a re-enumeration

- **GIVEN** a worker spawned with device name `epkowa:interpreter:001:007` and USB port `1-2.3`
- **AND** a scan failure has caused the device to re-enumerate at bus 1, device 8
- **WHEN** the worker reopens the device during error recovery
- **THEN** it SHALL open `epkowa:interpreter:001:008`
- **AND** it SHALL NOT open `epkowa:interpreter:001:007`
- **AND** the change of device name SHALL be recorded in the worker's log

#### Scenario: Reopen is unchanged when the address has not moved

- **GIVEN** a worker spawned with device name `epkowa:interpreter:001:007` and USB port `1-2.3`
- **AND** the device is still at bus 1, device 7
- **WHEN** the worker reopens the device during error recovery
- **THEN** it SHALL open `epkowa:interpreter:001:007`

#### Scenario: Reopen falls back to the spawn-time name when the port has no device

- **GIVEN** a worker spawned with device name `epkowa:interpreter:001:007` and USB port `1-2.3`
- **AND** no device is present at port `1-2.3`
- **WHEN** the worker reopens the device during error recovery
- **THEN** it SHALL attempt `epkowa:interpreter:001:007` as it does today
- **AND** it SHALL NOT raise a new error class of its own

#### Scenario: Reopen falls back when the device at the port is a different model

- **GIVEN** a worker spawned with USB port `1-2.3` for an Epson scanner
- **AND** the device now at port `1-2.3` reports different USB vendor or product identifiers
- **WHEN** the worker reopens the device during error recovery
- **THEN** the re-resolved address SHALL NOT be used
- **AND** the worker SHALL fall back to its spawn-time device name

#### Scenario: Reopen falls back when no USB port was supplied

- **GIVEN** a worker spawned without a USB port parameter
- **WHEN** the worker reopens the device during error recovery
- **THEN** it SHALL use its spawn-time device name
- **AND** re-resolution SHALL NOT be attempted

## MODIFIED Requirements

### Requirement: GraviScan Retry-Scanner Action

The system SHALL provide a `graviscan:retry-scanner` IPC handler that, given a `scannerId`,
**re-resolves that scanner's current USB address from live detection**, then stops that
scanner's worker (`stopScanner`, a no-op if already stopped by auto-pause) and respawns it
(`addScanner`) using a `saneName` built from the **refreshed** `usb_bus`/`usb_device`.

The refresh SHALL be performed as described in "Scanner USB Address Refresh". A fresh
*database* read is NOT sufficient: `usb_bus`/`usb_device` are written only by `resetUsb()`
and `upsertScannerRow()`, neither of which is on the retry path, and a physical power-cycle
— the precondition the operator has just satisfied — always re-enumerates the device at a
new number. The handler SHALL NOT reuse a refresh result obtained during an earlier retry.

Because a mid-scan respawn is queued until the next cycle boundary, the address resolved
when the operator clicks Retry can be stale by the time the worker is actually spawned. The
handler SHALL therefore also arrange for the address to be re-resolved at spawn time, as
described in "Coordinator Single-Scanner Spawn API", so the name the worker receives is
resolved at the moment of use.

The refresh SHALL run **before** `stopScanner()`, so that a scanner which cannot be
re-resolved is left running rather than stopped and unrecoverable. The handler SHALL either
call both `stopScanner` and `addScanner`, or neither.

The action SHALL require an active scan session and a live coordinator. The handler SHALL
fail without calling `addScanner` when the scanner row cannot be found, when the row's
`enabled` field is `false`, or when the refresh outcome is `not-detected`,
`no-stable-port`, `row-missing` or `detection-failed`. Each of those failures SHALL carry an
operator-actionable message that identifies the scanner by its `display_name` where one is
recorded, and SHALL NOT fall back to the stored `usb_bus`/`usb_device`, which after a
power-cycle is known to be stale.

A `no-stable-port` failure SHALL NOT direct the operator to run scanner detection while a
scan session is active: doing so disables saved scanners that are not currently enumerated,
which for a powered-off wedged scanner would remove it from the run permanently.

A null `usb_bus`/`usb_device` SHALL NOT by itself fail the retry: when the row carries a
usable `usb_port`, refresh SHALL recover the address and the retry SHALL proceed.

After `addScanner` resolves, the handler SHALL check `coordinator.getScannerStatuses()` for
the retried `scannerId` and SHALL resolve `{ success: false, error }` if that scanner is not
reported with status `'ready'` — `addScanner`/`spawnSingleScanner` do not throw on spawn
failure, so a resolved promise alone does not indicate the worker came online. The handler
SHALL write a durable log entry (via `scanLog()`) recording the retry attempt and its
outcome, including the silent-failure case. That entry SHALL identify the scanner and its
`usb_port`, and for a changed address SHALL record both the previous and the newly resolved
`usb_bus`/`usb_device`, so a later reader can reconstruct what the address was before the
refresh rather than only what it became.

A concurrent retry for the same `scannerId` SHALL be rejected while a prior retry for that
`scannerId` is still in flight.

#### Scenario: Retry respawns the worker on the scanner's refreshed address

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
- **AND** neither `coordinator.stopScanner` nor `coordinator.addScanner` SHALL be called
- **AND** a log entry recording the failed retry SHALL be written

#### Scenario: Retry fails without respawning when no stable USB port is recorded

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_port: null` (or `''`) and `enabled: true`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error }` where `error` states that no
  stable USB port is recorded for the scanner and that it cannot be recovered during this session
- **AND** `error` SHALL NOT instruct the operator to run scanner detection while the session is active
- **AND** the stored `usb_bus`/`usb_device` SHALL NOT be used to build a `saneName`
- **AND** neither `coordinator.stopScanner` nor `coordinator.addScanner` SHALL be called

#### Scenario: Retry fails without respawning when USB detection itself fails

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_port: '1-2.3', enabled: true`
- **AND** every USB detection attempt fails
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error }` surfacing the detection error
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

`ScannerConfig` MAY additionally carry an optional `resolveSaneName`
function. Where present, the shared spawn path SHALL call it
immediately before constructing the `ScannerSubprocess` and SHALL use
the name it returns in place of `config.saneName`. This exists because
a mid-scan `addScanner()` is queued until the next `cycle-complete`,
which can be a full scan interval later, while the USB device number a
SANE device name encodes is reassigned by the operating system on every
reconnect — so a name captured at enqueue time is not reliable at spawn
time. Resolving at the point of use makes the queueing delay
irrelevant to address correctness.

Where `resolveSaneName` is absent, or returns no name, or throws, the
spawn path SHALL fall back to `config.saneName` and proceed as it
otherwise would. Resolution SHALL NOT be able to fail a spawn that
would otherwise have been attempted, and SHALL NOT block the event
loop.

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

#### Scenario: A failing or absent resolver does not fail the spawn

- **GIVEN** a `ScanCoordinator` and a `ScannerConfig` with
  `saneName: 'epkowa:interpreter:001:008'`
- **WHEN** the config carries no `resolveSaneName`, or one that throws,
  or one that returns no name
- **THEN** the `ScannerSubprocess` SHALL be constructed with
  `'epkowa:interpreter:001:008'`
- **AND** the spawn SHALL proceed exactly as it does without a resolver

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

