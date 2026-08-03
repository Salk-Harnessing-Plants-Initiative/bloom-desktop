## MODIFIED Requirements

### Requirement: Mode-Aware Routing

The app SHALL conditionally render routes based on the configured scanner mode. Capture and config routes are mode-gated. Browse and view routes are always visible regardless of mode. The app SHALL show a loading state until the mode is resolved from the main process.

#### Scenario: CylinderScan capture routes visible in cylinderscan mode

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the app renders routes
- **THEN** `/capture-scan` and `/camera-settings` routes SHALL be available
- **AND** `/graviscan` and `/configure-scanner` routes SHALL NOT be available (`/graviscan` when added in a later increment)

#### Scenario: GraviScan configure-scanner route visible in graviscan mode

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the app renders routes
- **THEN** the `/configure-scanner` route SHALL be available
- **AND** `/capture-scan` and `/camera-settings` routes SHALL NOT be available

#### Scenario: Browse routes always visible

- **GIVEN** any scanner mode (cylinderscan, graviscan, or full)
- **WHEN** the app renders routes
- **THEN** `/browse-scans` and `/scan/:scanId` routes SHALL always be available
- **AND** GraviScan browse routes SHALL also be available when added in later increments

#### Scenario: Loading state while mode resolves

- **GIVEN** the app has just launched
- **WHEN** the `useAppMode()` hook is fetching the mode via IPC
- **THEN** the app SHALL display a loading indicator
- **AND** no routes SHALL be rendered until mode is known
- **AND** no flash of wrong routes SHALL occur

#### Scenario: Unknown route redirects to home

- **GIVEN** any scanner mode
- **WHEN** the user navigates to a route that does not exist or was removed by mode gating
- **THEN** the app SHALL redirect to `/`

#### Scenario: Empty mode (first run) redirects to machine config

- **GIVEN** no config exists or scanner_mode is empty string
- **WHEN** the `useAppMode()` hook resolves with mode `''`
- **THEN** the app SHALL redirect to `/machine-config`
- **AND** no capture or browse routes SHALL be rendered

---

## ADDED Requirements

### Requirement: Configure Scanner Navigation Link

The Layout sidebar SHALL show a "Configure Scanner" navigation link
(pointing to `/configure-scanner`) when, and only when, the configured
scanner mode is `graviscan`. This link is independent of the "Capture
Scan"/"Camera Settings" capture-links group governed by the
Mode-Aware Navigation requirement — Configure Scanner has no
CylinderScan equivalent and is not one of the six named Home-page
workflow steps.

#### Scenario: Configure Scanner nav link visible in graviscan mode

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the Layout sidebar renders
- **THEN** a "Configure Scanner" nav link SHALL be visible
- **AND** it SHALL navigate to `/configure-scanner`

#### Scenario: Configure Scanner nav link hidden in cylinderscan mode

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the Layout sidebar renders
- **THEN** no "Configure Scanner" nav link SHALL be rendered
