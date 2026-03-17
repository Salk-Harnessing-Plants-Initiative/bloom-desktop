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

### Requirement: Scan Preview Image Error Handling

The system SHALL display scan images using React-managed state for all rendering, including error states. When an image fails to load, the system SHALL display an error message using React conditional rendering (not direct DOM manipulation). The error state SHALL reset when navigating to a different frame.

#### Scenario: Image load failure shows error via React state

- **WHEN** an image fails to load in ScanPreview
- **THEN** an error message is displayed via React state (not innerHTML)
- **AND** the image element is hidden

#### Scenario: Error state resets on frame navigation

- **WHEN** the user navigates to a different frame after an image error
- **THEN** the error state resets and the new image loads normally

### Requirement: Scan Preview Keyboard Navigation

The system SHALL support keyboard navigation through scan frames using arrow keys, Home, and End. The keyboard handler SHALL use functional state updates to avoid stale closure references.

#### Scenario: Consecutive keyboard navigation works correctly

- **WHEN** the user presses ArrowRight multiple times in succession
- **THEN** the frame advances by one for each press (no skipped or repeated frames)

#### Scenario: Home and End keys navigate to boundaries

- **WHEN** the user presses Home
- **THEN** the viewer navigates to the first frame
- **WHEN** the user presses End
- **THEN** the viewer navigates to the last frame
