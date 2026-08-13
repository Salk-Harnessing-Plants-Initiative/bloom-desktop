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
from correcting an auto-filled value.

Persisted plate-assignment data (`GraviScanPlateAssignment`) SHALL be
scoped per wave, not shared across every wave of an experiment — each
`(experimentId, scannerId, plateIndex, waveNumber)` combination reads and
writes its own row. When the auto-fill effect re-runs for a reason
**other than a wave change** (e.g. a scanner reassignment while staying on
the same wave), a position that already has a persisted row **for the
current wave** SHALL be treated as operator-overridden whenever that row's
values differ from what a fresh recomputation of the current wave's
auto-fill would produce, and SHALL be preserved rather than overwritten. A
position with **no persisted row yet for the current wave** SHALL NOT be
treated as overridden merely because "no value" trivially differs from a
computed one — it SHALL always be populated by the fresh auto-fill
computation. This is a derived comparison against the current wave's own
data, not a stored or purely in-memory flag, so it SHALL correctly
identify an override even immediately after the renderer remounts (e.g.
after navigating away and back) or after switching wave and back, not
only within the same continuous session on the same wave.

Switching wave or experiment SHALL show the newly-selected wave's own
persisted data (auto-filled fresh, if no override exists for that wave, or
empty if the new wave has no metadata link) — a _different_ wave's
persisted values SHALL NOT be compared against, loaded into, or otherwise
influence the newly-selected wave's positions, since each wave's data is
independently scoped.

Entering or changing `plantBarcode` manually, in either mode, SHALL
trigger a case-insensitive match against the currently-loaded
`GraviPlateAccession` list; on a match, `transplantDate` and `customNote`
SHALL be auto-populated from that plate's row (still subject to further
manual override per the paragraph above). A barcode with no match SHALL
leave `transplantDate`/`customNote` unchanged.

If no wave metadata is linked for the current `(experimentId, waveNumber)`,
plate positions SHALL default to empty, editable fields (manual entry) —
the screen SHALL NOT load or display any other wave's previously-persisted
assignment for the current scanner/position.

A linked accession that resolves to zero `GraviPlateAccession` rows SHALL
be visually distinguished (e.g. a warning-styled note naming the linked
accession) from the "no wave metadata link exists at all" empty state, so
an operator can tell an intentionally-manual wave apart from a likely
misconfigured link.

If `listGraviMetadata()` or `graviPlateAccessions.list()` rejects or
resolves with `{ success: false }`, the plate grid SHALL retain its
last-known state and show an inline error — it SHALL NOT crash, and SHALL
NOT silently render an empty grid indistinguishable from the
no-link-exists case.

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
- **WHEN** the operator changes the field to `"Plate_04b"` and it persists
- **THEN** the input SHALL accept the edit
- **AND** the position's persisted value (`"Plate_04b"`) now differs from
  what a fresh auto-fill recomputation would produce (`"Plate_04"`),
  which is what identifies it as operator-overridden

#### Scenario: A manual edit survives an auto-fill re-run

- **GIVEN** a plate position holds a persisted, operator-overridden value
  (per the scenario above)
- **WHEN** the auto-fill effect re-runs (e.g. because a different scanner
  was assigned)
- **THEN** the edited position's values SHALL be unchanged
- **AND** other positions, whose persisted values still match a fresh
  auto-fill computation, SHALL be freshly auto-filled

#### Scenario: A manual edit survives navigating away and back

- **GIVEN** a plate position holds a persisted, operator-overridden value
- **WHEN** the operator navigates away from `/capture-scan` and back,
  remounting the screen
- **THEN** the position SHALL still show the operator's overridden value,
  not the wave's auto-fill value — because the override is derived from a
  persisted-vs-computed comparison made fresh on every mount, not from
  in-memory-only state that a remount would otherwise reset

#### Scenario: A manual edit survives navigating away and back even if the save was still in flight at unmount time

- **GIVEN** the operator has just edited a plate position's field, and its
  persist write has not yet resolved
- **WHEN** the operator navigates away from `/capture-scan` before that
  write settles, then navigates back, remounting the screen
- **THEN** the fresh mount SHALL wait for that write to settle before
  reading the position's persisted state
- **AND** the position SHALL show the operator's edited value, not a
  blank/reverted value from a read that raced ahead of the still-in-flight
  write

#### Scenario: Switching wave recomputes the auto-fill baseline from scratch

- **GIVEN** one or more plate positions hold operator-overridden values for
  wave 2
- **WHEN** the operator switches to wave 3
- **THEN** wave 3's positions SHALL be freshly auto-filled (or left empty,
  if wave 3 has no linked metadata) — wave 2's persisted values SHALL NOT
  be compared against, loaded into, or otherwise influence wave 3's
  positions

#### Scenario: Switching to a wave with its own different metadata still resets, not compares

- **GIVEN** wave 2 has an operator-overridden value at scanner/position
  `(sc-1, 00)`
- **AND** wave 3 has its **own** `GraviExperimentWaveMetadata` link, to a
  different accession than wave 2's
- **WHEN** the operator switches to wave 3
- **THEN** position `(sc-1, 00)` SHALL show wave 3's own fresh auto-fill
  value
- **AND** wave 2's persisted value SHALL NOT be treated as an "override"
  of wave 3's fresh computation merely because it differs from it — the
  wave switch is an unconditional reset, not a comparison

#### Scenario: A wave-switch round-trip preserves each wave's own override

- **GIVEN** wave 2 has an operator-overridden value at scanner/position
  `(sc-1, 00)`
- **AND** wave 3 has its own, different linked metadata
- **WHEN** the operator switches to wave 3, then switches back to wave 2
- **THEN** wave 2's position `(sc-1, 00)` SHALL show the operator's
  original override, exactly as it was — not re-derived from a fresh
  auto-fill computation, and not lost
- **NOTE**: this is the critical regression case for this requirement —
  since each wave's plate-assignment data is independently scoped, wave
  3's auto-fill never touches wave 2's row, so there is nothing to lose or
  restore incorrectly on the round trip

#### Scenario: A brand-new position is never mistaken for an override

- **GIVEN** the current wave has linked metadata, and a plate position has
  no prior persisted `GraviScanPlateAssignment` row at all (first time
  this scanner/position has been assigned)
- **WHEN** auto-fill runs
- **THEN** the position SHALL be populated with the freshly computed
  auto-fill value
- **AND** it SHALL NOT be treated as operator-overridden

#### Scenario: Manual barcode entry auto-populates matching plate metadata

- **GIVEN** the currently-loaded `GraviPlateAccession` list includes a
  plate with `plate_id: "Plate_09"`, `transplant_date`, and `custom_note`
- **WHEN** the operator manually types `"plate_09"` (any casing) into a
  position's barcode field
- **THEN** that position's `transplantDate`/`customNote` SHALL be
  auto-populated from the matching plate's row
- **WHEN** the operator instead types a barcode with no match
- **THEN** `transplantDate`/`customNote` SHALL remain unchanged

#### Scenario: No linked metadata falls back to manual, empty entry

- **GIVEN** the current wave has no `GraviExperimentWaveMetadata` link
- **WHEN** the operator views the plate assignment grid
- **THEN** all fields SHALL be empty and editable
- **AND** no other wave's previously-persisted assignment SHALL appear —
  including a wave that has its own persisted `GraviScanPlateAssignment`
  rows from an earlier session

#### Scenario: A linked accession with zero plates is distinguished from no link

- **GIVEN** the current wave has a `GraviExperimentWaveMetadata` link, but
  the linked accession has zero `GraviPlateAccession` rows
- **WHEN** the operator views the plate assignment grid
- **THEN** the grid SHALL show a warning-styled note naming the linked
  accession, distinct in appearance from the plain "no link exists" empty
  state

#### Scenario: A metadata-lookup failure does not crash or silently empty the grid

- **GIVEN** `listGraviMetadata()` or `graviPlateAccessions.list()` rejects
  or resolves with `{ success: false }`
- **WHEN** the plate assignment grid attempts to auto-fill
- **THEN** the grid SHALL retain its last-known state and show an inline
  error
- **AND** it SHALL NOT crash
- **AND** it SHALL NOT render as a plain empty grid indistinguishable from
  the "no link exists" case

---

### Requirement: GraviScan Scan Session Controls

The Capture Scan screen SHALL provide Start, Cancel, and continuous-mode
(interval/duration) controls. The Interval and Duration fields SHALL use
the same unit (minutes) — an operator SHALL NOT be required to convert
between units to reason about how long a continuous session will run,
and this SHALL match the production rig's own convention (`interval` and
`duration` both in minutes) so operators moving between the two are not
misled by a mismatched default.

`handleCancelScan` SHALL be `async`, awaited by its click handler, and
wrapped in a `try`/`catch`. A rejection SHALL surface an inline error banner
and SHALL NOT leave the screen showing "scanning" state indefinitely with no
feedback.

Before computing `totalCycles` for a continuous/interval scan, the interval
value SHALL be validated as a positive integer greater than zero. A
zero-or-negative interval SHALL be rejected with an inline validation
message before `startScan()` is ever called — the screen SHALL NOT rely
solely on an upstream form-level minimum-interval clamp to prevent this.

"Start Scan" SHALL be disabled while any scanner currently assigned to this
session has an active, unacknowledged wedge. This SHALL reflect the same
wedge state the globally-mounted `WedgeBanner` shows — a wedge that
occurred while the operator was on a different screen SHALL still block
"Start Scan" the moment the operator navigates to Capture Scan, not only
wedges that occur while already on this screen (a separate, independent
wedge subscription local to this screen would miss the former case).
Starting a new scan against a jammed/paused scanner is more likely to
compound the problem than to help; the existing `WedgeBanner` remains the
operator's mechanism to acknowledge/retry it, and clearing the wedge
there re-enables "Start Scan" here.

Once a scan session starts, the experiment/phenotyper/wave selectors SHALL
be disabled for the lifetime of that session, and every in-flight job's
eventual database write and QR verification SHALL be attributed to the
experiment/phenotyper/wave the session actually started under — never to a
value an operator changes a selector to while jobs are still pending. This
SHALL hold whether the session was started fresh in this screen instance or
was already in progress and is being observed after a navigate-away-and-back
remount (per the "GraviScan Session Restore on Renderer Navigation"
requirement).

If the current wave has no linked wave metadata (per the "GraviScan Plate
Assignment Auto-Fill and Manual Override" requirement) and no plate
positions have been manually filled in, the screen SHALL show a
non-blocking inline warning before the operator starts a scan — this
warning SHALL NOT be the operator's only signal of the condition; today,
absent this warning, the first indication would otherwise arrive only via
the post-scan QR verification banner, after a potentially long unattended
continuous run has already completed.

While a continuous (multi-cycle) scan is running, the screen SHALL show
the current cycle number and total configured cycle count. While the
coordinator is between cycles (waiting for the next scheduled scan), the
screen SHALL show a non-blocking indicator naming that waiting state.
This is the operator's only in-app signal distinguishing "cycle 2 just
started, this is correct" from "the session silently ended" when
per-scanner progress resets from 100% back to 0% at a cycle boundary.

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

#### Scenario: Duration is entered in minutes, consistent with Interval

- **GIVEN** the operator opens the continuous-mode form
- **WHEN** the operator views the Interval and Duration fields
- **THEN** both SHALL be labeled and interpreted in minutes
- **AND** `startScan()`'s computed `duration_seconds` SHALL equal
  `durationMinutes * 60`, not a value derived from hours

#### Scenario: A zero interval is rejected before starting a continuous scan

- **GIVEN** the operator has set the interval field to `0` (e.g. via a
  malformed input bypassing the form's own clamp)
- **WHEN** the operator clicks "Start" for a continuous scan
- **THEN** the screen SHALL show an inline validation error
- **AND** `startScan()` SHALL NOT be called with an interval of `0`

#### Scenario: Start Scan is disabled while a scanner has an active wedge

- **GIVEN** a scanner assigned to this session has an active,
  unacknowledged wedge event
- **WHEN** the operator views the Capture Scan screen
- **THEN** the "Start Scan" control SHALL be disabled
- **WHEN** the wedge is later acknowledged/retried and clears
- **THEN** "Start Scan" SHALL become enabled again (assuming no other
  blocking condition)

#### Scenario: A wedge that occurred while away still blocks Start on return

- **GIVEN** a scanner assigned to this session wedges while the operator
  is viewing a different page (e.g. Browse Scans), and `WedgeBanner`
  correctly shows the entry there
- **WHEN** the operator navigates to the Capture Scan screen
- **THEN** "Start Scan" SHALL already be disabled on arrival, reflecting
  the wedge that occurred before this screen was mounted — the screen
  SHALL NOT show "Start Scan" as enabled merely because its own view of
  wedge state only began accumulating at mount time

#### Scenario: Experiment/phenotyper/wave selectors are locked while a scan is running

- **GIVEN** a scan session is in progress
- **WHEN** the operator views the Capture Scan screen
- **THEN** the experiment chooser, phenotyper chooser, and Wave number
  input SHALL all be disabled
- **AND** they SHALL become enabled again once the session ends

#### Scenario: A mid-scan wave switch does not misattribute an in-flight job's write or verification

- **GIVEN** a scan session started under wave 0
- **WHEN** a job from that session completes after the operator has since
  switched the Wave selector to wave 5
- **THEN** `database.graviscans.create(...)` SHALL be called with
  `wave_number: 0`, and the eventual QR verification call SHALL be scoped
  to wave 0 — never wave 5
- **AND** the session's own abnormal-termination marker (keyed by wave 0)
  SHALL be the one cleared when the session ends, not a marker for wave 5

#### Scenario: Missing wave metadata warns before scan start, not only after

- **GIVEN** the current wave has no linked wave metadata and no plate
  positions have been manually filled in
- **WHEN** the operator views the Capture Scan screen before clicking
  "Start"
- **THEN** a non-blocking inline warning SHALL be visible, naming the
  condition
- **AND** this warning SHALL NOT be gated behind starting and completing a
  scan first

#### Scenario: Cycle counter is visible during a multi-cycle continuous scan

- **GIVEN** a continuous scan is running with `currentCycle: 2` and
  `totalCycles: 3`
- **WHEN** the operator views the Capture Scan screen
- **THEN** a "Cycle 2 of 3" indicator SHALL be visible

#### Scenario: Cycle counter is not shown for a single-cycle session

- **GIVEN** a scan is running with `totalCycles: 1` (a single-shot,
  non-continuous session)
- **WHEN** the operator views the Capture Scan screen
- **THEN** no cycle-count indicator SHALL be shown

#### Scenario: Waiting-for-next-cycle indicator appears between cycles

- **GIVEN** a continuous scan's coordinator state is `waiting` (one
  cycle's scans finished, the next cycle's interval wait is in progress)
- **WHEN** the operator views the Capture Scan screen
- **THEN** a non-blocking "waiting for next cycle" indicator SHALL be
  visible
- **AND** it SHALL NOT be shown while the coordinator state is `scanning`
  or `idle`

#### Scenario: The waiting indicator is driven by a live event, not just a mount-time snapshot

- **GIVEN** a continuous scan is actively running, past its first cycle
- **WHEN** the backend emits `interval-waiting` for the current cycle
  boundary
- **THEN** the waiting indicator SHALL appear without requiring a
  navigation, remount, or any other action from the operator
- **WHEN** the backend then emits the first `scan-started` event of the
  next cycle
- **THEN** the waiting indicator SHALL disappear again, reflecting that
  scanning has resumed

---

### Requirement: GraviScan Session Restore on Renderer Navigation

The Capture Scan screen SHALL restore in-progress scan UI state (pending
jobs, elapsed time, continuous-mode countdown, selected experiment/
phenotyper/wave/resolution) when the operator navigates away and back to
`/capture-scan` while the main process's `ScanSessionState` remains active,
by calling `getScanStatus()` on mount and rehydrating from its
`isActive: true` response.

On each job completion, the screen SHALL call `markJobRecorded()` so the
main process's own record of that job's status advances past `pending` —
restoring in-progress-scan state on a later remount SHALL correctly exclude
jobs that had already completed before the remount from the restored
`pendingJobs`, and SHALL make each such job available to the eventual QR
verification call the same as a job that completes after the remount.

Each completed job's persisted `GraviScan.resolution` value SHALL be the
resolution the scan actually achieved (the `scan-complete` event's
`achieved_resolution` field), not the pre-scan requested DPI — falling back
to the requested value only if a given event omits the field.

This restoration SHALL NOT be presented as surviving a full application
restart: the underlying `ScanSessionState` is an in-memory main-process
value with no disk/DB rehydration on app launch, so a scan in progress at
the moment of a full quit SHALL be lost from the app's perspective (though
already-completed `GraviScan`/`GraviImage` rows and image files remain in
the database/filesystem regardless).

On successfully starting a scan, the screen SHALL record a local marker
(e.g. `localStorage`, keyed by the current `experimentId` and
`waveNumber`) naming the expected total cycle count. This marker SHALL be
removed when the scan is cancelled successfully or completes normally.
When `getScanStatus()` returns `isActive: false` on mount, the screen
SHALL check for a marker matching the **currently selected**
`experimentId`/`waveNumber`; if one is present, the previous session for
that exact wave never cleanly finished, and the screen SHALL show a
non-blocking informational banner naming the expected cycle count. A
marker belonging to a _different_ wave of the same experiment SHALL NOT
trigger this banner while viewing the current wave. This is read-only
with respect to scan state: it does not restore the session, it only
informs the operator that data completeness for that wave's most recent
session should be checked before being trusted downstream (e.g. before
upload).

#### Scenario: Navigating away and back during an active scan restores progress

- **GIVEN** a continuous scan is in progress with 6 of 12 jobs completed
- **WHEN** the operator navigates to another page and back to
  `/capture-scan`
- **THEN** the screen SHALL show the scan as still in progress, with the
  6/12 completed-job count and elapsed/countdown timers restored

#### Scenario: A job that completed before a remount is still included in QR verification after restore

- **GIVEN** a continuous scan is in progress with 6 of 12 jobs completed
- **WHEN** the operator navigates to another page and back to
  `/capture-scan`, and the session subsequently ends normally
- **THEN** the QR verification call SHALL include all 12 jobs' plates, not
  only the 6 that completed after the remount

#### Scenario: A completed job's persisted resolution reflects what the scanner actually achieved

- **GIVEN** a scan session's requested resolution is 1200 DPI
- **WHEN** a job's `scan-complete` event reports `achieved_resolution: 1180`
  (the SANE device rounded the request)
- **THEN** `database.graviscans.create(...)` SHALL be called with
  `resolution: 1180`, not `1200`

#### Scenario: A full app restart does not restore an in-progress scan

- **GIVEN** a continuous scan was in progress when the application was
  fully quit and relaunched
- **WHEN** the operator navigates to `/capture-scan` after relaunch
- **THEN** the screen SHALL show no active scan (matching
  `getScanStatus()`'s `{ isActive: false }` response after a restart)
- **AND** this SHALL NOT be treated as a bug by this tier's tests — it is
  documented, expected behavior (see design.md Non-Goals)

#### Scenario: An abnormally-terminated session is surfaced, not silently dropped

- **GIVEN** a scan was started for wave 3 (a marker was recorded) and the
  app was force-quit before it cancelled or completed
- **AND** `getScanStatus()` returns `isActive: false` after relaunch
  (matching a fresh app launch)
- **WHEN** the operator selects wave 3 on the Capture Scan screen
- **THEN** a non-blocking informational banner SHALL name the expected
  cycle count recorded when that scan started
- **AND** no such banner SHALL appear if the marker was already removed
  (clean completion or successful cancel)

#### Scenario: An abnormal-termination marker is scoped to its own wave

- **GIVEN** wave 3's scan was force-quit mid-run (its marker still exists)
- **AND** wave 4 of the same experiment later completed cleanly (its own
  marker was recorded and removed normally)
- **WHEN** the operator selects wave 4 on the Capture Scan screen
- **THEN** no abnormal-termination banner SHALL appear for wave 4
- **WHEN** the operator instead selects wave 3
- **THEN** the abnormal-termination banner SHALL appear, naming wave 3's
  expected cycle count

#### Scenario: The abnormal-termination check still runs once experimentId/waveNumber become known asynchronously

- **GIVEN** a marker exists for `(experimentId: "exp-1", waveNumber: 3)`
- **AND** the Capture Scan screen mounts before that experiment/wave
  selection is known — e.g. restored moments later via the
  cross-navigation session mechanism, or picked by the operator from the
  experiment/wave selectors after the screen has already rendered — not
  synchronously available on the screen's very first render
- **WHEN** `experimentId`/`waveNumber` subsequently resolve to `("exp-1",
3)`
- **THEN** the banner SHALL still appear, naming the recorded expected
  cycle count
- **AND** this SHALL hold regardless of how many renders separate the
  screen's mount from that resolution — the check SHALL NOT be limited to
  whatever `experimentId`/`waveNumber` happened to be present at mount

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

#### Scenario: Per-scanner test results are shown next to each scanner

- **GIVEN** a Test Scan completed with scanner A succeeding and scanner B
  failing with an error message
- **WHEN** the operator views the scanner status panel
- **THEN** scanner A's row SHALL show a success indication
- **AND** scanner B's row SHALL show its specific error message
- **AND** neither result SHALL be visible only as an aggregate,
  unattributed message

---

### Requirement: GraviScan QR Verification Result Banner

After a scan session completes, the Capture Scan screen SHALL invoke
`graviscan:verify-plates` with the current `experimentId` and `waveNumber`,
and display a graded-severity result banner based on the returned
per-plate `verification_status` values:

- **Red** ("Duplicate QR Codes Detected") when any plate has status
  `duplicate_qr`.
- **Amber**, when, absent any `duplicate_qr`, any plate has status
  `unreadable` ("Some Plates Unreadable"), `needs_review` ("Manual Review
  Needed"), `incorrect` ("Plate Mismatch Detected"), or `lookup_failed`
  ("Verification Lookup Failed" — pinned as its own exact title, distinct
  from the other three; a `lookup_failed` plate's image was never
  successfully checked at all, so folding it under "Manual Review Needed"
  would wrongly tell the operator to _review_ a result rather than
  _retry_ the run).
- **Green** ("QR Verification Complete") when every plate has status
  `verified` or `swapped`.

`incorrect` and `lookup_failed` SHALL each render their own distinct label
and detail text — neither SHALL be collapsed into the `unreadable` label,
since they indicate different operator remedies (re-image the plate vs.
retry the run). When a batch contains two or more distinct non-green
statuses simultaneously (e.g. one `unreadable` and one `lookup_failed`,
with no `duplicate_qr` present), the banner SHALL surface **all**
applicable causes' detail text, not silently pick one by an undefined
priority order.

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

#### Scenario: A mixed batch of non-green statuses surfaces every applicable cause

- **GIVEN** a completed scan's verification results include one plate with
  status `unreadable` and a different plate with status `lookup_failed`,
  and no plate has status `duplicate_qr`
- **WHEN** the verification banner renders
- **THEN** it SHALL show an amber state
- **AND** the detail text SHALL name **both** the unreadable plate and the
  lookup-failed plate, with their respective distinct remedies — neither
  cause SHALL be silently omitted in favor of the other

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
