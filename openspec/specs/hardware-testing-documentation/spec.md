# hardware-testing-documentation Specification

## Purpose

TBD - created by archiving change add-cylinderscan-packaging-ci. Update Purpose after archive.

## Requirements

### Requirement: Undocumented Hardware-Adjacent Features Are Documented

Real, shipped CylinderScan features that affect hardware testing, operation, or data model but have no coverage in the hardware validation docs SHALL be documented, even if added after those docs were first written. This requirement covers documentation completeness only — it does not change or restate the behavior of the underlying features, which are already specified elsewhere (`scanner-api` for scanner identity, `scanning` for idle-session-reset and `experiment_type`).

#### Scenario: Scanner identity service is documented

- **WHEN** a developer looks for documentation of the scanner identity service
- **THEN** a hardware validation doc describes its purpose and the `scanner:get-scanner-id` IPC handler

#### Scenario: Idle-session-reset behavior is documented

- **WHEN** a developer looks for documentation of idle-session-reset behavior
- **THEN** a hardware validation doc describes when and how an idle session resets

#### Scenario: experiment_type field is documented

- **WHEN** a developer reads `docs/CONFIGURATION.md` or `docs/SCANNER_TESTING.md` for the fields that make up scan/experiment configuration
- **THEN** the `experiment_type` field is documented, including its default value

### Requirement: Consolidated Troubleshooting Guide Exists

A single `docs/TROUBLESHOOTING.md` SHALL exist, consolidating troubleshooting guidance for camera, DAQ, and scanner hardware issues that is otherwise scattered across per-component docs.

#### Scenario: Troubleshooting guide is discoverable

- **WHEN** a developer encounters a camera, DAQ, or scanner hardware issue during testing
- **THEN** `docs/TROUBLESHOOTING.md` exists and links to or contains guidance for that component
