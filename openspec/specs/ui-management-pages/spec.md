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

