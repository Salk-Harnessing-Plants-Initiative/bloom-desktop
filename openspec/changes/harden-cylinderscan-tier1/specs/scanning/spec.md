## ADDED Requirements

### Requirement: Mode-Aware Python Backend Status

The `PythonStatus` component SHALL only render when the configured scanner mode is `cylinderscan`. In `graviscan` mode, the component SHALL render nothing at all (not a heading with an empty body), since GraviScan does not use the Basler camera or NI-DAQ hardware this status panel describes and this tier adds no GraviScan-relevant content to show in its place.

#### Scenario: Camera/DAQ status shown in cylinderscan mode

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the Home page renders `<PythonStatus mode={mode} />`
- **THEN** the "Python Backend Status" heading and the Camera/DAQ hardware status rows SHALL be visible

#### Scenario: Component renders nothing in graviscan mode

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the Home page renders `<PythonStatus mode={mode} />`
- **THEN** the component SHALL render `null`
- **AND** no "Python Backend Status" heading or Camera/DAQ content SHALL appear anywhere on the Home page
