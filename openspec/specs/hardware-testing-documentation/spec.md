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

### Requirement: GraviScan Linux Packaged-App Deployment Is Documented

The `libusb-filter.so`/`LD_PRELOAD` packaged-app deployment mechanism, the Linux package-format choice, and any systemd/permissions caveats for running the packaged GraviScan app (distinct from the SANE scanner driver, already documented in `docs/GRAVISCAN_SCANNER_DRIVER_SETUP.md`) SHALL be documented. This requirement covers documentation completeness only — it does not change the behavior of the already-shipped mechanism it documents, which is already specified in the `scanning` capability's "LD_PRELOAD USB Filter for Parallel Scanner Isolation" requirement.

#### Scenario: LD_PRELOAD packaged-app wiring is documented

- **WHEN** a developer looks for documentation of how the `libusb-filter.so`/`LD_PRELOAD` mechanism is applied for a packaged (not dev-mode) GraviScan install
- **THEN** `docs/GRAVISCAN_LINUX_DEPLOYMENT.md` describes the real code path (`forge.config.ts`'s Linux-only `extraResource`, `scanner-subprocess.ts`'s packaged-vs-dev path resolution and environment-variable wiring) and the concrete failure mode if the filter isn't applied (SANE's `epkowa` backend claims USB interfaces on every connected Epson scanner during `sane_open()`, breaking parallel multi-scanner operation)

#### Scenario: The deb/rpm/AppImage choice is documented

- **WHEN** a developer looks for documentation of why the packaged app ships as `.deb`
- **THEN** `docs/GRAVISCAN_LINUX_DEPLOYMENT.md` states that the real GraviScan lab machine is Ubuntu/apt-based, that `.rpm` is configured but has no current real-machine consumer, and that an AppImage maker was considered and not added, with a link to this change's design.md for the full rationale

#### Scenario: Packaged-app systemd/permissions caveats are documented

- **WHEN** a developer looks for documentation of systemd or permissions considerations for running the packaged app (not the SANE driver) on a GraviScan lab machine
- **THEN** `docs/GRAVISCAN_LINUX_DEPLOYMENT.md` covers this, including plainly stating that no systemd unit or autostart configuration exists in this repo today if that remains true, rather than describing a hypothetical one

#### Scenario: The new doc is discoverable from existing entry points

- **WHEN** a developer is reading `docs/PACKAGING.md` or `docs/GRAVISCAN_SCANNER_DRIVER_SETUP.md`
- **THEN** each doc's "Related Documentation" section links to `docs/GRAVISCAN_LINUX_DEPLOYMENT.md`
