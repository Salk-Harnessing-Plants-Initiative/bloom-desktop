## ADDED Requirements

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
