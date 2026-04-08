## ADDED Requirements

### Requirement: Mode-Aware Routing

The app SHALL conditionally render routes based on the configured scanner mode. Capture and config routes are mode-gated. Browse and view routes are always visible regardless of mode. The app SHALL show a loading state until the mode is resolved from the main process.

#### Scenario: CylinderScan capture routes visible in cylinderscan mode

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the app renders routes
- **THEN** `/capture-scan` and `/camera-settings` routes SHALL be available
- **AND** `/graviscan` and `/scanner-config` routes SHALL NOT be available (when added in later increments)

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

### Requirement: Mode-Aware Home Page

The Home page SHALL display a numbered workflow guide specific to the configured scanner mode. Each step is a clickable card that navigates to the relevant page.

#### Scenario: CylinderScan workflow steps

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the Home page renders
- **THEN** the workflow steps SHALL be: Scientists → Phenotypers → Accessions → Experiments → Camera Settings → Capture Scan → Browse Scans
- **AND** each step SHALL be clickable and navigate to the corresponding page

#### Scenario: GraviScan workflow steps

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the Home page renders
- **THEN** the workflow steps SHALL be: Scientists → Phenotypers → Metadata → Experiments → Capture Scan → Browse Scans
- **AND** each step SHALL be clickable and navigate to the corresponding page

#### Scenario: First-run redirect to Machine Config

- **GIVEN** no config file exists (`~/.bloom/.env` missing)
- **WHEN** the Home page mounts
- **THEN** the user SHALL be redirected to `/machine-config`
- **AND** the Machine Config wizard SHALL require scanner mode selection before proceeding

### Requirement: Mode-Aware Navigation

The Layout sidebar navigation SHALL conditionally show capture-related links based on the configured scanner mode. Browse links are always shown.

#### Scenario: CylinderScan nav items

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the Layout sidebar renders
- **THEN** "Capture Scan" and "Camera Settings" nav links SHALL be visible
- **AND** the subtitle SHALL say "CylinderScan" (not hardcoded "Cylinder Scanner")

#### Scenario: GraviScan nav items

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the Layout sidebar renders
- **THEN** "Capture Scan" and "Camera Settings" nav links SHALL be replaced by GraviScan equivalents (when added in later increments)
- **AND** the subtitle SHALL say "GraviScan"

#### Scenario: Layout subtitle reflects configured mode

- **GIVEN** any scanner mode
- **WHEN** the Layout renders
- **THEN** the subtitle under "Bloom Desktop" SHALL display the mode name
- **AND** the footer SHALL continue to show the scanner name from config
