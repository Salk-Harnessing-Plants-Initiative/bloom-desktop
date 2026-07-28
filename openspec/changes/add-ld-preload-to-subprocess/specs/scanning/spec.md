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

#### Scenario: LIBUSB_ENDPOINT_RECOVERY toggle passed through to the shim

- **GIVEN** the app is running on Linux in real (non-mock) mode
- **WHEN** a scanner subprocess is spawned
- **THEN** the subprocess environment SHALL include `LIBUSB_ENDPOINT_RECOVERY`, defaulting to `"true"` unless the main-process environment explicitly sets `LIBUSB_ENDPOINT_RECOVERY=false` (case-insensitive)
- **AND** this value SHALL control whether the `libusb-filter.so` shim calls `libusb_clear_halt()` to recover a stalled IN endpoint after a `TIMEOUT`/`PIPE` error on `libusb_bulk_transfer()`

Note: this scenario documents `LIBUSB_ENDPOINT_RECOVERY`, added to the implementation after this proposal's original "Why"/"What Changes" sections were written (per issue #228) — the prose above was not updated to match at the time. Reconciled here rather than left as silent spec drift.
