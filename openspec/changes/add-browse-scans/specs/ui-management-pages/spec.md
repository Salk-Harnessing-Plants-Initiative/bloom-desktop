## ADDED Requirements

### Requirement: BrowseScans List View

The BrowseScans page SHALL display all non-deleted scans from the database in a paginated table format, with support for filtering by date range and experiment.

#### Scenario: Display Scans Table

**Given** scans exist in the database
**When** the user navigates to `/scans`
**Then** all non-deleted scans are displayed in a table
**And** each row shows: Plant ID, Accession, Experiment, Date, Phenotyper, Frame Count, Actions
**And** the table is paginated with 25 items per page by default
**And** scans are sorted by capture date descending (newest first)

**Acceptance Criteria**:
- Plant ID is clickable, linking to `/scan/:scanId`
- Date is formatted as human-readable (e.g., "Feb 17, 2026 10:30 AM")
- Frame count shows total images in scan
- Actions column includes View, Delete, and Upload buttons
- Loading state appears while fetching data

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

### Requirement: BrowseScans Filtering

The BrowseScans page SHALL allow users to filter scans by date range and experiment.

#### Scenario: Filter by Date Range

**Given** scans exist across multiple dates
**When** the user selects a date range (from/to)
**And** clicks "Apply" filter button
**Then** only scans within the date range are displayed
**And** the table pagination resets to page 1
**And** the filter state is reflected in the URL query parameters

**Acceptance Criteria**:
- Date pickers use standard date input format
- "From" date is inclusive (start of day)
- "To" date is inclusive (end of day)
- Clear button resets date filters

#### Scenario: Filter by Experiment

**Given** scans exist for multiple experiments
**When** the user selects an experiment from the dropdown
**And** clicks "Apply" filter button
**Then** only scans for that experiment are displayed
**And** the table pagination resets to page 1

**Acceptance Criteria**:
- Experiment dropdown shows all experiments
- "All Experiments" option clears the filter
- Combined filters (date + experiment) work together

### Requirement: Delete Scan

The BrowseScans page SHALL allow users to soft-delete individual scans with confirmation.

#### Scenario: Delete Scan with Confirmation

**Given** the user is viewing the scans table
**When** the user clicks the delete button for a scan
**Then** a confirmation dialog appears
**And** the dialog shows the Plant ID and capture date
**And** the dialog has Cancel and Delete buttons

**Acceptance Criteria**:
- Delete button has destructive styling (red)
- Confirmation dialog is modal (blocks interaction)
- Cancel closes dialog without action
- Delete calls IPC handler and refreshes table

#### Scenario: Soft Delete Preserves Data

**Given** the user confirms scan deletion
**When** the delete operation completes
**Then** the scan's `deleted` field is set to `true`
**And** the scan no longer appears in the table
**And** the scan files are NOT removed from disk
**And** a success message appears briefly

**Acceptance Criteria**:
- Database record preserved with `deleted: true`
- Files remain in scans directory
- Success message: "Scan deleted successfully"

### Requirement: BrowseScans Navigation Integration

The application SHALL provide navigation to the BrowseScans page via a clearly labeled link in the main navigation menu, with the route registered at `/scans`.

#### Scenario: Access via Navigation

**Given** the user is on any page in the application
**When** the user clicks the "Browse Scans" link in the navigation
**Then** the application navigates to `/scans`
**And** the BrowseScans page loads
**And** the scans list is fetched and displayed

**Acceptance Criteria**:
- Navigation link is clearly labeled "Browse Scans"
- Link is visible in the main navigation menu
- Route is registered in React Router
- Active route is visually indicated

### Requirement: ScanPreview Page

The ScanPreview page SHALL display a single scan with image navigation, zoom capabilities, and full metadata.

#### Scenario: Display Scan Images

**Given** the user navigates to `/scan/:scanId`
**When** the scan exists and is not deleted
**Then** the first image of the scan is displayed
**And** navigation controls show frame position (e.g., "1 / 72")
**And** previous/next buttons allow navigation between frames
**And** metadata panel shows scan details

**Acceptance Criteria**:
- Images load from local filesystem using `file://` protocol
- Frame counter updates on navigation
- First frame shown by default
- Navigation wraps around (last → first, first → last)

#### Scenario: Keyboard Navigation

**Given** the ScanPreview page is focused
**When** the user presses left/right arrow keys
**Then** the displayed image changes to previous/next frame
**And** the frame counter updates accordingly

**Acceptance Criteria**:
- Left arrow: previous frame
- Right arrow: next frame
- Home key: first frame
- End key: last frame

#### Scenario: Image Zoom

**Given** the user is viewing a scan image
**When** the user clicks zoom in/out buttons
**Then** the image scales to the selected zoom level
**And** available zoom levels are 1x, 1.5x, 2x, 3x
**And** a reset button returns to 1x (fit to container)

**Acceptance Criteria**:
- Zoom buttons show +/- icons
- Current zoom level displayed (e.g., "2x")
- Reset button labeled "Fit" or "Reset"
- Zooming preserves image center

#### Scenario: Image Pan

**Given** the image is zoomed beyond 1x
**When** the user clicks and drags on the image
**Then** the visible portion of the image moves with the drag
**And** the cursor changes to indicate drag mode

**Acceptance Criteria**:
- Panning only available when zoomed
- Cursor shows grab/grabbing icons
- Pan limits prevent scrolling beyond image bounds
- Smooth drag experience

### Requirement: ScanPreview Metadata Display

The ScanPreview page SHALL display comprehensive scan metadata in a dedicated panel.

#### Scenario: Display Scan Metadata

**Given** the user is viewing a scan
**When** the metadata panel is visible
**Then** the following information is displayed:
- Plant ID
- Accession name
- Experiment name
- Capture date and time
- Phenotyper name
- Scanner name
- Camera settings (exposure, gain, gamma, brightness, contrast)
- Total frame count
- Wave number
- Plant age (days)
- Local file path

**Acceptance Criteria**:
- Metadata organized in logical sections
- Empty fields show "N/A" or similar
- Path is displayed but not editable
- Date formatted as human-readable

### Requirement: ScanPreview Navigation

The ScanPreview page SHALL provide navigation back to BrowseScans and between scans.

#### Scenario: Back Navigation

**Given** the user is on the ScanPreview page
**When** the user clicks the "Back" link
**Then** the application navigates to `/scans`
**And** any active filters are preserved (via URL params)

**Acceptance Criteria**:
- Back link clearly visible at top
- Browser back button also works
- Filter state preserved in URL

### Requirement: Upload Scan to Bloom Storage

The application SHALL allow users to upload individual scans to Bloom remote storage with progress indication.

#### Scenario: Single Scan Upload

**Given** the user is viewing a scan (in table or preview)
**When** the user clicks the upload button
**And** valid Bloom credentials are configured
**Then** the scan images are uploaded to Supabase storage
**And** a progress indicator shows upload status
**And** success message appears when complete

**Acceptance Criteria**:
- Upload button available in both table and preview
- Progress shows percentage complete
- Status: "Uploading...", "Uploaded", or "Failed"
- Retry button appears on failure
- Upload disabled if credentials not configured

#### Scenario: Upload Progress Indication

**Given** a scan upload is in progress
**When** the upload is running
**Then** a progress bar shows image upload count (e.g., "12 / 72 images")
**And** the upload button is disabled
**And** the delete button is disabled (prevent data loss)
**And** the `Image.status` field is updated to "uploading" for each image

**Acceptance Criteria**:
- Progress shows image count (X / Y images)
- Per-image status tracked via `Image.status` field
- Real-time updates via `scans:upload-progress` IPC event
- Cancel option available (stretch goal)

### Requirement: Batch Upload Scans

The BrowseScans page SHALL allow users to select multiple scans and upload them in batch.

#### Scenario: Select Scans for Batch Upload

**Given** the user is viewing the scans table
**When** the user clicks checkboxes on multiple rows
**Then** a selection count is displayed (e.g., "3 selected")
**And** a "Upload Selected" button becomes enabled

**Acceptance Criteria**:
- Checkbox in each row
- "Select All" checkbox in header (selects current page)
- Selection count updates in real-time
- Bulk action buttons appear when selection > 0

#### Scenario: Execute Batch Upload

**Given** the user has selected multiple scans
**When** the user clicks "Upload Selected"
**Then** all selected scans are uploaded sequentially
**And** overall progress is displayed (e.g., "Uploading 2 of 5...")
**And** individual scan status is updated in table
**And** batch continues even if individual upload fails

**Acceptance Criteria**:
- Overall progress indicator
- Per-scan status updates in table
- Failed uploads marked, others continue
- Summary shown at end (X succeeded, Y failed)
- Selection cleared after batch completes

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
- Includes image count (not full image data)
- Ordered by `capture_date` descending

### Requirement: Scan Delete IPC Handler

The main process SHALL provide an IPC handler for soft-deleting scans.

#### Scenario: Soft Delete Scan

**Given** the renderer calls `db:scans:delete` with a scan ID
**When** the handler processes the request
**Then** the scan's `deleted` field is set to `true`
**And** the handler returns success confirmation
**And** the scan files are NOT removed from disk

**Acceptance Criteria**:
- Sets `deleted: true` via Prisma update
- Does not delete Image records
- Does not delete files from filesystem
- Returns `{ success: true }` on completion
- Returns error if scan not found

### Requirement: Scan Upload IPC Handler

The main process SHALL provide an IPC handler for uploading scans to Bloom remote storage.

#### Scenario: Upload Scan Images

**Given** the renderer calls `db:scans:upload` with a scan ID
**When** valid Bloom credentials are configured
**Then** the handler authenticates with Supabase
**And** uploads all scan images to remote storage
**And** emits progress events during upload
**And** returns success or error status

**Acceptance Criteria**:
- Uses `@salk-hpi/bloom-js` SupabaseStore
- Authenticates with stored credentials from `~/.bloom/.env`
- Uploads each image to designated storage bucket
- Updates `Image.status`: "pending" → "uploading" → "uploaded" (or "failed")
- Emits `scans:upload-progress` IPC event for real-time UI updates
- Error handling for network failures
- Returns `{ success: true, uploadedCount: number }` or error

### Requirement: Upload Status Display in Table

The BrowseScans table SHALL display per-scan upload status based on Image statuses.

#### Scenario: Display Upload Status Column

**Given** scans exist with varying upload states
**When** the BrowseScans table is displayed
**Then** an "Upload Status" column shows the upload state
**And** status is derived from related Image records

**Acceptance Criteria**:
- Status values: "Not uploaded", "X/Y uploaded", "Uploaded"
- "Not uploaded": All images have status "pending"
- "X/Y uploaded": Some images have status "uploaded", shown as fraction
- "Uploaded": All images have status "uploaded" (shows checkmark)
- "Uploading": At least one image has status "uploading" (shows progress bar)
- Failed uploads indicated with warning icon

#### Scenario: Real-time Status Updates

**Given** an upload is in progress
**When** the `scans:upload-progress` IPC event is received
**Then** the table row updates to reflect current upload progress
**And** no manual refresh is required

**Acceptance Criteria**:
- Table listens for `scans:upload-progress` event
- Row updates without full table refresh
- Progress bar animates during upload
