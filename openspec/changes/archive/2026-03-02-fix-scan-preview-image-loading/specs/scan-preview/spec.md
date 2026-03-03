## ADDED Requirements

### Requirement: ScanPreview Image Loading

The ScanPreview component SHALL load and display scan images from the local filesystem in both development and production modes.

#### Scenario: Images load in development mode

- **GIVEN** the application is running in development mode (webpack-dev-server)
- **AND** a scan exists with images saved to disk
- **WHEN** the user navigates to ScanPreview for that scan
- **THEN** images SHALL load and display correctly
- **AND** frame navigation SHALL work

#### Scenario: Images load in production mode

- **GIVEN** the application is running in production mode
- **AND** a scan exists with images saved to disk
- **WHEN** the user navigates to ScanPreview for that scan
- **THEN** images SHALL load and display correctly
- **AND** frame navigation SHALL work

### Requirement: Web Security Configuration

The BrowserWindow SHALL be configured with `webSecurity: false` to allow loading local files from HTTP context, matching the pilot implementation.

#### Scenario: File URLs accessible from HTTP context

- **GIVEN** the renderer is loaded from `http://localhost` (development mode)
- **WHEN** an img element uses `file://` src attribute
- **THEN** the image SHALL load successfully
- **AND** no CORS or security errors SHALL occur

#### Scenario: Pilot compatibility maintained

- **GIVEN** the pilot implementation uses `webSecurity: false`
- **WHEN** configuring BrowserWindow webPreferences
- **THEN** the same setting SHALL be used for compatibility
- **AND** a TODO comment SHALL indicate future improvement needed
