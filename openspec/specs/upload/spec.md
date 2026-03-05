# upload Specification

## Purpose

TBD - created by archiving change fix-upload-database-registration. Update Purpose after archive.

## Requirements

### Requirement: Upload Creates Database Records

The ImageUploader SHALL create records in the Supabase `image_metadata` table for each uploaded image, in addition to uploading files to Supabase Storage.

#### Scenario: Database records created during upload

- **GIVEN** a scan with N images ready for upload
- **WHEN** `uploadScan()` is called
- **THEN** N records SHALL be created in the `image_metadata` table
- **AND** each record SHALL contain the complete `CylImageMetadata` for that image
- **AND** this matches pilot behavior using `@salk-hpi/bloom-fs` `uploadImages` function

#### Scenario: Metadata includes experiment information

- **GIVEN** a scan associated with an experiment
- **WHEN** `CylImageMetadata` is built for upload
- **THEN** `species` SHALL be set to `experiment.species`
- **AND** `experiment` SHALL be set to `experiment.name`
- **AND** `scientist_name` SHALL be set to `experiment.scientist.name` (or "unknown" if not set)
- **AND** `scientist_email` SHALL be set to `experiment.scientist.email` (or "unknown" if not set)

#### Scenario: Metadata includes phenotyper information

- **GIVEN** a scan with an associated phenotyper
- **WHEN** `CylImageMetadata` is built for upload
- **THEN** `phenotyper_name` SHALL be set to `phenotyper.name` (or "unknown" if not set)
- **AND** `phenotyper_email` SHALL be set to `phenotyper.email` (or "unknown" if not set)

#### Scenario: Metadata includes scan details

- **GIVEN** a scan with capture metadata
- **WHEN** `CylImageMetadata` is built for upload
- **THEN** the following fields SHALL be populated from the scan:
  - `wave_number` from `scan.wave_number`
  - `plant_age_days` from `scan.plant_age_days`
  - `date_scanned` from `scan.capture_date.toISOString()`
  - `device_name` from `scan.scanner_name`
  - `plant_qr_code` from `scan.plant_id`
  - `accession_name` from `scan.accession_id`
  - `num_frames` from `scan.num_frames`

#### Scenario: Metadata includes camera settings

- **GIVEN** a scan with camera configuration
- **WHEN** `CylImageMetadata` is built for upload
- **THEN** the following camera settings SHALL be populated:
  - `exposure_time` from `scan.exposure_time` (default 0)
  - `gain` from `scan.gain` (default 0)
  - `brightness` from `scan.brightness` (default 0)
  - `contrast` from `scan.contrast` (default 0)
  - `gamma` from `scan.gamma` (default 0)
  - `seconds_per_rot` from `scan.seconds_per_rot` (default 0)

#### Scenario: Metadata includes image-specific frame number

- **GIVEN** an image with frame_number N
- **WHEN** `CylImageMetadata` is built for that image
- **THEN** `frame_number` SHALL be set to N
- **AND** this allows correlating database records with physical image files

### Requirement: Upload Uses bloom-fs Package

The ImageUploader SHALL use the `uploadImages` function from `@salk-hpi/bloom-fs` to ensure consistent behavior with other Bloom ecosystem tools.

#### Scenario: Single coordinated upload call

- **GIVEN** a scan with multiple images
- **WHEN** `uploadScan()` is called
- **THEN** a single `uploadImages()` call SHALL handle all images
- **AND** this provides concurrent upload with worker pool management
- **AND** this coordinates both Storage and database operations

#### Scenario: Progress tracking via callbacks

- **GIVEN** an upload in progress
- **WHEN** each image completes (success or failure)
- **THEN** the `result` callback SHALL be invoked with index, metadata, created ID, and error
- **AND** the calling code SHALL update local image status accordingly
