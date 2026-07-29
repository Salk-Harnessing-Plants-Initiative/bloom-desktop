## MODIFIED Requirements

### Requirement: GraviScan Image Operations

The system SHALL provide image reading, export, and cloud backup as testable functions in `src/main/graviscan/image-handlers.ts`, using callback injection for progress reporting.

#### Scenario: Read scan image as JPEG thumbnail

- **GIVEN** a TIFF scan image exists on disk
- **WHEN** `readScanImage(filePath)` is called without `full` option
- **THEN** the system SHALL convert the TIFF to JPEG at quality 85
- **AND** resize to 400px width (without enlargement)
- **AND** return a base64 data URI

#### Scenario: Read scan image at full resolution

- **GIVEN** a TIFF scan image exists on disk
- **WHEN** `readScanImage(filePath, { full: true })` is called
- **THEN** the system SHALL convert the TIFF to JPEG at quality 95
- **AND** return the full-resolution image as a base64 data URI

#### Scenario: Handle missing scan image with path fallback

- **GIVEN** the requested file path does not exist
- **WHEN** `readScanImage(filePath)` is called
- **THEN** the system SHALL attempt path resolution via `resolveGraviScanPath()` (extension fallback, `_et_` fallback)
- **AND** return `{ success: false, error: 'File not found' }` if resolution fails

#### Scenario: Get scan output directory

- **GIVEN** the application is running
- **WHEN** `getOutputDir()` is called
- **THEN** the system SHALL compute the output path from `app.getAppPath()` (development) or `app.getPath('home')` (production) based on `NODE_ENV`
- **AND** create the directory if it does not exist
- **AND** return the resolved output directory path

#### Scenario: Get output directory when directory creation fails

- **GIVEN** the computed output path cannot be created (e.g., permissions error)
- **WHEN** `getOutputDir()` is called
- **THEN** the system SHALL return `{ success: false, error: '...' }` with the filesystem error

#### Scenario: Download experiment images with metadata CSV

- **GIVEN** an experiment has GraviScan images across multiple waves
- **WHEN** `downloadImages(db, { experimentId, experimentName, targetDir })` is called with an already-resolved target directory (dialog handling deferred to IPC wiring in Increment 3c)
- **THEN** the system SHALL group images by wave number into subdirectories
- **AND** write a `metadata.csv` per wave with experiment, plate, accession, and image columns
- **AND** copy image files with concurrent file copy operations
- **AND** report progress via the injected `onProgress` callback

#### Scenario: Download with no images found

- **GIVEN** an experiment has no GraviScan images
- **WHEN** `downloadImages(db, params)` is called
- **THEN** the system SHALL return `{ success: true, total: 0, copied: 0, errors: [] }`

#### Scenario: Upload pending scans to Bloom and Box in parallel

- **GIVEN** scans exist with pending upload status
- **WHEN** `uploadAllScans(db, onProgress)` is called
- **THEN** the system SHALL trigger Bloom (Supabase) upload and Box backup (via `runBoxBackup()`) in parallel
- **AND** Bloom upload SHALL upload each scan's session and plate metadata before its images, then upload images with bounded concurrency (4 workers)
- **AND** if either upload target throws, the other SHALL still complete (failures isolated via `Promise.allSettled`, not a single combined `try` that aborts both)
- **AND** the combined result SHALL report success only if both targets succeeded, with merged `uploaded`/`skipped`/`failed` counts and merged `errors`
- **AND** report progress via the injected `onProgress` callback for each target independently

#### Scenario: Reject concurrent upload

- **GIVEN** an upload is already in progress (module-level `uploadInProgress` guard)
- **WHEN** `uploadAllScans(db, onProgress)` is called
- **THEN** the system SHALL return `{ success: false, errors: ['Upload already in progress'], uploaded: 0, skipped: 0, failed: 0 }`
