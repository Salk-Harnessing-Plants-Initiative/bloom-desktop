## ADDED Requirements

### Requirement: GraviScan Wedge Auto-Pause on Detection

When the `WedgeDetector` emits a `wedge-detected` event, `setupWedgeDetection()` SHALL immediately stop that scanner's worker subprocess via the coordinator's existing `stopScanner(scanner_id)`, excluding it from all subsequent scan cycles in the active session unless and until a later `retry-scanner` call (see below) respawns it — without waiting for any operator action to trigger the initial pause.

The auto-pause call SHALL NOT be gated behind (or delayed by) the Slack notification or the renderer-forwarding path: a slow or failing Slack webhook SHALL NOT delay stopping the wedged scanner. A durable log entry (via the existing `scanLog()` facility) SHALL record the auto-pause, including the scanner_id, signature, session_id, and cycle_number, in addition to — not instead of — the pre-existing `wedge-detected` log entry.

#### Scenario: Wedge detection auto-pauses the scanner

- **GIVEN** an active scan session with a running worker for scanner `sc-1`
- **WHEN** the `WedgeDetector` emits a `wedge-detected` event for `sc-1`
- **THEN** `coordinator.stopScanner('sc-1')` SHALL be called
- **AND** subsequent scan cycles SHALL NOT include `sc-1`
- **AND** a log entry recording the auto-pause SHALL be written

#### Scenario: Auto-pause is not delayed by a slow Slack notification

- **GIVEN** the configured `SlackNotifier.notify()` call would hang or reject
- **WHEN** the `WedgeDetector` emits a `wedge-detected` event
- **THEN** `coordinator.stopScanner()` SHALL still be called for the wedged scanner without waiting for the Slack call to settle

---

### Requirement: GraviScan Wedge Event Forwarding to Renderer

`setupWedgeDetection()` SHALL forward every `wedge-detected` event emitted by the `WedgeDetector` to the renderer, in addition to — not instead of — the existing `SlackNotifier.notify()` call and the auto-pause action.

The forwarded event SHALL be sent as a `graviscan:wedge-detected` IPC message carrying the same enriched payload (including `display_name`/`usb_port` when available) that is sent to Slack. Forwarding SHALL be best-effort: a missing or destroyed main window SHALL NOT throw or block the Slack notification or the auto-pause.

#### Scenario: Wedge event reaches Slack, the renderer, and triggers auto-pause

- **GIVEN** a `WedgeDetector` wired via `setupWedgeDetection(coordinator, db, getMainWindow)` with a live, non-destroyed main window
- **WHEN** the detector emits a `wedge-detected` event
- **THEN** `SlackNotifier.notify()` SHALL be called with the enriched event
- **AND** `getMainWindow().webContents.send('graviscan:wedge-detected', ...)` SHALL be called with the same enriched event
- **AND** `coordinator.stopScanner()` SHALL be called for the wedged scanner

#### Scenario: No main window available

- **GIVEN** a `WedgeDetector` wired via `setupWedgeDetection(coordinator, db)` with no third argument (or a `getMainWindow` that returns `null` or a destroyed window)
- **WHEN** the detector emits a `wedge-detected` event
- **THEN** the Slack notification path and the auto-pause SHALL be unaffected
- **AND** no `webContents.send` call SHALL occur
- **AND** no error SHALL be thrown

---

### Requirement: GraviScan Retry-Scanner Action

The system SHALL provide a `graviscan:retry-scanner` IPC handler that, given a `scannerId`, stops that scanner's worker (`stopScanner`, a no-op if already stopped by auto-pause) and respawns it (`addScanner`) using a `saneName` rebuilt from a fresh database read of the scanner's current `usb_bus`/`usb_device` (not a value cached from session start). The action SHALL require an active scan session and a live coordinator. If the scanner's `usb_bus` or `usb_device` is null (e.g. mid `reset-usb`), the scanner row's `enabled` field is `false`, or the scanner row cannot be found, the handler SHALL fail without calling `addScanner`. The handler SHALL write a durable log entry (via `scanLog()`) recording the retry attempt and its outcome.

#### Scenario: Retry respawns the worker with a fresh saneName

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_bus: 3, usb_device: 7, enabled: true`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** `coordinator.stopScanner('sc-1')` SHALL be called
- **AND** `coordinator.addScanner({ scannerId: 'sc-1', saneName: 'epkowa:interpreter:003:007', plates: [] })` SHALL be called
- **AND** the handler SHALL resolve `{ success: true }`
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
