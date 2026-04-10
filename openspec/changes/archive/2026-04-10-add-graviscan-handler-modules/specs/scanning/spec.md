## ADDED Requirements

### Requirement: GraviScan Scanner Detection and Configuration

The system SHALL provide scanner detection, configuration persistence, and startup validation as testable functions in `src/main/graviscan/scanner-handlers.ts`, importable without Electron runtime.

#### Scenario: Detect connected USB scanners

- **GIVEN** the GraviScan scanner detection service is available
- **WHEN** `detectScanners(db)` is called
- **THEN** the system SHALL detect Epson Perfection V600 scanners (USB `04b8:013a`) via `detectEpsonScanners()`
- **AND** return an array of `DetectedScanner` objects with USB bus, device, and port information

#### Scenario: Detect scanners in mock mode

- **GIVEN** the environment variable `GRAVISCAN_MOCK` is set to `'true'`
- **WHEN** `detectScanners(db)` is called
- **THEN** the system SHALL return simulated scanner data from database records without requiring USB hardware

#### Scenario: Handle scanner detection failure

- **GIVEN** `detectEpsonScanners()` returns `{ success: false, error: '...' }`
- **WHEN** `detectScanners(db)` is called
- **THEN** the system SHALL return `{ success: false, error: '...' }` with the upstream error message

#### Scenario: Save scanner records to database

- **GIVEN** an array of detected scanners with USB port information
- **WHEN** `saveScannersToDB(db, scanners)` is called
- **THEN** the system SHALL upsert `GraviScanner` records matching by USB port
- **AND** update bus/device numbers for existing scanners whose port matches

#### Scenario: Save scanner configuration

- **GIVEN** a valid `GraviConfigInput` with grid mode and resolution
- **WHEN** `saveConfig(db, config)` is called
- **THEN** the system SHALL persist the configuration to the `GraviConfig` table
- **AND** create or update the singleton config record

#### Scenario: Read scanner configuration when none exists

- **GIVEN** no `GraviConfig` record exists in the database
- **WHEN** `getConfig(db)` is called
- **THEN** the system SHALL return `null`

#### Scenario: Platform info reports correct backend

- **GIVEN** the system is running on a specific platform
- **WHEN** `getPlatformInfo()` is called
- **THEN** the system SHALL return `'sane'` on Linux, `'twain'` on Windows, and `'unsupported'` on macOS
- **AND** report mock mode status from the environment variable

#### Scenario: Validate scanner config against connected hardware

- **GIVEN** saved scanners exist in the database with USB port information
- **WHEN** `validateConfig(db)` is called
- **THEN** the system SHALL detect currently connected scanners
- **AND** categorize each saved scanner as matched, missing, or new
- **AND** return a validation status of `'valid'`, `'mismatch'`, or `'no-config'`

#### Scenario: Validate config with no saved scanners

- **GIVEN** no enabled `GraviScanner` records exist in the database
- **WHEN** `validateConfig(db)` is called
- **THEN** the system SHALL return status `'no-config'` without attempting USB detection

#### Scenario: Run startup scanner validation

- **GIVEN** cached scanner IDs from the renderer
- **WHEN** `runStartupScannerValidation(db, cachedScannerIds)` is called
- **THEN** the system SHALL query `GraviScanner` records from the database
- **AND** compare cached IDs with detected USB devices
- **AND** update module-level `sessionValidation` state with results

#### Scenario: Skip startup validation when no cached scanners

- **GIVEN** an empty array of cached scanner IDs
- **WHEN** `runStartupScannerValidation(db, [])` is called
- **THEN** the system SHALL set `isValidated: false` and `allScannersAvailable: false` without running detection

#### Scenario: Read and reset validation state

- **GIVEN** startup validation has completed
- **WHEN** `getSessionValidationState()` is called
- **THEN** the system SHALL return the current `SessionValidationState`
- **AND** `resetSessionValidation()` SHALL restore validation state to initial defaults

### Requirement: GraviScan Session Lifecycle Management

The system SHALL provide scan session start, status, cancel, and job-recording as testable functions in `src/main/graviscan/session-handlers.ts`, with `ScanCoordinator` and session state functions injected as parameters.

#### Scenario: Start one-shot scan

- **GIVEN** a `ScanCoordinator` instance is provided and no scan is in progress
- **WHEN** `startScan(coordinator, params, sessionFns)` is called without interval parameters
- **THEN** the system SHALL initialize scanner subprocesses via `coordinator.initialize(scannerConfigs)`
- **AND** trigger a one-shot scan via `coordinator.scanOnce()` (fire-and-forget)
- **AND** build and persist scan session state via the injected `setScanSession`

#### Scenario: Start continuous scan

- **GIVEN** a `ScanCoordinator` instance is provided and no scan is in progress
- **WHEN** `startScan(coordinator, params, sessionFns)` is called with interval parameters
- **THEN** the system SHALL initialize subprocesses via `coordinator.initialize(scannerConfigs)`
- **AND** trigger continuous scanning via `coordinator.scanInterval()` (fire-and-forget)
- **AND** calculate total cycles from interval and duration

#### Scenario: Reject scan when already in progress

- **GIVEN** the coordinator reports `isScanning` is true
- **WHEN** `startScan()` is called
- **THEN** the system SHALL return `{ success: false, error: 'Scan already in progress' }`

#### Scenario: Reject scan when coordinator not provided

- **GIVEN** no `ScanCoordinator` instance is available (null/undefined)
- **WHEN** `startScan(null, params, sessionFns)` is called
- **THEN** the system SHALL return `{ success: false, error: 'ScanCoordinator not initialized' }`

#### Scenario: Handle error in fire-and-forget scan

- **GIVEN** a scan has been started and the function has returned `{ success: true }`
- **WHEN** the coordinator's detached promise rejects
- **THEN** the system SHALL call `setScanSession(null)` to clear session state
- **AND** call the injected `onError` callback with the error

#### Scenario: Cancel active scan

- **GIVEN** a scan session is active
- **WHEN** `cancelScan(coordinator, sessionFns)` is called
- **THEN** the system SHALL cancel the scan via `coordinator.cancelAll()`
- **AND** shut down coordinator subprocesses via `coordinator.shutdown()`
- **AND** clear session state via the injected `setScanSession(null)`

#### Scenario: Cancel when no scan is active

- **GIVEN** no scan session is active
- **WHEN** `cancelScan(coordinator, sessionFns)` is called
- **THEN** the system SHALL return gracefully without error

#### Scenario: Get scan status after navigation

- **GIVEN** a scan session was started and the user navigated away
- **WHEN** `getScanStatus(sessionFns)` is called
- **THEN** the system SHALL return the persisted session state including `isActive`, `experimentId`, `jobs`, and progress

#### Scenario: Get scan status when no session exists

- **GIVEN** no scan session is active
- **WHEN** `getScanStatus(sessionFns)` is called
- **THEN** the system SHALL return `{ isActive: false }`

#### Scenario: Mark scan job as recorded

- **GIVEN** an active scan session with completed jobs
- **WHEN** `markJobRecorded(sessionFns, jobKey)` is called with `jobKey` in the format `${scannerId}:${plate_index}`
- **THEN** the system SHALL mark the specified job as DB-recorded in session state using that job key

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

#### Scenario: Upload pending scans to Box backup

- **GIVEN** scans exist with pending upload status
- **WHEN** `uploadAllScans(db, onProgress)` is called
- **THEN** the system SHALL trigger Box backup via `runBoxBackup()`
- **AND** report progress via the injected `onProgress` callback

#### Scenario: Reject concurrent upload

- **GIVEN** an upload is already in progress (module-level `uploadInProgress` guard)
- **WHEN** `uploadAllScans(db, onProgress)` is called
- **THEN** the system SHALL return `{ success: false, errors: ['Upload already in progress'], uploaded: 0, skipped: 0, failed: 0 }`
