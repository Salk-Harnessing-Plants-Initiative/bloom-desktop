# machine-configuration Specification

## Purpose

TBD - created by archiving change add-machine-configuration. Update Purpose after archive.

## Requirements

### Requirement: Config Store Module

The application SHALL provide a config store module that persists machine-level settings to `~/.bloom/config.json` and credentials to `~/.bloom/.env`.

#### Scenario: Load config from file

- **GIVEN** a valid config.json exists at `~/.bloom/config.json`
- **WHEN** the application starts or `loadConfig()` is called
- **THEN** the config values SHALL be loaded into memory
- **AND** the config object SHALL contain all expected fields

#### Scenario: Load config when file missing

- **GIVEN** no config.json exists at `~/.bloom/config.json`
- **WHEN** the application starts or `loadConfig()` is called
- **THEN** default values SHALL be returned
- **AND** default `scanner_name` SHALL be empty string
- **AND** default `camera_ip_address` SHALL be "mock"
- **AND** default `scans_dir` SHALL be "~/.bloom/scans"
- **AND** default `bloom_api_url` SHALL be "https://api.bloom.salk.edu/proxy"

#### Scenario: Save config to file

- **GIVEN** valid config values are provided
- **WHEN** `saveConfig()` is called
- **THEN** the config SHALL be written to `~/.bloom/config.json`
- **AND** the file SHALL be valid JSON
- **AND** the directory SHALL be created if it doesn't exist

#### Scenario: Load credentials from env file

- **GIVEN** a valid .env file exists at `~/.bloom/.env`
- **WHEN** `loadCredentials()` is called
- **THEN** the credentials SHALL be loaded into memory
- **AND** the credentials object SHALL contain `bloom_scanner_username`, `bloom_scanner_password`, and `bloom_anon_key`

#### Scenario: Save credentials to env file

- **GIVEN** valid credential values are provided
- **WHEN** `saveCredentials()` is called
- **THEN** the credentials SHALL be written to `~/.bloom/.env`
- **AND** the file SHALL use KEY=value format

### Requirement: Config Validation

The config store module SHALL validate configuration values before saving.

#### Scenario: Validate scanner name

- **GIVEN** the user provides a scanner name
- **WHEN** the config is validated
- **THEN** empty string SHALL be rejected with error "Scanner name is required"
- **AND** names with special characters (except dashes and underscores) SHALL be rejected
- **AND** alphanumeric names with dashes/underscores SHALL be accepted

#### Scenario: Validate camera IP address

- **GIVEN** the user provides a camera IP address
- **WHEN** the config is validated
- **THEN** "mock" SHALL be accepted (for development)
- **AND** valid IPv4 addresses (e.g., "10.0.0.23") SHALL be accepted
- **AND** invalid formats SHALL be rejected with error "Invalid IP address format"

#### Scenario: Validate scans directory

- **GIVEN** the user provides a scans directory path
- **WHEN** the config is validated
- **THEN** empty paths SHALL be rejected with error "Scans directory is required"
- **AND** valid directory paths SHALL be accepted
- **AND** paths with invalid characters SHALL be rejected

#### Scenario: Validate Bloom API URL

- **GIVEN** the user provides a Bloom API URL
- **WHEN** the config is validated
- **THEN** valid HTTPS URLs SHALL be accepted
- **AND** invalid URL formats SHALL be rejected with error "Invalid URL format"

### Requirement: Config IPC Handlers

The main process SHALL expose IPC handlers for configuration operations.

#### Scenario: Get config via IPC

- **GIVEN** the renderer process needs configuration
- **WHEN** the renderer calls `config:get`
- **THEN** the current config and credentials SHALL be returned (password masked)

#### Scenario: Set config via IPC

- **GIVEN** the renderer process provides new configuration
- **WHEN** the renderer calls `config:set` with valid values
- **THEN** the config SHALL be saved to disk
- **AND** a success response SHALL be returned

#### Scenario: Validate credentials via IPC

- **GIVEN** the user enters Bloom credentials
- **WHEN** the renderer calls `config:validate-credentials`
- **THEN** the credentials SHALL be compared to stored values
- **AND** `true` SHALL be returned if they match, `false` otherwise

#### Scenario: Test camera connection via IPC

- **GIVEN** the user clicks "Test Connection" for camera
- **WHEN** the renderer calls `config:test-camera` with an IP address
- **THEN** the system SHALL attempt to connect to the camera
- **AND** a success/failure status SHALL be returned

#### Scenario: Browse directory via IPC

- **GIVEN** the user clicks "Browse..." for scans directory
- **WHEN** the renderer calls `config:browse-directory`
- **THEN** a native folder picker dialog SHALL open
- **AND** the selected path SHALL be returned (or null if cancelled)

### Requirement: Machine Configuration Page

The application SHALL provide a Machine Configuration page at route `/machine-config` for editing machine-level settings.

#### Scenario: Display configuration form

- **GIVEN** the user navigates to `/machine-config`
- **WHEN** the page loads
- **THEN** a form SHALL display with fields for: Scanner Name, Camera IP, Scans Directory, Bloom API URL, Username, Password, Anon Key
- **AND** the form SHALL be pre-populated with current values
- **AND** the password field SHALL be masked

#### Scenario: Save configuration

- **GIVEN** the user has entered valid configuration values
- **WHEN** the user clicks "Save Configuration"
- **THEN** the config SHALL be saved to disk
- **AND** a success message SHALL appear
- **AND** the user SHALL remain on the configuration page

#### Scenario: Validation error display

- **GIVEN** the user has entered invalid configuration values
- **WHEN** the user clicks "Save Configuration"
- **THEN** validation errors SHALL be displayed inline near the relevant fields
- **AND** the config SHALL NOT be saved
- **AND** the form SHALL remain editable

#### Scenario: Cancel configuration changes

- **GIVEN** the user has modified configuration values
- **WHEN** the user clicks "Cancel"
- **THEN** the form SHALL be reset to the saved values
- **AND** no changes SHALL be written to disk

### Requirement: Machine Configuration Access Control

The Machine Configuration page SHALL be protected by Bloom credential authentication.

#### Scenario: First-run access (no credentials stored)

- **GIVEN** no credentials are stored in `~/.bloom/.env`
- **WHEN** the user navigates to `/machine-config`
- **THEN** the configuration form SHALL be displayed directly (no auth required)
- **AND** the user SHALL be able to set initial credentials

#### Scenario: Subsequent access (credentials exist)

- **GIVEN** credentials are stored in `~/.bloom/.env`
- **WHEN** the user navigates to `/machine-config`
- **THEN** a login form SHALL be displayed requesting username and password
- **AND** the user SHALL NOT see the configuration form until authenticated

#### Scenario: Successful authentication

- **GIVEN** the user is on the login form
- **WHEN** the user enters correct Bloom credentials
- **THEN** the configuration form SHALL be displayed
- **AND** the session SHALL remain authenticated until page is closed

#### Scenario: Failed authentication

- **GIVEN** the user is on the login form
- **WHEN** the user enters incorrect credentials
- **THEN** an error message SHALL appear: "Invalid credentials"
- **AND** the login form SHALL remain visible
- **AND** the user MAY retry

### Requirement: Machine Configuration Keyboard Shortcut

The application SHALL provide a keyboard shortcut to access the Machine Configuration page.

#### Scenario: Access via keyboard shortcut

- **GIVEN** the user is on any page in the application
- **WHEN** the user presses `Ctrl+Shift+,` (Windows/Linux) or `Cmd+Shift+,` (macOS)
- **THEN** the application SHALL navigate to `/machine-config`

### Requirement: Scanner Name Display

The application sidebar SHALL display the configured scanner name.

#### Scenario: Display scanner name in sidebar

- **GIVEN** a scanner name is configured
- **WHEN** the Layout component renders
- **THEN** the scanner name SHALL be displayed in the sidebar footer
- **AND** the format SHALL be "Scanner: {scanner_name}"

#### Scenario: Display default when no scanner name configured

- **GIVEN** no scanner name is configured (empty string)
- **WHEN** the Layout component renders
- **THEN** the sidebar footer SHALL display "Scanner: Not configured"

### Requirement: First-Run Detection

The application SHALL detect first-run state and guide users to Machine Configuration.

#### Scenario: First-run auto-redirect

- **GIVEN** no config.json exists at `~/.bloom/config.json`
- **WHEN** the application starts
- **THEN** the application SHALL redirect to `/machine-config`
- **AND** a message SHALL indicate this is first-time setup

#### Scenario: Subsequent runs with valid config

- **GIVEN** a valid config.json exists with required fields
- **WHEN** the application starts
- **THEN** the application SHALL navigate to the home page as normal
- **AND** no redirect to configuration SHALL occur

### Requirement: CaptureScan Config Integration

The CaptureScan page SHALL use configuration values instead of hardcoded defaults.

#### Scenario: Use scanner name from config

- **GIVEN** a scanner name is configured
- **WHEN** a scan is created
- **THEN** the scan SHALL use the configured `scanner_name`
- **AND** the scan SHALL NOT use the hardcoded "CaptureScan-UI" value

#### Scenario: Use scans directory from config

- **GIVEN** a scans directory is configured
- **WHEN** a scan is created
- **THEN** the scan output SHALL be saved to the configured `scans_dir`
- **AND** subdirectories SHALL be created as needed

### Requirement: Camera Settings Default Integration

The Camera Settings page (`/camera-settings`) SHALL load the default camera IP from Machine Configuration while preserving its existing functionality for per-session image parameter tuning.

#### Scenario: Load default camera IP on mount

- **GIVEN** a `camera_ip_address` is configured in Machine Configuration
- **WHEN** the Camera Settings page loads
- **THEN** the camera selection dropdown SHALL pre-select the configured camera IP
- **AND** the user MAY temporarily switch to a different camera for testing

#### Scenario: Temporary camera selection not persisted

- **GIVEN** the user selects a different camera in Camera Settings
- **WHEN** the user leaves the Camera Settings page
- **THEN** the temporary selection SHALL NOT be saved to Machine Configuration
- **AND** CaptureScan SHALL continue to use the Machine Configuration camera IP

#### Scenario: No default configured

- **GIVEN** no `camera_ip_address` is configured (or set to "mock")
- **WHEN** the Camera Settings page loads
- **THEN** the camera selection SHALL default to mock camera
- **AND** the "Detect Cameras" button SHALL remain available

### Requirement: Machine Configuration vs Camera Settings Separation

Machine Configuration and Camera Settings serve distinct purposes and SHALL NOT duplicate functionality.

#### Scenario: Machine Configuration scope

- **GIVEN** the admin navigates to Machine Configuration
- **WHEN** viewing the camera IP field
- **THEN** only the default camera IP SHALL be configurable
- **AND** per-session image parameters (exposure, gain, gamma, etc.) SHALL NOT be present
- **AND** live preview SHALL NOT be available (use Camera Settings for that)

#### Scenario: Camera Settings scope

- **GIVEN** the user navigates to Camera Settings
- **WHEN** viewing the page
- **THEN** per-session image parameters (exposure, gain, gamma, brightness, contrast) SHALL be configurable
- **AND** live preview SHALL be available
- **AND** scanner name, scans directory, and API credentials SHALL NOT be present

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
