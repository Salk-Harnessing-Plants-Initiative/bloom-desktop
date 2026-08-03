## MODIFIED Requirements

### Requirement: ScanPreview Image Loading

The ScanPreview component SHALL load and display scan images from the local filesystem in both development and production modes. File paths SHALL be converted to proper `bloom-scan://` URLs that work on all platforms (macOS, Windows, Linux), handling backslashes, drive letters, and spaces.

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

#### Scenario: Cross-platform custom-scheme URL construction

- **WHEN** an image path contains Windows backslashes (e.g., `C:\Users\foo\bar.png`)
- **THEN** the URL SHALL use forward slashes with a leading slash (e.g., `bloom-scan:///C:/Users/foo/bar.png`)
- **WHEN** an image path contains spaces (e.g., `/Users/foo bar/img.png`)
- **THEN** spaces SHALL be percent-encoded in the URL (e.g., `bloom-scan:///Users/foo%20bar/img.png`)

### Requirement: Web Security Configuration

The BrowserWindow SHALL NOT set `webSecurity: false`. Local scan images SHALL be served via a custom privileged `bloom-scan://` protocol, registered via `protocol.registerSchemesAsPrivileged()` before `app.ready` and handled via `protocol.handle()` after the app is ready, rather than relying on disabling the renderer's web security to load `file://` URLs from an HTTP origin.

#### Scenario: Custom scheme accessible from HTTP context

- **GIVEN** the renderer is loaded from `http://localhost` (development mode)
- **WHEN** an `img` element uses a `bloom-scan://` src attribute
- **THEN** the image SHALL load successfully
- **AND** no CORS or security errors SHALL occur
- **AND** `webSecurity` SHALL remain at its default (`true`) value

#### Scenario: Custom scheme accessible from packaged file origin

- **GIVEN** the renderer is loaded from a packaged `file://.../index.html` origin (production mode)
- **WHEN** an `img` element uses a `bloom-scan://` src attribute
- **THEN** the image SHALL load successfully

#### Scenario: Path traversal is rejected

- **GIVEN** the configured `scans_dir` is `C:\Users\phenotyper\bloom-scans`
- **WHEN** a `bloom-scan://` request resolves to an absolute path outside `scans_dir` (e.g. via a `..` segment or an absolute path override)
- **THEN** the protocol handler SHALL reject the request
- **AND** SHALL NOT return file contents from outside `scans_dir`

#### Scenario: A sibling directory sharing a name prefix is rejected

- **GIVEN** the configured `scans_dir` is `C:\Users\phenotyper\bloom-scans`
- **WHEN** a `bloom-scan://` request resolves to `C:\Users\phenotyper\bloom-scans-archive\x.png` (a sibling directory whose name happens to start with the same string, not a path actually inside `scans_dir`)
- **THEN** the protocol handler SHALL reject the request
- **AND** the containment check SHALL be boundary-aware (checking for an exact match or a `scans_dir` + path-separator prefix), not a plain string prefix match that a same-prefix sibling directory could satisfy

#### Scenario: Containment check reads the currently-configured scans_dir

- **GIVEN** the protocol handler was registered while `scans_dir` was `C:\old-scans`
- **AND** the operator has since changed `scans_dir` to `C:\new-scans` via Configure Scanner
- **WHEN** a `bloom-scan://` request for a path under `C:\new-scans` arrives
- **THEN** the request SHALL be served (the handler reads `scans_dir` fresh on every request, not a value captured at registration time)
