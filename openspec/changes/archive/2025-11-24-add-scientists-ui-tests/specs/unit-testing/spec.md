# unit-testing Spec Delta

## ADDED Requirements

### Requirement: Scientists Page Component Unit Tests

The system SHALL provide comprehensive unit tests for the Scientists page component to verify data fetching, state management, error handling, and list rendering logic in isolation from IPC and database layers.

#### Scenario: Fetch scientists on component mount

- **GIVEN** the Scientists page component is rendered
- **WHEN** the component mounts
- **THEN** `window.electron.database.scientists.list` SHALL be called once
- **AND** the loading state SHALL appear initially
- **AND** the scientists list SHALL be displayed after data loads
- **AND** scientists SHALL be sorted alphabetically by name

#### Scenario: Display loading state during fetch

- **GIVEN** the Scientists page component is rendered
- **WHEN** the API response is delayed (slow network simulation)
- **THEN** a loading indicator SHALL be visible
- **AND** the loading indicator SHALL disappear after data loads
- **AND** the scientists list SHALL be rendered

#### Scenario: Display error state when fetch fails

- **GIVEN** the Scientists page component is rendered
- **WHEN** `window.electron.database.scientists.list` returns an error
- **THEN** an error message SHALL be displayed
- **AND** the error message SHALL be user-friendly (not raw error text)
- **AND** the scientists list SHALL not be rendered

#### Scenario: Display empty state when no scientists exist

- **GIVEN** the Scientists page component is rendered
- **WHEN** `window.electron.database.scientists.list` returns an empty array
- **THEN** an empty state message SHALL be displayed
- **AND** the ScientistForm SHALL still be visible
- **AND** no loading or error indicators SHALL be visible

#### Scenario: Render list of scientists alphabetically

- **GIVEN** the Scientists page component is rendered
- **WHEN** `window.electron.database.scientists.list` returns multiple scientists in random order
- **THEN** all scientists SHALL be displayed in the list
- **AND** scientists SHALL be sorted alphabetically by name
- **AND** each scientist SHALL display in format "Name (email)"
- **AND** each scientist SHALL appear exactly once

#### Scenario: Refresh list after scientist creation

- **GIVEN** the Scientists page component is rendered with initial data
- **WHEN** a new scientist is successfully created via ScientistForm
- **AND** the `onSuccess` callback is triggered
- **THEN** `window.electron.database.scientists.list` SHALL be called again
- **AND** the scientists list SHALL be updated with the new scientist
- **AND** the new scientist SHALL appear in alphabetical order

#### Scenario: Handle network errors gracefully

- **GIVEN** the Scientists page component is rendered
- **WHEN** `window.electron.database.scientists.list` throws an unexpected error
- **THEN** an error message SHALL be displayed
- **AND** the error message SHALL state "An unexpected error occurred" or similar
- **AND** the application SHALL not crash
- **AND** the previous list state SHALL be preserved (if any)

### Requirement: Test Data Fixtures for Scientists

The system SHALL provide reusable test data factory functions for creating consistent scientist test data across unit and E2E tests.

#### Scenario: Create scientist test data with defaults

- **GIVEN** a test needs scientist data
- **WHEN** `createScientistData()` is called without arguments
- **THEN** a valid scientist object SHALL be returned
- **AND** the object SHALL have a name field with a default value
- **AND** the object SHALL have an email field with a unique value (using timestamp or UUID)

#### Scenario: Create scientist test data with overrides

- **GIVEN** a test needs custom scientist data
- **WHEN** `createScientistData({ name: 'Custom Name', email: 'custom@example.com' })` is called
- **THEN** a scientist object SHALL be returned with the custom values
- **AND** all fields not specified in overrides SHALL use default values

#### Scenario: Use test data constants

- **GIVEN** a test needs edge case data
- **WHEN** the test imports constants like `maxLengthName` or `specialCharName`
- **THEN** the constants SHALL provide valid test data for edge cases
- **AND** the constants SHALL be reusable across multiple tests
- **AND** the constants SHALL match database schema constraints (e.g., max length 255)
