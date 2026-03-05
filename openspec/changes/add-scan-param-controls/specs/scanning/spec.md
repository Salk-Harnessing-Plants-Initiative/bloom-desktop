## ADDED Requirements

### Requirement: Configurable Rotation Speed

The Camera Settings form SHALL provide a `seconds_per_rot` control that allows users to configure the turntable rotation speed, with the value persisted and used when initiating scans.

#### Scenario: Rotation speed control displayed with correct range

- **GIVEN** the user is on the Camera Settings page
- **WHEN** the Camera Settings form is rendered
- **THEN** a "Seconds per Rotation" slider+input control SHALL be displayed
- **AND** the minimum value SHALL be 4
- **AND** the maximum value SHALL be 10
- **AND** the default value SHALL be 7

#### Scenario: Rotation speed used during scan

- **GIVEN** the user has configured `seconds_per_rot` to a value (e.g., 5)
- **AND** the user navigates to the Capture Scan page
- **WHEN** the user starts a scan
- **THEN** the scanner SHALL be initialized with the configured `seconds_per_rot` value
- **AND** the DAQ settings SHALL use the configured value instead of `DEFAULT_DAQ_SETTINGS.seconds_per_rot`

#### Scenario: Rotation speed control respects read-only mode

- **GIVEN** the Camera Settings form is rendered in read-only mode (e.g., on Capture Scan page)
- **WHEN** the form displays the seconds_per_rot control
- **THEN** the slider and input SHALL be disabled

### Requirement: Configurable Frame Count

The Camera Settings form SHALL provide a `num_frames` control that allows users to configure the number of images captured per rotation, with the value persisted and used when initiating scans.

#### Scenario: Frame count control displayed with correct defaults

- **GIVEN** the user is on the Camera Settings page
- **WHEN** the Camera Settings form is rendered
- **THEN** a "Frames per Rotation" slider+input control SHALL be displayed
- **AND** the default value SHALL be 72

#### Scenario: Frame count used during scan instead of hardcoded value

- **GIVEN** the user has configured `num_frames` to a value (e.g., 36)
- **AND** the user navigates to the Capture Scan page
- **WHEN** the user starts a scan
- **THEN** the scanner SHALL be initialized with the configured `num_frames` value
- **AND** the hardcoded value of 72 SHALL NOT be used

#### Scenario: Frame count control respects read-only mode

- **GIVEN** the Camera Settings form is rendered in read-only mode
- **WHEN** the form displays the num_frames control
- **THEN** the slider and input SHALL be disabled

### Requirement: Scan Parameter Defaults

`DEFAULT_CAMERA_SETTINGS` SHALL include default values for `num_frames` and `seconds_per_rot` so that scans work correctly without explicit user configuration.

#### Scenario: Default camera settings include scan parameters

- **GIVEN** no camera settings have been configured by the user
- **WHEN** the system uses `DEFAULT_CAMERA_SETTINGS`
- **THEN** `num_frames` SHALL be 72
- **AND** `seconds_per_rot` SHALL be 7.0
