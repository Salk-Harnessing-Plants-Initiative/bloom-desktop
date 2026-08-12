## MODIFIED Requirements

### Requirement: BrowseScans List View

The BrowseScans page SHALL display all non-deleted scans from the database in a paginated table format, with support for filtering by date range and experiment.

#### Scenario: Display Scans Table

**Given** scans exist in the database
**When** the user navigates to `/scans`
**Then** all non-deleted scans are displayed in a table
**And** each row shows: Plant ID, Accession, Experiment, Date, Phenotyper, Frame Count, a thumbnail preview, a camera-settings summary, and Actions
**And** the table is paginated with 25 items per page by default
**And** scans are sorted by capture date descending (newest first)

**Acceptance Criteria**:

- Plant ID is clickable, linking to `/scan/:scanId`
- Date is formatted as human-readable (e.g., "Feb 17, 2026 10:30 AM")
- Frame count shows total images in scan
- Actions column includes View, Delete, and Upload buttons
- Loading state appears while fetching data
- The thumbnail-preview and camera-settings-summary columns are governed in detail by the `BrowseScans Thumbnail Preview` and `BrowseScans Camera Settings Summary` requirements below

#### Scenario: Empty State

**Given** no scans exist in the database (or all are deleted)
**When** the user navigates to `/scans`
**Then** a message indicates no scans are present
**And** the message suggests capturing scans via CaptureScan page

**Acceptance Criteria**:

- Empty state message is clear (e.g., "No scans yet")
- Link to CaptureScan page is provided

#### Scenario: Pagination

**Given** more scans exist than the page size
**When** the user views the BrowseScans table
**Then** pagination controls are displayed below the table
**And** the user can navigate to next/previous pages
**And** the total count is displayed (e.g., "Showing 1-25 of 342 scans")

**Acceptance Criteria**:

- Page size selector allows 25, 50, or 100 items
- Page input allows jumping to specific page
- Previous/Next buttons disabled at boundaries
- Changing page size resets to page 1

> **Note on pre-existing drift (not fixed by this change):** this requirement's text still says route `/scans` and "Frame Count" — both already stale relative to the live app (actual route `/browse-scans`; the live table also already shows Wave/Age/Upload Status columns beyond what's documented here). This drift predates this change and reconciling it is out of scope for this tier; see `design.md`'s "BrowseScans List View drift" decision. Only the two new columns this change actually adds (thumbnail preview, camera-settings summary) are reflected above.

### Requirement: Scans List IPC Handler

The main process SHALL provide an IPC handler for fetching paginated scan lists with filters.

#### Scenario: Fetch Scans with Pagination

**Given** the renderer calls `db:scans:list`
**When** the handler receives pagination parameters
**Then** the handler returns scans for the requested page
**And** the response includes total count for pagination
**And** soft-deleted scans are excluded

**Acceptance Criteria**:

- Parameters: `{ page: number, pageSize: number, experimentId?: string, dateFrom?: string, dateTo?: string }`
- Returns: `{ scans: ScanWithRelations[], total: number, page: number, pageSize: number }`
- Includes phenotyper and experiment relations
- Includes image `id`, `status`, `path`, and `frame_number` for each image (still not full image data — no upload timestamps or error fields) — `path`/`frame_number` support resolving each scan's first-image thumbnail without a separate per-row fetch. (Note: the live spec this requirement replaces said "Includes image count (not full image data)," which was already stale relative to the actual `{id, status}` select before this change touched it — this MODIFIED requirement's text reflects the accurate pre-existing shape plus this change's own `path`/`frame_number` addition; only the latter is what this change actually introduces, same principle as the "BrowseScans List View drift" note above.)
- Ordered by `capture_date` descending

#### Scenario: Response Includes First-Image Reference Data

**Given** a scan with multiple images at different `frame_number` values
**When** `db:scans:list`'s paginated query returns that scan
**Then** each image entry in the response includes its `path` and `frame_number` alongside `id` and `status`
**And** the renderer can determine the lowest-`frame_number` image without an additional IPC round trip

## ADDED Requirements

### Requirement: BrowseScans Thumbnail Preview

The BrowseScans table SHALL display a small thumbnail of each scan's first captured image.

#### Scenario: Thumbnail renders the lowest-frame-number image

**Given** a scan has at least one captured image
**When** its row renders in the BrowseScans table
**Then** the thumbnail column SHALL display the image with the lowest `frame_number` for that scan, at approximately 48×64px
**And** the image SHALL be loaded via the existing `bloom-scan://` protocol (the same resolution mechanism `ScanPreview.tsx` uses: resolve the image's path against the configured `scans_dir` if relative, then convert via `pathToFileUrl()`)
**And** the `<img>` element SHALL have `loading="lazy"` so images load as their row scrolls into view

#### Scenario: Missing or unloadable images fall back to a placeholder

- **GIVEN** a scan with zero captured images, or an image file that fails to load (moved/deleted from disk)
- **WHEN** its row renders in the BrowseScans table
- **THEN** a placeholder SHALL render in place of the thumbnail (not a broken-image icon)

**Acceptance Criteria**:

- No new IPC handler or per-row IPC call is introduced — the thumbnail's source data comes from the same paginated `db:scans:list` response already used to render the rest of the row

### Requirement: BrowseScans Camera Settings Summary

The BrowseScans table SHALL display a compact, per-scan summary of camera settings, including the scanner/device used.

#### Scenario: Compact summary with full values on hover

**Given** a scan with recorded camera settings (`scanner_name`, `exposure_time`, `gain`, `brightness`, `contrast`, `gamma`, `seconds_per_rot`)
**When** its row renders in the BrowseScans table
**Then** the camera-settings column SHALL display a compact summary including the scanner name (e.g. "Cam-A · Exp 50ms · Gain 4")
**And** the element's `title` attribute SHALL contain the full set of recorded values (scanner name, exposure, gain, brightness, contrast, gamma, seconds-per-rotation), viewable on hover

**Acceptance Criteria**:

- No backend/query change is required — `db:scans:list`'s response already includes these `Scan` scalar fields
- This compact-summary approach is chosen over dedicated always-visible columns or a column-configuration UI specifically to keep the table readable without horizontal scrolling

### Requirement: CylinderScan Workflow Guide Structure

CylinderScan's Home page SHALL present its workflow guide via a dedicated `CylinderScanWorkflowGuide` component (not the shared `WorkflowSteps` component) with a two-section structure — a prominent "Daily Workflow" section and a less-prominent, unordered "Setup" section — in place of the prior single flat numbered list.

#### Scenario: CylinderScan's Daily Workflow and Setup sections

- **GIVEN** the user is in CylinderScan mode and navigates to the Home page
- **WHEN** the workflow guide renders
- **THEN** a "Daily Workflow" section SHALL prominently display, in this order: Camera Settings (confirm/verify before each session), Capture Scan (rendered as the single large primary call-to-action), Browse Scans (secondary)
- **AND** a "Setup" section SHALL display, as unordered cards with no step numbers: Scientists, Phenotypers, Accessions, Experiments

**Acceptance Criteria**:

- No step numbers are shown in either section — numbering previously implied a strict sequential order that doesn't reflect reality (Scientists/Phenotypers/Accessions/Camera-Settings setup tasks can be done in parallel)
- No route is added, removed, or changed — this requirement governs grouping/prominence only
- Accent colors for this component are governed by `ui-color-palette`'s "CylinderScanWorkflowGuide uses the lime convention natively" scenario, not this one
- **GraviScan's equivalent restructure is explicitly deferred, not part of this requirement.** `graviScanSteps` continues rendering through the existing shared `WorkflowSteps` component, completely unchanged (flat numbered list, current blue accents, current routes/titles) — see `design.md`'s "Deferred Scope" for why and the follow-up tracking issue

### Requirement: Home Page Status Dashboard

The Home page SHALL present live hardware/system status, a link-driven quickstart guide (per the CylinderScan Workflow Guide Structure requirement), and a summary of today's scan activity.

#### Scenario: Hardware status displayed with an administrator-contact message on failure

**Given** the user is in CylinderScan mode and navigates to the Home page
**When** the page loads
**Then** the existing Python/camera/DAQ hardware status is presented as a dashboard-style summary with visual (color-coded) indicators
**And** if a hardware component is unavailable, the summary SHALL show a "Contact your administrator" message
**And** the Home page SHALL NOT show any link to Machine Configuration (admin-only, one-time-per-machine setup)

**Acceptance Criteria**:

- No additional IPC calls beyond what `PythonStatus` already performs are introduced for this scenario
- GraviScan mode's Home screen is unaffected (`PythonStatus` remains mode-gated to `cylinderscan`, rendering nothing in GraviScan mode, as it does today)

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
