## MODIFIED Requirements

### Requirement: GraviScan Scanner Configuration Page

The system SHALL provide a Scanner Configuration page at `/scanner-config` (visible only in GraviScan mode) that allows users to detect connected USB scanners, compare detected scanners against saved DB records, configure grid mode (2grid/4grid) and resolution (DPI), and persist scanner and config records to the database.

Scanner enablement SHALL be modeled as `ScannerAssignment.scannerId !== null` (one source of truth across ScannerConfig, Metadata, GraviScan pages and their hooks). When detection returns N scanners, the system SHALL populate `scannerAssignments` with N entries whose `scannerId` matches each detected scanner, and the "Enabled" checkbox SHALL toggle that assignment between set and `null`. Only enabled scanners SHALL be persisted when the user saves. Save SHALL provide explicit visual feedback (success or error banner) so the user knows their configuration was committed — or, on failure, why it was not.

**Stable-identity key for enabled/disabled memory.** The unchecked-state memory across re-detection SHALL be keyed by `usb_port` as the primary key. `DetectedScanner.usb_port` is typed `string` and is `''` (empty, not `null`) when the platform does not populate it. When `usb_port` is empty, the fallback key SHALL be the composite `${vendor_id}:${product_id}:${name}:${usb_bus}:${usb_device}` — the full composite avoids collisions between identical-model scanners on the same hub. The fallback predicate is `!usb_port`, not `usb_port === null`. The unchecked-state memory SHALL be persisted to `localStorage` so it survives page reload, HMR, and navigation-away-and-back.

#### Scenario: Detect connected scanners

- **GIVEN** the user is in GraviScan mode
- **WHEN** the user navigates to the Scanner Configuration page
- **THEN** the system SHALL call `detectScanners` to enumerate connected USB scanners
- **AND** display each detected scanner with name, USB port, and availability status
- **AND** indicate which scanners are new (not in DB) vs. previously saved

#### Scenario: Detection populates scanner assignments

- **GIVEN** N scanners are returned from `detectScanners`
- **WHEN** the detection result is applied to state
- **THEN** `scannerAssignments` SHALL contain one entry per detected scanner with `scannerId` set to that scanner's id (not `null`)
- **AND** each assignment's `gridMode` SHALL default to the currently selected grid mode
- **AND** each rendered scanner's "Enabled" checkbox SHALL reflect `scannerId !== null`

#### Scenario: Save scanner configuration persists every enabled scanner

- **GIVEN** N scanners are detected and all N have their "Enabled" checkbox checked
- **WHEN** the user selects a grid mode and resolution and clicks Save
- **THEN** the system SHALL call `saveConfig` with the selected grid_mode and resolution
- **AND** call `saveScannersToDB` with an array of exactly N entries
- **AND** each entry SHALL include `name`, `vendor_id`, `product_id`, `usb_port`, `usb_bus`, `usb_device`, and `display_name`
- **AND** the renderer SHALL pass `display_name: scanner.name` as the default when no user override exists, or `display_name: undefined` when the user has not explicitly set a value (so the main-process upsert can preserve existing admin-chosen `display_name` via its `?? existing.display_name` fallback)
- **AND** each payload entry SHALL NOT include `scanner_id` (the DB row's id is server-side state)
- **AND** the persisted `GraviConfig.grid_mode` SHALL equal the grid mode selected in the UI (not the `'2grid'` fallback)

#### Scenario: Save with zero enabled scanners is prevented

- **GIVEN** N scanners are detected and the user has unchecked "Enabled" for all of them
- **WHEN** the user attempts to save
- **THEN** the Save Configuration button SHALL be disabled
- **AND** a helper message SHALL explain that at least one scanner must be enabled
- **AND** no IPC call to `saveConfig`, `saveScannersToDB`, or `disableMissingScanners` SHALL be made

#### Scenario: Main-process saveScannersToDB rejects empty array (defense-in-depth)

- **GIVEN** the renderer's zero-enabled guard has been bypassed (e.g., by a future regression)
- **WHEN** `saveScannersToDB` is invoked with an empty array
- **THEN** the main-process handler SHALL return `{ success: false, error: 'no scanners to save' }`
- **AND** SHALL NOT insert any rows into `GraviScanner`

#### Scenario: Main-process matching uses usb_port as primary identity

- **GIVEN** a detected scanner with a valid `usb_port`
- **WHEN** `saveScannersToDB` determines whether to update an existing row or create a new one
- **THEN** the match SHALL be performed by `usb_port` first
- **AND** the fallback SHALL be the composite `(vendor_id, product_id, name, usb_bus, usb_device)`
- **AND** `usb_bus`+`usb_device` alone SHALL NOT be treated as primary identity (the OS reassigns `usb_device` on reconnect; coincidental reuse could match unrelated stale rows)
- **AND** this matching priority SHALL be consistent with the renderer's unchecked-state key

#### Scenario: Save shows success feedback to the user

- **GIVEN** the user clicks Save and `saveConfig`, `saveScannersToDB`, and `disableMissingScanners` all return success
- **WHEN** the IPC calls resolve
- **THEN** the page SHALL display a visible success banner styled with Tailwind classes `bg-green-50 border border-green-200 text-green-800`
- **AND** the banner text SHALL reference the number of scanners saved, the grid mode (rendered as "2-Grid" or "4-Grid" matching the radio labels), and the resolution in DPI
- **AND** the banner SHALL persist until the user clicks its dismiss control or navigates away (no auto-dismiss)

#### Scenario: Save shows error feedback on failure

- **GIVEN** the user clicks Save and `saveScannersToDB` returns `{ success: false, error }`
- **WHEN** the IPC call resolves
- **THEN** the page SHALL display a visible error banner styled with Tailwind classes `bg-red-50 border border-red-200 text-red-800`
- **AND** the banner text SHALL contain the error message returned by the IPC
- **AND** the Save Configuration button SHALL be re-armed for retry

#### Scenario: Partial failure informs user of both outcomes and re-arms Save

- **GIVEN** `saveConfig` resolves `{ success: true }` but `saveScannersToDB` resolves `{ success: false, error }`
- **WHEN** both IPC calls complete
- **THEN** the error banner SHALL reference both outcomes (e.g., "Config saved. Scanner save failed: <error>.")
- **AND** the Save Configuration button SHALL be re-armed so the user can retry the scanner write
- **AND** no DB transaction SHALL be rolled back (the `GraviConfig` write is intentionally independent — NOT a goal of this proposal; see Non-Goals)

#### Scenario: Enabled checkbox toggles actual enabled state

- **GIVEN** a detected scanner is displayed with its "Enabled" checkbox checked
- **WHEN** the user clicks the checkbox to uncheck it
- **THEN** the corresponding `scannerAssignments` entry's `scannerId` SHALL be set to `null`
- **AND** the unchecked-state memory (keyed by `usb_port` or the composite fallback) SHALL record this scanner as unchecked
- **AND** the unchecked-state memory SHALL be written to `localStorage` within the same event handler
- **AND** the checkbox SHALL reflect the new unchecked state
- **AND** a subsequent Save SHALL NOT include that scanner in the `saveScannersToDB` payload

#### Scenario: Unchecked state persists across save and re-detect

- **GIVEN** the user has unchecked one of two detected scanners and clicked Save
- **AND** `handleSave` triggers a follow-up `detectScanners` that returns the same physical scanners with refreshed DB-issued `scanner_id` values
- **WHEN** the detection result is re-applied
- **THEN** the scanner that the user unchecked SHALL remain unchecked (its `scannerAssignments.scannerId` SHALL remain `null`)
- **AND** the scanner that the user kept enabled SHALL remain enabled with its new DB-issued id
- **AND** enabled-state persistence SHALL use the stable-identity key described in the requirement preamble

#### Scenario: Unchecked state survives USB reconnect (device number reassignment)

- **GIVEN** two scanners are detected and the user has unchecked one
- **AND** a USB reconnect causes the re-detection to return the same physical scanners with the SAME `usb_port` but a DIFFERENT `usb_device` value
- **WHEN** the detection result is re-applied
- **THEN** the unchecked scanner SHALL remain unchecked
- **AND** the enabled scanner SHALL remain enabled
- **AND** the system SHALL NOT lose the user's enabled/disabled selection just because `usb_device` changed

#### Scenario: Unchecked state survives renderer reload

- **GIVEN** the user has unchecked one scanner on the Scanner Configuration page
- **AND** the user has not yet clicked Save
- **WHEN** the renderer reloads (e.g., Cmd-R in dev mode, Electron HMR, or navigation away and back)
- **THEN** on the next detection result applied, the previously unchecked scanner SHALL remain unchecked
- **AND** the system SHALL read the unchecked-state memory from `localStorage` — a pure in-memory or module-level `Map` is insufficient because it is wiped by every renderer reload

#### Scenario: Identical-model scanners on the same hub do not collide

- **GIVEN** two Epson V850 scanners are connected to the same USB hub
- **AND** both have `usb_port: ''` (platform did not populate port info)
- **WHEN** the fallback key is computed for each
- **THEN** the keys SHALL differ because the composite fallback `${vendor_id}:${product_id}:${name}:${usb_bus}:${usb_device}` distinguishes them via `usb_bus` and `usb_device`
- **AND** an unchecked state on one SHALL NOT propagate to the other
- **AND** saving one but not the other SHALL produce exactly one `GraviScanner` row from this save operation

#### Scenario: Save is guarded against rapid double-click re-entrancy

- **GIVEN** the user clicks Save once and the IPC round-trip is still in flight
- **WHEN** the user clicks Save again before the first call resolves
- **THEN** the Save Configuration button SHALL be visually disabled and SHALL NOT trigger a second IPC call
- **AND** the in-flight call SHALL complete normally
- **AND** the Save button SHALL re-enable only after the first call resolves (success or failure)

#### Scenario: Save re-arms and fires a fresh IPC call after successful resolution

- **GIVEN** the user clicks Save once and the IPC round-trip completes successfully
- **WHEN** the user clicks Save a second time
- **THEN** a fresh IPC round-trip SHALL fire
- **AND** the re-entrancy guard SHALL NOT latch the button in a permanently-disabled state

#### Scenario: Auto-save on resolution change writes the same scanners as manual save

- **GIVEN** the user has detected N scanners with all enabled
- **AND** the user changes the resolution selector
- **WHEN** the debounced auto-save fires (500ms after the change)
- **THEN** `saveScannersToDB` SHALL be called with exactly N entries matching the enabled scanners
- **AND** the payload SHALL NOT be empty just because `scannerAssignments` was filtered incorrectly
- **AND** `saveConfig` SHALL be called with the new resolution and the correct grid_mode
- **AND** `disableMissingScanners` SHALL be called with the same enabled-scanner identity list

#### Scenario: Unchecked scanners are marked disabled in the database

- **GIVEN** a scanner with `GraviScanner.enabled = true` was previously saved
- **WHEN** the user unchecks that scanner on the Scanner Configuration page and clicks Save
- **THEN** after the IPC round-trip, the corresponding `GraviScanner` row's `enabled` column SHALL be `false`
- **AND** the row SHALL NOT be deleted — its id remains valid so historical `GraviScan` FK references are preserved
- **AND** downstream consumers (Metadata page, BrowseGraviScans) that filter `GraviScanner.enabled = true` SHALL NOT render the scanner as active

#### Scenario: disableMissingScanners only touches scanners previously saved

- **GIVEN** the DB contains three `GraviScanner` rows and the user's current enabled list contains two of them
- **WHEN** the renderer calls `disableMissingScanners` with the USB identities of the two enabled scanners
- **THEN** the main-process handler SHALL set `enabled = false` on exactly one row (the one not in the list)
- **AND** SHALL NOT alter the two rows matching the enabled list
- **AND** matching SHALL be performed by `usb_port` primary with composite fallback (consistent with `saveScannersToDB`)

#### Scenario: Metadata JSON uses human-readable scanner name

- **GIVEN** a `GraviScanner` row has `display_name: "Bench 3 Scanner"` and `name: "Epson Perfection V850"`
- **WHEN** a scan completes and metadata.json is written for that scanner
- **THEN** the metadata.json `scanner_name` field SHALL be `"Bench 3 Scanner"` (the `display_name`)
- **AND** if `display_name` is `null`, the field SHALL be `"Epson Perfection V850"` (the `name`)
- **AND** only if both are missing SHALL the field fall back to the scanner id
- **AND** the value SHALL be resolved via a DB lookup in `session-handlers.ts` at scan-session start — not the UUID-only fallback previously shipped at line 196

#### Scenario: display_name default preserves admin-chosen values on re-save

- **GIVEN** a `GraviScanner` row with `display_name: "Bench 3 Scanner"` (admin-chosen override)
- **WHEN** the user clicks Save again without modifying `display_name`
- **THEN** the renderer SHALL send `display_name: undefined` for that scanner
- **AND** the main-process upsert SHALL preserve the existing `"Bench 3 Scanner"` via its `?? existing.display_name` fallback
- **AND** the persisted `display_name` SHALL remain `"Bench 3 Scanner"` (NOT overwritten with the auto-detected `scanner.name`)

#### Scenario: No scanners detected

- **GIVEN** the user is in GraviScan mode
- **WHEN** no USB scanners are connected and the user navigates to Scanner Configuration
- **THEN** the system SHALL display a message indicating no scanners found
- **AND** provide a Re-Detect button to retry detection
- **AND** the Save button SHALL be disabled

#### Scenario: Platform info display

- **GIVEN** the user is in GraviScan mode
- **WHEN** the Scanner Configuration page loads
- **THEN** the system SHALL call `getPlatformInfo` and display whether SANE/TWAIN backend is available and whether mock mode is active

#### Scenario: Scanner detection error or timeout

- **GIVEN** the user clicks Detect or Re-Detect
- **WHEN** scanner detection fails or times out
- **THEN** the system SHALL display a descriptive error message
- **AND** the Re-Detect button SHALL remain available for retry

#### Scenario: Previously saved scanner no longer connected

- **GIVEN** the database contains saved scanner records
- **WHEN** a saved scanner is not found in the current detection results
- **THEN** the system SHALL display that scanner with a "disconnected" or "missing" indicator
- **AND** the user SHALL be able to re-detect to check if it was reconnected
