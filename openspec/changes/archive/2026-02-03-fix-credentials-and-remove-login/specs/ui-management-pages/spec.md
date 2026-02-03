# Spec Delta: UI Management Pages - Fix Credential Flow

This spec delta modifies the Machine Configuration page to remove the unnecessary login screen and fix the credential flow to match the pilot implementation pattern.

## REMOVED Requirements

- Login screen for credential validation (contradicts pilot pattern)
- `config:validate-credentials` IPC handler (no longer needed)

## ADDED Requirements

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
