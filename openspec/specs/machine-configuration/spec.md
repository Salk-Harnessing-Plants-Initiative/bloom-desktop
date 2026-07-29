# machine-configuration Specification

## Purpose

TBD - created by archiving change add-machine-configuration. Update Purpose after archive.

## Requirements

### Requirement: Config Store Module

The application SHALL provide a config store module that persists all machine-level settings and credentials to `~/.bloom/.env`.

#### Scenario: Load config from file

- **GIVEN** a valid `.env` file exists at `~/.bloom/.env`
- **WHEN** the application starts or `loadConfig()` is called
- **THEN** the config values SHALL be loaded into memory
- **AND** the config object SHALL contain all expected fields

#### Scenario: Load config when file missing

- **GIVEN** no `.env` file exists at `~/.bloom/.env`
- **WHEN** the application starts or `loadConfig()` is called
- **THEN** default values SHALL be returned
- **AND** default `scanner_name` SHALL be empty string
- **AND** default `camera_ip_address` SHALL be "mock"
- **AND** default `scans_dir` SHALL be "~/.bloom/scans"
- **AND** default `bloom_api_url` SHALL be "https://api.bloom.salk.edu/proxy"

#### Scenario: Save config to file

- **GIVEN** valid config values are provided
- **WHEN** `saveConfig()` is called
- **THEN** the config SHALL be written to `~/.bloom/.env`
- **AND** the file SHALL use KEY=VALUE format
- **AND** the directory SHALL be created if it doesn't exist

#### Scenario: Load all settings from file

- **GIVEN** a valid `.env` file exists at `~/.bloom/.env`
- **WHEN** `loadConfig()` is called
- **THEN** all settings and credentials SHALL be loaded into memory
- **AND** the config object SHALL contain `scanner_name`, `camera_ip_address`, `scans_dir`, `bloom_api_url`
- **AND** the credentials SHALL contain `bloom_scanner_username`, `bloom_scanner_password`, and `bloom_anon_key`

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

- **GIVEN** no `.env` file exists at `~/.bloom/.env`
- **WHEN** the application starts
- **THEN** the application SHALL redirect to `/machine-config`
- **AND** a message SHALL indicate this is first-time setup

#### Scenario: Subsequent runs with valid config

- **GIVEN** a valid `.env` file exists with required fields
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
- **WHEN** viewing the configuration form
- **THEN** the following SHALL be configurable: scanner name, camera IP, scans directory, Bloom API credentials, `num_frames`, `seconds_per_rot`
- **AND** per-session image parameters (exposure, gain, gamma) SHALL NOT be present
- **AND** live preview SHALL NOT be available (use Camera Settings for that)

#### Scenario: Camera Settings scope

- **GIVEN** the user navigates to Camera Settings
- **WHEN** viewing the page
- **THEN** per-session image parameters (exposure, gain, gamma) SHALL be configurable
- **AND** live preview SHALL be available
- **AND** scanner name, scans directory, API credentials, `num_frames`, and `seconds_per_rot` SHALL NOT be present

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

### Requirement: Scan Parameter Configuration

The Machine Configuration page SHALL include scan parameters (`num_frames` and `seconds_per_rot`) as admin-configurable settings, persisted alongside other machine-level configuration in `~/.bloom/.env`.

#### Scenario: Default scan parameter values

- **GIVEN** no `.env` file exists or scan parameters are not set
- **WHEN** `loadConfig()` is called
- **THEN** `num_frames` SHALL default to 72
- **AND** `seconds_per_rot` SHALL default to 7.0

#### Scenario: Load scan parameters from file

- **GIVEN** a `.env` file contains `NUM_FRAMES=36` and `SECONDS_PER_ROT=5.0`
- **WHEN** `loadConfig()` is called
- **THEN** `num_frames` SHALL be 36
- **AND** `seconds_per_rot` SHALL be 5.0

#### Scenario: Save scan parameters to file

- **GIVEN** the admin sets `num_frames` to 36 and `seconds_per_rot` to 5.0
- **WHEN** the admin clicks "Save Configuration"
- **THEN** `NUM_FRAMES=36` and `SECONDS_PER_ROT=5.0` SHALL be written to `~/.bloom/.env`

#### Scenario: Validate num_frames bounds

- **GIVEN** the admin enters a value for num_frames
- **WHEN** the config is validated
- **THEN** integers in range 1-720 SHALL be accepted
- **AND** zero SHALL be rejected with error "Number of frames must be an integer between 1 and 720"
- **AND** negative numbers SHALL be rejected with the same error
- **AND** non-integers (e.g., 1.5) SHALL be rejected with the same error
- **AND** values above 720 SHALL be rejected with the same error

#### Scenario: Validate seconds_per_rot bounds

- **GIVEN** the admin enters a value for seconds_per_rot
- **WHEN** the config is validated
- **THEN** numbers in range 2.0-120.0 SHALL be accepted
- **AND** values below 2.0 SHALL be rejected with error "Seconds per rotation must be between 2.0 and 120.0"
- **AND** values above 120.0 SHALL be rejected with the same error

#### Scenario: Display scan parameter controls

- **GIVEN** the admin navigates to Machine Configuration
- **WHEN** the page loads
- **THEN** a "Scan Parameters" section SHALL be displayed between Hardware and Actions sections
- **AND** `num_frames` SHALL have a number input with label "Frames per rotation" (default 72)
- **AND** `seconds_per_rot` SHALL have a number input with label "Seconds per rotation" (default 7.0)
- **AND** helper text SHALL describe the effect on scan duration and image angular resolution

#### Scenario: CaptureScan reads scan parameters from config

- **GIVEN** `num_frames` and `seconds_per_rot` are configured in Machine Configuration
- **WHEN** the user starts a scan from the CaptureScan page
- **THEN** the scanner SHALL use the configured `num_frames` value via `DAQSettings`
- **AND** the scanner SHALL use the configured `seconds_per_rot` value via `DAQSettings`
- **AND** the hardcoded value of 72 SHALL NOT be used

#### Scenario: CaptureScan displays scan parameters

- **GIVEN** `num_frames` and `seconds_per_rot` are loaded from Machine Configuration
- **WHEN** the CaptureScan page renders
- **THEN** the configured frame count and rotation time SHALL be displayed as read-only text near the "Start Scan" button
- **AND** the display SHALL be read-only (phenotypers do not change these values)

#### Scenario: CaptureScan falls back to defaults when config missing

- **GIVEN** `num_frames` or `seconds_per_rot` are not set in Machine Configuration
- **WHEN** the user starts a scan
- **THEN** `num_frames` SHALL fall back to 72
- **AND** `seconds_per_rot` SHALL fall back to 7.0

### Requirement: Basler acA2000-50gm Camera Compatibility

The Camera Settings page SHALL expose only parameters supported by the Basler acA2000-50gm (ace Classic GigE) and use correct types and ranges for the Pylon API.

#### Scenario: Supported controls only

- **GIVEN** the user navigates to Camera Settings
- **WHEN** viewing the form
- **THEN** exactly three image parameter controls SHALL be present: Exposure Time, Gain, Gamma
- **AND** Brightness and Contrast controls SHALL NOT be present (unsupported: `BslBrightness`/`BslContrast` are ace 2+ only)
- **AND** Width and Height controls SHALL NOT be present (not applied to hardware)

#### Scenario: Gain control uses correct GainRaw parameters

- **GIVEN** the user is on the Camera Settings page
- **WHEN** viewing the Gain control
- **THEN** the slider SHALL have min=36, max=512, step=1
- **AND** the input SHALL produce integer values only (matching Pylon `IInteger` type for `GainRaw`)
- **AND** the default SHALL be 100 (~9.9 dB for the acA2000-50gm)

#### Scenario: Python GainRaw receives integer

- **GIVEN** the user configures gain in Camera Settings
- **WHEN** the value is sent to the Python backend
- **THEN** `camera.GainRaw.Value` SHALL receive an `int` value
- **AND** the Python `CameraSettings.gain` field SHALL be typed as `int`

#### Scenario: CameraSettings type contains only supported fields

- **GIVEN** the `CameraSettings` TypeScript interface is defined
- **WHEN** the interface is inspected at compile time
- **THEN** it SHALL contain: `exposure_time`, `gain`, `camera_ip_address`, `gamma`
- **AND** it SHALL NOT contain: `brightness`, `contrast`, `width`, `height`

#### Scenario: Python IPC handler filters unknown camera settings

- **GIVEN** the TypeScript renderer sends a camera settings dict to the Python backend
- **WHEN** the dict contains keys not present in the Python `CameraSettings` dataclass (e.g., `brightness`, `contrast`)
- **THEN** unknown keys SHALL be silently filtered before constructing `CameraSettings(**kwargs)`
- **AND** the scan SHALL proceed without error

### Requirement: Scanner Mode Selection

The Machine Configuration page SHALL include a scanner mode selector as the first configuration field. The mode determines which subsequent fields are shown. CylinderScan-specific fields (camera IP, num_frames, seconds_per_rot) SHALL be hidden when mode is `graviscan`. The scanner mode field SHALL be required — the app cannot be used without it.

The existing fields remain: scanner_name, camera_ip_address, scans_dir, bloom_api_url, bloom_scanner_username, bloom_scanner_password, bloom_anon_key, num_frames, seconds_per_rot. The scanner_mode field is added.

#### Scenario: Scanner mode is required on first run

- **GIVEN** the app is launched for the first time (no `~/.bloom/.env` exists)
- **WHEN** the user is redirected to Machine Config
- **THEN** the scanner mode selector SHALL be the first visible field
- **AND** the user SHALL NOT be able to save without selecting a mode
- **AND** the mode options SHALL be "CylinderScan (rotating cylinder + camera)" and "GraviScan (flatbed scanners)"

#### Scenario: CylinderScan mode shows cylinder-specific fields

- **GIVEN** scanner mode is set to `cylinderscan`
- **WHEN** the Machine Config page renders
- **THEN** Camera IP Address, Frames per Rotation, and Seconds per Rotation fields SHALL be visible
- **AND** the form SHALL validate these fields on save

#### Scenario: GraviScan mode hides cylinder-specific fields

- **GIVEN** scanner mode is set to `graviscan`
- **WHEN** the Machine Config page renders
- **THEN** Camera IP Address, Frames per Rotation, and Seconds per Rotation fields SHALL NOT be visible
- **AND** the form SHALL NOT validate these fields on save

#### Scenario: Mode change is an admin action

- **GIVEN** the Machine Config page is open
- **WHEN** the admin changes the scanner mode
- **THEN** the mode-specific field sections SHALL update immediately
- **AND** saving SHALL persist the new mode to `~/.bloom/.env` as `SCANNER_MODE=cylinderscan` or `SCANNER_MODE=graviscan`

#### Scenario: Config validation skips irrelevant fields by mode

- **GIVEN** scanner mode is `graviscan`
- **WHEN** config is saved with camera_ip_address empty
- **THEN** validation SHALL pass (camera IP is not required in GraviScan mode)
- **AND** `num_frames` and `seconds_per_rot` SHALL use defaults without validation errors

### Requirement: Per-Scanner grid_mode Persistence

The `graviscan:save-scanners-db` IPC handler SHALL persist the per-scanner `grid_mode` field on both Prisma UPDATE and CREATE operations.

- On UPDATE: the data block SHALL include
  `grid_mode: scanner.grid_mode ?? existing.grid_mode` so that
  payload values overwrite, but absent payload values preserve the
  current DB value (not the schema default).
- On CREATE: the data block SHALL include
  `grid_mode: scanner.grid_mode ?? '4grid'` so new rows accept a
  caller-supplied value but fall back to the schema default when
  unspecified.

Valid `grid_mode` values are `'2grid'` and `'4grid'` (see
`src/types/graviscan.ts`). The handler does not need to validate the
value at this layer — Prisma's `String` column accepts any string and
upstream code paths enforce the enum.

#### Scenario: UPDATE persists payload grid_mode

- **GIVEN** a `GraviScanner` row exists with `grid_mode='4grid'`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  whose entry for that scanner has `grid_mode: '2grid'`
- **THEN** after the call, the row's `grid_mode` SHALL be `'2grid'`
- **AND** `updatedAt` SHALL be advanced (Prisma @updatedAt)

#### Scenario: CREATE accepts payload grid_mode

- **GIVEN** no existing `GraviScanner` row for `usb_port='17-2'`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  whose entry has `usb_port='17-2'` and `grid_mode: '2grid'`
- **THEN** a new row SHALL be created with `grid_mode='2grid'`

#### Scenario: CREATE without grid_mode falls back to schema default

- **GIVEN** no existing `GraviScanner` row for `usb_port='17-1'`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  whose entry has `usb_port='17-1'` and NO `grid_mode` field
- **THEN** a new row SHALL be created with `grid_mode='4grid'`
  (the schema default)

#### Scenario: UPDATE without grid_mode preserves existing DB value

- **GIVEN** a `GraviScanner` row exists with `grid_mode='2grid'`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  whose entry for that scanner OMITS `grid_mode`
- **THEN** the row's `grid_mode` SHALL remain `'2grid'`

---

### Requirement: Stale GraviScanner Rows Are Disabled, Not Deleted

Two IPC handlers in `src/main/graviscan-handlers.ts` SHALL implement a
consistent disable-on-detect policy for stale `GraviScanner` rows:

1. **`graviscan:save-scanners-db`** — after upserting the payload
   rows, the handler SHALL set `enabled = false` on any existing
   `GraviScanner` row whose `usb_port` is NOT in the payload's
   `usb_port` set.
2. **`graviscan:validate-config`** — when validation detects an
   enabled row whose `usb_port` no longer enumerates, the handler
   SHALL `UPDATE enabled = false` rather than the current
   `DELETE` behavior (graviscan-handlers.ts:917-922).

Disabled rows are preserved in the DB so existing `GraviScan` and
`GraviScanPlateAssignment` rows referencing them via `scanner_id`
remain valid (the schema has no ON DELETE CASCADE on those foreign
keys).

If a scanner with a previously-disabled `usb_port` is re-detected, the
existing row SHALL be re-enabled (`enabled = true`) by the upsert path,
not duplicated.

#### Scenario: Stale rows are disabled in save-scanners-db

- **GIVEN** enabled `GraviScanner` rows exist for
  `usb_port` ∈ `{'1-1','1-2','1-3'}`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  covering only `{'1-1','1-2'}`
- **THEN** the rows for `1-1` and `1-2` SHALL be updated normally
- **AND** the row for `1-3` SHALL be updated to `enabled = false`
- **AND** the row for `1-3` SHALL still exist (NOT deleted)

#### Scenario: validate-config disables stale rows instead of deleting

- **GIVEN** enabled `GraviScanner` rows exist for
  `usb_port` ∈ `{'1-1','1-2','1-3'}`
- **AND** USB enumeration detects only `{'1-1','1-2'}`
- **WHEN** `graviscan:validate-config` is invoked
- **THEN** the row for `1-3` SHALL be updated to `enabled = false`
- **AND** the row SHALL NOT be deleted
- **AND** the handler's return value SHALL reflect the validation
  status using the disabled rows correctly

#### Scenario: Disabled rows preserve FK chain to GraviScan

- **GIVEN** a `GraviScan` row references a `GraviScanner.id` via
  `scanner_id`
- **AND** that `GraviScanner` row is subsequently disabled by
  `save-scanners-db` or `validate-config`
- **THEN** the `GraviScan` row SHALL remain in the DB unchanged
- **AND** queries that JOIN the two tables SHALL still succeed
  (the FK reference resolves)

#### Scenario: Re-detection re-enables a previously-disabled row

- **GIVEN** a `GraviScanner` row for `usb_port='1-3'` exists with
  `enabled = false`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  including `{usb_port: '1-3'}`
- **THEN** the existing row SHALL be updated (upserted) with
  `enabled = true`
- **AND** exactly ONE row SHALL exist for `usb_port='1-3'` after the
  operation (verified via `db.graviScanner.count({where: {usb_port:
'1-3'}})`)
- **AND** no new row SHALL be created (no duplicate)

#### Scenario: Disabled rows are excluded from all UI-facing queries

- **GIVEN** the DB contains both enabled and disabled `GraviScanner`
  rows
- **WHEN** any UI-facing query that lists scanners runs (e.g.,
  `graviscan:get-scanner-status`, `graviscan:validate-config`)
- **THEN** the response SHALL include ONLY rows with `enabled = true`
- **AND** code paths that intentionally include disabled rows (e.g.,
  audit/maintenance queries, if any) SHALL be explicitly documented
  with a code comment

---

### Requirement: scan_worker Subprocess Spawn on Scanner Discovery

The `graviscan:save-scanners-db` IPC handler SHALL call `coordinator.addScanner(config)` after the DB upsert phase for every payload entry that:

1. Is `enabled = true` after the upsert, AND
2. Does not already have a ready worker
   (`!coordinator.hasWorker(scannerId)`).

This ensures that newly-created `GraviScanner` rows — and rows that
are re-enabled after being disabled — get a `scan_worker` subprocess
without requiring an app restart.

The handler SHALL NOT spawn workers for rows that ended up
`enabled = false` (stale rows that were just disabled).

#### Scenario: Newly-created scanner gets a worker spawned

- **GIVEN** a `ScanCoordinator` with no worker for scanner_id `X`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  containing a NEW entry whose row ends up with id=`X` and
  `enabled=true`
- **THEN** `coordinator.addScanner(...)` SHALL be called with config
  for `X`
- **AND** after settling, `coordinator.hasWorker('X')` SHALL return
  `true`

#### Scenario: Already-running scanner does not spawn duplicate worker

- **GIVEN** a `ScanCoordinator` already has a ready worker for
  scanner_id `Y`
- **WHEN** `graviscan:save-scanners-db` is invoked with a payload
  including `Y`
- **THEN** `coordinator.addScanner` SHALL NOT spawn a new subprocess
  for `Y` (the existing one is reused)

#### Scenario: Disabled rows are not spawned

- **GIVEN** the payload causes scanner_id `Z` to end up `enabled=false`
  (e.g., it was a stale row being disabled)
- **WHEN** `graviscan:save-scanners-db` completes its upsert phase
- **THEN** `coordinator.addScanner` SHALL NOT be called for `Z`

---

### Requirement: Per-Scanner Disable IPC

The system SHALL provide a new IPC handler
`graviscan:disable-scanner` that takes a `scanner_id` and:

1. Sets `enabled = false` on the matching `GraviScanner` row.
2. Calls `coordinator.stopScanner(scanner_id)` if a worker exists for
   that id.
3. Returns `{ ok: true }` on success or `{ ok: false, error: '...' }`
   on failure (e.g., scanner_id not found).

This IPC backs the per-row Remove button on the Configure Scanner
page (see ui-management-pages capability).

#### Scenario: disable-scanner disables row and stops worker

- **GIVEN** a `GraviScanner` row exists for scanner_id `A` with
  `enabled=true`
- **AND** a ready worker for `A` is in the coordinator subprocess map
- **WHEN** `graviscan:disable-scanner('A')` is invoked
- **THEN** the row SHALL be updated to `enabled = false`
- **AND** `coordinator.stopScanner('A')` SHALL be called
- **AND** after settling, `coordinator.hasWorker('A')` returns `false`
- **AND** the handler SHALL return `{ ok: true }`

#### Scenario: disable-scanner with unknown id returns error

- **GIVEN** no `GraviScanner` row exists for scanner_id `'unknown'`
- **WHEN** `graviscan:disable-scanner('unknown')` is invoked
- **THEN** the handler SHALL return
  `{ ok: false, error: <descriptive message> }`
- **AND** SHALL NOT throw

#### Scenario: disable-scanner is idempotent

- **GIVEN** a `GraviScanner` row for scanner_id `A` is already
  `enabled = false` and has no worker
- **WHEN** `graviscan:disable-scanner('A')` is invoked
- **THEN** the handler SHALL return `{ ok: true }`
- **AND** SHALL NOT throw or attempt to stop a non-existent worker
