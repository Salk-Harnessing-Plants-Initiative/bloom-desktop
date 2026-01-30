# Spec Delta: UI Management Pages

## MODIFIED Requirements

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
