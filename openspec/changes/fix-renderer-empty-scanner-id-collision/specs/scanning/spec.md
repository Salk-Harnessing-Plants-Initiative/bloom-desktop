## MODIFIED Requirements

### Requirement: GraviScan Scanner Configuration Page

The system SHALL provide a Scanner Configuration page at `/scanner-config` (visible only in GraviScan mode) that allows users to detect connected USB scanners, compare detected scanners against saved DB records, configure grid mode (2grid/4grid) and resolution (DPI), and persist scanner and config records to the database.

Scanner enablement SHALL be modeled as `ScannerAssignment.scannerId !== null` (one source of truth across ScannerConfig, Metadata, GraviScan pages and their hooks). When detection returns N scanners, the system SHALL populate `scannerAssignments` with N entries whose `scannerId` matches each detected scanner, and the "Enabled" checkbox SHALL toggle that assignment between set and `null`. Only enabled scanners SHALL be persisted when the user saves. Save SHALL provide explicit visual feedback (success or error banner) so the user knows their configuration was committed — or, on failure, why it was not.

A scanner the user has previously disabled (`GraviScanner.enabled = false` in the DB) SHALL still appear on the page with an unchecked "Enabled" checkbox, allowing the user to re-enable it. This is the only UI path to re-enable a disabled scanner — a Catch-22 where disabled scanners disappear from the page would leave the user unable to recover them without direct DB edits.

**Stable-identity key for enabled/disabled memory.** The unchecked-state memory across re-detection SHALL be keyed by `usb_port` as the primary key. `DetectedScanner.usb_port` is typed `string` and is `''` (empty, not `null`) when the platform does not populate it. When `usb_port` is empty, the fallback key SHALL be the composite `${vendor_id}:${product_id}:${name}:${usb_bus}:${usb_device}` — the full composite avoids collisions between identical-model scanners on the same hub. The fallback predicate is `!usb_port`, not `usb_port === null`. The unchecked-state memory SHALL be persisted to `localStorage` so it survives page reload, HMR, and navigation-away-and-back.

**Lookup-key invariant for assignment ↔ detected resolution (renderer-wide).** Every renderer site that resolves a `ScannerAssignment` to its corresponding `DetectedScanner` (or vice versa) SHALL match by `usb_port` with the same composite-fallback key used for unchecked-state memory — NEVER by `scanner_id` / `scannerId`. The `scanner_id` field is `''` (empty-string sentinel) for fresh-install placeholder scanners that have not yet been persisted to the DB; multiple placeholder scanners therefore share the same `scanner_id` value, and `Array.find((s) => s.scanner_id === a.scannerId)` collisions cause N assignments to resolve to the same first detected scanner. This invariant also applies to same-direction lookups (`scannerStates.find((s) => s.scannerId === a.scannerId)`, `assignments.some((a) => a.scannerId === scanner.scannerId)`) — `ScannerPanelState` SHALL carry a `usbPort` field populated at construction time so these same-direction lookups can key on `usbPort` instead of `scannerId`. The canonical helpers `findDetectedForAssignment()`, `findIndexDetectedForAssignment()`, and `findAssignmentForDetected()` (declared in `src/types/graviscan.ts`) SHALL be used at every renderer call site to enforce this invariant. A repository-wide lint rule (or grep-based CI check) SHALL flag any new `\.scanner_id === .*\.scannerId` or `\.scannerId === .*\.scanner_id` patterns introduced outside of the helper definitions.

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
- **AND** each assignment's `usbPort` SHALL be populated from the detected scanner's `usb_port` (the canonical stable-identity key)
- **AND** each rendered scanner's "Enabled" checkbox SHALL reflect `scannerId !== null`
- **AND** for fresh-install placeholder scanners (where `DetectedScanner.scanner_id` is the empty-string sentinel), `scannerAssignments[i].scannerId` SHALL preserve the empty-string value rather than coercing to `null` — the empty string is non-null, the checkbox renders checked, and the user defaults to "save these new scanners". The renderer SHALL filter empty-string ids out of any IPC call that uses `scannerId` as a foreign key (`isDbScannerId()` helper) so placeholder ids never reach Prisma. Real DB ids replace the placeholders after the first successful Save + re-detect.
- **AND** every renderer site that needs to resolve `scannerAssignments[i]` back to its `DetectedScanner` SHALL use `findDetectedForAssignment()` (which matches by `usb_port` with composite fallback), not `Array.find((s) => s.scanner_id === a.scannerId)` (which collides on the empty-string sentinel).

#### Scenario: Assignment-to-detected lookup matches by usb_port, not scanner_id

- **GIVEN** detection returns two placeholder scanners with `scanner_id: ''` and distinct `usb_port` values (e.g., `'1-1'` and `'1-2'`)
- **AND** `scannerAssignments` has two entries that preserve the empty-string `scannerId` and carry the corresponding `usbPort` values
- **WHEN** the renderer resolves each assignment back to its detected scanner via `findDetectedForAssignment(detectedScanners, assignment)`
- **THEN** the assignment with `usbPort: '1-1'` SHALL resolve to the detected scanner whose `usb_port` is `'1-1'`
- **AND** the assignment with `usbPort: '1-2'` SHALL resolve to the detected scanner whose `usb_port` is `'1-2'`

#### Scenario: Detected-to-assignment inverse lookup matches by usb_port

- **GIVEN** the same two placeholder scanners and assignments above
- **WHEN** the renderer iterates detected scanners and resolves each back to its assignment via `findAssignmentForDetected(scannerAssignments, detected)` (the inverse direction used in `useTestScan.ts`)
- **THEN** detected scanner with `usb_port: '1-1'` SHALL resolve to the assignment with `usbPort: '1-1'`
- **AND** detected scanner with `usb_port: '1-2'` SHALL resolve to the assignment with `usbPort: '1-2'`
- **AND** neither lookup SHALL collide on the shared `''` `scanner_id` sentinel

#### Scenario: Empty-usb_port platforms use composite fallback

- **GIVEN** a platform that does not populate `usb_port` (e.g., some Linux configurations) emits two detected scanners both with `usb_port: ''`
- **AND** the two scanners have distinct `(vendor_id, product_id, name, usb_bus, usb_device)` tuples
- **WHEN** the renderer resolves each assignment via `findDetectedForAssignment` (or the inverse helper)
- **THEN** the helper SHALL fall back to the composite key `${vendor_id}:${product_id}:${name}:${usb_bus}:${usb_device}` rather than treating empty `usb_port` as a wildcard match
- **AND** each lookup SHALL return the correct corresponding scanner (no collision on empty `usb_port`)
- **AND** Save SHALL persist exactly two distinct `GraviScanner` rows on these platforms

#### Scenario: ScannerPanelState carries usb_port for same-direction lookups

- **GIVEN** the GraviScan page initializes `scannerStates` from `scannerAssignments` and `detectedScanners`
- **WHEN** `ScannerPanelState` is constructed
- **THEN** the panel state SHALL include a `usbPort` field populated from the corresponding detected scanner's `usb_port`
- **AND** subsequent same-direction lookups like `scannerStates.find((s) => ...)` and `assignments.some((a) => ...)` SHALL match on `usbPort` (or composite fallback) rather than `scannerId`
- **AND** these same-direction lookups SHALL NOT collide when two `ScannerPanelState` entries share `scannerId === ''`

#### Scenario: Save with two placeholder scanners persists two DB rows

- **GIVEN** a fresh-install state with no `GraviScanner` rows in the DB
- **AND** the renderer detects two placeholder scanners with `scanner_id: ''` and distinct `usb_port` values
- **AND** both "Enabled" checkboxes are checked
- **WHEN** the user clicks Save
- **THEN** `saveScannersToDB` SHALL receive a payload of exactly two distinct entries (one per `usb_port`)
- **AND** the `GraviScanner` table SHALL contain two rows after Save completes
- **AND** the previously failing assertion `expect(scannerCount).toBeGreaterThanOrEqual(2)` in `tests/e2e/graviscan-scanner-config-save.e2e.ts` SHALL pass

#### Scenario: Recovery from pre-fix collapsed-row state

- **GIVEN** a user upgraded from the buggy commit range (`3689c6b` through this fix's parent commit)
- **AND** the DB contains exactly one collapsed `GraviScanner` row (the pre-fix Save persisted only one of N detected scanners)
- **AND** the user's machine still has all N physical scanners connected
- **WHEN** the user navigates to the Scanner Configuration page after pulling the fix
- **THEN** detection SHALL surface N detected scanners — one with the real DB id (matched by `usb_port` to the surviving row) and N-1 with `scanner_id: ''` placeholders
- **AND** all N "Enabled" checkboxes SHALL render checked by default
- **WHEN** the user clicks Save
- **THEN** `saveScannersToDB` SHALL receive N distinct entries
- **AND** the DB SHALL contain N rows after Save (the surviving row updated; N-1 new rows inserted)
- **AND** the success banner SHALL report "N scanners saved" (the user-visible signal that recovery is complete)

#### Scenario: isScannerEnabled gates Start Scan on real DB ids only

- **GIVEN** a `ScannerAssignment` with `scannerId: ''` (placeholder, not yet saved to DB)
- **WHEN** `useScanSession.isScannerEnabled(scannerId)` is called with `''`
- **THEN** the function SHALL return `false`
- **AND** the user SHALL NOT be able to start a scan that would attempt to use `''` as a `GraviScanner.id` foreign key in `Scan` rows
- **AND** the function SHALL return `true` only when the assignment's `scannerId` satisfies `isDbScannerId()` (non-empty string)

#### Scenario: isScannerEnabled gates Test Scan on real DB ids only

- **GIVEN** a `ScannerAssignment` with `scannerId: ''` (placeholder, not yet saved to DB)
- **WHEN** the user clicks "Test All Scanners" via `useTestScan.handleTestAllScanners`
- **THEN** the placeholder assignment SHALL be filtered out via `isDbScannerId()` BEFORE the test scan dispatch
- **AND** the IPC `startScan` call SHALL NOT include any scanner with a placeholder id
- **AND** if all assignments have placeholder ids, the test SHALL be a no-op (early return), preventing FK violations downstream

#### Scenario: Detection equilibrium after save+re-detect (regression guard)

- **GIVEN** N physical scanners are connected on a fresh install with `dbScanners.length === 0`
- **AND** the user has checked all N "Enabled" checkboxes
- **WHEN** the user clicks Save and the post-save `handleDetectScanners` resolves
- **THEN** `detectedScanners.length` SHALL equal N (the DB row count post-save), not greater
- **AND** all entries in `detectedScanners` SHALL have non-empty `scanner_id` (real DB UUIDs)
- **AND** no two entries in `detectedScanners` SHALL share the same `usb_port`
- **AND** `scannerAssignments.length` SHALL equal N
- **AND** if the user then unchecks the first checkbox via `handleScannerAssignment(0, null)`, the resulting state SHALL still satisfy `detectedScanners.length === N` (uncheck does not mutate the detected list)
- **AND** if the user then re-clicks Save, the auto-save id-remap SHALL NOT introduce duplicate or stale entries

#### Scenario: Auto-save id-remap distributes real UUIDs by usb_port

- **GIVEN** two placeholder scanners with `scanner_id: ''` and distinct `usb_port: '1-1'` and `'1-2'`
- **AND** the auto-save effect has fired and `saveScannersToDB` returned two `GraviScanner` rows with new UUIDs
- **WHEN** the renderer's id-remap step (`useScannerConfig.ts:618-623`) runs
- **THEN** the predicate SHALL match each `savedScanner` to its `assignedScanners` entry by `usb_port` (with composite fallback for empty-port platforms), NOT by `scanner_id === tempId` (which collides for placeholders)
- **AND** the renderer SHALL widen its narrowed `savedScanners` row type to expose `usb_port: string | null` so the predicate has the field available
- **AND** after the remap, both `scannerAssignments[0].scannerId` and `scannerAssignments[1].scannerId` SHALL be distinct real UUIDs (NOT both equal to the same UUID)
- **AND** `detectedScanners` SHALL likewise have its placeholder `''` rewritten to the matching real UUID per scanner

#### Scenario: Renderer filters empty-string scannerId out of FK-bound payloads

- **GIVEN** an assignment with `scannerId: ''`
- **WHEN** any renderer site builds an IPC payload that uses `scannerId` as a Prisma foreign key (e.g., `assignedScannerIds` in `GraviScan.tsx`, `enabledIdentities` in `useScannerConfig.ts`, scan-start payload in `useScanSession.ts`)
- **THEN** the renderer SHALL filter the assignment via `isDbScannerId(a.scannerId)` (NOT `a.scannerId !== null`, which lets `''` through)
- **AND** the IPC handler SHALL NEVER receive `''` as a `scannerId`
- **AND** the `Scan.scanner_id` foreign key SHALL never be set to `''` for any row this renderer creates

#### Scenario: ScannerPanelState React keys do not collide on placeholder ids

- **GIVEN** two `ScannerPanelState` entries with `scannerId: ''` and distinct `usbPort: '1-1'` and `'1-2'`
- **WHEN** the GraviScan page renders the scanner list (`scannerStates.map((scanner, idx) => <div key={...}>...)`)
- **THEN** the React `key` SHALL derive from `scanner.usbPort` (with `slot-${idx}` fallback for the empty-port edge case), NOT from `scanner.scannerId`
- **AND** React SHALL NOT emit "Encountered two children with the same key" warnings
- **AND** the order of the rendered scanners SHALL be stable across re-renders

#### Scenario: Re-checking a previously unchecked placeholder scanner preserves its usb_port

- **GIVEN** a detected placeholder scanner with `scanner_id: ''` and `usb_port: '1-1'`
- **AND** the user previously unchecked its "Enabled" checkbox (assignment.scannerId is `null`, assignment.usbPort is `null`)
- **WHEN** the user re-checks the checkbox via `handleScannerAssignment(slotIndex, '')`
- **THEN** the assignment SHALL be updated to `{ scannerId: '', usbPort: '1-1', ... }`
- **AND** the assignment SHALL NOT be coerced to `{ scannerId: null, usbPort: null, ... }` by an `if (scannerId)` truthiness check that treats `''` as falsy

#### Scenario: Disabled scanner from DB is rendered as unchecked but visible

- **GIVEN** the user previously unchecked Scanner B and clicked Save (DB now has `enabled = false` for Scanner B)
- **WHEN** the user navigates back to the Scanner Configuration page in a later session
- **THEN** the page SHALL display BOTH Scanner A and Scanner B in the detected-scanners list
- **AND** Scanner B's "Enabled" checkbox SHALL be unchecked
- **AND** Scanner A's "Enabled" checkbox SHALL be checked
- **AND** the user SHALL be able to click Scanner B's checkbox to re-enable it
- **AND** clicking Save with both checked SHALL set both DB rows' `enabled = true`

#### Scenario: Save scanner configuration persists every enabled scanner

- **GIVEN** N scanners are detected and all N have their "Enabled" checkbox checked
- **WHEN** the user selects a grid mode and resolution and clicks Save
- **THEN** the system SHALL call `saveConfig` with the selected grid_mode and resolution
- **AND** call `saveScannersToDB` with an array of exactly N entries
- **AND** each entry SHALL include `name`, `vendor_id`, `product_id`, `usb_port`, `usb_bus`, `usb_device`, and `display_name`
- **AND** the renderer SHALL pass `display_name: scanner.name` as the default when no user override exists, or `display_name: undefined` when the user has not explicitly set a value (so the main-process upsert can preserve existing admin-chosen `display_name` via its `?? existing.display_name` fallback)
- **AND** each payload entry SHALL NOT include `scanner_id` (the DB row's id is server-side state)
- **AND** the persisted `GraviConfig.grid_mode` SHALL equal the grid mode selected in the UI (not the `'2grid'` fallback)
- **AND** the renderer SHALL build the payload by resolving each enabled assignment via `findDetectedForAssignment()` (matched by `usb_port` with composite fallback) so two placeholder assignments with `scanner_id: ''` resolve to two distinct detected scanners, not one scanner duplicated.

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
- **AND** this matching priority SHALL be consistent with the renderer's unchecked-state key and assignment-lookup helpers

#### Scenario: matchDetectedToDb uses the same priority as saveScannersToDB

- **GIVEN** a saved `GraviScanner` row at `usb_port: '1-1'` with `usb_bus: 1`, `usb_device: 4`
- **AND** a USB reconnect causes the kernel to reassign `usb_device: 8` (same scanner, same `usb_port`)
- **WHEN** detection runs and `matchDetectedToDb` resolves the detected scanner against the DB
- **THEN** the function SHALL match by `usb_port` first (returning the saved row)
- **AND** SHALL NOT match by `usb_bus + usb_device` first (which would fail because `usb_device` changed)
- **AND** the fallback SHALL be the composite `(vendor_id, product_id, name, usb_bus, usb_device)` — same priority as `saveScannersToDB`
- **AND** this closes the missed inversion from change `fix-scanner-config-save-flow` (which inverted `saveScannersToDB` but not `matchDetectedToDb`)

#### Scenario: matchDetectedToDb matches legacy rows where usb_port is null

- **GIVEN** a saved `GraviScanner` row written before `usb_port` was populated (`usb_port: null`, `usb_bus: 1`, `usb_device: 4`, `vendor_id: '04b8'`, `product_id: '013a'`, `name: 'Epson Perfection V600 Photo'`)
- **AND** detection now returns a scanner with the same `(vendor_id, product_id, name, usb_bus, usb_device)` tuple AND a non-null `usb_port: '1-1'`
- **WHEN** `matchDetectedToDb` resolves the detected scanner against the DB
- **THEN** the `usb_port` predicate SHALL skip (saved value is null; cannot equality-match a non-null value)
- **AND** the composite-fallback predicate SHALL match
- **AND** the saved row SHALL be returned with its `usb_port` opportunistically updated to `'1-1'` on the next save (no silent regression of legacy rows)
- **AND** legacy rows whose `name` was renamed via direct DB edit (e.g., admin set a `display_name`-style override into the `name` column) MAY fail the composite match — this is documented as a Non-Goal: such rows SHALL be re-saved via the Scanner Configuration page on next detection to repopulate `usb_port`

#### Scenario: Detection result is sorted by usb_port using a numeric-aware comparator

- **GIVEN** scanners physically connected at `usb_port: '1-2'`, `'1-10'`, and `'1-1'` (a hub with ≥10 ports)
- **WHEN** `lsusb` enumeration returns them in non-port order (kernel scheduling-dependent)
- **THEN** `lsusb-detection.ts`'s detection result SHALL sort the deduplicated list by `usb_port` ascending using a **numeric-aware comparator** (split on `-`, parse each segment as `parseInt`, compare numerically)
- **AND** the sorted order SHALL be `['1-1', '1-2', '1-10']` (NOT lexicographic `['1-1', '1-10', '1-2']`)
- **AND** non-numeric segments SHALL fall back to lexicographic compare (defensive against unexpected platforms)
- **AND** empty-port entries (`''`) SHALL sort to a stable position (typically before all numeric entries) without crashing
- **AND** the renderer's row order SHALL be deterministic across sessions and across kernel re-enumeration
- **AND** identical-model scanners SHALL NOT silently swap visual row positions between sessions when no physical change occurred
- **AND** the operator's "row 1 = bench-left scanner" mental model SHALL be preserved across sessions

#### Scenario: scanner_name is refreshed per cycle for long interval scans

- **GIVEN** a continuous-mode scan session has started with N=12 cycles, 5-minute interval
- **AND** the operator updates a scanner's `display_name` (via the editor — see proposal `surface-scanner-identity-on-metadata-page`) between cycle 3 and cycle 4
- **WHEN** cycle 4's `scanOnce` runs and writes metadata.json files
- **THEN** the metadata.json `scanner_name` field SHALL reflect the updated `display_name` (NOT the value frozen at scan-start)
- **AND** the implementation SHALL re-query `db.graviScanner.findMany({where:{id:{in:scannerIds}}})` per cycle and rebuild `sessionContext.scannerNames`
- **AND** cycles 1-3 SHALL retain the original `display_name` in their metadata.json files (per-cycle freshness, not retroactive rewrite)
- **AND** the audit log (Proposal 2's `GraviScannerBinding` table) SHALL record the rename event so reviewers can reconstruct when cycle N's name became cycle N+1's name

#### Scenario: per-cycle scannerName refresh filters placeholder ids before DB query

- **GIVEN** the per-cycle refresh path runs inside `scanOnce`
- **AND** `sessionContext.scannerIds` somehow contains an empty-string placeholder `''` (defense-in-depth — should not happen post-fix, but the guard hardens against future regressions)
- **WHEN** the implementation builds the Prisma query
- **THEN** it SHALL filter `scannerIds` via `isDbScannerId()` BEFORE the `db.graviScanner.findMany({where:{id:{in:realIds}}})` call
- **AND** the empty-string id SHALL NOT reach the Prisma query (which would silently return no rows AND leave `ctx.scannerNames.get('')` undefined)
- **AND** the metadata.json write fallback SHALL be `ctx.scannerNames.get(scannerId) || (isDbScannerId(scannerId) ? scannerId : 'unknown-scanner')` so empty-string `scanner_name` NEVER appears in metadata.json
- **AND** the map reassignment (`ctx.scannerNames = next`) SHALL be a single atomic statement so concurrent reads observe either the old or the new map, never a half-mutated state

#### Scenario: Save shows success feedback to the user

- **GIVEN** the user clicks Save and `saveConfig`, `saveScannersToDB`, and `disableMissingScanners` all return success
- **WHEN** the IPC calls resolve
- **THEN** the page SHALL display a visible success banner styled with Tailwind classes `bg-green-50 border border-green-200 text-green-800`
- **AND** the banner text SHALL reference the number of scanners saved, the grid mode (rendered as "2-Grid" or "4-Grid" matching the radio labels), and the resolution in DPI
- **AND** the banner count SHALL match the number of distinct DB rows actually persisted (post-fix this matches the user's enabled-scanner count; pre-fix the banner could under-count when the collision collapsed N to 1)
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
- **AND** the payload SHALL be built via `findDetectedForAssignment()` so two placeholder assignments resolve to two distinct entries
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
- **AND** SHALL NOT alter the two rows matching the identity list
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
