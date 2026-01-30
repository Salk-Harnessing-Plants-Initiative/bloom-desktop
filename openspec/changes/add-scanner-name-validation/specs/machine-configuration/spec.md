# Spec Delta: machine-configuration

This change modifies the machine-configuration capability to fetch valid scanner names from the Bloom API.

## MODIFIED Requirements

### Requirement: Scanner Name Selection

The Machine Configuration page SHALL present scanner names as a dropdown populated from the Bloom API.

#### Scenario: Fetch scanner list on page load

- **GIVEN** the user opens the Machine Configuration page
- **AND** Bloom API credentials are configured
- **WHEN** the page loads
- **THEN** the system SHALL fetch the scanner list from the Bloom API
- **AND** a loading indicator SHALL be displayed during the fetch
- **AND** the dropdown SHALL be disabled until fetch completes

#### Scenario: Display scanner dropdown on successful fetch

- **GIVEN** the scanner list is successfully fetched
- **WHEN** the dropdown is rendered
- **THEN** all scanner names from the API response SHALL be displayed as options
- **AND** the currently configured scanner name (if any) SHALL be pre-selected
- **AND** a placeholder option "Select a scanner..." SHALL be shown if no scanner is configured

#### Scenario: Handle API fetch error

- **GIVEN** the scanner list fetch fails (network error, auth error, etc.)
- **WHEN** the error occurs
- **THEN** an error message SHALL be displayed: "Failed to fetch scanners. Check your credentials and network connection."
- **AND** a "Retry" button SHALL be displayed
- **AND** the scanner dropdown SHALL be disabled
- **AND** the user SHALL NOT be able to save the configuration without a valid scanner selection

#### Scenario: Retry after error

- **GIVEN** the scanner list fetch has failed
- **WHEN** the user clicks the "Retry" button
- **THEN** the system SHALL re-attempt to fetch the scanner list
- **AND** the loading indicator SHALL be displayed during the retry

#### Scenario: No credentials configured (first run)

- **GIVEN** no Bloom API credentials are configured
- **WHEN** the page loads
- **THEN** the scanner dropdown SHALL be disabled
- **AND** a message SHALL indicate credentials must be configured first
- **AND** the scanner fetch SHALL NOT be attempted

#### Scenario: Fetch scanners after credentials saved

- **GIVEN** the user is on the Machine Configuration page
- **AND** no credentials were previously configured
- **WHEN** the user saves valid credentials
- **THEN** the system SHALL automatically fetch the scanner list
- **AND** the dropdown SHALL be enabled with the fetched options

### Requirement: Bloom API Scanner Endpoint

The config module SHALL provide a method to fetch scanners from the Bloom API.

#### Scenario: Successful API call

- **GIVEN** valid Bloom API credentials are configured
- **AND** the Bloom API is accessible
- **WHEN** `fetchScanners()` is called
- **THEN** the system SHALL return a list of scanner objects with `name` property
- **AND** the list SHALL be read directly from the API response

#### Scenario: Authentication failure

- **GIVEN** invalid or expired credentials
- **WHEN** `fetchScanners()` is called
- **THEN** the system SHALL return an error indicating authentication failed
- **AND** the scanners list SHALL NOT be returned

#### Scenario: Network error

- **GIVEN** the Bloom API is unreachable (network error, timeout)
- **WHEN** `fetchScanners()` is called
- **THEN** the system SHALL return an error indicating network failure
- **AND** the system SHALL NOT cache or fallback to stale data

## MODIFIED Requirements (from add-machine-configuration)

### Requirement: Config Validation (MODIFIED)

The config store module SHALL validate configuration values before saving.

#### Scenario: Validate scanner name (MODIFIED)

- **GIVEN** the user provides a scanner name
- **WHEN** the config is validated
- **THEN** empty string SHALL be rejected with error "Scanner name is required"
- **AND** any non-empty string SHALL be accepted (API dropdown enforces validity)

_Note: The previous alphanumeric restriction is removed since the dropdown only allows valid scanner names from the API._
