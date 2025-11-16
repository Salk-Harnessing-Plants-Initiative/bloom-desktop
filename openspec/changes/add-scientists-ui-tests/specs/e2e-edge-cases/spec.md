# e2e-edge-cases Spec Delta

## MODIFIED Requirements

### Requirement: Scientists Management E2E Edge Cases

The system SHALL handle edge cases in the Scientists management UI including maximum length inputs, special characters, rapid submissions, and state preservation across navigation.

#### Scenario: Create scientist with maximum length name

- **GIVEN** the user is on the Scientists page
- **WHEN** the user enters a name with exactly 255 characters (database schema limit)
- **AND** the user enters a valid email
- **AND** the user submits the form
- **THEN** the scientist SHALL be created successfully
- **AND** the full name SHALL be stored in the database
- **AND** the name SHALL be displayed in the list (truncated or scrollable if needed)
- **AND** no validation errors SHALL appear

#### Scenario: Create scientist with special characters in name

- **GIVEN** the user is on the Scientists page
- **WHEN** the user enters a name with special characters (e.g., "Dr. O'Brien-Smith")
- **AND** the user enters a valid email
- **AND** the user submits the form
- **THEN** the scientist SHALL be created successfully
- **AND** the special characters SHALL be preserved in the database
- **AND** the name SHALL be displayed correctly in the list

#### Scenario: Create scientist with Unicode characters in name

- **GIVEN** the user is on the Scientists page
- **WHEN** the user enters a name with Unicode characters (e.g., "Dr. Müller")
- **AND** the user enters a valid email
- **AND** the user submits the form
- **THEN** the scientist SHALL be created successfully
- **AND** the Unicode characters SHALL be preserved and displayed correctly
- **AND** alphabetical sorting SHALL work correctly with Unicode characters

#### Scenario: Create scientist with subdomain email

- **GIVEN** the user is on the Scientists page
- **WHEN** the user enters a valid name
- **AND** the user enters an email with subdomain (e.g., "user@test.example.com")
- **AND** the user submits the form
- **THEN** the scientist SHALL be created successfully
- **AND** the email SHALL be validated as correct format
- **AND** the email SHALL be displayed correctly in the list

#### Scenario: Prevent rapid double submission

- **GIVEN** the user is on the Scientists page
- **WHEN** the user fills in valid scientist data
- **AND** the user clicks the submit button twice in rapid succession
- **THEN** only one scientist SHALL be created
- **AND** only one IPC call to `db:scientists:create` SHALL be made
- **AND** the form SHALL be disabled during submission (loading state)
- **AND** the submit button SHALL show "Adding..." or similar loading text

#### Scenario: Preserve state across page navigation

- **GIVEN** the user creates a scientist on the Scientists page
- **AND** the scientist appears in the list
- **WHEN** the user navigates to a different page (e.g., Home)
- **AND** the user navigates back to the Scientists page
- **THEN** the scientist SHALL still appear in the list
- **AND** the data SHALL be loaded from the database (not just UI state)
- **AND** the list SHALL be sorted alphabetically
- **AND** the form SHALL be cleared (not showing previous input)