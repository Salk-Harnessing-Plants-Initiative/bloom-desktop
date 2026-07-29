## MODIFIED Requirements

### Requirement: GraviScan TIFF Metadata Embedding

The system SHALL embed scan provenance metadata into output TIFF images so files are self-describing for downstream analysis.

#### Scenario: TIFF ImageDescription contains scan metadata

- **GIVEN** a scan is performed by the scan worker (real or mock mode)
- **WHEN** the output TIFF image is written
- **THEN** TIFF tag 270 (ImageDescription) SHALL contain JSON with `scanner_id`, `grid_mode`, `plate_index`, `resolution_dpi`, `scan_region_mm`, `exp_name`, `wave_number`, `st_timestamp`, `phenotyper_name`, `capture_timestamp`, and `bloom_version`
- **AND** `exp_name`, `wave_number`, and `phenotyper_name` SHALL default to an empty string / zero when not supplied by the caller (no renderer populates them yet)
- **AND** `st_timestamp` SHALL reflect the actual row-start timestamp used to build the scan's output filename

#### Scenario: TIFF resolution tags match scan DPI

- **GIVEN** a scan is performed at a specific DPI resolution
- **WHEN** the output TIFF image is written
- **THEN** TIFF tags 282 (XResolution) and 283 (YResolution) SHALL match the scan resolution
- **AND** TIFF tag 296 (ResolutionUnit) SHALL be set to inches (2)
