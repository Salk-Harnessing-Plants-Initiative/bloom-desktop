## MODIFIED Requirements

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
- **AND** default `bloom_api_url` SHALL be "https://bloom.salk.edu/api"

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

### Requirement: Machine Configuration vs Camera Settings Separation

Machine Configuration and Camera Settings serve distinct purposes and SHALL NOT duplicate functionality.

#### Scenario: Machine Configuration scope

- **GIVEN** the admin navigates to Machine Configuration
- **WHEN** viewing the configuration form
- **THEN** the following SHALL be configurable: scanner name, camera IP (via auto-detection dropdown or manual entry), scans directory, Bloom API credentials, `num_frames`, `seconds_per_rot`
- **AND** per-session image parameters (exposure, gain, gamma) SHALL NOT be present
- **AND** live preview SHALL NOT be available (use Camera Settings for that)

#### Scenario: Camera Settings scope

- **GIVEN** the user navigates to Camera Settings
- **WHEN** viewing the page
- **THEN** per-session image parameters (exposure, gain, gamma) SHALL be configurable
- **AND** live preview SHALL be available
- **AND** scanner name, scans directory, API credentials, `num_frames`, and `seconds_per_rot` SHALL NOT be present
- **AND** camera IP address selection/auto-detection SHALL NOT be present (configured solely in Machine Configuration; see "Camera Detection in Machine Configuration Hardware Section")

## REMOVED Requirements

### Requirement: Camera Settings Default Integration

**Reason**: `camera_ip_address` is no longer settable from the Camera Settings
page at all (#338) — Machine Configuration is now the sole place to
configure it, including camera auto-detection. A "default that Camera
Settings loads and may temporarily override" no longer applies once Camera
Settings has no camera-selection UI to load a default into.

**Migration**: See the new "Camera Detection in Machine Configuration
Hardware Section" requirement below, which absorbs the auto-detection
capability (dropdown of detected cameras + manual entry fallback) into
Machine Configuration's existing Hardware section, replacing its plain text
input.

## ADDED Requirements

### Requirement: Camera Detection in Machine Configuration Hardware Section

The Machine Configuration page's Hardware section (CylinderScan mode only) SHALL let the admin select `camera_ip_address` from a list of cameras detected on the network, or enter one manually, replacing the previous plain text input.

#### Scenario: Cameras detected on section load

- **GIVEN** the admin opens Machine Configuration in CylinderScan mode
- **WHEN** the Hardware section renders
- **THEN** the system SHALL attempt to detect cameras via the existing
  `camera:detect-cameras` IPC call
- **AND** detected cameras SHALL populate a dropdown, each labeled by
  friendly/model name
- **AND** the mock camera SHALL always appear as a selectable option

#### Scenario: Select a detected camera

- **GIVEN** the dropdown lists one or more detected cameras
- **WHEN** the admin selects one
- **THEN** `camera_ip_address` SHALL be set to that camera's IP address
- **AND** the existing "Test Connection" action SHALL remain available for
  the selected value

#### Scenario: Manual entry fallback

- **GIVEN** the admin selects "Manual Entry..." from the dropdown, or no
  cameras were detected
- **WHEN** the manual entry field is shown
- **THEN** the admin SHALL be able to type an IP address (or "mock")
  directly into `camera_ip_address`
- **AND** saving SHALL persist the manually-entered value exactly as before

#### Scenario: Detection failure does not block manual entry

- **GIVEN** camera detection fails (the `camera:detect-cameras` call rejects
  or resolves with `success: false`) or returns zero cameras
- **WHEN** the Hardware section renders
- **THEN** the manual entry field SHALL be shown as the fallback
- **AND** the admin SHALL still be able to save a manually-entered
  `camera_ip_address`

#### Scenario: Previously-saved camera IP is reflected on load

- **GIVEN** `camera_ip_address` is already saved as a real IP address that is
  not present in the current detected-cameras list (for example, the camera
  is powered off)
- **WHEN** the Hardware section renders
- **THEN** the manual entry field SHALL be shown, pre-filled with the saved
  IP address
- **AND** the saved value SHALL NOT be silently replaced by the mock camera
  or left blank

#### Scenario: Previously-saved camera IP matches a detected camera

- **GIVEN** `camera_ip_address` is already saved and its value matches the IP
  address of a currently-detected camera
- **WHEN** the Hardware section renders
- **THEN** the dropdown SHALL pre-select that camera
- **AND** the selection SHALL NOT fall back to the mock camera default

### Requirement: Restart Required Notice for Scanner Mode Changes

When Machine Configuration is saved and `scanner_mode` changed from its previously-saved value, the page SHALL show a persistent, explicit notice that a restart is required, instead of (or in addition to) the generic save confirmation.

#### Scenario: Scanner mode changed and saved

- **GIVEN** the admin changes Scanner Mode on the Machine Configuration page
- **WHEN** the admin clicks "Save Configuration" and the save succeeds
- **THEN** a persistent, non-auto-dismissing notice SHALL be shown stating
  that the application must be restarted for the mode change to take effect
- **AND** the notice SHALL remain visible until dismissed by the admin (it
  SHALL NOT auto-clear on a timer, unlike the generic save toast)

#### Scenario: Scanner mode unchanged

- **GIVEN** the admin saves Machine Configuration without changing Scanner
  Mode
- **WHEN** the save succeeds
- **THEN** the existing generic "Configuration saved successfully!" toast
  SHALL be shown as before
- **AND** the restart-required notice SHALL NOT appear

### Requirement: Hardware Diagnostics in Machine Configuration

The Machine Configuration page's Hardware section (CylinderScan mode only) SHALL provide "Check Hardware" and "Restart Python" actions, relocated from the Home page, with a confirmation step before restarting.

#### Scenario: Check Hardware from Machine Configuration

- **GIVEN** the admin is on the Machine Configuration page in CylinderScan
  mode
- **WHEN** the admin clicks "Check Hardware"
- **THEN** the system SHALL invoke the existing `python:check-hardware` IPC
  call
- **AND** the resulting camera/DAQ status SHALL be displayed within the
  Hardware section

#### Scenario: Restart Python requires confirmation

- **GIVEN** the admin is on the Machine Configuration page in CylinderScan
  mode
- **WHEN** the admin clicks "Restart Python"
- **THEN** a confirmation dialog SHALL be shown warning that this may
  interrupt an in-progress scan
- **AND** the Python subprocess SHALL only be restarted (via the existing
  `python:restart` IPC call) if the admin confirms
- **AND** declining the confirmation SHALL leave the Python subprocess
  running unaffected

#### Scenario: Diagnostics unavailable outside CylinderScan mode

- **GIVEN** `scanner_mode` is `graviscan`
- **WHEN** the admin views Machine Configuration
- **THEN** the Hardware Diagnostics controls SHALL NOT be shown, consistent
  with the rest of the CylinderScan-only Hardware section
