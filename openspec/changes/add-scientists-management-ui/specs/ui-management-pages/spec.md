# Spec: UI Management Pages

## Description

This capability introduces database management UI pages for bloom-desktop, starting with the Scientists management page. These pages provide users with a visual interface to view and create reference data entities without requiring direct database manipulation.

## Scope

**In Scope**:
- Scientists management page (list + create)
- Form validation with Zod schemas
- Error handling and user feedback
- Loading states for async operations
- On-demand data refresh after mutations

**Out of Scope**:
- Edit/Delete functionality (not permitted by database handlers)
- Pagination (not needed for reference data scale)
- Search/filter (will be added in future if needed)
- Bulk import (existing functionality, not part of this change)

## ADDED Requirements

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

## Technical Requirements

### Form Validation

- **Library**: Zod for schema definition and validation
- **Integration**: React Hook Form with Zod resolver
- **Validation Rules**:
  - Name: Required, min 1 character, max 255 characters
  - Email: Required, valid email format per standard regex

### Data Fetching

- **IPC Handler**: `db:scientists:list`
- **Timing**: On component mount
- **Error Handling**: Display user-friendly error if fetch fails
- **Loading State**: Show loading indicator until data arrives

### Data Mutation

- **IPC Handler**: `db:scientists:create`
- **Payload**: `{ name: string, email: string }`
- **Response Handling**:
  - Success: Refresh list, clear form, show success feedback
  - Error: Display error message, preserve form data

### State Management

- **Form State**: Managed by React Hook Form
- **List State**: Local component state with `useState`
- **Error State**: Local component state for IPC errors
- **Loading State**: Separate boolean state for async operations

### Styling

- **Framework**: Tailwind CSS (existing)
- **Consistency**: Match pilot's visual design
- **Responsiveness**: Fixed-width containers, left-aligned layout
- **Accessibility**: Proper labels, focus states, ARIA attributes

## Testing Requirements

### E2E Test Coverage

- ✅ Navigate to Scientists page
- ✅ Display empty state
- ✅ Create scientist with valid data
- ✅ Display created scientist in list
- ✅ Show validation error for empty name
- ✅ Show validation error for invalid email
- ✅ Show database error for duplicate email

### Unit Test Coverage

- ✅ ScientistForm renders all fields
- ✅ ScientistForm shows validation errors
- ✅ ScientistForm calls IPC handler on valid submit
- ✅ ScientistForm resets after successful submission
- ✅ ScientistForm displays IPC error messages

### Coverage Targets

- **E2E Tests**: 36 total tests (adds 5 new scenarios)
- **IPC Coverage**: Maintain 90%+ (scientists handlers already tested)
- **TypeScript Coverage**: Maintain 50%+ overall project coverage

## Non-Functional Requirements

### Performance

- **Initial Load**: Scientists list should load within 500ms
- **Form Submission**: Create operation should complete within 1 second
- **Validation**: Client-side validation should be instant (<50ms)

### Accessibility

- **Keyboard Navigation**: All form controls accessible via keyboard
- **Screen Readers**: Proper labels and ARIA attributes
- **Focus Management**: Logical tab order through form fields
- **Error Announcement**: Error messages associated with fields

### Compatibility

- **Database Schema**: 100% compatible with bloom-desktop-pilot
- **IPC Handlers**: Uses existing tested handlers (no changes)
- **Operating Systems**: Works on macOS, Windows, Linux (Electron target platforms)

### Security

- **Input Sanitization**: React escapes rendered content automatically
- **SQL Injection**: Not applicable (Prisma parameterized queries)
- **Validation**: Both client-side (UX) and server-side (security)

## Future Considerations

This spec establishes patterns for:
- **Phenotypers page** - Identical requirements (name + email)
- **Accessions page** - Similar requirements (name only)
- **Experiments page** - Extended requirements (relational fields)

**Not Addressed in This Spec**:
- Edit functionality (no IPC handler exists)
- Delete functionality (no IPC handler exists)
- Pagination (not needed at current scale)
- Advanced search/filtering (future enhancement)
- Bulk operations (import already exists separately)

## Success Metrics

- ✅ Users can create scientists without touching the database directly
- ✅ Invalid data is caught before reaching the database
- ✅ Duplicate emails are prevented with clear error messages
- ✅ All E2E scenarios pass in both dev and packaged modes
- ✅ Code patterns are reusable for Phenotypers and Accessions