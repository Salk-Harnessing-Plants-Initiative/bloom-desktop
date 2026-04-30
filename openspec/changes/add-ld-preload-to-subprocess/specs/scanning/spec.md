## ADDED Requirements

### Requirement: LD_PRELOAD USB Filter for Parallel Scanner Isolation

The system SHALL set `LD_PRELOAD` and `SANE_USB_FILTER` environment variables when spawning scanner subprocesses on Linux, restricting each process to its assigned USB scanner.

#### Scenario: Parallel scanning with 5 scanners on Linux

- **GIVEN** 5 Epson scanners are connected on Linux
- **WHEN** the coordinator spawns 5 scanner subprocesses
- **THEN** each subprocess SHALL have `LD_PRELOAD` set to the `libusb-filter.so` path
- **AND** each subprocess SHALL have `SANE_USB_FILTER` set to its bus:device (e.g., `001:007`)
- **AND** `sane_open()` in each process SHALL only see its assigned scanner
- **AND** all 5 subprocesses SHALL initialize without USB contention

#### Scenario: Mock mode does not set LD_PRELOAD

- **GIVEN** the app is running in mock mode (`--mock`)
- **WHEN** a scanner subprocess is spawned
- **THEN** `LD_PRELOAD` and `SANE_USB_FILTER` SHALL NOT be set

#### Scenario: Non-Linux platforms skip LD_PRELOAD

- **GIVEN** the app is running on macOS or Windows
- **WHEN** a scanner subprocess is spawned
- **THEN** `LD_PRELOAD` and `SANE_USB_FILTER` SHALL NOT be set
