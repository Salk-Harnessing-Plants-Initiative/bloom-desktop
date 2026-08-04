## ADDED Requirements

### Requirement: GraviScan Wedge Banner

While in GraviScan mode, the app SHALL display a `WedgeBanner`, mounted app-wide in `Layout.tsx` (not scoped to any single screen), showing one inline banner entry per scanner with an active, unacknowledged wedge. Each entry SHALL display the scanner's identity (`display_name` if available, else `scanner_id`), the detected `signature`, and the originating `error_message`, and SHALL communicate that the scanner has already been automatically paused (not that pausing is pending an operator action). Entries SHALL be styled with the existing inline error-severity convention (red border/background, matching `ConfigureScanner.tsx`'s `saveError` banner) — no toast, per this codebase's existing inline-banner convention. Multiple entries SHALL render as a vertically-stacked list that does not overlap the top navigation or other entries.

A new wedge event for a scanner that already has an entry SHALL replace that entry rather than adding a second one, and SHALL reset that entry's retry-confirmation sub-state (if any was pending) to unconfirmed. All entries SHALL be cleared when the active scan session ends (on the coordinator's `interval-complete` or `cancelled` events).

#### Scenario: Wedge banner appears app-wide, not screen-scoped

- **GIVEN** GraviScan mode is active and a `wedge-detected` event arrives for scanner `sc-1`
- **WHEN** the operator is on any page (e.g. Browse Scans, Experiments) — not a dedicated scan screen
- **THEN** a banner entry for `sc-1` SHALL be visible

#### Scenario: Banner communicates the scanner is already paused

- **GIVEN** a `wedge-detected` event arrives for scanner `sc-1`
- **WHEN** the banner entry for `sc-1` renders
- **THEN** its copy SHALL indicate the scanner has already stopped/been paused, not that pausing awaits an operator click

#### Scenario: Multiple entries stack without overlapping

- **GIVEN** `wedge-detected` events arrive for two different scanners
- **WHEN** both banner entries are showing
- **THEN** they SHALL render as a vertically-stacked list with no overlap between entries or with the top navigation

#### Scenario: Repeated wedge on the same scanner replaces, not stacks, and resets confirmation

- **GIVEN** a banner entry is already showing for scanner `sc-1` from cycle 3, with a pending retry confirmation
- **WHEN** a new `wedge-detected` event arrives for `sc-1` from cycle 5
- **THEN** there SHALL be exactly one banner entry for `sc-1`, showing cycle 5's data
- **AND** its retry-confirmation sub-state SHALL be reset to unconfirmed

#### Scenario: Banner clears when the session ends

- **GIVEN** one or more banner entries are showing
- **WHEN** the coordinator emits `interval-complete` or `cancelled`
- **THEN** all banner entries SHALL be removed

---

### Requirement: GraviScan Session Auto-Pause Counter

While in GraviScan mode, in addition to the per-scanner banner entries, the app SHALL track and display two session-scoped numbers: the total count of `wedge-detected` events this session, and the count of distinct `scanner_id`s that have wedged at least once this session. Both SHALL be shown together in a small, non-dismissible indicator whenever the event count is greater than zero (e.g. "3 auto-pause events across 1 scanner this session"). A flat event count alone SHALL NOT be displayed without the distinct-scanner count, since a single scanner re-wedging after repeated failed retries would otherwise be indistinguishable from multiple scanners each wedging once — the two numbers exist specifically so an operator can tell an isolated, chronically-re-wedging unit apart from a systemic, multi-scanner problem. Neither number SHALL decrease when an entry is dismissed — both reflect cumulative session history, not current unacknowledged state. Both SHALL reset to zero on the same `interval-complete`/`cancelled` events that clear the per-scanner entries.

#### Scenario: Event count increments on each wedge and survives dismissal

- **GIVEN** the session event count is currently 1 (one prior wedge this session)
- **WHEN** a `wedge-detected` event arrives for a second scanner, and its banner entry is then dismissed
- **THEN** the displayed event count SHALL be 2
- **AND** dismissing the entry SHALL NOT decrease either number

#### Scenario: Repeated wedges on the same scanner increment the event count without inflating the distinct-scanner count

- **GIVEN** scanner `sc-1` has wedged once this session (event count 1, distinct-scanner count 1)
- **WHEN** `sc-1` is retried and then wedges again
- **THEN** the displayed event count SHALL be 2
- **AND** the displayed distinct-scanner count SHALL remain 1

#### Scenario: Indicator is hidden when zero and resets with the session

- **GIVEN** no `wedge-detected` event has occurred this session
- **WHEN** the operator is in GraviScan mode
- **THEN** no counter indicator SHALL be shown
- **WHEN** at least one wedge has occurred and the coordinator then emits `interval-complete` or `cancelled`
- **THEN** both numbers SHALL reset to zero and the indicator SHALL be hidden again

---

### Requirement: GraviScan Wedge Response Actions

Each `WedgeBanner` entry SHALL offer two actions: **Dismiss** (hides the entry; makes no IPC call — the scanner is already paused by auto-pause, independent of whether or when the operator dismisses) and **Power-Cycled & Retry** (requires an explicit confirmation step, displaying explanatory text about the power-cycle precondition, before calling `retryScanner(scannerId)`; removes the entry on success, and shows the returned error inline without removing the entry on failure).

#### Scenario: Dismiss hides the entry without any backend call

- **GIVEN** a banner entry for scanner `sc-1`
- **WHEN** the operator clicks "Dismiss"
- **THEN** the entry SHALL be removed
- **AND** `retryScanner` SHALL NOT be called
- **AND** the scanner's paused state SHALL be unaffected (it was already paused by auto-pause)

#### Scenario: Retry requires confirmation with explanatory text before the IPC call fires

- **GIVEN** a banner entry for scanner `sc-1`
- **WHEN** the operator clicks "Power-Cycled & Retry"
- **THEN** `retryScanner` SHALL NOT be called yet
- **AND** the entry SHALL show a confirmation sub-state that renders explanatory text describing the power-cycle precondition
- **AND** the confirmation sub-state SHALL show distinct "Confirm Retry" and "Cancel" controls

#### Scenario: Confirming retry calls the backend and removes the entry on success

- **GIVEN** a banner entry for scanner `sc-1` in the retry-confirmation sub-state
- **WHEN** the operator clicks "Confirm Retry"
- **AND** `retryScanner('sc-1')` resolves `{ success: true }`
- **THEN** the entry SHALL be removed

#### Scenario: Retry failure keeps the entry visible with an inline error

- **GIVEN** a banner entry for scanner `sc-1` in the retry-confirmation sub-state
- **WHEN** the operator clicks "Confirm Retry"
- **AND** `retryScanner('sc-1')` resolves `{ success: false, error: msg }`
- **THEN** the entry SHALL remain visible
- **AND** `msg` SHALL be shown inline on that entry

#### Scenario: Cancelling the retry confirmation calls nothing

- **GIVEN** a banner entry for scanner `sc-1` in the retry-confirmation sub-state
- **WHEN** the operator clicks "Cancel"
- **THEN** the entry SHALL revert to its unconfirmed state
- **AND** `retryScanner` SHALL NOT be called
