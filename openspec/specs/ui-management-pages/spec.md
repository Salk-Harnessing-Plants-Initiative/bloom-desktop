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

The Experiments page MUST allow users to create new experiments with validation (name required, species required, scientist required, accession required).

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
- Includes image count (not full image data)
- Ordered by `capture_date` descending

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
