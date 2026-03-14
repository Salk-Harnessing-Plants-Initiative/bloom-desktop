## ADDED Requirements

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

## MODIFIED Requirements

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
