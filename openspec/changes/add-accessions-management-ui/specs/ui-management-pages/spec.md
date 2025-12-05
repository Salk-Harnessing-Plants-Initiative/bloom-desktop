# ui-management-pages Spec Deltas

## ADDED Requirements

### Requirement: Accessions List View

The Accessions page SHALL display all accessions from the database in a clean, readable list format with support for empty and populated states, showing accession metadata and relationships.

#### Scenario: Empty State

**Given** no accessions exist in the database
**When** the user navigates to `/accessions`
**Then** the page displays a message indicating no accessions are present
**And** the create form is visible below

**Acceptance Criteria**:

- Empty state message is clear (e.g., "No accessions yet")
- List container is visually distinct but empty
- User can immediately see the create form without scrolling
- Upload file section is visible and accessible

#### Scenario: Display Accessions List

**Given** multiple accessions exist in the database
**When** the user navigates to `/accessions`
**Then** all accessions are displayed in an expandable list
**And** each list item shows the accession's name and creation date
**And** the list is sorted alphabetically by name

**Acceptance Criteria**:

- Each accession appears exactly once
- Format: "Name - Created: YYYY-MM-DD" or similar clear presentation
- List is scrollable if content exceeds container height
- Loading state appears while fetching data
- Database errors show user-friendly error message
- Collapse/expand indicators are visible

#### Scenario: Expand Accession Details

**Given** accessions exist in the database
**When** the user clicks an accession list item
**Then** the item expands to show detailed information
**And** displays number of plant-accession mappings
**And** displays linked experiments (if any)
**And** shows edit/delete action buttons

**Acceptance Criteria**:

- Smooth expand/collapse animation
- Clear visual hierarchy for nested information
- Edit button enables inline name editing
- Delete button shows confirmation dialog
- Only one accession expanded at a time (accordion behavior)

### Requirement: Create Accession

The Accessions page MUST allow users to create new accessions with client-side validation (name required) and provide a simple creation flow for basic accession tracking.

#### Scenario: Valid Submission

**Given** the user is on the `/accessions` page
**When** the user enters a valid name (e.g., "Arabidopsis Col-0")
**And** the user clicks "Add Accession" button
**Then** the accession is created in the database
**And** a success message or indicator appears
**And** the form field is cleared
**And** the accessions list refreshes to show the new entry

**Acceptance Criteria**:

- Name is trimmed of leading/trailing whitespace
- Loading indicator appears during submission
- IPC call completes successfully
- New accession appears in list without page refresh
- Form is ready for another entry
- Creation timestamp is auto-generated server-side

#### Scenario: Validation Failure - Empty Name

**Given** the user is on the `/accessions` page
**When** the user leaves the name field empty
**And** the user clicks "Add Accession" button
**Then** an error message appears near the name field
**And** the error message states "Name is required" or similar
**And** no IPC call is made to the database

**Acceptance Criteria**:

- Validation runs before submission (no network call)
- Error message is displayed inline near the name field
- Error message is cleared when user starts typing
- Submit button can be clicked again after fixing error

#### Scenario: Duplicate Names Allowed

**Given** an accession named "Sample Batch" already exists
**When** the user enters "Sample Batch" as the name
**And** the user clicks "Add Accession" button
**Then** a second accession with the same name is created successfully
**And** both accessions appear in the list with distinct IDs

**Acceptance Criteria**:

- Database does NOT enforce unique name constraint
- Duplicate names are permitted by design
- Each accession has unique UUID
- List shows both entries separately
- Creation dates help distinguish duplicates

### Requirement: Excel File Upload for Plant Mappings

The Accessions page SHALL support uploading Excel files (XLSX/XLS) to bulk-create plant-accession mappings, with file validation, sheet selection, column mapping, and preview functionality.

#### Scenario: Upload Valid Excel File

**Given** the user is on the `/accessions` page
**And** an accession exists to attach mappings to
**When** the user drags and drops a valid Excel file (<15MB)
**Then** the file is validated successfully
**And** a preview of the first 20 rows appears
**And** sheet selection dropdown appears (if multiple sheets)
**And** column selection dropdowns appear for Plant ID and Genotype ID

**Acceptance Criteria**:

- Drag-and-drop zone is clearly marked
- File size validation (15MB limit)
- Format validation (XLSX, XLS only)
- Preview table shows first 20 rows
- Column headers detected automatically
- Sheet dropdown shows all sheet names
- Column dropdowns populated from headers

#### Scenario: File Validation - Too Large

**Given** the user is on the `/accessions` page
**When** the user uploads an Excel file larger than 15MB
**Then** an error message appears stating "File too large (max 15MB)"
**And** no preview is shown
**And** the user can select a different file

**Acceptance Criteria**:

- Size check happens before parsing
- Clear error message with size limit
- Upload zone remains interactive
- Previous selections are cleared

#### Scenario: Column Mapping and Highlighting

**Given** a valid Excel file is uploaded with preview shown
**When** the user selects "Barcode" from the Plant ID dropdown
**And** the user selects "Genotype" from the Genotype ID dropdown
**Then** the selected columns are highlighted in the preview
**And** Plant ID column shows green highlighting
**And** Genotype ID column shows blue highlighting

**Acceptance Criteria**:

- Visual column highlighting in preview table
- Color-coded: green for Plant ID, blue for Genotype ID
- Highlighting updates immediately on selection change
- Clear visual distinction between column types
- Hover tooltips explain column purposes

#### Scenario: Batch Upload Plant Mappings

**Given** an Excel file is uploaded with columns mapped
**And** the user clicks "Upload Mappings" button
**When** the file contains 500 rows
**Then** rows are processed in batches of 100
**And** a progress indicator shows "Processing batch X of Y"
**And** all 500 plant-accession mappings are created
**And** success message shows "500 mappings uploaded"

**Acceptance Criteria**:

- Batch size: 100 rows per database transaction
- Progress indicator shows current batch
- UI remains responsive during upload
- Atomic batch transactions (all-or-nothing per batch)
- Final count matches total rows processed
- Error messages show which batch failed (if any)

### Requirement: Inline Accession Name Editing

The Accessions page MUST support inline editing of accession names with keyboard shortcuts (Enter to save, Escape to cancel) and optimistic UI updates.

#### Scenario: Edit Accession Name Successfully

**Given** an accession named "Old Name" exists in the list
**And** the accession is expanded
**When** the user clicks the "Edit" button
**Then** the name field becomes editable with current value highlighted
**When** the user types "New Name"
**And** the user presses Enter
**Then** the name is updated in the database
**And** the list shows "New Name" immediately
**And** a success indicator appears briefly

**Acceptance Criteria**:

- Name field converts to input on edit click
- Current value is pre-filled and selected
- Enter key saves changes
- Escape key cancels editing
- Optimistic UI update (shows new name before server confirms)
- Rollback on failure
- Validation: name cannot be empty

#### Scenario: Cancel Inline Edit

**Given** an accession is in edit mode
**And** the user has typed changes
**When** the user presses Escape
**Then** the edit mode is canceled
**And** the original name is restored
**And** no database call is made

**Acceptance Criteria**:

- Escape key cancels edit
- Changes are discarded
- Original value restored immediately
- No optimistic update
- No database call made

### Requirement: Accessions Navigation Integration

The application SHALL provide navigation to the Accessions page via a clearly labeled link in the main navigation menu, with the route registered at `/accessions`.

#### Scenario: Access via Navigation

**Given** the user is on any page in the application
**When** the user clicks the "Accessions" link in the navigation
**Then** the application navigates to `/accessions`
**And** the Accessions page loads
**And** the accessions list is fetched and displayed

**Acceptance Criteria**:

- Navigation link is clearly labeled "Accessions"
- Link is visible in the main navigation menu
- Route is registered in React Router
- Navigation works in both development and packaged modes
- Active route is visually indicated (if navigation has active states)
- Icon represents data/files (e.g., folder or table icon)
