# ui-management-pages Specification

## Purpose
TBD - created by archiving change add-scientists-management-ui. Update Purpose after archive.
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

