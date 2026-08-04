## MODIFIED Requirements

### Requirement: GraviScan Retry-Scanner Action

The system SHALL provide a `graviscan:retry-scanner` IPC handler that, given a `scannerId`, stops that scanner's worker (`stopScanner`, a no-op if already stopped by auto-pause) and respawns it (`addScanner`) using a `saneName` rebuilt from a fresh database read of the scanner's current `usb_bus`/`usb_device` (not a value cached from session start). The action SHALL require an active scan session and a live coordinator. If the scanner's `usb_bus` or `usb_device` is null (e.g. mid `reset-usb`), the scanner row's `enabled` field is `false`, or the scanner row cannot be found, the handler SHALL fail without calling `addScanner`. After `addScanner` resolves, the handler SHALL check `coordinator.getScannerStatuses()` for the retried `scannerId` and SHALL resolve `{ success: false, error }` if that scanner is not reported with status `'ready'` — `addScanner`/`spawnSingleScanner` do not throw on spawn failure, so a resolved promise alone does not indicate the worker came online. The handler SHALL write a durable log entry (via `scanLog()`) recording the retry attempt and its outcome, including the silent-failure case.

#### Scenario: Retry respawns the worker with a fresh saneName

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_bus: 3, usb_device: 7, enabled: true`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** `coordinator.stopScanner('sc-1')` SHALL be called
- **AND** `coordinator.addScanner({ scannerId: 'sc-1', saneName: 'epkowa:interpreter:003:007', plates: [] })` SHALL be called
- **AND** `coordinator.getScannerStatuses()` SHALL be checked for `sc-1`
- **AND**, given that status is `'ready'`, the handler SHALL resolve `{ success: true }`
- **AND** a log entry recording the successful retry SHALL be written

#### Scenario: Retry fails without respawning when USB identity is unknown

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_bus: null` (e.g. a `reset-usb` is in progress)
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error: '...' }`
- **AND** `coordinator.addScanner` SHALL NOT be called

#### Scenario: Retry fails without respawning a disabled scanner

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `enabled: false` (the operator disabled it via ConfigureScanner's "Remove" action)
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error: '...' }`
- **AND** `coordinator.addScanner` SHALL NOT be called

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

#### Scenario: A rejected respawn is caught and surfaced, not left unhandled

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has valid `usb_bus`/`usb_device`/`enabled: true`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **AND** `coordinator.addScanner()` rejects
- **THEN** the handler SHALL resolve `{ success: false, error: msg }` (the rejection SHALL be caught, not left as an unhandled promise rejection)
- **AND** a log entry recording the failed retry SHALL be written

#### Scenario: Retry reports failure when the respawned worker silently fails to come online

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has valid `usb_bus`/`usb_device`/`enabled: true`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **AND** `coordinator.addScanner()` resolves without throwing
- **AND** `coordinator.getScannerStatuses()` reports `sc-1` with status `'error'` or `'dead'`, or does not include `sc-1` at all
- **THEN** the handler SHALL resolve `{ success: false, error }`, where `error` is the status's recorded `error` message when present, or a message stating the scanner did not come online
- **AND** a log entry recording the failed retry SHALL be written
