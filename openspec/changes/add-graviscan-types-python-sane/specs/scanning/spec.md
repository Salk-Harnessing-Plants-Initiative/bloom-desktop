## ADDED Requirements

### Requirement: GraviScan TypeScript Type Definitions

The system SHALL provide TypeScript type definitions for all GraviScan domain entities in `src/types/graviscan.ts`, enabling compile-time safety for GraviScan features across renderer and main processes. These hand-written interfaces represent IPC/UI domain objects (often with relations); Prisma-generated types represent database rows. Both coexist intentionally.

#### Scenario: Scanner detection types available

- **GIVEN** the GraviScan types module is imported
- **WHEN** code references `DetectedScanner`
- **THEN** the interface SHALL include `name`, `scanner_id`, `usb_bus`, `usb_device`, `usb_port`, `is_available`, `vendor_id`, `product_id`, and optional `sane_name`

#### Scenario: GraviScan interface includes timing fields from Prisma schema

- **GIVEN** the GraviScan types module is imported
- **WHEN** code references the `GraviScan` interface
- **THEN** it SHALL include `scan_started_at: Date | null` and `scan_ended_at: Date | null` matching the Prisma `GraviScan` model

#### Scenario: Grid mode and plate index constants

- **GIVEN** the GraviScan types module is imported
- **WHEN** code references `PLATE_INDICES`
- **THEN** `'2grid'` mode SHALL map to `['00', '01']`
- **AND** `'4grid'` mode SHALL map to `['00', '01', '10', '11']`

#### Scenario: Plate assignment helper creates correct defaults for 4-grid

- **GIVEN** the GraviScan types module is imported
- **WHEN** `createPlateAssignments('4grid')` is called
- **THEN** it SHALL return 4 `PlateAssignment` objects with `selected: true` and all barcode/date/note fields null

#### Scenario: Plate assignment helper creates correct defaults for 2-grid

- **GIVEN** the GraviScan types module is imported
- **WHEN** `createPlateAssignments('2grid')` is called
- **THEN** it SHALL return 2 `PlateAssignment` objects with `selected: true` and all barcode/date/note fields null

#### Scenario: Plate label formatting

- **GIVEN** the GraviScan types module is imported
- **WHEN** `getPlateLabel('00')` is called
- **THEN** it SHALL return `'A(00)'`
- **AND** `getPlateLabel('01')` SHALL return `'B(01)'`
- **AND** `getPlateLabel('10')` SHALL return `'C(10)'`
- **AND** `getPlateLabel('11')` SHALL return `'D(11)'`

#### Scenario: Scanner slot generation

- **GIVEN** the GraviScan types module is imported
- **WHEN** `generateScannerSlots(3)` is called
- **THEN** it SHALL return `['Scanner 1', 'Scanner 2', 'Scanner 3']`

#### Scenario: Empty scanner assignment defaults

- **GIVEN** the GraviScan types module is imported
- **WHEN** `createEmptyScannerAssignment(0)` is called
- **THEN** it SHALL return an object with `slot: 'Scanner 1'`, `scannerId: null`, `usbPort: null`, `gridMode: '2grid'`

#### Scenario: GraviScan Prisma model re-exports available

- **GIVEN** the database types module is imported
- **WHEN** code references `GraviScanPlateAssignment`, `GraviPlateAccession`, or `GraviPlateSectionMapping`
- **THEN** the types SHALL resolve to the corresponding Prisma-generated model types

### Requirement: GraviScan Scan Region Geometry

The system SHALL provide scan region geometry for 2-grid and 4-grid plate configurations in `python/graviscan/scan_regions.py`, with coordinates in millimeters calibrated for the Epson Perfection V39 flatbed scanner (USB ID `04b8:013a`, A4 scan bed 215.9mm x 297.0mm). Coordinates are hardcoded constants derived from the original GraviScan calibration (`graviscan.cfg`, not shipped in this repo) and validated against the V39 scan bed dimensions.

#### Scenario: Scan region geometry for 2-grid mode

- **GIVEN** a 2-grid plate configuration
- **WHEN** scan regions are requested via `get_scan_region('2grid', plate_index)`
- **THEN** the system SHALL return `ScanRegion` objects for plate indices `'00'` and `'01'`
- **AND** each region SHALL specify `top`, `left`, `width`, `height` in millimeters
- **AND** each region SHALL be convertible to integer pixel coordinates at any supported DPI via `to_pixels(dpi)`

#### Scenario: Scan region geometry for 4-grid mode

- **GIVEN** a 4-grid plate configuration
- **WHEN** scan regions are requested for all plate indices
- **THEN** the system SHALL return 4 `ScanRegion` objects for indices `'00'`, `'01'`, `'10'`, `'11'`
- **AND** no two regions SHALL overlap (bounding boxes do not intersect)

#### Scenario: All regions fit within scanner bed bounds

- **GIVEN** any grid mode and plate index combination
- **WHEN** a scan region is computed
- **THEN** the region's right edge (`left + width`) SHALL NOT exceed 215.9mm
- **AND** the region's bottom edge (`top + height`) SHALL NOT exceed 297.0mm

#### Scenario: Invalid plate index for grid mode

- **GIVEN** a 2-grid plate configuration
- **WHEN** `get_scan_region('2grid', '10')` is called (index '10' is only valid for 4-grid)
- **THEN** the system SHALL raise a `KeyError` or `ValueError`

### Requirement: GraviScan Scan Worker Protocol

The system SHALL provide a per-scanner subprocess worker in `python/graviscan/scan_worker.py` that communicates via line-delimited JSON on stdin and prefixed events on stdout, supporting both real SANE hardware (Linux) and mock mode (all platforms).

#### Scenario: SANE import guard on unsupported platforms

- **GIVEN** the system is running on macOS or Windows where `libsane` is absent
- **WHEN** the scan worker module is loaded
- **THEN** the SANE import failure SHALL be caught (by targeted `except (ImportError, OSError)` or by the worker's general initialization error handler)
- **AND** the worker SHALL fall back to mock scanning mode
- **AND** no import error SHALL propagate to the caller

#### Scenario: Scan worker ready event

- **GIVEN** a scan worker subprocess is started with `--mock` flag and `--scanner-id <uuid>`
- **WHEN** the worker has initialized successfully
- **THEN** it SHALL emit `EVENT:{"type":"ready","scanner_id":"<uuid>"}` on stdout where `<uuid>` matches the `--scanner-id` argument

#### Scenario: Scan worker accepts scan command

- **GIVEN** a scan worker subprocess is in the ready state
- **WHEN** a `{"action":"scan","plates":[...]}` JSON command is sent on stdin
- **THEN** it SHALL begin scanning and emit `scan-started` events for each plate

#### Scenario: Scan worker handles cancel during active scan

- **GIVEN** a scan worker subprocess is performing a scan
- **WHEN** a `{"action":"cancel"}` message is sent on stdin
- **THEN** the worker SHALL abort the current scan
- **AND** emit a `scan-cancelled` event on stdout
- **AND** return to a state ready to accept new commands

#### Scenario: Scan worker handles quit command

- **GIVEN** a scan worker subprocess is running
- **WHEN** a `{"action":"quit"}` message is sent on stdin
- **THEN** the worker SHALL exit cleanly with exit code 0

#### Scenario: Scan worker handles malformed input gracefully

- **GIVEN** a scan worker subprocess is running
- **WHEN** invalid JSON is received on stdin
- **THEN** the worker SHALL emit an error event on stdout
- **AND** SHALL NOT crash or exit

### Requirement: GraviScan TIFF Metadata Embedding

The system SHALL embed scan provenance metadata into output TIFF images so files are self-describing for downstream analysis.

#### Scenario: TIFF ImageDescription contains scan metadata

- **GIVEN** a scan is performed by the scan worker (real or mock mode)
- **WHEN** the output TIFF image is written
- **THEN** TIFF tag 270 (ImageDescription) SHALL contain JSON with `scanner_id`, `grid_mode`, `plate_index`, `resolution_dpi`, `scan_region_mm`, `capture_timestamp`, and `bloom_version`

#### Scenario: TIFF resolution tags match scan DPI

- **GIVEN** a scan is performed at a specific DPI resolution
- **WHEN** the output TIFF image is written
- **THEN** TIFF tags 282 (XResolution) and 283 (YResolution) SHALL match the scan resolution
- **AND** TIFF tag 296 (ResolutionUnit) SHALL be set to inches (2)

### Requirement: GraviScan PyInstaller Bundling

The system SHALL bundle GraviScan Python modules into the PyInstaller executable alongside existing CylinderScan hardware modules.

#### Scenario: Hidden imports include only existing GraviScan modules

- **GIVEN** the PyInstaller spec file (`python/main.spec`) is used to build the Python executable
- **WHEN** the build completes
- **THEN** `graviscan`, `graviscan.scan_regions`, and `graviscan.scan_worker` modules SHALL be importable at runtime
- **AND** the `sane` module SHALL be included as a hidden import (fails gracefully if unavailable)
- **AND** no references to non-existent modules (e.g., `graviscan.models`, `graviscan.functions`) SHALL be present

### Requirement: GraviScan Python Dependencies

The system SHALL declare GraviScan-specific Python dependencies as optional dependency groups to avoid forcing SANE/TWAIN installation on all platforms.

#### Scenario: Pillow available as core dependency

- **GIVEN** the Python environment is set up via `uv sync`
- **WHEN** the scan worker imports `PIL`
- **THEN** Pillow SHALL be available (declared as core dependency `pillow>=10.0.0`; already a transitive dep via `imageio`, this makes it explicit)

#### Scenario: SANE dependencies optional on Linux

- **GIVEN** the Python environment is on Linux
- **WHEN** GraviScan dependencies are installed via `uv sync --extra graviscan-linux`
- **THEN** `python-sane>=2.9.0` SHALL be installed
- **AND** default `uv sync --extra dev` SHALL NOT attempt to install `python-sane`

#### Scenario: TWAIN dependencies optional on Windows

- **GIVEN** the Python environment is on Windows
- **WHEN** GraviScan dependencies are installed via `uv sync --extra graviscan-windows`
- **THEN** `pytwain>=2.0.0` SHALL be installed
- **AND** default `uv sync --extra dev` SHALL NOT attempt to install `pytwain`

#### Scenario: CI compatibility with all-extras

- **GIVEN** CI runs `uv sync --all-extras --frozen`
- **WHEN** the lockfile includes `python-sane` and `pytwain`
- **THEN** `python-sane` SHALL install successfully on Linux CI runners (requires `libsane-dev` system package)
- **AND** `pytwain` (Windows-only) SHALL be excluded from Linux CI via environment markers or CI configuration to prevent cross-platform install failures
