## MODIFIED Requirements

### Requirement: Home Page Status Dashboard

The Home page SHALL present live hardware/system status, a link-driven quickstart guide (per the CylinderScan Workflow Guide Structure requirement), and a summary of today's scan activity.

#### Scenario: Hardware status displayed with an administrator-contact message on failure

**Given** the user is in CylinderScan mode and navigates to the Home page
**When** the page loads
**Then** a simple status indicator is shown with one of three states — Connected, Checking, or Error — derived from the existing `python:get-version` call and `onStatus`/`onError` event subscriptions (no per-component camera/DAQ breakdown; that detail now lives only in Machine Configuration's relocated "Check Hardware")
**And** if the status is Error, the summary SHALL show a generic "Contact your administrator" message
**And** the Home page SHALL NOT show any interactive troubleshooting controls ("Check Hardware", "Restart Python") — those actions live in Machine Configuration (see the "Hardware Diagnostics in Machine Configuration" requirement in the `machine-configuration` capability)
**And** the Home page SHALL NOT show any link to Machine Configuration (admin-only, one-time-per-machine setup)

**Acceptance Criteria**:

- "Connected" maps to the existing status values of `'Connected'` or any status string containing `'ready'`; "Error" maps to the existing `'Error'` status; "Checking" maps to every other status value (including the initial `'Checking...'` state and `'Restarted'`) — this is a relabeling of the three states the component already distinguishes for its colored pill, not a new state machine
- Home's status indicator is derived from the existing `python:get-version`/status-event IPC surface only; it does NOT invoke `python:check-hardware` or `python:restart` (those are only triggered from Machine Configuration now) — verified by a test asserting neither mock is called after Home mounts
- GraviScan mode's Home screen is unaffected (the status indicator remains mode-gated to `cylinderscan`, rendering nothing in GraviScan mode, as it does today)

#### Scenario: Today's Activity summary

**Given** the user navigates to the Home page
**When** the page loads
**Then** a "Today's Activity" summary SHALL display today's captured scans (capture date/time, plant ID, experiment), sourced from the existing `db:scans:getRecent` IPC call
**And** the summary SHALL show an upload-status count breakdown (pending, failed, uploaded) aggregated across all of today's scans' images combined — a true cross-scan total, not one scan's status repeated

**Acceptance Criteria**:

- "Today's Activity" is framed honestly as today-scoped (matching `db:scans:getRecent`'s actual `capture_date`-within-today filtering), not a generic "last N scans" claim
- `db:scans:getRecent`'s `include` is extended to also select each image's `status` (additive; no existing test depends on the prior shape)
- The cross-scan aggregation is built on a shared low-level counter (`countUploadStatuses()` in `src/utils/upload-status.ts`), also used by `BrowseScans.tsx`'s existing per-scan status label — not two independently-written categorization implementations
- If no scans were captured today, the scan list shows an empty/neutral state, not an error (the date-unscoped failed-upload indicator below is unaffected by this empty state)

#### Scenario: Date-unscoped failed-upload indicator

**Given** the application has one or more images with `status: 'failed'` on a non-deleted scan, regardless of that scan's capture date
**When** the user navigates to the Home page
**Then** a persistent "N failed uploads need attention" indicator SHALL be shown, linking to Browse Scans
**And** this indicator SHALL appear even if no scans were captured today (i.e. it is not scoped by the "Today's Activity" summary's date filter)

**Acceptance Criteria**:

- Sourced from a new `db:scans:getFailedUploadCount` IPC handler, computed as a single count query (`status: 'failed'`, excluding soft-deleted scans) — not a row fetch
- This is a genuinely new IPC handler and is therefore subject to the IPC coverage gate (`tests/e2e/renderer-database-ipc.e2e.ts`)
- If `failedCount` is 0, no indicator is shown

#### Scenario: Quickstart guide displayed

**Given** the user navigates to the Home page
**When** the page loads
**Then** the workflow guide (per the CylinderScan Workflow Guide Structure requirement) displays alongside the hardware-status and Today's Activity summaries
