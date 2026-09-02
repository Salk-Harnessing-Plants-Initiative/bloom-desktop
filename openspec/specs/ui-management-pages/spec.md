# ui-management-pages Specification

## Purpose

This specification defines the requirements for the UI management pages for both Scientists and Phenotypers. It covers the functionality and user experience for listing, creating, editing, and deleting Scientists and Phenotypers, ensuring that users can efficiently manage these entities through intuitive interfaces, robust validation, and clear feedback. The goal is to provide a unified, consistent, and reliable management experience for both Scientists and Phenotypers within the application.

## Requirements

### Requirement: Scientists List View

The Scientists page SHALL display all scientists from the database in a clean, readable list format, with support for both empty and populated states.

#### Scenario: Empty State

**Given** no scientists exist in the database
**When** the user navigates to `/scientists`
**Then** the page displays a message indicating no scientists are present
**And** the create form is visible below

**Acceptance Criteria**:

- Empty state message is clear (e.g., "No scientists yet")
- List container is visually distinct but empty
- User can immediately see the create form without scrolling

#### Scenario: Display Scientists

**Given** multiple scientists exist in the database
**When** the user navigates to `/scientists`
**Then** all scientists are displayed in a list
**And** each list item shows the scientist's name and email
**And** the list is sorted alphabetically by name

**Acceptance Criteria**:

- Each scientist appears exactly once
- Format: "Name (email)" or similar clear presentation
- List is scrollable if content exceeds container height
- Loading state appears while fetching data
- Database errors show user-friendly error message

### Requirement: Create Scientist

The Scientists page MUST allow users to create new scientists with client-side validation (name required, valid email format) and server-side constraint enforcement (unique email).

#### Scenario: Valid Submission

**Given** the user is on the `/scientists` page
**When** the user enters a valid name (e.g., "Dr. Jane Smith")
**And** the user enters a valid email (e.g., "jane.smith@example.com")
**And** the user clicks "Add new scientist" button
**Then** the scientist is created in the database
**And** a success message or indicator appears
**And** the form fields are cleared
**And** the scientists list refreshes to show the new entry

**Acceptance Criteria**:

- Name is trimmed of leading/trailing whitespace
- Email is validated for proper format
- Loading indicator appears during submission
- IPC call completes successfully
- New scientist appears in list without page refresh
- Form is ready for another entry

#### Scenario: Validation Failure - Empty Name

**Given** the user is on the `/scientists` page
**When** the user leaves the name field empty
**And** the user enters a valid email
**And** the user clicks "Add new scientist" button
**Then** an error message appears near the name field
**And** the error message states "Name is required" or similar
**And** no IPC call is made to the database
**And** the form remains populated with the entered email

**Acceptance Criteria**:

- Validation runs before submission (no network call)
- Error message is displayed inline near the name field
- Error message is cleared when user starts typing
- Email field retains its value
- Submit button can be clicked again after fixing error

#### Scenario: Validation Failure - Invalid Email Format

**Given** the user is on the `/scientists` page
**When** the user enters a valid name
**And** the user enters an invalid email (e.g., "notanemail")
**And** the user clicks "Add new scientist" button
**Then** an error message appears near the email field
**And** the error message states "Must be a valid email address" or similar
**And** no IPC call is made to the database
**And** the form remains populated with the entered name

**Acceptance Criteria**:

- Validation checks for @ symbol and domain
- Error message is displayed inline near the email field
- Error message is cleared when user starts typing
- Name field retains its value
- Submit button can be clicked again after fixing error

#### Scenario: Database Constraint Error - Duplicate Email

**Given** a scientist with email "existing@example.com" exists
**When** the user enters a valid name
**And** the user enters "existing@example.com" as the email
**And** the user clicks "Add new scientist" button
**Then** the IPC call returns an error response
**And** an error message appears indicating the email already exists
**And** the form remains populated with the entered data
**And** the user can correct the email and retry

**Acceptance Criteria**:

- Database unique constraint error is caught
- Error message is user-friendly (not raw database error)
- Error message clearly indicates the problem (duplicate email)
- Form data is preserved for correction
- Loading state clears when error is received

### Requirement: Navigation Integration

The application SHALL provide navigation to the Scientists page via a clearly labeled link in the main navigation menu, with the route registered at `/scientists`.

#### Scenario: Access via Navigation

**Given** the user is on any page in the application
**When** the user clicks the "Scientists" link in the navigation
**Then** the application navigates to `/scientists`
**And** the Scientists page loads
**And** the scientists list is fetched and displayed

**Acceptance Criteria**:

- Navigation link is clearly labeled "Scientists"
- Link is visible in the main navigation menu
- Route is registered in React Router
- Navigation works in both development and packaged modes
- Active route is visually indicated (if navigation has active states)

### Requirement: Phenotypers List View

The Phenotypers page SHALL display all phenotypers from the database in a clean, readable list format, with support for both empty and populated states.

#### Scenario: Empty State

**Given** no phenotypers exist in the database
**When** the user navigates to `/phenotypers`
**Then** the page displays a message indicating no phenotypers are present
**And** the create form is visible below

**Acceptance Criteria**:

- Empty state message is clear (e.g., "No phenotypers yet")
- List container is visually distinct but empty
- User can immediately see the create form without scrolling

#### Scenario: Display Phenotypers

**Given** multiple phenotypers exist in the database
**When** the user navigates to `/phenotypers`
**Then** all phenotypers are displayed in a list
**And** each list item shows the phenotyper's name and email
**And** the list is sorted alphabetically by name

**Acceptance Criteria**:

- Each phenotyper appears exactly once
- Format: "Name (email)" or similar clear presentation
- List is scrollable if content exceeds container height
- Loading state appears while fetching data
- Database errors show user-friendly error message

### Requirement: Create Phenotyper

The Phenotypers page MUST allow users to create new phenotypers with client-side validation (name required, valid email format) and server-side constraint enforcement (unique email).

#### Scenario: Valid Submission

**Given** the user is on the `/phenotypers` page
**When** the user enters a valid name (e.g., "John Smith")
**And** the user enters a valid email (e.g., "john.smith@example.com")
**And** the user clicks "Add new phenotyper" button
**Then** the phenotyper is created in the database
**And** a success message or indicator appears
**And** the form fields are cleared
**And** the phenotypers list refreshes to show the new entry

**Acceptance Criteria**:

- Name is trimmed of leading/trailing whitespace
- Email is validated for proper format
- Loading indicator appears during submission
- IPC call completes successfully
- New phenotyper appears in list without page refresh
- Form is ready for another entry

#### Scenario: Validation Failure - Empty Name

**Given** the user is on the `/phenotypers` page
**When** the user leaves the name field empty
**And** the user enters a valid email
**And** the user clicks "Add new phenotyper" button
**Then** an error message appears near the name field
**And** the error message states "Name is required" or similar
**And** no IPC call is made to the database
**And** the form remains populated with the entered email

**Acceptance Criteria**:

- Validation runs before submission (no network call)
- Error message is displayed inline near the name field
- Error message is cleared when user starts typing
- Email field retains its value
- Submit button can be clicked again after fixing error

#### Scenario: Validation Failure - Invalid Email Format

**Given** the user is on the `/phenotypers` page
**When** the user enters a valid name
**And** the user enters an invalid email (e.g., "notanemail")
**And** the user clicks "Add new phenotyper" button
**Then** an error message appears near the email field
**And** the error message states "Must be a valid email address" or similar
**And** no IPC call is made to the database
**And** the form remains populated with the entered name

**Acceptance Criteria**:

- Validation checks for @ symbol and domain
- Error message is displayed inline near the email field
- Error message is cleared when user starts typing
- Name field retains its value
- Submit button can be clicked again after fixing error

#### Scenario: Database Constraint Error - Duplicate Email

**Given** a phenotyper with email "existing@example.com" exists
**When** the user enters a valid name
**And** the user enters "existing@example.com" as the email
**And** the user clicks "Add new phenotyper" button
**Then** the IPC call returns an error response
**And** an error message appears indicating the email already exists
**And** the form remains populated with the entered data
**And** the user can correct the email and retry

**Acceptance Criteria**:

- Database unique constraint error is caught
- Error message is user-friendly (not raw database error)
- Error message clearly indicates the problem (duplicate email)
- Form data is preserved for correction
- Loading state clears when error is received

### Requirement: Phenotypers Navigation Integration

The application SHALL provide navigation to the Phenotypers page via a clearly labeled link in the main navigation menu, with the route registered at `/phenotypers`.

#### Scenario: Access via Navigation

**Given** the user is on any page in the application
**When** the user clicks the "Phenotypers" link in the navigation
**Then** the application navigates to `/phenotypers`
**And** the Phenotypers page loads
**And** the phenotypers list is fetched and displayed

**Acceptance Criteria**:

- Navigation link is clearly labeled "Phenotypers"
- Link is visible in the main navigation menu
- Route is registered in React Router
- Navigation works in both development and packaged modes
- Active route is visually indicated (if navigation has active states)

### Requirement: Excel File Upload for Accessions

The Accessions page SHALL provide drag-and-drop Excel file upload functionality for bulk-creating plant-to-genotype mappings with visual column mapping and preview.

#### Scenario: Drag and Drop File Upload

**Given** the user is on the `/accessions` page
**When** the user drags an Excel file (XLSX or XLS) into the upload zone
**Then** the file is accepted and parsed
**And** a loading indicator appears during parsing
**And** the sheet selector becomes visible (if multiple sheets)
**And** the column mapping interface appears

**Acceptance Criteria**:

- Upload zone has clear visual indication (dashed border)
- Accepted file types: .xlsx, .xls
- File type validation with user-friendly error message
- Loading state while parsing file

#### Scenario: File Size Validation

**Given** the user is on the `/accessions` page
**When** the user uploads an Excel file larger than 15MB
**Then** an error message appears indicating the file is too large
**And** the file is rejected
**And** the user is advised to split the file into smaller parts

**Acceptance Criteria**:

- Maximum file size: 15MB
- Clear error message: "File size exceeds 15MB. Please split into smaller files."
- Upload zone remains available for retry

#### Scenario: Sheet Selection for Multi-Sheet Files

**Given** the user has uploaded an Excel file with multiple sheets
**When** the file is parsed
**Then** a dropdown appears showing all sheet names
**And** the first sheet is selected by default
**And** the preview table shows data from the selected sheet

**Acceptance Criteria**:

- Sheet dropdown only visible when file has multiple sheets
- Changing sheet updates the preview and resets column selections
- Column headers extracted from first row of selected sheet

#### Scenario: Column Mapping Selection

**Given** the user has uploaded an Excel file
**When** the preview interface is displayed
**Then** two dropdown selectors appear: "Plant ID (Barcode)" and "Genotype ID"
**And** each dropdown contains all column headers from the file
**And** the user must select both columns before uploading

**Acceptance Criteria**:

- Both selectors start with "Select..." placeholder
- Columns can be selected in any order
- Same column cannot be selected for both fields
- Upload button disabled until both columns selected

#### Scenario: Visual Column Highlighting

**Given** the user has selected Plant ID and Genotype ID columns
**When** viewing the preview table
**Then** the Plant ID column is highlighted in green
**And** the Genotype ID column is highlighted in blue
**And** column headers show icons/labels indicating their mapping

**Acceptance Criteria**:

- Green highlight (#BBF7D0 or similar) for Plant ID column
- Blue highlight (#BFDBFE or similar) for Genotype ID column
- Header row shows "Plant ID" and "Genotype ID" labels
- Highlighting updates immediately on selection change

#### Scenario: Preview Table Display

**Given** the user has uploaded an Excel file
**When** the preview interface is displayed
**Then** a table shows the first 20 data rows (excluding header)
**And** all columns from the sheet are visible
**And** the table is horizontally scrollable if columns exceed width

**Acceptance Criteria**:

- Maximum 20 rows displayed in preview
- Header row always visible
- Table scrollable for wide spreadsheets
- Empty cells display as empty (not "undefined" or "null")

#### Scenario: Successful Upload with Batch Processing

**Given** the user has selected Plant ID and Genotype ID columns
**When** the user clicks the "Upload Accession File" button
**Then** a progress indicator appears showing upload status
**And** mappings are processed in batches of 100 rows
**And** a new accession is created with the file name
**And** all mappings are associated with the accession
**And** a success message appears when complete
**And** the accession list refreshes to show the new entry

**Acceptance Criteria**:

- Progress indicator shows during upload
- Batch size: 100 rows per batch
- Uses existing `createWithMappings` IPC handler
- Accession name derived from file name
- Form resets after successful upload
- Success message: "Done uploading!" or similar

#### Scenario: Upload Error Handling

**Given** the user is uploading an Excel file
**When** the upload fails (network error, database error)
**Then** an error message appears indicating the failure
**And** the form remains populated for retry
**And** the user can attempt the upload again

**Acceptance Criteria**:

- Error message is user-friendly (not raw error)
- Form state preserved on error
- Retry possible without re-uploading file

#### Scenario: Invalid File Type

**Given** the user is on the `/accessions` page
**When** the user attempts to upload a non-Excel file (e.g., .csv, .pdf, .txt)
**Then** the file is rejected
**And** an error message indicates only Excel files are accepted

**Acceptance Criteria**:

- Only .xlsx and .xls files accepted
- Clear error message for invalid file types
- Upload zone remains available for retry

### Requirement: Accession Mappings Preview

The Accessions page SHALL display a table of plant-to-genotype mappings when an accession is expanded, allowing users to view and verify uploaded data.

#### Scenario: View mappings table in expanded accession

- **GIVEN** an accession exists with plant mappings
- **WHEN** the user clicks on the accession to expand it
- **THEN** a table SHALL be displayed showing all plant mappings
- **AND** the table SHALL have columns for "Plant Barcode" and "Genotype ID"
- **AND** the mappings SHALL be sorted alphabetically by plant barcode

#### Scenario: Empty mappings state

- **GIVEN** an accession exists with no plant mappings
- **WHEN** the user expands the accession
- **THEN** a message SHALL indicate "No plant mappings" or similar
- **AND** the Edit and Delete buttons SHALL still be visible

#### Scenario: Loading state for mappings

- **GIVEN** the user clicks to expand an accession
- **WHEN** the mappings are being fetched from the database
- **THEN** a loading indicator SHALL be displayed
- **AND** the loading indicator SHALL be replaced by the table when data loads

#### Scenario: Mappings table scrollable for large datasets

- **GIVEN** an accession has more than 10 plant mappings
- **WHEN** the mappings table is displayed
- **THEN** the table SHALL be scrollable vertically
- **AND** the table height SHALL be constrained to prevent excessive page length

### Requirement: Inline Editing of Accession Mappings

The Accessions page SHALL allow users to edit the genotype ID of individual plant mappings inline.

#### Scenario: Edit genotype ID inline

- **GIVEN** the mappings table is displayed for an expanded accession
- **WHEN** the user clicks on a genotype ID cell
- **THEN** the cell SHALL become editable with an input field
- **AND** the input SHALL be pre-populated with the current value

#### Scenario: Save inline edit with Enter key

- **GIVEN** the user is editing a genotype ID inline
- **WHEN** the user presses Enter
- **THEN** the new value SHALL be saved to the database
- **AND** the cell SHALL return to display mode with the updated value

#### Scenario: Cancel inline edit with Escape key

- **GIVEN** the user is editing a genotype ID inline
- **WHEN** the user presses Escape
- **THEN** the edit SHALL be cancelled
- **AND** the cell SHALL return to display mode with the original value

#### Scenario: Save inline edit on blur

- **GIVEN** the user is editing a genotype ID inline
- **WHEN** the user clicks outside the input field
- **THEN** the new value SHALL be saved to the database
- **AND** the cell SHALL return to display mode with the updated value

### Requirement: Experiments List View

The Experiments page SHALL display all experiments from the database in a clean, readable list format, with support for both empty and populated states.

#### Scenario: Empty State

**Given** no experiments exist in the database
**When** the user navigates to `/experiments`
**Then** the page displays a message indicating no experiments are present
**And** the create form is visible below

**Acceptance Criteria**:

- Empty state message is clear (e.g., "No experiments yet")
- List container is visually distinct but empty
- User can immediately see the create form without scrolling

#### Scenario: Display Experiments

**Given** multiple experiments exist in the database
**When** the user navigates to `/experiments`
**Then** all experiments are displayed in a list
**And** each list item shows: `{species} - {name} ({scientist name or "unknown"})`
**And** the list is sorted alphabetically by name

**Acceptance Criteria**:

- Each experiment appears exactly once
- Format: "{species} - {name} ({scientist name})" or "(unknown)" if no scientist linked
- List is scrollable if content exceeds container height (max-height: 256px)
- Loading state appears while fetching data
- Database errors show user-friendly error message

### Requirement: Create Experiment

The Experiments page MUST allow users to create new experiments with validation (name required, species required, scientist required, accession required). When the configured scanner mode is `graviscan`, the created experiment SHALL have `experiment_type: 'graviscan'`, and the form SHALL additionally offer a wave-number field (default `0`); the form's existing required Accession dropdown is reused as that wave's metadata-file selection — no second accession picker is added. When the configured scanner mode is `cylinderscan` (or any other mode), the created experiment SHALL have `experiment_type: 'cylinderscan'` and the form's fields are unchanged from today.

#### Scenario: Valid Submission

**Given** the user is on the `/experiments` page
**When** the user enters a valid name (e.g., "Drought Study 2025")
**And** the user selects a species from the dropdown
**And** the user selects a scientist from the dropdown
**And** the user selects an accession from the dropdown
**And** the user clicks "Create" button
**Then** the experiment is created in the database with scientist and accession linked
**And** the form fields are cleared
**And** the experiments list refreshes to show the new entry

**Acceptance Criteria**:

- Name is trimmed of leading/trailing whitespace at the validation level
- Species is required (dropdown, no empty option after selection)
- Scientist is required (dropdown from scientists list)
- Accession is required (dropdown from accessions list)
- Loading indicator appears during submission
- IPC call completes successfully
- New experiment appears in list without page refresh

#### Scenario: Validation Failure - Empty Name

**Given** the user is on the `/experiments` page
**When** the user leaves the name field empty
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** an error indication appears

**Acceptance Criteria**:

- Validation runs before submission (no network call)
- Form remains populated with selected values
- Submit button can be clicked again after fixing error

#### Scenario: Validation Failure - Whitespace-Only Name

**Given** the user is on the `/experiments` page
**When** the user enters only whitespace characters (e.g. " ")
**And** the user selects a scientist and accession
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** an error message "Name is required" appears

**Acceptance Criteria**:

- Whitespace is trimmed before min-length validation
- No IPC call is made to the database
- Other form fields retain their values

#### Scenario: Validation Failure - No Scientist Selected

**Given** the user is on the `/experiments` page
**And** scientists exist in the database
**When** the user fills in name and species
**And** the user does not select a scientist
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** an error message "Scientist is required" appears near the scientist field

#### Scenario: Validation Failure - No Accession Selected

**Given** the user is on the `/experiments` page
**And** accessions exist in the database
**When** the user fills in name, species, and scientist
**And** the user does not select an accession
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** an error message "Accession is required" appears near the accession field

#### Scenario: Species Dropdown

**Given** the user is on the `/experiments` page
**When** the user views the species dropdown
**Then** all supported species are available for selection

**Acceptance Criteria**:

- Dropdown pre-selects the first species
- All 15 species are listed alphabetically

#### Scenario: GraviScan mode sets experiment_type and links the selected accession to a wave

**Given** the configured scanner mode is `graviscan`
**When** the user creates a new experiment via the standard Create flow, selecting an accession in the form's existing required Accession dropdown and a wave number (default `0`)
**Then** the created experiment SHALL have `experiment_type: 'graviscan'`
**And** the created experiment's `accession_id` SHALL be set to the selected accession, exactly as it is for a cylinderscan experiment today
**And** the page SHALL call `linkGraviMetadata(newExperimentId, waveNumber, accessionId)` immediately after the experiment is created, using that same selected accession
**And** no second accession/metadata-file dropdown SHALL appear on the form

#### Scenario: GraviScan mode filters the Accession dropdown to GraviScan-eligible files

**Given** the configured scanner mode is `graviscan`
**And** the database has a mix of CylinderScan barcode-mapping `Accessions` rows and GraviScan metadata-file `Accessions` rows
**When** the Accession dropdown renders
**Then** its options SHALL come from `graviPlateAccessions.listFiles()`, not the generic `accessions.list()`
**And** only GraviScan-eligible accessions (at least one `GraviPlateAccession` child) SHALL appear

#### Scenario: Post-create link failure does not lose the created experiment

**Given** a new graviscan experiment was just created successfully
**When** the subsequent `linkGraviMetadata` call fails
**Then** the page SHALL show "Experiment created but metadata link failed: {message}"
**And** the newly created experiment SHALL remain in the experiments list (not rolled back)

#### Scenario: CylinderScan mode is unaffected

**Given** the configured scanner mode is `cylinderscan`
**When** the user creates a new experiment
**Then** the created experiment SHALL have `experiment_type: 'cylinderscan'`
**And** no wave-number field SHALL appear
**And** the Accession dropdown behaves exactly as it does today (no wave-linking call is made)

### Requirement: Attach Accession to Existing Experiment

The Experiments page SHALL allow users to attach an accession to an existing experiment via a dedicated UI section. For `cylinderscan`-typed experiments, this uses the existing single-accession `attachAccession` call, unchanged. For `graviscan`-typed experiments, this section instead requires a wave number and calls `linkGraviMetadata`, since a single experiment may have distinct accessions per wave; existing wave→accession links are shown inline beneath each graviscan experiment, each with an Unlink action.

#### Scenario: Attach Accession (cylinderscan)

**Given** experiments and accessions exist in the database
**And** the selected experiment has `experiment_type: 'cylinderscan'`
**When** the user selects the experiment from the dropdown
**And** the user selects an accession from the dropdown
**And** the user clicks "Attach Accession" button
**Then** the experiment is updated with the accession link via `attachAccession`
**And** a success message appears

**Acceptance Criteria**:

- Experiment dropdown shows: `{species} - {name} ({scientist name})`
- Accession dropdown shows: `{name} - {id}`
- Loading indicator during attachment
- Success message: "Accession successfully attached."
- Error message if attachment fails

#### Scenario: Attach Metadata File to a Wave (graviscan)

**Given** experiments and GraviScan metadata files exist in the database
**And** the selected experiment has `experiment_type: 'graviscan'`
**When** the user selects the experiment from the dropdown
**Then** the wave-number field SHALL default to `max(existing linked wave numbers for that experiment) + 1`
**And** the metadata-file dropdown's options SHALL come from `graviPlateAccessions.listFiles()`, not the generic `accessions.list()`, so only GraviScan-eligible files appear
**And** when the user selects a metadata file and clicks the attach action, the page SHALL call `linkGraviMetadata(experimentId, waveNumber, accessionId)`
**And** on success, the new wave→accession link SHALL appear inline beneath that experiment in the list

#### Scenario: Existing wave links shown inline, with Unlink

**Given** a `graviscan`-typed experiment has one or more linked waves
**When** the experiments list renders
**Then** each experiment SHALL show its linked waves as "Wave N: {accession name}" beneath its entry, each with an Unlink action
**And** clicking Unlink SHALL first show a confirmation naming the wave number and accession, and stating that history is not retained (for wave `0`, additionally noting the experiment's default accession will not change)
**And** only on confirming SHALL the page call `unlinkGraviMetadata(experimentId, waveNumber)`
**And** declining the confirmation SHALL leave the link unchanged and make no IPC call

#### Scenario: Linking a wave that already has a link is rejected

**Given** a `graviscan`-typed experiment already has wave `2` linked to a metadata file
**When** the user attempts to link wave `2` again (to the same or a different file) without first unlinking
**Then** the page SHALL surface the backend's rejection as an inline error
**And** the existing link SHALL remain unchanged

### Requirement: Experiments Navigation Integration

The application SHALL provide navigation to the Experiments page via a clearly labeled link in the main navigation menu, with the route registered at `/experiments`.

#### Scenario: Access via Navigation

**Given** the user is on any page in the application
**When** the user clicks the "Experiments" link in the navigation
**Then** the application navigates to `/experiments`
**And** the Experiments page loads
**And** the experiments list is fetched and displayed

**Acceptance Criteria**:

- Navigation link is clearly labeled "Experiments"
- Link is visible in the main navigation menu
- Route is registered in React Router
- Navigation works in both development and packaged modes

### Requirement: ExperimentChooser Component

The ExperimentChooser component SHALL provide a dropdown for selecting experiments in CaptureScan, replacing the text input.

#### Scenario: Display Experiment Options

**Given** the ExperimentChooser is rendered
**When** experiments exist in the database
**Then** a dropdown displays all experiments by name
**And** a placeholder option "Choose an experiment" is shown when nothing selected

**Acceptance Criteria**:

- Dropdown shows experiment names
- Placeholder text when no selection
- Amber border when nothing selected
- Gray border when selection made

#### Scenario: Selection Change Callback

**Given** the ExperimentChooser is rendered
**When** the user selects an experiment
**Then** the `experimentIdChanged` callback is called with the experiment ID
**And** the dropdown updates to show the selected experiment

**Acceptance Criteria**:

- Callback receives experiment ID (string) or null
- Selection is visually indicated
- Clearing selection (if supported) calls callback with null

#### Scenario: Periodic Refresh

**Given** the ExperimentChooser is rendered
**When** the component is mounted
**Then** experiments are fetched immediately
**And** experiments are refreshed every 10 seconds

**Acceptance Criteria**:

- Initial fetch on mount
- Polling interval: 10 seconds
- Cleanup on unmount (clear interval)
- New experiments appear without manual refresh

### Requirement: PhenotyperChooser Component

The PhenotyperChooser component SHALL provide a dropdown for selecting phenotypers in CaptureScan, replacing the text input.

#### Scenario: Display Phenotyper Options

**Given** the PhenotyperChooser is rendered
**When** phenotypers exist in the database
**Then** a dropdown displays all phenotypers by name
**And** a placeholder option "Choose a phenotyper" is shown when nothing selected

**Acceptance Criteria**:

- Dropdown shows phenotyper names
- Placeholder text when no selection
- Amber border when nothing selected
- Gray border when selection made

#### Scenario: Selection Change Callback

**Given** the PhenotyperChooser is rendered
**When** the user selects a phenotyper
**Then** the `phenotyperIdChanged` callback is called with the phenotyper ID
**And** the dropdown updates to show the selected phenotyper

**Acceptance Criteria**:

- Callback receives phenotyper ID (string) or null
- Selection is visually indicated

#### Scenario: Periodic Refresh

**Given** the PhenotyperChooser is rendered
**When** the component is mounted
**Then** phenotypers are fetched immediately
**And** phenotypers are refreshed every 10 seconds

**Acceptance Criteria**:

- Initial fetch on mount
- Polling interval: 10 seconds
- Cleanup on unmount (clear interval)
- New phenotypers appear without manual refresh

### Requirement: CaptureScan Chooser Integration

The CaptureScan page SHALL use ExperimentChooser and PhenotyperChooser components instead of text inputs.

#### Scenario: Experiment Selection in CaptureScan

**Given** the user is on the CaptureScan page
**When** the user views the Experiment field
**Then** a dropdown is displayed (not a text input)
**And** the user can select from available experiments

**Acceptance Criteria**:

- Text input replaced with ExperimentChooser
- Selected experiment ID used for scan metadata
- Validation requires experiment selection

#### Scenario: Phenotyper Selection in CaptureScan

**Given** the user is on the CaptureScan page
**When** the user views the Phenotyper field
**Then** a dropdown is displayed (not a text input)
**And** the user can select from available phenotypers

**Acceptance Criteria**:

- Text input replaced with PhenotyperChooser
- Selected phenotyper ID used for scan metadata
- Validation requires phenotyper selection

### Requirement: Plant Barcode Autocomplete

The PlantBarcodeInput component SHALL provide autocomplete suggestions from the experiment's accession mappings as the user types.

#### Scenario: Display autocomplete suggestions

- **GIVEN** an experiment with an attached accession containing plant barcodes ["PLANT_001", "PLANT_002", "PLANT_003", "OTHER_001"]
- **WHEN** the user types "PLANT" in the plant barcode field
- **THEN** a dropdown SHALL appear showing up to 5 matching barcodes
- **AND** the matches SHALL be case-insensitive
- **AND** the dropdown SHALL show ["PLANT_001", "PLANT_002", "PLANT_003"]

#### Scenario: Select autocomplete suggestion

- **GIVEN** the autocomplete dropdown is visible with suggestions
- **WHEN** the user clicks on a suggestion or presses Enter while highlighted
- **THEN** the input SHALL be populated with the selected barcode
- **AND** the dropdown SHALL close
- **AND** the genotype ID SHALL be auto-populated

#### Scenario: Keyboard navigation

- **GIVEN** the autocomplete dropdown is visible with suggestions
- **WHEN** the user presses Arrow Down/Up
- **THEN** the highlight SHALL move between suggestions
- **AND** pressing Escape SHALL close the dropdown without selection

#### Scenario: No suggestions when experiment has no accession

- **GIVEN** an experiment without an attached accession
- **WHEN** the user types in the plant barcode field
- **THEN** no autocomplete dropdown SHALL appear
- **AND** the user MAY enter any barcode manually

### Requirement: Plant Barcode Validation

The PlantBarcodeInput component SHALL validate plant barcodes against the experiment's accession mappings and block scanning for invalid barcodes.

#### Scenario: Valid barcode entered

- **GIVEN** an experiment with an accession containing barcode "PLANT_001"
- **WHEN** the user enters "PLANT_001" in the plant barcode field
- **THEN** no validation error SHALL be displayed
- **AND** the scan button SHALL remain enabled (if other requirements met)

#### Scenario: Invalid barcode entered

- **GIVEN** an experiment with an accession containing only ["PLANT_001", "PLANT_002"]
- **WHEN** the user enters "INVALID_BARCODE" in the plant barcode field
- **THEN** a validation error SHALL be displayed: "Barcode not found in accession file"
- **AND** the scan button SHALL be disabled

#### Scenario: Validation skipped when no accession attached

- **GIVEN** an experiment without an attached accession
- **WHEN** the user enters any barcode
- **THEN** no validation error SHALL be displayed
- **AND** the user MAY proceed with the scan

### Requirement: Plant Barcode Sanitization

The PlantBarcodeInput component SHALL sanitize user input to normalize barcode formats.

#### Scenario: Replace plus signs with underscores

- **GIVEN** the user is entering a plant barcode
- **WHEN** the user types "PLANT+001"
- **THEN** the input SHALL display "PLANT_001"

#### Scenario: Replace spaces with underscores

- **GIVEN** the user is entering a plant barcode
- **WHEN** the user types "PLANT 001 TEST"
- **THEN** the input SHALL display "PLANT_001_TEST"

#### Scenario: Preserve allowed characters

- **GIVEN** the user is entering a plant barcode
- **WHEN** the user types "Plant_001-A"
- **THEN** the input SHALL display "Plant_001-A" (unchanged)
- **AND** alphanumerics, underscores, and dashes SHALL be preserved

#### Scenario: Strip other special characters

- **GIVEN** the user is entering a plant barcode
- **WHEN** the user types "PLANT@001#TEST!"
- **THEN** the input SHALL display "PLANT001TEST"

### Requirement: Genotype ID Auto-Population

The MetadataForm SHALL automatically populate the genotype ID field when a valid plant barcode is entered.

#### Scenario: Auto-populate genotype ID on valid barcode

- **GIVEN** an experiment with an accession mapping: barcode "PLANT_001" -> genotype_id "GT_ABC123"
- **WHEN** the user enters or selects "PLANT_001"
- **THEN** the genotype ID field SHALL be automatically populated with "GT_ABC123"

#### Scenario: Clear genotype ID when barcode changes to invalid

- **GIVEN** the genotype ID field is populated with "GT_ABC123"
- **WHEN** the user changes the plant barcode to an invalid value
- **THEN** the genotype ID field SHALL be cleared

#### Scenario: No auto-population when experiment has no accession

- **GIVEN** an experiment without an attached accession
- **WHEN** the user enters a plant barcode
- **THEN** the genotype ID field SHALL NOT be auto-populated
- **AND** the user MAY enter a genotype ID manually

### Requirement: Duplicate Scan Prevention

The CaptureScan page SHALL prevent re-scanning the same plant for the same
experiment, wave, and plant age.

#### Scenario: Matching duplicate found

- **GIVEN** a non-deleted scan exists for plant "PLANT_001", experiment
  "EXP_001", wave 2, plant age 21 days
- **WHEN** the user selects experiment "EXP_001", enters barcode
  "PLANT_001", wave 2, and plant age 21
- **THEN** a warning SHALL be displayed indicating this plant/wave/age
  combination was already scanned for this experiment
- **AND** the scan button SHALL be disabled

#### Scenario: Matching duplicate found on a different day

- **GIVEN** a non-deleted scan exists for plant "PLANT_001", experiment
  "EXP_001", wave 2, plant age 21 days, captured yesterday
- **WHEN** the user enters the same plant, experiment, wave, and plant age
  today
- **THEN** a warning SHALL be displayed, the same as same-day duplicate
  matches — capture date is no longer part of the duplicate key
- **AND** the scan button SHALL be disabled

#### Scenario: Different wave number

- **GIVEN** a non-deleted scan exists for plant "PLANT_001", experiment
  "EXP_001", wave 2, plant age 21 days
- **WHEN** the user enters the same plant and experiment but wave 3
- **THEN** no warning SHALL be displayed
- **AND** the scan button SHALL remain enabled

#### Scenario: Different plant age

- **GIVEN** a non-deleted scan exists for plant "PLANT_001", experiment
  "EXP_001", wave 2, plant age 21 days
- **WHEN** the user enters the same plant, experiment, and wave but plant
  age 25
- **THEN** no warning SHALL be displayed
- **AND** the scan button SHALL remain enabled

#### Scenario: Same plant scanned for different experiment

- **GIVEN** a non-deleted scan exists for plant "PLANT_001", experiment
  "EXP_001", wave 2, plant age 21 days
- **WHEN** the user selects experiment "EXP_002" with the same plant, wave,
  and age
- **THEN** no warning SHALL be displayed
- **AND** the scan button SHALL remain enabled

#### Scenario: Periodic duplicate check

- **GIVEN** the user has entered a plant barcode, experiment, wave number,
  and plant age
- **WHEN** the component is mounted
- **THEN** the duplicate check SHALL run every 2 seconds via
  `db:scans:checkDuplicate`
- **AND** the check SHALL stop when the component unmounts

#### Scenario: Unparsed wave number or plant age does not trigger the check

- **GIVEN** the wave-number or plant-age-days form field is empty or
  contains a non-numeric value
- **WHEN** the periodic duplicate check would otherwise run
- **THEN** the check SHALL NOT call `db:scans:checkDuplicate` with an
  invalid value
- **AND** no warning SHALL be displayed as a result of this skipped check

### Requirement: Plant Barcode IPC Handlers

The main process SHALL provide IPC handlers for plant barcode operations.

#### Scenario: Get plant barcodes for accession

- **GIVEN** an accession with plant mappings exists
- **WHEN** the renderer calls `db:accessions:getPlantBarcodes(accessionId)`
- **THEN** the handler SHALL return an array of plant barcodes

#### Scenario: Get genotype ID by barcode

- **GIVEN** a plant barcode mapping exists for an experiment's accession
- **WHEN** the renderer calls `db:accessions:getGenotypeByBarcode(plantBarcode, experimentId)`
- **THEN** the handler SHALL return the genotype_id or null if not found

### Requirement: Experiment Accession Indicator

The ExperimentChooser component SHALL display a visual indicator for experiments that have accessions attached.

#### Scenario: Experiment with accession shows checkmark

- **WHEN** an experiment has an associated accession
- **THEN** the dropdown displays a checkmark prefix: `✓ {experiment.name}`

#### Scenario: Experiment without accession shows no indicator

- **WHEN** an experiment has no associated accession
- **THEN** the dropdown displays only the experiment name: `{experiment.name}`

### Requirement: Accession Linked Experiments Display

The AccessionList component SHALL display which experiments are linked to each accession when expanded.

#### Scenario: Accession with linked experiments

- **WHEN** an accession is expanded AND has linked experiments
- **THEN** a "Linked Experiments:" section displays with a bulleted list of experiment names

#### Scenario: Accession with no linked experiments

- **WHEN** an accession is expanded AND has no linked experiments
- **THEN** a "Linked Experiments:" section displays with italic gray text "No experiments linked"

### Requirement: Accession List Query Includes Experiments

The database handler for listing accessions SHALL include the linked experiments relation.

#### Scenario: Fetching accessions includes experiment names

- **WHEN** the accessions list is fetched
- **THEN** each accession includes an `experiments` array with experiment names

### Requirement: Fetch Scanners IPC Handler

The IPC handler for `config:fetch-scanners` SHALL accept `apiUrl` and `credentials` as parameters and use the provided credentials to fetch scanners from the Bloom API, rather than loading credentials from the `.env` file.

#### Scenario: Fetch scanners works on first run

- **GIVEN** the app is running for the first time
- **AND** no `~/.bloom/.env` file exists
- **WHEN** user enters valid credentials in the form
- **AND** clicks the "Fetch Scanners from Bloom" button
- **THEN** the button SHALL successfully fetch the scanner list
- **AND** the scanner dropdown SHALL populate with available scanners

#### Scenario: Fetch scanners uses form credentials not file

- **GIVEN** saved credentials exist in `~/.bloom/.env`
- **AND** user has modified the credentials in the form
- **AND** user has NOT saved the modified credentials
- **WHEN** user clicks the "Fetch Scanners from Bloom" button
- **THEN** the handler SHALL use the modified credentials from the form
- **AND** the handler SHALL NOT use the saved credentials from `.env`

### Requirement: Configuration Form Loading

When the Machine Configuration page loads, it SHALL immediately display the configuration form pre-filled with saved values (if any exist), without requiring credential re-entry or login screen.

#### Scenario: Direct access to configuration without login

- **GIVEN** the app is started
- **AND** saved configuration exists in `~/.bloom/.env` (single file with all config)
- **WHEN** user navigates to Machine Configuration
- **THEN** the configuration form SHALL be displayed immediately
- **AND** the form SHALL be pre-filled with ALL saved values (scanner name, camera IP, API URL, credentials)
- **AND** NO login screen SHALL be displayed

#### Scenario: First run shows form immediately

- **GIVEN** the app is started for the first time
- **AND** no saved configuration exists
- **WHEN** user navigates to Machine Configuration
- **THEN** the configuration form SHALL be displayed immediately
- **AND** the form SHALL contain default values
- **AND** NO login screen SHALL be displayed

### Requirement: Form State Management

The Machine Configuration component SHALL manage two form states (`'loading'` and `'config'`) without a login state.

#### Scenario: Simplified state transitions

- **GIVEN** the Machine Configuration component is mounted
- **THEN** the form state SHALL initially be `'loading'`
- **WHEN** configuration data is loaded from storage
- **THEN** the form state SHALL transition directly to `'config'`
- **AND** the form state SHALL NOT include `'login'` as a possible value

### Requirement: Single Source of Truth Configuration Storage

The application SHALL store all machine configuration (scanner settings AND credentials) in a single `~/.bloom/.env` file, eliminating the redundant `config.json` file.

#### Scenario: All configuration saved to .env

- **GIVEN** user has filled in the complete configuration form
- **WHEN** user clicks "Save Configuration"
- **THEN** all values SHALL be saved to `~/.bloom/.env`
- **AND** the following fields SHALL be present in `.env`:
  - `SCANNER_NAME`
  - `CAMERA_IP_ADDRESS`
  - `SCANS_DIR`
  - `BLOOM_API_URL`
  - `BLOOM_SCANNER_USERNAME`
  - `BLOOM_SCANNER_PASSWORD`
  - `BLOOM_ANON_KEY`
- **AND** NO `~/.bloom/config.json` file SHALL be created

#### Scenario: Automatic migration from legacy config.json

- **GIVEN** the app is started
- **AND** `~/.bloom/config.json` exists (legacy format)
- **AND** `~/.bloom/.env` exists with credentials
- **WHEN** configuration is loaded
- **THEN** values from both files SHALL be merged
- **AND** all values SHALL be saved to `~/.bloom/.env`
- **AND** `~/.bloom/config.json` SHALL be deleted
- **AND** future loads SHALL read only from `~/.bloom/.env`

### Requirement: Bloom API Scanner Fetch Authentication

The Machine Configuration page SHALL fetch valid scanner names from the Bloom API using proper Supabase authentication with `@salk-hpi/bloom-js` library, matching the pilot implementation.

#### Scenario: Successful scanner fetch with valid credentials

**Given** a user has entered valid Bloom API credentials (username, password, anon key, API URL)
**When** the application fetches scanners from the Bloom API
**Then** the system creates a Supabase client with the API URL and anon key
**And** authenticates using `supabase.auth.signInWithPassword()` with the username and password
**And** creates a `SupabaseStore` instance from `@salk-hpi/bloom-js`
**And** calls `store.getAllCylScanners()` to query the `cyl_scanners` table
**And** returns a list of scanners with `id` and `name` fields
**And** populates the scanner dropdown with the fetched names

**Acceptance Criteria**:

- Uses `@supabase/supabase-js` `createClient()` method
- Uses `@salk-hpi/bloom-js` `SupabaseStore` class
- Authenticates with email/password (not password as Bearer token)
- Queries `cyl_scanners` table (not `/scanners` HTTP endpoint)
- Returns scanner objects with `{ id: number, name: string | null }` structure
- Scanner dropdown shows only valid scanners from database

#### Scenario: Authentication failure with invalid credentials

**Given** a user has entered invalid Bloom API credentials
**When** the application attempts to fetch scanners
**Then** the Supabase client authentication fails
**And** the system returns an error: "Authentication failed: [error message]"
**And** the scanner dropdown shows "Unable to load scanners"
**And** an error message displays to the user
**And** a "Retry" button allows the user to attempt fetch again

**Acceptance Criteria**:

- Supabase auth errors are caught and formatted for user display
- No raw error objects exposed to UI
- Retry mechanism available
- Scanner dropdown disabled during error state

#### Scenario: Network error during scanner fetch

**Given** a user has valid credentials
**And** the Bloom API is unreachable or network is down
**When** the application attempts to fetch scanners
**Then** the system catches the network error
**And** returns an error: "Network error: [error message]"
**And** the scanner dropdown shows "Unable to load scanners"
**And** appropriate error handling prevents application crash

**Acceptance Criteria**:

- Network errors caught and handled gracefully
- User-friendly error messages displayed
- Application remains functional despite API unavailability
- Retry mechanism available

#### Scenario: Scanner fetch triggers after credential save

**Given** a user is configuring the machine for the first time (no existing credentials)
**When** the user enters Bloom API credentials and clicks "Save Configuration"
**And** the credentials save successfully
**Then** the system automatically triggers `fetchScanners()`
**And** shows a loading indicator in the scanner dropdown
**And** populates the scanner dropdown when fetch completes
**And** the user can immediately select a scanner without page refresh

**Acceptance Criteria**:

- Scanner fetch triggered automatically after first-time credential save
- Loading state shown during fetch ("Loading scanners...")
- Dropdown populates without requiring page navigation or refresh
- Seamless UX: credentials → save → scanners load → select scanner

### Requirement: Machine Configuration Page Section Order

The Machine Configuration page SHALL present form sections in the following order to optimize user experience and logical flow: Bloom API Credentials (first), Machine Identity (second), Hardware (third).

#### Scenario: First-run configuration flow

**Given** a user is configuring the machine for the first time
**And** no credentials exist in `~/.bloom/.env`
**When** the user navigates to `/machine-configuration`
**Then** the Bloom API Credentials section appears first at the top of the page
**And** the Machine Identity section appears second below credentials
**And** the Hardware section appears third below machine identity
**And** the scanner name dropdown in Machine Identity section shows "Enter credentials first" (disabled)
**And** the user can complete the form in top-to-bottom order without scrolling back

**Acceptance Criteria**:

- Section visual order: Credentials → Machine Identity → Hardware
- Tab navigation order follows visual order
- Scanner dropdown disabled until credentials entered
- Save button appears at bottom after all sections
- No behavioral changes to validation or save functionality

#### Scenario: Existing configuration access flow

**Given** a user has existing credentials stored in `~/.bloom/.env`
**And** the user has authenticated successfully
**When** the user views the Machine Configuration page
**Then** the Bloom API Credentials section appears first at the top with masked password
**And** the Machine Identity section appears second with pre-selected scanner
**And** the Hardware section appears third with existing camera/directory settings
**And** the scanner name dropdown is populated and enabled (credentials already exist)
**And** the user can review and modify settings in top-to-bottom order

**Acceptance Criteria**:

- Credentials section shows: username (populated), password (masked), anon key (populated), API URL (populated)
- Scanner dropdown populated with scanners from Bloom API
- Pre-existing scanner selection visible
- Camera IP and scans directory pre-populated
- Form follows logical dependency: credentials enable scanner selection

#### Scenario: Keyboard navigation follows visual order

**Given** a user is on the Machine Configuration page
**When** the user presses Tab to navigate through form fields
**Then** focus moves in the following order:

1. Username (Bloom API Credentials)
2. Password (Bloom API Credentials)
3. Anon Key (Bloom API Credentials)
4. API URL (Bloom API Credentials)
5. Scanner Name dropdown (Machine Identity)
6. Camera IP Address (Hardware)
7. Scans Directory path (Hardware)
8. Browse button (Hardware)
9. Save Configuration button

**Acceptance Criteria**:

- Tab order matches visual top-to-bottom order
- No focus traps or unexpected focus jumps
- Focus visible on all interactive elements
- Screen readers announce sections in correct order

### Requirement: Bloom API Credentials Section

The Machine Configuration page SHALL provide a Bloom API Credentials section at the top of the form that allows users to enter authentication credentials and test connectivity before completing the full configuration.

The section SHALL include:

- API URL input field
- Username (email) input field
- Password input field
- Anon Key input field
- **"Fetch Scanners from Bloom" button** to test credentials and retrieve scanner list

#### Scenario: Fetch button disabled when credentials incomplete

- **GIVEN** user is on Machine Configuration page
- **WHEN** any credential field (username, password, anon key, or API URL) is empty
- **THEN** the "Fetch Scanners from Bloom" button SHALL be disabled
- **AND** button SHALL have grayed-out styling

#### Scenario: Fetch button enabled when credentials complete

- **GIVEN** user has entered all credentials (username, password, anon key, API URL)
- **WHEN** all fields have non-empty values
- **THEN** the "Fetch Scanners from Bloom" button SHALL be enabled
- **AND** button SHALL have primary blue styling

#### Scenario: User fetches scanners successfully

- **GIVEN** user has entered valid credentials
- **WHEN** user clicks "Fetch Scanners from Bloom" button
- **THEN** button SHALL show loading state with spinner
- **AND** scanner list SHALL be fetched from Bloom API
- **AND** on success, scanner dropdown SHALL populate with available scanners
- **AND** success message SHALL display "✓ Found N scanners"
- **AND** button SHALL return to enabled state

#### Scenario: User fetches scanners with invalid credentials

- **GIVEN** user has entered invalid credentials
- **WHEN** user clicks "Fetch Scanners from Bloom" button
- **THEN** button SHALL show loading state with spinner
- **AND** authentication SHALL fail
- **AND** error message SHALL display authentication failure reason
- **AND** scanner dropdown SHALL remain empty with error state
- **AND** button SHALL return to enabled state

#### Scenario: User can complete form after fetching scanners

- **GIVEN** user has successfully fetched scanners using the button
- **WHEN** scanner dropdown is populated
- **THEN** user SHALL be able to select a scanner from dropdown
- **AND** user SHALL be able to complete remaining form fields
- **AND** user SHALL be able to save full configuration
- **AND** validation SHALL not block save due to empty scanner field

#### Scenario: Fetch button prevents duplicate requests

- **GIVEN** user clicks "Fetch Scanners from Bloom" button
- **WHEN** fetch operation is in progress (loading state)
- **THEN** button SHALL be disabled
- **AND** clicking button again SHALL have no effect
- **AND** button SHALL re-enable only after fetch completes

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

The application SHALL allow users to soft-delete individual scans, with
confirmation, from both the BrowseScans table and the ScanPreview page.

#### Scenario: Delete Scan with Confirmation

- **GIVEN** the user is viewing the scans table or a scan's preview page
- **WHEN** the user clicks the delete button for a scan
- **THEN** a confirmation modal appears
- **AND** the modal shows the Plant ID and capture date
- **AND** the modal has Cancel and Delete buttons

**Acceptance Criteria**:

- Delete button has destructive styling (red), present in both
  `BrowseScans.tsx`'s table row actions and `ScanPreview.tsx`'s toolbar
- Confirmation modal is modal (blocks interaction), shared between both
  call sites (not a native `window.confirm()`)
- Cancel closes the modal without action
- Delete calls the `db:scans:delete` IPC handler; on success, BrowseScans
  refreshes its table and ScanPreview navigates back to `/scans`

#### Scenario: Soft Delete Preserves Data

- **GIVEN** the user confirms scan deletion
- **WHEN** the delete operation completes
- **THEN** the scan's `deleted` field is set to `true` in the database
- **AND** the scan's `metadata.json` on disk has `deleted: true` set
- **AND** the scan no longer appears in the BrowseScans table
- **AND** the scan files are NOT removed from disk
- **AND** a success message appears briefly

**Acceptance Criteria**:

- Database record preserved with `deleted: true`
- `metadata.json` updated with `deleted: true` via an atomic write
- Files remain in the scans directory
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
- Includes image `id`, `status`, `path`, and `frame_number` for each image (still not full image data — no upload timestamps or error fields) — `path`/`frame_number` support resolving each scan's first-image thumbnail without a separate per-row fetch. (Note: the live spec this requirement replaces said "Includes image count (not full image data)," which was already stale relative to the actual `{id, status}` select before this change touched it — this MODIFIED requirement's text reflects the accurate pre-existing shape plus this change's own `path`/`frame_number` addition; only the latter is what this change actually introduces, same principle as the "BrowseScans List View drift" note above.)
- Ordered by `capture_date` descending

#### Scenario: Response Includes First-Image Reference Data

**Given** a scan with multiple images at different `frame_number` values
**When** `db:scans:list`'s paginated query returns that scan
**Then** each image entry in the response includes its `path` and `frame_number` alongside `id` and `status`
**And** the renderer can determine the lowest-`frame_number` image without an additional IPC round trip

### Requirement: Scan Delete IPC Handler

The main process SHALL provide an IPC handler for soft-deleting scans that
keeps the scan's on-disk `metadata.json` in sync.

#### Scenario: Soft Delete Scan

- **GIVEN** the renderer calls `db:scans:delete` with a scan ID
- **WHEN** the handler processes the request
- **THEN** the scan's `deleted` field is set to `true` in the database
- **AND** the handler returns success confirmation
- **AND** the scan files are NOT removed from disk

**Acceptance Criteria**:

- Sets `deleted: true` via Prisma update
- Does not delete Image records
- Does not delete files from filesystem
- Returns `{ success: true }` on completion
- Returns error if scan not found

#### Scenario: metadata.json is updated on delete

- **GIVEN** a scan with an existing `metadata.json` file on disk
- **WHEN** `db:scans:delete` successfully soft-deletes the scan
- **THEN** the scan's `metadata.json` file SHALL be rewritten with
  `deleted: true` added, via an atomic write (temp file + rename)
- **AND** all other fields in `metadata.json` SHALL remain unchanged

#### Scenario: Missing metadata.json does not fail the delete

- **GIVEN** a scan whose `metadata.json` file does not exist on disk (e.g.
  a legacy scan captured before metadata.json support existed)
- **WHEN** `db:scans:delete` is called for that scan
- **THEN** the database soft-delete SHALL still succeed
- **AND** the handler SHALL log a warning about the missing file
- **AND** the handler SHALL still return `{ success: true }`

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

### Requirement: Date Filter Validation

The system SHALL validate date filter inputs in the scan list handler. Malformed date strings SHALL be rejected with a descriptive error message rather than producing invalid Date objects.

#### Scenario: Malformed date rejected

- **WHEN** a malformed date string (e.g., `'not-a-date'`) is passed as dateFrom or dateTo
- **THEN** the system returns an error response with a descriptive message

#### Scenario: Valid date accepted

- **WHEN** a valid ISO date string (e.g., `'2025-02-17'`) is passed as dateFrom
- **THEN** the system parses it correctly and filters scans accordingly

### Requirement: DPI Dropdown Restricted to Validated Set

The `GRAVISCAN_RESOLUTIONS` constant in `src/types/graviscan.ts` SHALL
be restricted to the V600-validated DPI set:

```typescript
export const GRAVISCAN_RESOLUTIONS = [200, 400, 600, 800, 1200, 1600] as const;
```

This removes `3200` and `6400` from operator-selectable values, which
were neither validated against the V600 wedge envelope nor
empirically tested by the investigation. The `(recommended)` tag on
`1200` SHALL be preserved in the DPI dropdowns on
`src/renderer/ConfigureScanner.tsx` and
`src/renderer/components/graviscan/ScannerConfigSection.tsx`.

#### Scenario: Dropdown offers only validated values

- **GIVEN** the Configure Scanner page is open
- **WHEN** the DPI dropdown is rendered
- **THEN** the available options SHALL be exactly
  `[200, 400, 600, 800, 1200, 1600]` (in that order)
- **AND** `3200` and `6400` SHALL NOT be selectable

#### Scenario: 1200 dpi remains marked with its production-validated label

- **GIVEN** the DPI dropdown is rendered
- **WHEN** the operator inspects the options
- **THEN** the `1200` option SHALL carry a suffix indicating it is
  the production-validated resolution (currently
  `(production, validated at 140×140 mm)` per Cluster K — the
  literal copy may evolve, but the requirement is that 1200 is
  visually distinguished as the operator's intended default)

#### Scenario: GRAVISCAN_RESOLUTIONS constant is the single source

- **GIVEN** the dropdown is sourced from `GRAVISCAN_RESOLUTIONS`
- **WHEN** the constant is modified
- **THEN** both dropdown locations SHALL reflect the new value (the
  constant is the single source of truth — no hard-coded option lists
  in the JSX)

---

### Requirement: Per-Scanner Remove Button on Configure Scanner Page

The Configure Scanner page SHALL render a `Remove` button per scanner
row. When clicked, the button SHALL:

1. Call `window.electron.gravi.disableScanner(scannerId)` (which
   in turn invokes the `graviscan:disable-scanner` IPC; see
   machine-configuration capability).
2. Optimistically remove the row from the visible scanner list (the
   IPC's success will be confirmed by a subsequent
   `get-scanner-status` refresh, which filters `enabled=true`).
3. Show a toast or inline confirmation on success/failure.

The button SHALL be visible on every scanner row, regardless of
whether the row is currently in `disconnected`, `starting`, `error`,
`dead`, or `ready` state. The button SHALL be disabled (grayed) for
ALL rows while a scan is active anywhere, per the global gate
described in the scenario below.

#### Scenario: Remove button appears on each scanner row

- **GIVEN** the Configure Scanner page lists N scanner rows
- **WHEN** the rows are rendered
- **THEN** each row SHALL show a Remove button

#### Scenario: Clicking Remove disables the scanner

- **GIVEN** a scanner row for scanner_id `A` is displayed
- **WHEN** the operator clicks the Remove button
- **THEN** `window.electron.gravi.disableScanner('A')` SHALL be
  called
- **AND** on success, the row SHALL disappear from the scanner list
  on the next status refresh

#### Scenario: Remove button is disabled during active scan (global gate)

- **GIVEN** `window.electron.gravi.getScanStatus()` indicates
  `isActive: true` (a scan is running somewhere in the app)
- **WHEN** the scanner rows are rendered
- **THEN** every row's Remove button SHALL be disabled (`disabled`
  attribute set) and visually grayed, regardless of that row's own
  `status` value
- **AND** clicking any of them SHALL NOT call the disable-scanner IPC
- **AND** once `getScanStatus()` next reports `isActive: false`, the
  Remove buttons SHALL become enabled again (subject to the
  per-status rule in the next scenario)

  Note: this is a global gate on the session-level "is a scan
  active" signal, not a per-row status check. The real
  `getScannerStatus()` status union
  (`'ready' | 'starting' | 'error' | 'dead' | 'disconnected'`,
  confirmed in `src/main/graviscan/scanner-handlers.ts`) has no
  `scanning` value — a subprocess that is mid-scan is indistinguishable
  from one that is merely initializing, because `ScannerSubprocess`
  only exposes an `isReady` flag and both cases report `starting` (see
  `src/main/graviscan/scan-coordinator.ts`'s `getScannerStatuses()`).
  A per-row `scanning` check is therefore not implementable without a
  coordinator/backend change, which is out of scope for this proposal
  (Tier 2 owns coordinator changes). Since `ScanCoordinator` is a
  module-level singleton (`src/main/graviscan/wiring.ts`) and
  concurrent multi-experiment scanning is architecturally impossible
  today, gating every Remove button on "is any scan active anywhere"
  is not a meaningful narrowing compared to a real per-row gate — it
  is the accurate expression of the current architecture.

#### Scenario: Remove remains enabled per-row for non-active-scan statuses

- **GIVEN** `getScanStatus()` indicates `isActive: false`
- **WHEN** a scanner row's status is `error`, `dead`, or
  `disconnected`
- **THEN** that row's Remove button SHALL remain enabled (the global
  gate only disables Remove while a scan is actually active; being
  errored/dead/disconnected does not itself disable Remove)

#### Scenario: Failure surfaces an inline error message

- **GIVEN** the disable-scanner IPC returns `{ ok: false, error: msg }`
- **WHEN** the response arrives
- **THEN** the UI SHALL surface the error message via the
  ConfigureScanner page's inline save-error banner
  (`setSaveError(\`Failed to remove scanner: ${err}\`)`) so the
  operator sees the failure without leaving the page or chasing a
  fading toast
- **AND** the scanner row SHALL remain visible until the operator
  retries or dismisses the banner

#### Scenario: Success removes the row optimistically on the same page

- **GIVEN** the disable-scanner IPC returns `{ ok: true }`
- **WHEN** the response arrives
- **THEN** the UI SHALL remove the row from the local scanner list
  immediately (`setScanners((prev) => prev.filter(...))`) — the
  visual confirmation is the row disappearing from the page
- **AND** the scanner list SHALL refresh on the next
  `get-scanner-status` poll to confirm the removal against the DB

(Note: the original spec called for `useToast.showToast` for both
the success and failure paths. Per Cluster D (commit 4540537) the
implementation uses the existing inline `saveError` banner pattern
on the ConfigureScanner page, which is consistent with the page's
other save/error feedback and avoids introducing a new toast
dependency. The spec was updated to match the shipped behavior;
re-introducing toasts is a future-redo concern.)

(Note: the illustrative code above previously read
`window.electron.graviscan.disableScanner(...)`. `main`'s actual
preload namespace exposes GraviScan operations under
`window.electron.gravi.*` — confirmed in `src/main/preload.ts`
(`contextBridge.exposeInMainWorld('electron', { ..., gravi: graviAPI })`)
and `src/types/electron.d.ts` (`ElectronAPI.gravi: GraviAPI`). This is a
spec-text correction only; no behavior changes as a result — the
implementation was always going to use the real namespace.)

---

### Requirement: Predictive Cadence Warning on Continuous-Scan Form

The continuous-scan form SHALL render an amber warning banner BEFORE the operator clicks Start when the predicted per-cycle wall time exceeds the configured interval.

The prediction uses a pure function `estimateCycleSeconds()` (located
in `src/renderer/lib/cadenceEstimator.ts` or similar) that takes:

- `platesPerScanner` (derived from each scanner's `grid_mode`)
- `scannerCount`
- `dpi`
- `regionMm` (width and height in millimeters)

…and returns an estimated wall-clock seconds per cycle, calibrated
against the empirical numbers from the V600 wedge investigation
summary (Section 3): 2 plates × 5 scanners × 1200 dpi × 140×140 mm
≈ 300 s honored, 4 plates × 5 scanners × 1200 dpi × 140×140 mm
≈ 418 s back-to-back.

The banner SHALL:

- Use the existing amber Tailwind classes
  (`bg-amber-50 border-amber-300 text-amber-800`) consistent with
  other warning banners on this page.
- Display copy that names the predicted minutes, the configured
  interval, and the three remediation paths (fewer plates, lower DPI,
  smaller region).
- Disappear when the configuration changes such that the prediction
  fits the interval.
- Re-evaluate reactively when DPI, platesPerScanner, or scannerCount
  changes.

The existing reactive `overtime` banner (which fires AFTER configured
duration is exceeded) SHALL remain unchanged; this requirement adds a
parallel predictive banner, not a replacement.

#### Scenario: Banner appears when prediction exceeds interval

- **GIVEN** the form has `platesPerScanner=4`, `scannerCount=5`,
  `dpi=1200`, `regionMm={140,140}`, `intervalMinutes=5`
- **WHEN** the component renders
- **THEN** `estimateCycleSeconds()` SHALL return a value > 300
- **AND** the amber warning banner SHALL be visible
- **AND** the banner copy SHALL include the predicted minutes and
  the three remediation paths

#### Scenario: Banner is hidden when prediction fits interval

- **GIVEN** the form has `platesPerScanner=2`, `scannerCount=5`,
  `dpi=1200`, `regionMm={140,140}`, `intervalMinutes=5`
- **WHEN** the component renders
- **THEN** `estimateCycleSeconds()` SHALL return a value ≤ 300
- **AND** the amber warning banner SHALL NOT be visible

#### Scenario: Banner reacts to DPI change

- **GIVEN** the banner is currently visible for `dpi=1200`
- **WHEN** the operator changes `dpi` to `800` (lower)
- **AND** the new prediction fits the interval
- **THEN** the banner SHALL disappear on the next render

#### Scenario: Banner reacts to grid_mode change

- **GIVEN** the banner is currently visible for 4-plate config
- **WHEN** the operator changes platesPerScanner from 4 to 2
- **AND** the new prediction fits the interval
- **THEN** the banner SHALL disappear on the next render

#### Scenario: Overtime banner remains unchanged

- **GIVEN** a continuous scan has started and exceeded the configured
  duration
- **THEN** the existing reactive `overtime` banner
  (`ScanControlSection.tsx:277-284`) SHALL continue to display as it
  does today — the new predictive banner does not replace it

### Requirement: Scanner Detection and Persistence on Configure Scanner Page

The Configure Scanner page SHALL provide a "Detect Scanners" action
that calls `window.electron.gravi.detectScanners()`, auto-assigns a
`display_name` of `Scanner N` to each detected scanner ordered by
`usb_port`, and persists the result via
`window.electron.gravi.saveScannersToDB()`. After a successful save,
the page SHALL reload its list via
`window.electron.gravi.getScannerStatus()` so the visible rows
reflect the merged DB + live coordinator state (one of `ready`,
`starting`, `error`, `dead`, `disconnected`).

#### Scenario: Detect populates the scanner list

- **GIVEN** the Configure Scanner page is open with no scanners listed
- **WHEN** the operator clicks "Detect Scanners" and
  `detectScanners()` returns one or more scanners
- **THEN** the scanners SHALL be saved via `saveScannersToDB()`
- **AND** the page SHALL display the saved scanners after reloading
  status via `getScannerStatus()`

#### Scenario: Detect with zero scanners surfaces an inline error

- **GIVEN** the operator clicks "Detect Scanners"
- **WHEN** `detectScanners()` returns `{ success: true, scanners: [] }`
- **THEN** the page SHALL show an inline error such as "No scanners
  detected. Check USB connections."
- **AND** SHALL NOT call `saveScannersToDB()`

#### Scenario: Detect failure surfaces the returned error inline

- **GIVEN** the operator clicks "Detect Scanners"
- **WHEN** `detectScanners()` returns `{ success: false, error: msg }`
- **THEN** the page SHALL display `msg` in an inline error area
- **AND** SHALL NOT call `saveScannersToDB()`

#### Scenario: Save failure surfaces the returned error without clearing the list

- **GIVEN** detection succeeded and `saveScannersToDB()` is called
- **WHEN** `saveScannersToDB()` returns `{ success: false, error: msg }`
- **THEN** the page SHALL display `msg` in an inline error area
- **AND** the previously-displayed scanner list SHALL remain unchanged

#### Scenario: Page polls status while any scanner is starting

- **GIVEN** at least one scanner row currently has status `starting`
- **WHEN** the page is mounted
- **THEN** the page SHALL periodically re-call `getScannerStatus()`
  until no row remains in `starting` status
- **AND** the page SHALL NOT poll when no row is `starting`

---

### Requirement: Resolution and Grid Mode Configuration on Configure Scanner Page

The Configure Scanner page SHALL provide a single, global resolution
selector sourced from `GRAVISCAN_RESOLUTIONS` (per the "DPI Dropdown
Restricted to Validated Set" requirement) and a single, global grid
mode selector (`2grid` / `4grid`), persisted together via
`window.electron.gravi.saveConfig({ resolution, grid_mode })` and
loaded via `window.electron.gravi.getConfig()`. This control is
global, not per-scanner: `main`'s `GraviScanner` Prisma model has no
per-scanner `grid_mode` column (only `GraviScan` and the `GraviConfig`
singleton do), matching `graviscan:get-scanner-status`'s own documented
behavior of applying one `GraviConfig`-sourced `gridMode` uniformly to
every scanner row.

If the persisted `GraviConfig.resolution` is not a member of
`GRAVISCAN_RESOLUTIONS` (a legacy value saved before the DPI dropdown
was restricted), the page SHALL fall the dropdown back to `1200` for
display and show an inline warning naming the stale value, without
calling `saveConfig()` until the operator explicitly saves.

Because the `1200` fallback display is visually indistinguishable
from an operator deliberately choosing `1200`, the page SHALL NOT
allow a plain, unmodified Save click to silently persist the
fallback value as if it were a confirmed choice. While the
legacy-value warning is showing, the Save button SHALL remain
disabled until the operator has explicitly interacted with the
resolution selector (e.g. re-selecting a value, including
re-selecting `1200`) — this interaction is treated as the operator's
affirmative re-confirmation of the resolution to persist.

#### Scenario: Save is disabled until the operator re-confirms a legacy resolution

- **GIVEN** a `GraviConfig` row exists with `resolution: 6400` and
  the page has fallen the selector back to `1200` with the stale-value
  warning showing
- **WHEN** the page has just mounted and the operator has not yet
  touched the resolution selector
- **THEN** the "Save" button SHALL be disabled
- **AND** clicking it (if somehow triggered) SHALL NOT call
  `saveConfig()`
- **WHEN** the operator then interacts with the resolution selector
  (selecting any value, including re-selecting `1200`)
- **THEN** the "Save" button SHALL become enabled

#### Scenario: Loads persisted resolution and grid mode into the form

- **GIVEN** a `GraviConfig` row exists with `resolution: 600` and
  `grid_mode: '4grid'`
- **WHEN** the Configure Scanner page mounts
- **THEN** the resolution selector SHALL show `600`
- **AND** the grid mode selector SHALL show `4grid`

#### Scenario: Legacy out-of-range resolution triggers fallback and warning

- **GIVEN** a `GraviConfig` row exists with `resolution: 3200`
- **WHEN** the Configure Scanner page mounts
- **THEN** the resolution selector SHALL display `1200`
- **AND** an inline warning SHALL name the stale value `3200`
- **AND** `saveConfig()` SHALL NOT be called automatically

#### Scenario: Saving resolution and grid mode calls saveConfig

- **GIVEN** the operator has changed the resolution and/or grid mode
  selectors
- **WHEN** the operator clicks "Save"
- **THEN** `window.electron.gravi.saveConfig({ resolution, grid_mode })`
  SHALL be called with the selected values
- **AND** on success, a transient success message SHALL be shown

---

### Requirement: Reset USB on Configure Scanner Page

The Configure Scanner page SHALL provide a "Reset All USB
Connections" action (labeled to make clear it affects every
connected scanner, not a single row — `resetUsb()`'s backend
implementation unconditionally shuts down the entire
`ScanCoordinator`, per `src/main/graviscan/scanner-handlers.ts`) that
calls `window.electron.gravi.resetUsb()`. Adjacent explanatory text
SHALL state that this action resets ALL connected scanners
simultaneously.

Before invoking `resetUsb()`, the page SHALL check
`window.electron.gravi.getScanStatus()`. If it indicates
`isActive: true`, the action SHALL be blocked: the page SHALL show an
inline message (e.g. "Cannot reset USB while a scan is in progress")
and SHALL NOT call `resetUsb()`.

When no scan is active, clicking the action SHALL immediately mark
every currently-listed scanner row as `starting` for immediate visual
feedback, then refresh scanner status (`getScannerStatus()`) and the
scan-active gate once `resetUsb()` resolves, regardless of its result.
The page SHALL NOT re-run the full detect-and-save flow (`detectScanners()`

- `saveScannersToDB()`) after `resetUsb()`: `resetUsb()`'s backend
  implementation already shuts down, re-detects, and re-initializes the
  coordinator internally (`src/main/graviscan/scanner-handlers.ts`), and
  re-running detect independently races the subprocess `resetUsb()` just
  spawned — the newly-spawned subprocess is typically still `starting`
  (not yet `ready`) the instant `resetUsb()` resolves, so a second
  `saveScannersToDB()` call's `!coordinator.hasWorker(id)` check sees no
  ready worker and spawns a **second** subprocess for the same scanner,
  orphaning the first mid-initialization and leaving the scanner stuck
  `disconnected` (confirmed via a real multi-process E2E run, not merely
  suspected — a unit test with mocked IPC calls cannot catch this class of
  bug since it doesn't model subprocess timing). A status refresh plus the
  page's own polling effect (see "Scanner Detection and Persistence...")
  is sufficient to reflect `resetUsb()`'s outcome as its subprocesses come
  up. A `resetUsb()` failure SHALL surface the returned error message
  inline and SHALL NOT crash the page.

#### Scenario: Reset USB is blocked while a scan is active

- **GIVEN** `window.electron.gravi.getScanStatus()` indicates
  `isActive: true`
- **WHEN** the operator clicks "Reset All USB Connections"
- **THEN** the page SHALL show an inline message such as "Cannot
  reset USB while a scan is in progress"
- **AND** `window.electron.gravi.resetUsb()` SHALL NOT be called

#### Scenario: Clicking Reset USB immediately marks all rows starting

- **GIVEN** the Configure Scanner page lists scanners with mixed
  statuses, and `getScanStatus()` indicates `isActive: false`
- **WHEN** the operator clicks "Reset All USB Connections"
- **THEN** every listed row SHALL immediately show status `starting`,
  before `resetUsb()` resolves

#### Scenario: Reset USB success refreshes status without re-running detect

- **GIVEN** the operator has clicked "Reset All USB Connections"
  (no scan was active)
- **WHEN** `resetUsb()` resolves with `{ success: true }`
- **THEN** the page SHALL call `getScannerStatus()` and `getScanStatus()`
  to refresh the visible rows and the scan-active gate
- **AND** the page SHALL NOT call `detectScanners()` or
  `saveScannersToDB()` as part of this flow

#### Scenario: Reset USB failure surfaces an inline error

- **GIVEN** the operator has clicked "Reset All USB Connections"
  (no scan was active)
- **WHEN** `resetUsb()` resolves with `{ success: false, error: msg }`
- **THEN** the page SHALL display `msg` in an inline error area
- **AND** SHALL NOT throw an unhandled error

---

### Requirement: GraviScan Environment Variable Status Banner

The Configure Scanner page SHALL display a small inline banner
surfacing whether `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` and
`LIBUSB_ENDPOINT_RECOVERY` are configured, backed by
`window.electron.config.getGraviScanEnvStatus()`. The banner SHALL
show configured/not-configured state for each value without ever
displaying the webhook URL itself (only a boolean derived from its
presence is transmitted to the renderer).

#### Scenario: Both env vars configured

- **GIVEN** `getGraviScanEnvStatus()` resolves to
  `{ slackConfigured: true, libusbRecoveryEnabled: true }`
- **WHEN** the Configure Scanner page renders
- **THEN** the banner SHALL indicate both are configured/enabled
- **AND** SHALL NOT render the webhook URL value anywhere in the DOM

#### Scenario: Slack webhook not configured

- **GIVEN** `getGraviScanEnvStatus()` resolves to
  `{ slackConfigured: false, libusbRecoveryEnabled: true }`
- **WHEN** the Configure Scanner page renders
- **THEN** the banner SHALL visually distinguish the "not configured"
  Slack state from the "configured" libusb-recovery state (e.g. via
  color or icon), so the operator does not need to read closely to
  notice a missing wedge-alert channel

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

### Requirement: Scan Duplicate Check IPC Handler

The main process SHALL provide an IPC handler for checking whether a scan
matching a specific plant, experiment, wave, and age already exists.

#### Scenario: Duplicate exists

- **GIVEN** a non-deleted scan exists with `plant_id="PLANT_001"`,
  `experiment_id="EXP_001"`, `wave_number=2`, `plant_age_days=21`
- **WHEN** the renderer calls
  `db:scans:checkDuplicate("PLANT_001", "EXP_001", 2, 21)`
- **THEN** the handler SHALL return `{ success: true, data: true }`

#### Scenario: No duplicate — different wave or age

- **GIVEN** a non-deleted scan exists with `plant_id="PLANT_001"`,
  `experiment_id="EXP_001"`, `wave_number=2`, `plant_age_days=21`
- **WHEN** the renderer calls
  `db:scans:checkDuplicate("PLANT_001", "EXP_001", 3, 21)` (different wave)
  or `db:scans:checkDuplicate("PLANT_001", "EXP_001", 2, 25)` (different age)
- **THEN** the handler SHALL return `{ success: true, data: false }`

#### Scenario: No duplicate — different experiment

- **GIVEN** a non-deleted scan exists with `plant_id="PLANT_001"`,
  `experiment_id="EXP_001"`, `wave_number=2`, `plant_age_days=21`
- **WHEN** the renderer calls
  `db:scans:checkDuplicate("PLANT_001", "EXP_002", 2, 21)`
- **THEN** the handler SHALL return `{ success: true, data: false }`

#### Scenario: Soft-deleted matches are excluded

- **GIVEN** a scan matching `("PLANT_001", "EXP_001", 2, 21)` exists but has
  `deleted: true`
- **WHEN** the renderer calls
  `db:scans:checkDuplicate("PLANT_001", "EXP_001", 2, 21)`
- **THEN** the handler SHALL return `{ success: true, data: false }`

#### Scenario: Invalid plantId or experimentId returns an error, not a false negative

- **GIVEN** `plantId` is `""`, `null`, `undefined`, or a non-string value
  (e.g. `123`), with `experimentId="EXP_001"`, `waveNumber=2`,
  `plantAgeDays=21` otherwise well-formed
- **WHEN** `db:scans:checkDuplicate` is called with that `plantId`
- **THEN** the handler SHALL return `{ success: false, error: <message> }`
- **AND** it SHALL NOT return `{ success: true, data: false }` (which would
  read as "no duplicate" rather than "the check could not run")
- **AND** the same holds symmetrically when `experimentId` (not `plantId`)
  is the invalid argument

#### Scenario: Invalid waveNumber or plantAgeDays returns an error, not a false negative

- **GIVEN** `waveNumber` is negative (e.g. `-1`), non-integer (e.g. `1.5`),
  or not a number at all (e.g. `"two"`), with `plantId="PLANT_001"`,
  `experimentId="EXP_001"`, `plantAgeDays=21` otherwise well-formed
- **WHEN** `db:scans:checkDuplicate` is called with that `waveNumber`
- **THEN** the handler SHALL return `{ success: false, error: <message> }`
- **AND** the same holds symmetrically when `plantAgeDays` (not
  `waveNumber`) is the invalid argument

**Acceptance Criteria**:

- Returns `{ success: true, data: boolean }` on a well-formed request
- Returns `{ success: false, error: string }` for malformed arguments —
  each of `plantId`, `experimentId`, `waveNumber`, `plantAgeDays` is
  validated independently, not just checked as a group
- Never throws — all failure paths return a typed error response

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
**Then** the camera-settings column SHALL display a compact summary including the scanner name (e.g. "Cam-A · Exp 50000μs · Gain 4" — `exposure_time` is stored in microseconds, not milliseconds)
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

#### Scenario: A clean natural completion resets scan state the same way a cancel does

- **GIVEN** a scan session completes naturally (every job finished, or the
  configured continuous-mode interval/duration elapsed)
- **WHEN** the session ends
- **THEN** pending jobs and per-scanner progress SHALL both be cleared, the
  same as a successful cancel — `isScanning: false` SHALL NOT coexist with
  a stale non-empty `pendingJobs` or `progressByScanner` left over from the
  just-ended session

#### Scenario: Duration is entered in minutes, consistent with Interval

- **GIVEN** the operator opens the continuous-mode form
- **WHEN** the operator views the Interval and Duration fields
- **THEN** both SHALL be labeled and interpreted in minutes
- **AND** `startScan()`'s computed `duration_seconds` SHALL equal
  `durationMinutes * 60`, not a value derived from hours

#### Scenario: A zero interval is rejected before starting a continuous scan

- **GIVEN** the operator has set the interval field to `0` (e.g. via a
  malformed input bypassing the form's own clamp)
- **WHEN** the operator views the Capture Scan screen
- **THEN** the screen SHALL show an inline validation error
- **AND** the "Start Scan" control SHALL be disabled while that error is
  showing
- **AND** `startScan()` SHALL NOT be called with an interval of `0`, even
  if the operator clicks where "Start Scan" would otherwise be

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

#### Scenario: A late interval-waiting event after the session has already ended does not resurrect the waiting indicator

- **GIVEN** a continuous scan session has already ended
  (`interval-complete` or `cancelled` already fired)
- **WHEN** a stray/late `interval-waiting` or `scan-started` event
  nonetheless arrives afterward
- **THEN** the coordinator state SHALL remain `idle`, not flip to
  `waiting`/`scanning`
- **AND** the waiting indicator SHALL NOT render, since it also checks that
  a scan is actually in progress, not only the coordinator state field

Before starting a scan, the main process SHALL confirm every plate's
`output_path` resolves inside the configured scan output directory,
following symlinks — the same containment guarantee already applied to
every path a renderer supplies for a read. `startScan()` SHALL NOT be
called with any plate whose path resolves outside that directory.

#### Scenario: A plate's output_path outside the scan output directory blocks the whole start-scan call

- **GIVEN** a `start-scan` request includes a plate whose `output_path`
  resolves outside the configured scan output directory (e.g. via a `..`
  segment)
- **WHEN** the request is handled
- **THEN** the call SHALL be rejected with the same uniform "path outside
  scan directory" error every other path handler in this file uses
- **AND** the scan SHALL NOT start — no plate in the request, not just the
  offending one, is scanned

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
  `verified` or `swapped`. When any plate has status `swapped`, the
  detail text additionally names how many plates were auto-corrected via
  swap-detection, distinguishing an audit-trailed auto-correction from a
  run with zero incidents at all — this does not change the banner's
  green severity, since a detected swap was already successfully
  corrected and needs no further operator action.

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

#### Scenario: An auto-corrected swap is visibly distinguished from a zero-incident run

- **GIVEN** a completed scan's verification results include one plate with
  status `swapped` and the rest `verified`, with no `duplicate_qr` plates
- **WHEN** the verification banner renders
- **THEN** it SHALL still show the green state (the swap was already
  auto-corrected)
- **AND** the detail text SHALL name that a plate position was
  auto-corrected after a detected swap, distinct from the plain "Every
  plate verified correctly" wording used when no swap occurred

#### Scenario: Verification is invoked with the current wave number

- **GIVEN** the operator is scanning wave 3 of an experiment
- **WHEN** the scan session completes and verification runs
- **THEN** `graviscan:verify-plates` SHALL be invoked with `waveNumber: 3`
  alongside `experimentId`, per the "Wave-scoped plate lookup" scenario in
  the `scanning` capability

### Requirement: GraviScan Browse Page

The application SHALL provide a `BrowseGraviScans` page at `/browse-graviscans`, visible only in `graviscan` mode, displaying one row per experiment (not per scan), server-side paginated and filterable, via `database.graviscans.browseByExperiment`.

#### Scenario: Empty state

**Given** no GraviScan experiments exist
**When** the user navigates to `/browse-graviscans`
**Then** the page displays a message indicating no GraviScan data is present

#### Scenario: Per-experiment row content

**Given** at least one GraviScan experiment with scans exists
**When** the page renders
**Then** each row shows: experiment name, "Needs Review" badge (if applicable), scientist, phenotyper(s), date range, image-count breakdown (scanners × plates × cycles), resolution/grid mode, accession name, and a per-wave Bloom/Box backup progress indicator

**Acceptance Criteria**:

- Rows are paginated (20 per page) via `browseByExperiment`'s `offset`/`limit`
- A "View Images" action navigates to `/graviscan-experiment/:experimentId`
- A per-experiment wave selector ("All Waves" or a specific wave) scopes that row's Download action

#### Scenario: Filtering

**Given** multiple GraviScan experiments with varying dates, names, accessions, and upload statuses
**When** the user sets a date-range, experiment-name, accession, or upload-status filter
**Then** the row list updates to match, debounced 300ms except the upload-status filter, which applies immediately

**Acceptance Criteria**:

- Date-range filtering is inclusive on both ends
- Experiment-name and accession filters match by substring
- Upload-status filter accepts `pending`/`uploaded`/`failed`

#### Scenario: Download images for a wave

**Given** an experiment row with at least one wave of images
**When** the user selects a wave (or "All Waves") and clicks Download
**Then** the page calls `gravi.downloadImages({experimentId, experimentName, waveNumber})` and reports the result

**Known limitation, not fixed by this requirement**: `downloadImages`'s exported `plates.csv`/`sections.csv` resolve plate/accession metadata via the experiment's legacy `Experiment.accession_id`, not this same change's new wave-scoped `GraviExperimentWaveMetadata` links — a wave linked to a different metadata file than the experiment's legacy accession will download with metadata that does not reflect that wave's actual link. See `design.md` Decision 10.

#### Scenario: Mismatch warning before downloading a single diverged wave

**Given** the selected wave's `listGraviMetadata` link points to a different accession than the experiment's `accession_id`
**When** the user selects that wave and clicks Download
**Then** the page SHALL show an inline warning naming the wave, that its linked metadata differs from the experiment's default accession, and that the downloaded CSV will reflect the default accession instead — before proceeding with the download
**And** the download SHALL still proceed (the warning informs, it does not block)

#### Scenario: Mismatch warning before an "All Waves" download with any diverged wave

**Given** the experiment has two or more linked waves, and at least one wave's linked accession differs from the experiment's `accession_id`
**When** the user selects "All Waves" and clicks Download
**Then** the page SHALL show the same inline warning, naming every diverged wave (not just the first), before proceeding
**And** the download SHALL still proceed

#### Scenario: No warning when every relevant wave matches the experiment's default accession

**Given** either a single selected wave whose linked accession is the same as the experiment's `accession_id` (e.g. wave `0`, immediately after creation, per `design.md` Decision 4), or "All Waves" selected with no wave's link differing from `accession_id`
**When** the user clicks Download
**Then** no mismatch warning SHALL appear

#### Scenario: No warning for a wave with no metadata link at all

**Given** the selected wave has no `GraviExperimentWaveMetadata` row (it falls back to the experiment's `accession_id` by design, not by divergence)
**When** the user clicks Download
**Then** no mismatch warning SHALL appear for that wave

#### Scenario: Fetch error shows a friendly message

**Given** `browseByExperiment` returns an error (e.g. a database connection failure)
**When** the page attempts to load
**Then** the page SHALL display a user-friendly error message
**And** SHALL NOT throw an unhandled error

### Requirement: GraviScan Box Backup UI

`BrowseGraviScans.tsx` SHALL provide one global "Backup to Box" action that triggers `uploadAllScans()` and surfaces its Box-backup progress and result, without polling scan status on an interval.

#### Scenario: Idle state

**Given** the page is mounted
**When** no backup is in flight and no scan session is active
**Then** the button SHALL read "Backup to Box" and be enabled

#### Scenario: Backup in-flight state

**Given** the operator has clicked "Backup to Box"
**When** the `uploadAllScans()` call has not yet resolved
**Then** the button SHALL read "Backing up…" and be disabled

#### Scenario: Scan-in-progress state

**Given** a scan session is currently active (per `getScanStatus()` or a live `onIntervalStart`/`onIntervalComplete`/`onCancelled` event)
**When** the button renders
**Then** the button SHALL read "Scan in progress…" and be disabled

#### Scenario: Scan-active detection uses push events, not polling

**Given** the page mounts while a scan session is already active (e.g. the operator navigated here mid-scan)
**When** the page determines whether to disable the backup button
**Then** it SHALL call `getScanStatus()` once on mount to establish the current state
**And** it SHALL subscribe to `onIntervalStart`/`onIntervalComplete`/`onCancelled` for subsequent live updates
**And** it SHALL NOT poll `getScanStatus()` on a fixed interval

#### Scenario: Successful backup reports counts

**Given** the operator clicks "Backup to Box" and the call resolves with `{success: true, uploaded: N, skipped: M, failed: 0}`
**When** the result is received
**Then** the page SHALL display a dismissable inline banner reporting the uploaded/skipped counts

#### Scenario: Partial failure reports the aggregate and first error

**Given** the backup call resolves with `failed > 0` and a non-empty `errors` array not including `'rclone not installed'`
**When** the result is received
**Then** the page SHALL display an inline banner showing the failed count and the first error message

#### Scenario: rclone-unavailable failure shows a friendly message

**Given** the backup call's `errors` array includes the string `'rclone not installed'`
**When** the result is received
**Then** the page SHALL display "Box backup unavailable (rclone not installed)" instead of the generic failed-count/first-error message

#### Scenario: Per-experiment Box progress indicator

**Given** a `onUploadProgress` event arrives with Box-backup progress fields (`totalImages`, `completedImages`, `failedImages`, `currentExperiment`)
**When** the event is received
**Then** the row matching `currentExperiment` SHALL show a "Box X/Y" mini progress indicator, updated live as further events arrive

### Requirement: GraviScan Experiment Detail Page

The application SHALL provide an `ExperimentDetail` page at `/graviscan-experiment/:experimentId`, visible only in `graviscan` mode, showing one experiment's metadata summary, linked wave-metadata, and a resizable file table with inline preview, via `database.graviscans.experimentDetail` and `database.experiments.listGraviMetadata`.

#### Scenario: Metadata summary

**Given** a valid `experimentId`
**When** the page loads
**Then** it displays scientist, phenotyper, date range, image count, resolution, grid mode, and single/multi-wave status

#### Scenario: Unknown experiment shows an error, not a crash

**Given** an `experimentId` that does not correspond to any experiment
**When** the page loads
**Then** it displays a user-friendly "experiment not found" message
**And** does not throw an unhandled error

#### Scenario: Fetch error shows a friendly message

**Given** `experimentDetail` returns an error other than "not found" (e.g. a database connection failure)
**When** the page attempts to load
**Then** the page SHALL display a user-friendly error message
**And** SHALL NOT throw an unhandled error

#### Scenario: Linked Metadata section — list and unlink

**Given** the experiment has one or more waves linked to metadata files (via `listGraviMetadata`)
**When** the section renders
**Then** each link is shown as "Wave N: {accession name}" with an Unlink action
**And** clicking Unlink SHALL first show a confirmation naming the wave number and accession, and stating that history is not retained
**And** for wave `0` specifically, the confirmation SHALL additionally state that the experiment's default accession was originally set to the same file and will not change when wave 0 is unlinked
**And** only on confirming SHALL the page call `unlinkGraviMetadata(experimentId, waveNumber)` and remove that entry from the list on success
**And** declining the confirmation SHALL leave the link unchanged and make no IPC call

#### Scenario: Linked Metadata section — link a new wave

**Given** the experiment is `graviscan`-typed
**When** the user enters a wave number (defaulting to `max(existing wave numbers) + 1`), selects a metadata file, and submits
**Then** the page calls `linkGraviMetadata(experimentId, waveNumber, accessionId)`
**And** on success, the new link appears in the list
**And** on failure, an inline error message appears near the form without clearing the operator's selections

#### Scenario: Resizable file table with inline preview

**Given** the experiment has one or more scan files
**When** the table renders
**Then** columns (icon/filename/plate/wave) SHALL be resizable by dragging a column edge, using a shared resize hook (not per-page duplicated drag-listener code)
**And** clicking a row expands an inline TIFF preview plus capture/transplant date, note, barcode, scanner, grid, plate, and wave

**Acceptance Criteria**:

- Column-resize drag listeners are attached only while dragging and are removed on both `mouseup` and component unmount
- Scanner and (when the experiment has more than one wave) wave filter chips narrow the visible rows with live counts

#### Scenario: Per-plate verification status badge

**Given** a scan file with a `verification_status` of `needs_review` or `verified`
**When** the row renders
**Then** it SHALL show an amber "Needs Review" or green check badge respectively
**And** any other `verification_status` value (e.g. `pending`, for scans not yet verified) SHALL render with no error styling

### Requirement: GraviScan Metadata Page

The application SHALL provide a `Metadata` page at `/metadata`, visible only in `graviscan` mode, composing a metadata upload flow and a metadata list flow, with no internal build-time mode branch (mode-gating is handled entirely by the route, per `scanning/spec.md`'s Mode-Aware Routing requirement).

#### Scenario: Page composition

**Given** the user navigates to `/metadata` in graviscan mode
**When** the page renders
**Then** it SHALL render the metadata upload component and the metadata list component together, with no tri-mode or build-time-`APP_MODE` branch inside the page component itself

### Requirement: GraviScan Metadata Upload

`GraviMetadataUpload.tsx` SHALL accept an Excel (`.xlsx`/`.xls`) file up to 15MB, let the user map spreadsheet columns to required fields, reject mappings that assign two fields to the same column, validate the data, and create a metadata-file record via `database.graviPlateAccessions.createWithSections`.

#### Scenario: Column mapping

**Given** a valid spreadsheet file is selected
**When** it is parsed client-side
**Then** the user SHALL be prompted to choose a sheet (if multiple exist) and map columns to: Plate ID, Section ID, Plant QR, Accession, Medium, Transplant Date (all required) and Custom Note (optional)
**And** a live preview table (capped at 20 rows) SHALL reflect the current mapping with color-coded columns
**And** each column's dropdown option and preview-table header SHALL show its 1-based position alongside its header text (or a placeholder if the header is blank), so a column named only by position in a collision error is locatable in the mapping UI

#### Scenario: Column mapping collision blocked

**Given** two or more fields (whether required or optional) are mapped to the same spreadsheet column, with unmapped fields excluded from consideration
**When** the user submits
**Then** the submission SHALL be blocked before any row-level validation runs, even if the resulting rows would otherwise pass that validation
**And** the page SHALL show an inline error naming every field mapped to that column and disambiguating the column by position (not solely by header text, which may be blank or duplicated across columns)
**And** each independently colliding column SHALL produce its own such error, and a column claimed by three or more fields SHALL produce one error naming all of them rather than one error per pair
**And** SHALL NOT call `createWithSections`

#### Scenario: Partial-row validation

**Given** a row has some required cells filled and others blank
**When** the file is submitted
**Then** that row SHALL be flagged as a validation error, not silently dropped
**And** the submission SHALL NOT proceed while any row has an unresolved validation error

#### Scenario: Successful upload

**Given** a fully valid, mapped spreadsheet
**When** the user submits
**Then** rows SHALL be grouped by Plate ID into a plate→sections structure and passed to `createWithSections({name: fileName}, plates)`
**And** on success, the form SHALL show a completion message, then reset and notify the parent (`onUploadComplete`)

#### Scenario: Oversized or wrong-type file rejected

**Given** a selected file is not `.xlsx`/`.xls`, or exceeds 15MB
**When** the user attempts to select it
**Then** the file SHALL be rejected with an inline error before any parsing is attempted

#### Scenario: Empty sheet rejected

**Given** a selected, valid-type spreadsheet whose chosen sheet has zero data rows
**When** the user attempts to submit
**Then** the page SHALL show an inline error indicating there is no data to import
**And** SHALL NOT call `createWithSections`

### Requirement: GraviScan Metadata List

`GraviMetadataList.tsx` SHALL list existing metadata files via `database.graviPlateAccessions.listFiles`, with per-file expansion to view plates/sections and a Delete action, surfacing loading, error, and empty states for the file list itself.

#### Scenario: Loading state

**Given** a `listFiles()` call is in flight, whether from initial mount or a later refresh
**When** the call has not yet resolved
**Then** the page SHALL show a loading message instead of an empty or stale list

#### Scenario: Fetch failure surfaced

**Given** `listFiles()` resolves with `success: false`
**When** the fetch completes
**Then** the page SHALL show the returned error inline, falling back to a default message if none is provided
**And** SHALL NOT render an empty-state message in its place

#### Scenario: Empty-state message

**Given** `listFiles()` resolves successfully with zero files
**When** the fetch completes
**Then** the page SHALL show an explanatory empty-state message instead of a blank list

#### Scenario: Expand fetch failure surfaced

**Given** a file entry is expanded and `graviPlateAccessions.list(fileId)` resolves with `success: false`
**When** the fetch completes
**Then** the page SHALL show the returned error inline, falling back to a default message if none is provided
**And** SHALL NOT render an empty plate/section table in its place

#### Scenario: File list

**Given** one or more metadata files exist
**When** the list renders
**Then** each entry SHALL show file name, created date, linked experiment names, and plate count, in chronological order with no filtering/sorting UI

#### Scenario: Expand to view plates and sections

**Given** a file entry
**When** the user expands it
**Then** the page SHALL lazily fetch `graviPlateAccessions.list(fileId)` and render a table with a header row (Plate ID, Accession, Transplant Date, Custom Note, Section, Plant QR, Medium) over row-spanned plate-level cells (plate ID/accession/transplant date/note) and per-section rows (section ID/plant QR/medium)

#### Scenario: Delete blocked while referenced

**Given** a metadata file still referenced by `Experiment.accession_id` or by any `GraviExperimentWaveMetadata` link
**When** the user clicks Delete
**Then** the backend SHALL reject the deletion (per `scanning/spec.md`'s `graviPlateAccessions.*` requirement) and the page SHALL surface the returned error rather than removing the entry from the list

#### Scenario: Delete succeeds when unreferenced

**Given** a metadata file with no remaining references
**When** the user clicks Delete
**Then** it SHALL be removed from the database and disappear from the list

### Requirement: Global Upload-Progress Indicator

The application SHALL provide a persistent, app-wide indicator of in-flight or just-finished upload/backup progress (Bloom upload and Box backup), visible regardless of which page the operator is currently viewing, rendered as an inline banner in `Layout.tsx` — not a toast notification.

#### Scenario: Indicator persists across navigation

**Given** an upload/backup is triggered from `BrowseGraviScans.tsx` (via `uploadAllScans()`)
**When** the operator navigates to a different page (e.g. `ExperimentDetail` or `Metadata`) before it completes
**Then** the Layout-level indicator SHALL continue showing live progress
**And** the indicator SHALL show a final result summary once the upload completes, regardless of which page is active at that time

#### Scenario: Indicator dismissible, not a toast

**Given** the indicator is showing an in-flight or completed status
**When** the operator clicks its dismiss control
**Then** it SHALL hide until the next upload/backup event
**And** it SHALL NOT auto-dismiss on a timer (unlike this codebase's rejected toast pattern)
