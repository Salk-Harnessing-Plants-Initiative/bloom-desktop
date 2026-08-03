## ADDED Requirements

### Requirement: Mode-Aware Python Backend Status

The `PythonStatus` component SHALL only display Camera/DAQ hardware status when the configured scanner mode is `cylinderscan`. In `graviscan` mode, Camera/DAQ-specific content SHALL be suppressed, since GraviScan does not use the Basler camera or NI-DAQ hardware this status panel describes.

#### Scenario: Camera/DAQ status shown in cylinderscan mode

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the Home page renders `<PythonStatus mode={mode} />`
- **THEN** the Camera and DAQ hardware status rows SHALL be visible

#### Scenario: Camera/DAQ status suppressed in graviscan mode

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the Home page renders `<PythonStatus mode={mode} />`
- **THEN** the Camera and DAQ hardware status rows SHALL NOT be rendered
