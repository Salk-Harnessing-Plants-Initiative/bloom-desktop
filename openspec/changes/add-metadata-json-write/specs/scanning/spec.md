## ADDED Requirements

### Requirement: Metadata JSON File Write

The Scanner SHALL write a `metadata.json` file to the scan output directory before image capture begins, containing all scan metadata and camera settings in a format compatible with the pilot implementation.

#### Scenario: metadata.json written before image capture

- **GIVEN** the scanner is initialized with metadata and output_path
- **WHEN** the `scan()` method is called
- **THEN** a `metadata.json` file SHALL be written to `output_path` BEFORE the scan command is sent to the Python backend
- **AND** the file SHALL exist on disk before any image files are created

#### Scenario: metadata.json contains all required fields

- **GIVEN** a scan is started with full metadata and camera settings
- **WHEN** `metadata.json` is written
- **THEN** the file SHALL contain these fields: `id`, `phenotyper_id`, `experiment_id`, `scanner_name`, `plant_id`, `accession_name`, `path`, `capture_date`, `wave_number`, `plant_age_days`, `num_frames`, `exposure_time`, `gain`, `brightness`, `contrast`, `gamma`, `seconds_per_rot`
- **AND** `capture_date` SHALL be an ISO 8601 string
- **AND** camera settings SHALL be at the top level (not nested), matching the pilot format

#### Scenario: metadata.json format matches pilot

- **GIVEN** a scan is started
- **WHEN** `metadata.json` is written
- **THEN** the file SHALL be formatted with 2-space JSON indentation
- **AND** the field names SHALL match the pilot's `ScanMetadata` type from `custom.types.ts`

#### Scenario: metadata.json write failure does not block scanning

- **GIVEN** the scanner is initialized with metadata
- **AND** writing `metadata.json` fails (e.g., disk error)
- **WHEN** the `scan()` method is called
- **THEN** the error SHALL be logged
- **AND** scanning SHALL proceed (images are captured normally)
- **AND** the scan SHALL still be saved to the database on completion

### Requirement: Atomic Metadata Write

The `metadata.json` file SHALL be written atomically using a temp-file-then-rename pattern to prevent partial or corrupt files.

#### Scenario: Atomic write via temp file

- **GIVEN** the scanner is writing `metadata.json`
- **WHEN** the write operation executes
- **THEN** content SHALL first be written to a temporary file (`metadata.json.tmp`)
- **AND** the temporary file SHALL be renamed to `metadata.json`
- **AND** if the process crashes during write, no partial `metadata.json` SHALL exist

### Requirement: Scan Output Directory Creation

The Scanner SHALL create the scan output directory (including parent directories) before writing `metadata.json`, if the directory does not already exist.

#### Scenario: Output directory created before metadata write

- **GIVEN** the configured `output_path` does not exist on disk
- **WHEN** the `scan()` method writes `metadata.json`
- **THEN** the output directory SHALL be created recursively
- **AND** `metadata.json` SHALL be written successfully to the new directory
