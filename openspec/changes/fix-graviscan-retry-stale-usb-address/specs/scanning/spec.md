# scanning — spec deltas

## ADDED Requirements

### Requirement: Scanner USB Address Refresh

The system SHALL provide a `src/main/graviscan/scanner-usb-refresh.ts` module that
re-resolves a single saved scanner's current USB address from live detection, so that
callers needing a usable SANE device name do not depend on `usb_bus`/`usb_device` values
persisted by an earlier operation. The module SHALL be importable without an Electron
runtime and SHALL NOT depend on `ScanCoordinator`.

It SHALL export:

- `matchScannerByPort(detected, row)` — a **pure** function returning the `DetectedScanner`
  whose `usb_port` equals `row.usb_port`, or `null` when `row.usb_port` is `null` or the
  empty string, or when no detected scanner carries that port. This function SHALL be the
  single definition of "which detected device is this saved row?" and SHALL be used by
  both `refreshScannerUsbAddress()` and `resetUsb()`'s per-scanner loop.
- `refreshScannerUsbAddress(db, scannerId, detect?)` — reads the scanner row, resolves its
  live USB address, persists `usb_bus`/`usb_device` when they have changed, and returns a
  discriminated `RefreshOutcome` of `'refreshed'`, `'not-detected'`, `'no-stable-port'` or
  `'detection-failed'`. The `detect` parameter SHALL default to `detectEpsonScanners` and
  be injectable for testing.

`refreshScannerUsbAddress()` SHALL run detection at most once per call. The system SHALL
NOT perform a device-level USB reset (`USBDEVFS_RESET`) as part of refresh, per the
requirement "USBDEVFS_RESET Removed from Recovery Path".

`usb_port` SHALL be treated as the stable identifier and SHALL NOT be written by this
module; only `usb_bus` and `usb_device` are written.

#### Scenario: Refresh updates a scanner whose device number changed

- **GIVEN** a `GraviScanner` row for `sc-1` with `usb_port: '1-2.3'`, `usb_bus: 1`, `usb_device: 7`
- **AND** detection reports an Epson scanner at `usb_port: '1-2.3'` with `usb_bus: 1, usb_device: 8`
- **WHEN** `refreshScannerUsbAddress(db, 'sc-1', detect)` is called
- **THEN** the row SHALL be updated to `usb_bus: 1, usb_device: 8`
- **AND** the outcome SHALL be `{ status: 'refreshed', usbBus: 1, usbDevice: 8, saneName: 'epkowa:interpreter:001:008', changed: true }`

#### Scenario: Refresh performs no write when the address is unchanged

- **GIVEN** a `GraviScanner` row for `sc-1` with `usb_port: '1-2.3'`, `usb_bus: 1`, `usb_device: 8`
- **AND** detection reports that scanner still at `usb_bus: 1, usb_device: 8`
- **WHEN** `refreshScannerUsbAddress(db, 'sc-1', detect)` is called
- **THEN** the outcome SHALL be `{ status: 'refreshed', changed: false }` with `saneName: 'epkowa:interpreter:001:008'`
- **AND** no `graviScanner.update` call SHALL be made

#### Scenario: Refresh recovers an address the database does not hold at all

- **GIVEN** a `GraviScanner` row for `sc-1` with `usb_port: '1-2.3'` and `usb_bus: null, usb_device: null`
- **AND** detection reports that scanner at `usb_bus: 1, usb_device: 9`
- **WHEN** `refreshScannerUsbAddress(db, 'sc-1', detect)` is called
- **THEN** the row SHALL be updated to `usb_bus: 1, usb_device: 9`
- **AND** the outcome SHALL be `{ status: 'refreshed', changed: true }`

#### Scenario: Refresh reports not-detected when no device occupies the saved port

- **GIVEN** a `GraviScanner` row for `sc-1` with `usb_port: '1-2.3'`
- **AND** detection succeeds but reports no scanner at `usb_port: '1-2.3'`
- **WHEN** `refreshScannerUsbAddress(db, 'sc-1', detect)` is called
- **THEN** the outcome SHALL be `{ status: 'not-detected', usbPort: '1-2.3' }`
- **AND** no `graviScanner.update` call SHALL be made

#### Scenario: Refresh reports no-stable-port when the row has no usable usb_port

- **GIVEN** a `GraviScanner` row for `sc-1` whose `usb_port` is `null` or the empty string
  (no migration has ever backfilled `usb_port`, and `lsusb -t` failure records it as `''`)
- **WHEN** `refreshScannerUsbAddress(db, 'sc-1', detect)` is called
- **THEN** the outcome SHALL be `{ status: 'no-stable-port' }`
- **AND** the stored `usb_bus`/`usb_device` SHALL NOT be used as a substitute match
- **AND** no `graviScanner.update` call SHALL be made

#### Scenario: Refresh surfaces a detection failure rather than guessing

- **GIVEN** a `GraviScanner` row for `sc-1` with a populated `usb_port`
- **AND** `detect()` returns `{ success: false, error: 'lsusb not available' }`
- **WHEN** `refreshScannerUsbAddress(db, 'sc-1', detect)` is called
- **THEN** the outcome SHALL be `{ status: 'detection-failed', error: 'lsusb not available' }`
- **AND** no `graviScanner.update` call SHALL be made

#### Scenario: Refresh short-circuits in mock mode without calling detection

- **GIVEN** the environment variable `GRAVISCAN_MOCK` is set to `'true'`
- **AND** a `GraviScanner` row for `sc-1` with `usb_bus: 1, usb_device: 2`
- **WHEN** `refreshScannerUsbAddress(db, 'sc-1', detect)` is called
- **THEN** `detect` SHALL NOT be called
- **AND** the outcome SHALL be `{ status: 'refreshed', changed: false }` built from the row's existing values
- **AND** no `graviScanner.update` call SHALL be made

#### Scenario: Refresh reports not-detected when the scanner row does not exist

- **GIVEN** no `GraviScanner` row exists for `sc-1`
- **WHEN** `refreshScannerUsbAddress(db, 'sc-1', detect)` is called
- **THEN** the outcome SHALL be `{ status: 'not-detected' }` with no `usbPort`
- **AND** `detect` SHALL NOT be called

#### Scenario: matchScannerByPort is pure and rejects unusable ports

- **GIVEN** a detected list containing a scanner at `usb_port: '1-2.3'`
- **WHEN** `matchScannerByPort(detected, { usb_port: '1-2.3' })` is called
- **THEN** it SHALL return that detected scanner
- **AND** `matchScannerByPort(detected, { usb_port: null })` SHALL return `null`
- **AND** `matchScannerByPort(detected, { usb_port: '' })` SHALL return `null`
- **AND** the detected list SHALL NOT be mutated

### Requirement: Scanner Identity Matching Precedence

The system SHALL match a detected USB scanner to its saved `GraviScanner` row on `usb_port`
first, and SHALL fall back to `usb_bus`+`usb_device` only when `usb_port` is unusable on
either side. `usb_bus`+`usb_device` SHALL NOT be treated as primary identity: the operating
system reassigns `usb_device` on every reconnect, so a coincidental reuse of a device number
can match an unrelated saved row.

This precedence SHALL be uniform across `matchDetectedToDb()` (`scanner-handlers.ts`),
`upsertScannerRow()` (`scanner-upsert.ts`), `validateConfig()` and `resetUsb()`.

The `usb_bus`+`usb_device` fallback SHALL be retained rather than removed, because
`usb_port` is recorded as the empty string when `lsusb -t` is unavailable, leaving the
bus/device pair as the only available discriminator on such systems.

Where a future `firmware_serial` becomes available for hardware that exposes one, it
SHALL take precedence over `usb_port`; the Epson Perfection V600 exposes no usable
`iSerial`, so `usb_port` is the terminal stable tier for currently supported hardware.

#### Scenario: A reused device number does not bind a detected scanner to the wrong row

- **GIVEN** saved rows `sc-A` with `usb_port: '1-2.3', usb_device: 8` and `sc-B` with `usb_port: '1-4', usb_device: 5`
- **AND** a re-enumeration moves the scanner at port `1-4` to `usb_device: 8`
- **WHEN** detection results are matched against the saved rows
- **THEN** the detected scanner at `usb_port: '1-4'` SHALL bind to `sc-B`
- **AND** it SHALL NOT bind to `sc-A` on the strength of the coincident `usb_device: 8`

#### Scenario: Upsert updates the row owning the port, not the row owning the device number

- **GIVEN** a saved row `sc-A` with `usb_port: '1-2.3'`, `usb_bus: 1`, `usb_device: 8`
- **AND** a saved row `sc-B` with `usb_port: '1-4'`, `usb_bus: 1`, `usb_device: 5`
- **WHEN** `upsertScannerRow(db, { usb_port: '1-4', usb_bus: 1, usb_device: 8, ... })` is called
- **THEN** `sc-B` SHALL be updated
- **AND** `sc-A`'s `usb_port` and `display_name` SHALL be left unchanged
- **AND** no new `GraviScanner` row SHALL be created

#### Scenario: Matching falls back to bus and device when no usable port is present

- **GIVEN** a saved row `sc-1` with `usb_port: null`, `usb_bus: 1`, `usb_device: 4`
- **AND** a detected scanner with `usb_port: ''` (because `lsusb -t` was unavailable), `usb_bus: 1`, `usb_device: 4`
- **WHEN** detection results are matched against the saved rows
- **THEN** the detected scanner SHALL bind to `sc-1` via the `usb_bus`+`usb_device` fallback
- **AND** an empty-string `usb_port` SHALL NOT be treated as matching another row's empty-string `usb_port`

## MODIFIED Requirements

### Requirement: GraviScan Retry-Scanner Action

The system SHALL provide a `graviscan:retry-scanner` IPC handler that, given a `scannerId`,
**re-resolves that scanner's current USB address from live detection**, then stops that
scanner's worker (`stopScanner`, a no-op if already stopped by auto-pause) and respawns it
(`addScanner`) using a `saneName` built from the **refreshed** `usb_bus`/`usb_device`.

The refresh SHALL be performed by `refreshScannerUsbAddress()` (see "Scanner USB Address
Refresh") and SHALL run **before** `stopScanner()`, so that a scanner which cannot be
re-resolved is left running rather than stopped and unrecoverable. A fresh *database* read
is NOT sufficient: `usb_bus`/`usb_device` are written only by `resetUsb()` and
`upsertScannerRow()`, neither of which is on the retry path, and a physical power-cycle —
the precondition the operator has just satisfied — always re-enumerates the device at a new
number.

The action SHALL require an active scan session and a live coordinator. The handler SHALL
fail without calling `addScanner` when the scanner row cannot be found, when the row's
`enabled` field is `false`, or when the refresh outcome is `'not-detected'`,
`'no-stable-port'` or `'detection-failed'`. Each of those failures SHALL carry an
operator-actionable message naming the cause, and SHALL NOT fall back to the stored
`usb_bus`/`usb_device`, which after a power-cycle is known to be stale.

A null `usb_bus`/`usb_device` SHALL NOT by itself fail the retry: when the row carries a
usable `usb_port`, refresh SHALL recover the address and the retry SHALL proceed.

After `addScanner` resolves, the handler SHALL check `coordinator.getScannerStatuses()` for
the retried `scannerId` and SHALL resolve `{ success: false, error }` if that scanner is not
reported with status `'ready'` — `addScanner`/`spawnSingleScanner` do not throw on spawn
failure, so a resolved promise alone does not indicate the worker came online. The handler
SHALL write a durable log entry (via `scanLog()`) recording the retry attempt and its
outcome, including the refreshed address (or the refresh-failure cause) and the
silent-failure case.

#### Scenario: Retry respawns the worker on the scanner's refreshed address

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_bus: 1, usb_device: 7, usb_port: '1-2.3', enabled: true`
- **AND** the scanner has since been power-cycled and live detection reports it at `usb_bus: 1, usb_device: 8` on `usb_port: '1-2.3'`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the row SHALL be updated to `usb_bus: 1, usb_device: 8` before the respawn
- **AND** `coordinator.stopScanner('sc-1')` SHALL be called
- **AND** `coordinator.addScanner({ scannerId: 'sc-1', saneName: 'epkowa:interpreter:001:008', plates: [] })` SHALL be called
- **AND** `coordinator.addScanner` SHALL NOT be called with the stale `'epkowa:interpreter:001:007'`
- **AND** `coordinator.getScannerStatuses()` SHALL be checked for `sc-1`
- **AND**, given that status is `'ready'`, the handler SHALL resolve `{ success: true }`
- **AND** a log entry recording the successful retry and the refreshed address SHALL be written

#### Scenario: Retry succeeds unchanged when the address did not move

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_bus: 3, usb_device: 7, usb_port: '3-1', enabled: true`
- **AND** live detection reports that scanner still at `usb_bus: 3, usb_device: 7`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** `coordinator.addScanner({ scannerId: 'sc-1', saneName: 'epkowa:interpreter:003:007', plates: [] })` SHALL be called
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
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_port: '1-2.3', enabled: true`
- **AND** live detection succeeds but reports no scanner on `usb_port: '1-2.3'` (the operator
  clicked Retry before reconnecting or powering the scanner back on)
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error }` where `error` names the
  scanner's port and states that no scanner was detected there
- **AND** neither `coordinator.stopScanner` nor `coordinator.addScanner` SHALL be called
- **AND** a log entry recording the failed retry SHALL be written

#### Scenario: Retry fails without respawning when no stable USB port is recorded

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_port: null` (or `''`) and `enabled: true`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error }` where `error` states that no
  stable USB port is recorded for the scanner and directs the operator to re-run scanner detection
- **AND** the stored `usb_bus`/`usb_device` SHALL NOT be used to build a `saneName`
- **AND** neither `coordinator.stopScanner` nor `coordinator.addScanner` SHALL be called

#### Scenario: Retry fails without respawning when USB detection itself fails

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_port: '1-2.3', enabled: true`
- **AND** USB detection returns `{ success: false, error: 'lsusb not available' }`
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
- **AND** neither `coordinator.stopScanner` nor `coordinator.addScanner` SHALL be called

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
