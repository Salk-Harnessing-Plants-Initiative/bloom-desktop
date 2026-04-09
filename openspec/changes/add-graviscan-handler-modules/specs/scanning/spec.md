## ADDED Requirements

### Requirement: GraviScan Scanner Detection and Configuration

The system SHALL provide scanner detection, configuration persistence, and startup validation as pure service functions in `src/main/graviscan/scanner-handlers.ts`, independent of Electron IPC.

#### Scenario: Detect connected USB scanners

- **GIVEN** the GraviScan scanner detection service is available
- **WHEN** `detectScanners(db)` is called
- **THEN** the system SHALL detect Epson Perfection V600 scanners (USB `04b8:013a`) via `detectEpsonScanners()`
- **AND** return an array of `DetectedScanner` objects with USB bus, device, and port information

#### Scenario: Detect scanners in mock mode

- **GIVEN** the environment variable `GRAVISCAN_MOCK` is set to `'true'`
- **WHEN** `detectScanners(db)` is called
- **THEN** the system SHALL return simulated scanner data without requiring USB hardware

#### Scenario: Save scanner configuration

- **GIVEN** a valid `GraviConfigInput` with grid mode and resolution
- **WHEN** `saveConfig(db, config)` is called
- **THEN** the system SHALL persist the configuration to the `GraviConfig` table
- **AND** create or update the singleton config record

#### Scenario: Validate scanner config against connected hardware

- **GIVEN** saved scanners exist in the database with USB port information
- **WHEN** `validateConfig(db)` is called
- **THEN** the system SHALL detect currently connected scanners
- **AND** categorize each saved scanner as matched, missing, or new
- **AND** return a validation status of `'valid'`, `'mismatch'`, or `'no-config'`

#### Scenario: Platform info reports correct backend

- **GIVEN** the system is running on a specific platform
- **WHEN** `getPlatformInfo()` is called
- **THEN** the system SHALL return `'sane'` on Linux, `'twain'` on Windows, and `'unsupported'` on macOS
- **AND** report mock mode status from the environment variable

### Requirement: GraviScan Session Lifecycle Management

The system SHALL provide scan session start, status, cancel, and job-recording as pure service functions in `src/main/graviscan/session-handlers.ts`, with dependencies injected for testability.

#### Scenario: Start one-shot scan

- **GIVEN** a `ScanCoordinator` instance is provided and no scan is in progress
- **WHEN** `startScan(coordinator, params, sessionFns)` is called without interval parameters
- **THEN** the system SHALL initialize scanner subprocesses via the coordinator
- **AND** trigger a one-shot scan via `coordinator.scanOnce()`
- **AND** build and persist scan session state via the injected `setScanSession`

#### Scenario: Start continuous scan

- **GIVEN** a `ScanCoordinator` instance is provided and no scan is in progress
- **WHEN** `startScan(coordinator, params, sessionFns)` is called with interval parameters
- **THEN** the system SHALL trigger continuous scanning via `coordinator.scanInterval()`
- **AND** calculate total cycles from interval and duration

#### Scenario: Reject scan when already in progress

- **GIVEN** the coordinator reports `isScanning` is true
- **WHEN** `startScan()` is called
- **THEN** the system SHALL return `{ success: false, error: 'Scan already in progress' }`

#### Scenario: Cancel active scan

- **GIVEN** a scan session is active
- **WHEN** `cancelScan(coordinator, sessionFns)` is called
- **THEN** the system SHALL cancel the scan via the coordinator
- **AND** clear session state via the injected `setScanSession(null)`

#### Scenario: Get scan status after navigation

- **GIVEN** a scan session was started and the user navigated away
- **WHEN** `getScanStatus(sessionFns)` is called
- **THEN** the system SHALL return the persisted session state including `isActive`, `experimentId`, `jobs`, and progress

### Requirement: GraviScan Image Operations

The system SHALL provide image reading, export, and cloud backup as pure service functions in `src/main/graviscan/image-handlers.ts`, using callback injection for progress reporting.

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

#### Scenario: Download experiment images with metadata CSV

- **GIVEN** an experiment has GraviScan images across multiple waves
- **WHEN** `downloadImages(db, { experimentId, experimentName, targetDir })` is called
- **THEN** the system SHALL group images by wave number into subdirectories
- **AND** write a `metadata.csv` per wave with experiment, plate, accession, and image columns
- **AND** copy image files with 4-concurrent file copy operations
- **AND** report progress via the injected `onProgress` callback

#### Scenario: Upload pending scans to Box backup

- **GIVEN** scans exist with pending upload status
- **WHEN** `uploadAllScans(db, onProgress)` is called
- **THEN** the system SHALL trigger Box backup via `runBoxBackup()`
- **AND** report progress via the injected `onProgress` callback
- **AND** guard against concurrent uploads
