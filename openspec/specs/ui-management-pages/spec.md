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

The Experiments page MUST allow users to create new experiments with validation (name required, species required) and optional scientist/accession linking.

#### Scenario: Valid Submission

**Given** the user is on the `/experiments` page
**When** the user enters a valid name (e.g., "Drought Study 2025")
**And** the user selects a species from the dropdown
**And** the user optionally selects a scientist
**And** the user optionally selects an accession
**And** the user clicks "Create" button
**Then** the experiment is created in the database
**And** the form fields are cleared
**And** the experiments list refreshes to show the new entry

**Acceptance Criteria**:

- Name is trimmed of leading/trailing whitespace
- Species is required (dropdown, no empty option after selection)
- Scientist is optional (dropdown from scientists list)
- Accession is optional (dropdown from accessions list)
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

#### Scenario: Species Dropdown

**Given** the user is on the `/experiments` page
**When** the user views the species dropdown
**Then** the following species are available (alphabetically sorted):

- Alfalfa
- Amaranth
- Arabidopsis
- Canola
- Lotus
- Maize
- Medicago
- Pennycress
- Rice
- Sorghum
- Soybean
- Spinach
- Sugar_Beet
- Tomato
- Wheat

**Acceptance Criteria**:

- Dropdown pre-selects first species by default
- All 15 species available
- Species are sorted alphabetically

### Requirement: Attach Accession to Existing Experiment

The Experiments page SHALL allow users to attach an accession to an existing experiment via a dedicated UI section.

#### Scenario: Attach Accession

**Given** experiments and accessions exist in the database
**When** the user selects an experiment from the dropdown
**And** the user selects an accession from the dropdown
**And** the user clicks "Attach Accession" button
**Then** the experiment is updated with the accession link
**And** a success message appears

**Acceptance Criteria**:

- Experiment dropdown shows: `{species} - {name} ({scientist name})`
- Accession dropdown shows: `{name} - {id}`
- Loading indicator during attachment
- Success message: "Accession successfully attached."
- Error message if attachment fails

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

The CaptureScan page SHALL prevent re-scanning the same plant on the same day for the same experiment.

#### Scenario: Plant already scanned today

- **GIVEN** plant "PLANT_001" was scanned today for experiment "EXP_001"
- **WHEN** the user selects experiment "EXP_001" and enters barcode "PLANT_001"
- **THEN** a warning SHALL be displayed: "This plant was already scanned today"
- **AND** the scan button SHALL be disabled

#### Scenario: Plant scanned on a different day

- **GIVEN** plant "PLANT_001" was scanned yesterday for experiment "EXP_001"
- **WHEN** the user selects experiment "EXP_001" and enters barcode "PLANT_001"
- **THEN** no warning SHALL be displayed
- **AND** the scan button SHALL remain enabled

#### Scenario: Same plant scanned for different experiment

- **GIVEN** plant "PLANT_001" was scanned today for experiment "EXP_001"
- **WHEN** the user selects experiment "EXP_002" and enters barcode "PLANT_001"
- **THEN** no warning SHALL be displayed
- **AND** the scan button SHALL remain enabled

#### Scenario: Periodic duplicate check

- **GIVEN** the user has entered a plant barcode and experiment
- **WHEN** the component is mounted
- **THEN** the duplicate check SHALL run every 2 seconds
- **AND** the check SHALL stop when the component unmounts

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

#### Scenario: Get most recent scan date

- **GIVEN** scans exist for a plant and experiment
- **WHEN** the renderer calls `db:scans:getMostRecentScanDate(plantId, experimentId)`
- **THEN** the handler SHALL return the most recent capture_date or null if no scans exist

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
