# scan-preview Specification

## Purpose

TBD - created by archiving change fix-scan-preview-image-loading. Update Purpose after archive.
## Requirements
### Requirement: ScanPreview Image Loading

The ScanPreview component SHALL load and display scan images from the local filesystem in both development and production modes. File paths SHALL be converted to proper file:// URLs that work on all platforms (macOS, Windows, Linux), handling backslashes, drive letters, and spaces.

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

#### Scenario: Cross-platform file URL construction

- **WHEN** an image path contains Windows backslashes (e.g., `C:\Users\foo\bar.png`)
- **THEN** the file URL SHALL use forward slashes with a leading slash (e.g., `file:///C:/Users/foo/bar.png`)
- **WHEN** an image path contains spaces (e.g., `/Users/foo bar/img.png`)
- **THEN** spaces SHALL be percent-encoded in the URL (e.g., `file:///Users/foo%20bar/img.png`)

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

### Requirement: ScanPreview Frame Reset on Navigation

The ScanPreview component SHALL reset the current frame to 0 when the scan ID changes, preventing out-of-bounds frame indices when navigating between scans with different frame counts.

#### Scenario: Frame resets when navigating to different scan

- **GIVEN** the user is viewing scan A at frame 5 of 10
- **WHEN** the user navigates to scan B (which has 3 frames)
- **THEN** the current frame SHALL reset to 0
- **AND** the first image of scan B SHALL be displayed
- **AND** no out-of-bounds access SHALL occur

