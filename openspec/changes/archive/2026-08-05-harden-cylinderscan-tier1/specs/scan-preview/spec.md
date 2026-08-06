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

- **WHEN** an image path is converted to a `bloom-scan://` URL
- **THEN** the path SHALL be carried as a `path` query parameter behind a fixed `local-file` host (e.g., `bloom-scan://local-file/?path=<encoded>`), never embedded directly in the URL's authority/path position
- **AND** the path SHALL be percent-encoded via `encodeURIComponent` before being placed in the query string, so Windows backslashes (normalized to forward slashes first), drive letters, spaces, and other special characters all round-trip correctly
- **WHEN** the URL is parsed back into a native path
- **THEN** the original path SHALL be recovered by reading the `path` query parameter (e.g. via `URLSearchParams`), not by string-manipulating the URL's authority or path components

> **Why not the `file://` triple-slash convention (e.g. `bloom-scan:///C:/Users/foo/bar.png`):** `bloom-scan://` is registered with `standard: true`, so Chromium's generic WHATWG "special scheme" URL parser applies to it — the same authority-parsing rules as `http`/`file`. Unlike the literal `file:` scheme, a _custom_ standard scheme gets none of `file:`'s spec-mandated drive-letter/empty-host quirk handling: the parser collapses the extra leading slash and reads the first path segment as the **host** (e.g. `bloom-scan:///C:/foo` arrives at the protocol handler as host `"c"`, path `/foo` — confirmed against a real Electron build, not just unit tests, since Node's own `URL`/`Request` don't apply special-scheme parsing to unlisted custom schemes and so never reproduce this). Carrying the path in the query string sidesteps authority/path parsing entirely and is immune to this regardless of the path's shape.

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
