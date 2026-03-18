## MODIFIED Requirements

### Requirement: Scanner Subprocess Lifecycle

The system SHALL close all readline interfaces associated with a scanner subprocess when the subprocess exits or is shut down, to prevent resource leaks during long-running scan sessions. When recovering from a scan failure, the system SHALL perform a kernel-level USB device reset (via `USBDEVFS_RESET` ioctl on Linux) to flush stale USB bulk transfers before reinitializing the SANE backend, ensuring the reopened device handle does not inherit a corrupted USB pipe.

#### Scenario: Subprocess exits normally

- **WHEN** a scanner subprocess exits (process `exit` event fires)
- **THEN** both the stdout and stderr readline interfaces SHALL be closed
- **AND** no orphaned readline interfaces remain attached to the dead process streams

#### Scenario: Subprocess is shut down via shutdown()

- **WHEN** `shutdown()` is called on a `ScannerSubprocess`
- **THEN** both readline interfaces SHALL be closed before or during process termination

#### Scenario: Subprocess is respawned after failure

- **WHEN** a subprocess is shut down and a new one is spawned for the same scanner
- **THEN** the previous subprocess's readline interfaces SHALL already be closed
- **AND** the new subprocess creates fresh readline interfaces

#### Scenario: USB device reset during scan recovery

- **WHEN** a scan fails and `_reopen_device()` is called
- **AND** the platform is Linux
- **THEN** the system SHALL perform a `USBDEVFS_RESET` ioctl on `/dev/bus/usb/{bus}/{device}` before calling `sane.init()`
- **AND** the bus:device address SHALL remain the same after the reset
- **AND** any stale USB bulk transfers SHALL be flushed

#### Scenario: USB reset fails or non-Linux platform

- **WHEN** a scan fails and `_reopen_device()` is called
- **AND** the USB reset fails (permission denied, device not found) or the platform is not Linux
- **THEN** the failure SHALL be logged as non-fatal
- **AND** the existing SANE-only recovery (exit → sleep → init → open) SHALL proceed unchanged
