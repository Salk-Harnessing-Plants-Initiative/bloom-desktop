## ADDED Requirements

### Requirement: Reset USB Scanner Connection

The system SHALL provide a "Reset USB" button on the Configure Scanner page that gracefully shuts down all SANE connections, clears stale USB addresses from the database, re-detects scanners via lsusb, and re-initializes subprocesses.

#### Scenario: Reset with all scanners connected

- **GIVEN** scanners are configured and initialized
- **WHEN** the user clicks "Reset USB"
- **THEN** all scanner subprocesses SHALL be gracefully shut down via `coordinator.shutdown()`
- **AND** `usb_bus` and `usb_device` SHALL be set to null on all enabled GraviScanner records
- **AND** `usb_port` SHALL be preserved for stable matching
- **AND** scanners SHALL be re-detected via lsusb with fresh bus/device numbers
- **AND** detected scanners SHALL be matched to DB records by `usb_port`
- **AND** subprocesses SHALL be re-initialized for matched scanners
- **AND** the handler SHALL return per-scanner status (ready or disconnected)

#### Scenario: Reset when a scanner is unplugged

- **GIVEN** 5 scanners were configured but 1 has been physically unplugged
- **WHEN** the user clicks "Reset USB"
- **THEN** the 4 connected scanners SHALL be re-initialized with status "ready"
- **AND** the unplugged scanner SHALL have status "disconnected"

#### Scenario: Reset USB blocked during active scan

- **GIVEN** a scan is in progress
- **WHEN** the user views the Configure Scanner page
- **THEN** the "Reset USB" button SHALL be disabled
