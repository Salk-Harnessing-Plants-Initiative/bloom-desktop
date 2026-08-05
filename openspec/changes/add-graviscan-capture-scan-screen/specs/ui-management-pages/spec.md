## ADDED Requirements

### Requirement: GraviScan Capture Scan Screen Routing and Navigation

While in GraviScan mode, `App.tsx` SHALL register a `/capture-scan` route
rendering `GraviScan.tsx`, inside the existing `mode === 'graviscan'`
conditional block (matching the pattern already used for
`/configure-scanner`). `Layout.tsx`'s `graviscanLinks` array SHALL include a
"Capture Scan" entry pointing at this route. `WorkflowSteps.tsx`'s existing
graviscan step 5 ("Capture Scan", `route: '/capture-scan'`) requires no
change — the route now exists.

While in CylinderScan mode, this route SHALL NOT be registered; the
existing `mode === 'cylinderscan'` block's own `capture-scan` route
(`CaptureScan.tsx`) is unaffected.

#### Scenario: Capture Scan workflow tile navigates to a working screen

- **GIVEN** GraviScan mode is active
- **WHEN** the operator clicks the "Capture Scan" tile on the Home page
- **THEN** the app SHALL navigate to `/capture-scan` and render `GraviScan.tsx`
- **AND** the operator SHALL NOT be redirected to Home

#### Scenario: Sidebar nav link is present in GraviScan mode

- **GIVEN** GraviScan mode is active
- **WHEN** the sidebar renders
- **THEN** a "Capture Scan" link SHALL be present, pointing at `/capture-scan`

#### Scenario: CylinderScan mode's own Capture Scan route is unaffected

- **GIVEN** CylinderScan mode is active
- **WHEN** the operator navigates to `/capture-scan`
- **THEN** the existing `CaptureScan.tsx` page SHALL render, unchanged from
  today

---

### Requirement: GraviScan Plate Assignment Auto-Fill and Manual Override

The Capture Scan screen SHALL auto-populate each assigned scanner's plate
positions (`plantBarcode`, `transplantDate`, `customNote`, `selected`) from
the current wave's linked metadata, when one exists: resolve the accession
linked to `(experimentId, waveNumber)` via
`window.electron.database.experiments.listGraviMetadata(experimentId)`,
then load that accession's plates via
`window.electron.database.graviPlateAccessions.list(accessionId)`.

`plantBarcode`, `transplantDate`, and `customNote` SHALL be rendered as
editable inputs at all times — auto-fill pre-populates these fields, it
SHALL NOT render them as read-only text or otherwise prevent the operator
from correcting an auto-filled value. A per-position dirty flag SHALL be
set whenever the operator edits any of `plantBarcode`/`transplantDate`/
`customNote`/`selected` for that position. If the auto-fill effect re-runs
for any reason (wave change, experiment change, scanner reassignment) while
a position's dirty flag is set, that position's current values SHALL be
preserved, not overwritten by the fresh auto-fill computation. Every
position's dirty flag SHALL be cleared when the operator switches wave or
experiment (a new wave's auto-fill is a fresh start).

If no wave metadata is linked for the current `(experimentId, waveNumber)`,
plate positions SHALL default to empty, editable fields (manual entry) —
the screen SHALL NOT reuse another wave's auto-filled values.

#### Scenario: Auto-fill populates fields from the current wave's linked metadata

- **GIVEN** wave 2 of an experiment is linked (via `listGraviMetadata`) to
  an accession with 4 `GraviPlateAccession` rows
- **AND** 2 scanners are assigned, each in `2grid` mode (2 positions each)
- **WHEN** the operator selects wave 2
- **THEN** the 4 plate positions SHALL be auto-populated with the
  accession's plate IDs, transplant dates, and custom notes, in metadata-row
  order

#### Scenario: Operator can edit an auto-filled field

- **GIVEN** a plate position was auto-filled with `plantBarcode: "Plate_04"`
- **WHEN** the operator changes the field to `"Plate_04b"`
- **THEN** the input SHALL accept the edit
- **AND** that position's dirty flag SHALL be set

#### Scenario: A manual edit survives an auto-fill re-run

- **GIVEN** a plate position's dirty flag is set after a manual edit (per
  the scenario above)
- **WHEN** the auto-fill effect re-runs (e.g. because a different scanner
  was assigned)
- **THEN** the edited position's values SHALL be unchanged
- **AND** other, non-dirty positions SHALL be freshly auto-filled

#### Scenario: Dirty flags clear on wave switch

- **GIVEN** one or more plate positions have their dirty flag set for wave 2
- **WHEN** the operator switches to wave 3
- **THEN** all dirty flags SHALL be cleared
- **AND** wave 3's positions SHALL be freshly auto-filled (or left empty, if
  wave 3 has no linked metadata) without inheriting wave 2's manual edits

#### Scenario: No linked metadata falls back to manual, empty entry

- **GIVEN** the current wave has no `GraviExperimentWaveMetadata` link
- **WHEN** the operator views the plate assignment grid
- **THEN** all fields SHALL be empty and editable
- **AND** no other wave's auto-filled values SHALL appear

---

### Requirement: GraviScan Scan Session Controls

The Capture Scan screen SHALL provide Start, Cancel, and continuous-mode
(interval/duration) controls.

`handleCancelScan` SHALL be `async`, awaited by its click handler, and
wrapped in a `try`/`catch`. A rejection SHALL surface an inline error banner
and SHALL NOT leave the screen showing "scanning" state indefinitely with no
feedback.

Before computing `totalCycles` for a continuous/interval scan, the interval
value SHALL be validated as a positive integer greater than zero. A
zero-or-negative interval SHALL be rejected with an inline validation
message before `startScan()` is ever called — the screen SHALL NOT rely
solely on an upstream form-level minimum-interval clamp to prevent this.

#### Scenario: Cancel awaits the IPC call and surfaces a rejection

- **GIVEN** a scan is in progress
- **WHEN** the operator clicks "Cancel" and the underlying
  `window.electron.gravi.cancelScan()` call rejects
- **THEN** an inline error banner SHALL display the failure
- **AND** the screen SHALL NOT silently remain in "scanning" state with no
  indication anything went wrong

#### Scenario: Cancel succeeds and resets scan state

- **GIVEN** a scan is in progress
- **WHEN** the operator clicks "Cancel" and `cancelScan()` resolves
  successfully
- **THEN** pending jobs SHALL be cleared, `isScanning` SHALL become `false`,
  and scanner states SHALL return to idle

#### Scenario: A zero interval is rejected before starting a continuous scan

- **GIVEN** the operator has set the interval field to `0` (e.g. via a
  malformed input bypassing the form's own clamp)
- **WHEN** the operator clicks "Start" for a continuous scan
- **THEN** the screen SHALL show an inline validation error
- **AND** `startScan()` SHALL NOT be called with an interval of `0`

---

### Requirement: GraviScan Session Restore on Renderer Navigation

The Capture Scan screen SHALL restore in-progress scan UI state (pending
jobs, elapsed time, continuous-mode countdown, selected experiment/
phenotyper/wave/resolution) when the operator navigates away and back to
`/capture-scan` while the main process's `ScanSessionState` remains active,
by calling `getScanStatus()` on mount and rehydrating from its
`isActive: true` response.

This restoration SHALL NOT be presented as surviving a full application
restart: the underlying `ScanSessionState` is an in-memory main-process
value with no disk/DB rehydration on app launch, so a scan in progress at
the moment of a full quit SHALL be lost from the app's perspective (though
already-completed `GraviScan`/`GraviImage` rows and image files remain in
the database/filesystem regardless).

#### Scenario: Navigating away and back during an active scan restores progress

- **GIVEN** a continuous scan is in progress with 6 of 12 jobs completed
- **WHEN** the operator navigates to another page and back to
  `/capture-scan`
- **THEN** the screen SHALL show the scan as still in progress, with the
  6/12 completed-job count and elapsed/countdown timers restored

#### Scenario: A full app restart does not restore an in-progress scan

- **GIVEN** a continuous scan was in progress when the application was
  fully quit and relaunched
- **WHEN** the operator navigates to `/capture-scan` after relaunch
- **THEN** the screen SHALL show no active scan (matching
  `getScanStatus()`'s `{ isActive: false }` response after a restart)
- **AND** this SHALL NOT be treated as a bug by this tier's tests — it is
  documented, expected behavior (see design.md Non-Goals)

---

### Requirement: GraviScan Test Scan

The Capture Scan screen SHALL provide a "Test Scan" action, independent of
an active scan session, that captures a single one-shot image per assigned
scanner (via the existing `scanOnce()` backend path, not a new backend
capability) to verify camera/plate alignment before starting a real
session.

Test Scan SHALL resolve its output directory via
`window.electron.gravi.getOutputDir()`. If that call fails, the screen
SHALL show a blocking inline error and SHALL NOT substitute a hardcoded
fallback path (e.g. `/tmp`).

#### Scenario: Test scan captures without starting a session

- **GIVEN** no scan session is active
- **WHEN** the operator clicks "Test Scan"
- **THEN** each assigned scanner SHALL capture one image
- **AND** `isScanning`/session state SHALL remain unaffected (no session
  is started)

#### Scenario: Test scan surfaces an output-directory failure

- **GIVEN** `getOutputDir()` resolves with `{ success: false }`
- **WHEN** the operator clicks "Test Scan"
- **THEN** the screen SHALL show a blocking inline error naming the failure
- **AND** SHALL NOT attempt the capture against a hardcoded fallback path

---

### Requirement: GraviScan QR Verification Result Banner

After a scan session completes, the Capture Scan screen SHALL invoke
`graviscan:verify-plates` with the current `experimentId` and `waveNumber`,
and display a graded-severity result banner based on the returned
per-plate `verification_status` values:

- **Red** ("Duplicate QR Codes Detected") when any plate has status
  `duplicate_qr`.
- **Amber** ("Some Plates Unreadable" / "Manual Review Needed" /
  "Plate Mismatch Detected") when, absent any `duplicate_qr`, any plate has
  status `unreadable`, `needs_review`, `incorrect`, or `lookup_failed`.
- **Green** ("QR Verification Complete") when every plate has status
  `verified` or `swapped`.

`incorrect` and `lookup_failed` SHALL each render their own distinct label
and detail text — neither SHALL be collapsed into the `unreadable` label,
since they indicate different operator remedies (re-image the plate vs.
retry the run).

#### Scenario: Duplicate QR codes produce the red banner

- **GIVEN** a completed scan's verification results include at least one
  plate with status `duplicate_qr`
- **WHEN** the verification banner renders
- **THEN** it SHALL show the red, "Duplicate QR Codes Detected" state

#### Scenario: A lone incorrect plate does not render as unreadable

- **GIVEN** a completed scan's verification results include exactly one
  plate with status `incorrect` and no `duplicate_qr` plates
- **WHEN** the verification banner renders
- **THEN** it SHALL show an amber state with a label distinct from "QR
  Unreadable" (e.g. naming the plate mismatch specifically)

#### Scenario: A lookup failure does not render as unreadable

- **GIVEN** a completed scan's verification results include exactly one
  plate with status `lookup_failed`
- **WHEN** the verification banner renders
- **THEN** it SHALL show an amber state with a label distinct from "QR
  Unreadable", indicating the lookup itself failed and the run should be
  retried

#### Scenario: All plates verified renders the green banner

- **GIVEN** every plate in a completed scan's verification results has
  status `verified` or `swapped`
- **WHEN** the verification banner renders
- **THEN** it SHALL show the green, "QR Verification Complete" state naming
  the count of plates verified

#### Scenario: Verification is invoked with the current wave number

- **GIVEN** the operator is scanning wave 3 of an experiment
- **WHEN** the scan session completes and verification runs
- **THEN** `graviscan:verify-plates` SHALL be invoked with `waveNumber: 3`
  alongside `experimentId`, per the "Wave-scoped plate lookup" scenario in
  the `scanning` capability
