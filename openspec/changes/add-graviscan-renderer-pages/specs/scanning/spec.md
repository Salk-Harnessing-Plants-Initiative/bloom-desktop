## ADDED Requirements

### Requirement: GraviScan Data Persistence

The system SHALL create GraviScan, GraviImage, and GraviScanSession database records in the **main process** (not the renderer), triggered by scan coordinator events. This follows the CylinderScan pattern (`scanner-process.ts:saveScanToDatabase()`) and ensures records are created even if the renderer crashes during long-running scans (#195). Read operations and plate assignment CRUD SHALL be exposed via IPC to the renderer.

#### Scenario: Create GraviScan and GraviImage records on grid-complete

- **GIVEN** a grid scan has completed and files have been renamed with `_et_` suffix
- **WHEN** the `grid-complete` event fires in the main process with `renamedFiles`, `scanStartedAt`, `scanEndedAt`, and grid metadata
- **THEN** the main process SHALL create a GraviScan record with experiment_id, phenotyper_id, scanner_id, plate_barcode, transplant_date, custom_note, path (post-rename), grid_mode, plate_index, resolution, format, session_id, cycle_number, wave_number, scan_started_at, and scan_ended_at
- **AND** create a GraviImage record for each renamed file with the post-rename path and status 'pending'
- **AND** use Prisma nested create for atomicity (both records created together or not at all)

#### Scenario: Create GraviScanSession on scan start

- **GIVEN** the user starts a scan (single or continuous)
- **WHEN** `startScan` is called in the main process session handler
- **THEN** a GraviScanSession record SHALL be created with experiment_id, phenotyper_id, scan_mode, interval_seconds, duration_seconds, and total_cycles
- **AND** `started_at` SHALL be set to the current timestamp
- **AND** the session_id SHALL be available for subsequent GraviScan records

#### Scenario: Complete GraviScanSession on scan end

- **GIVEN** a scan session finishes (all cycles complete or cancelled)
- **WHEN** the session completion handler runs in the main process
- **THEN** `completed_at` SHALL be set to the current timestamp
- **AND** `cancelled` SHALL be set to true if the session was cancelled

#### Scenario: Records survive renderer crash

- **GIVEN** a continuous scan is in progress and the renderer crashes or is refreshed
- **WHEN** the scan coordinator completes subsequent cycles in the main process
- **THEN** GraviScan and GraviImage records SHALL still be created for each completed grid
- **AND** the GraviScanSession SHALL be completable when the scan finishes

#### Scenario: Plate assignment CRUD

- **GIVEN** the user is on the Metadata page
- **WHEN** `database.graviscanPlateAssignments.upsertMany` is called with experiment_id, scanner_id, and an array of plate assignments
- **THEN** plate assignments SHALL be created or updated using the `@@unique([experiment_id, scanner_id, plate_index])` constraint
- **AND** the assignments SHALL be retrievable via `database.graviscanPlateAssignments.list`

#### Scenario: Wave number query

- **GIVEN** the user selects an experiment on the Metadata page
- **WHEN** `database.graviscans.getMaxWaveNumber` is called with experiment_id
- **THEN** the system SHALL return the highest wave_number for that experiment (or 0 if none exist)
- **AND** the suggested next wave number SHALL be max + 1

#### Scenario: Barcode uniqueness check per wave

- **GIVEN** the user enters a plate barcode on the Metadata page
- **WHEN** `database.graviscans.checkBarcodeUniqueInWave` is called with experiment_id, wave_number, and plate_barcode
- **THEN** the system SHALL return whether that barcode is already used in that experiment+wave combination

#### Scenario: Plate metadata snapshot immutability

- **GIVEN** a GraviScan record was created with plate_barcode, transplant_date, and custom_note values from the active plate assignments at scan time
- **WHEN** the user later modifies plate assignments for the same experiment/scanner/plate_index
- **THEN** the original GraviScan record SHALL retain the plate_barcode, transplant_date, and custom_note values that were active at scan time
- **AND** the mutable GraviScanPlateAssignment table SHALL NOT retroactively alter completed scan metadata

#### Scenario: DB write failure on grid-complete does not lose scan data

- **GIVEN** a grid scan completes and files are successfully renamed on disk
- **WHEN** the main-process `scan-persistence.ts` fails to create the GraviScan/GraviImage DB records (e.g., Prisma constraint violation, disk full for SQLite WAL)
- **THEN** the error SHALL be logged as a warning with the affected file paths
- **AND** the scan SHALL continue (not abort subsequent grids or cycles)
- **AND** the `metadata.json` file written before the scan (per GraviScan Metadata JSON Writer requirement) SHALL serve as the durable fallback record for the affected grid
- **AND** image files SHALL remain on disk at their post-rename paths

#### Scenario: Double failure escalated beyond warning

- **GIVEN** a grid scan completes and both the metadata.json write (before scan) AND the DB record creation (on grid-complete) fail for the same grid
- **WHEN** `scan-persistence.ts` detects that no metadata.json exists for a grid whose DB write also failed
- **THEN** the error SHALL be escalated to the renderer via an IPC event (not just a log warning)
- **AND** the scanning page SHALL display a prominent alert indicating that scan data for the affected grid has no machine-readable metadata record
- **AND** the scan SHALL continue (not abort), but the user SHALL be informed so they can investigate

### Requirement: GraviScan Scanner Configuration Page

The system SHALL provide a Scanner Configuration page at `/scanner-config` (visible only in GraviScan mode) that allows users to detect connected USB scanners, compare detected scanners against saved DB records, configure grid mode (2grid/4grid) and resolution (DPI), and persist scanner and config records to the database.

#### Scenario: Detect connected scanners

- **GIVEN** the user is in GraviScan mode
- **WHEN** the user navigates to the Scanner Configuration page
- **THEN** the system SHALL call `detectScanners` to enumerate connected USB scanners
- **AND** display each detected scanner with name, USB port, and availability status
- **AND** indicate which scanners are new (not in DB) vs. previously saved

#### Scenario: Save scanner configuration

- **GIVEN** at least one scanner is detected
- **WHEN** the user selects a grid mode and resolution and clicks Save
- **THEN** the system SHALL call `saveConfig` with the selected grid_mode and resolution
- **AND** call `saveScannersToDB` for any newly detected scanners
- **AND** display a success confirmation
- **AND** the saved config SHALL be retrievable via `getConfig` on next page load

#### Scenario: No scanners detected

- **GIVEN** the user is in GraviScan mode
- **WHEN** no USB scanners are connected and the user navigates to Scanner Configuration
- **THEN** the system SHALL display a message indicating no scanners found
- **AND** provide a Re-Detect button to retry detection
- **AND** the Save button SHALL be disabled

#### Scenario: Platform info display

- **GIVEN** the user is in GraviScan mode
- **WHEN** the Scanner Configuration page loads
- **THEN** the system SHALL call `getPlatformInfo` and display whether SANE/TWAIN backend is available and whether mock mode is active

#### Scenario: Scanner detection error or timeout

- **GIVEN** the user clicks Detect or Re-Detect
- **WHEN** scanner detection fails or times out
- **THEN** the system SHALL display a descriptive error message
- **AND** the Re-Detect button SHALL remain available for retry

#### Scenario: Previously saved scanner no longer connected

- **GIVEN** the database contains saved scanner records
- **WHEN** a saved scanner is not found in the current detection results
- **THEN** the system SHALL display that scanner with a "disconnected" or "missing" indicator
- **AND** the user SHALL be able to re-detect to check if it was reconnected

### Requirement: GraviScan Metadata Page

The system SHALL provide a Metadata page at `/metadata` (visible only in GraviScan mode) that allows users to assign per-plate metadata (barcode, transplant date, custom note) for each plate position defined by the current grid configuration, select experiment and phenotyper, and set wave number.

#### Scenario: Plate grid matches config

- **GIVEN** the user has saved a GraviConfig with a grid_mode
- **WHEN** the user navigates to the Metadata page
- **THEN** the system SHALL read the saved GraviConfig to determine grid_mode
- **AND** display plate assignment inputs for each plate position (2 for 2grid, 4 for 4grid) per enabled scanner
- **AND** each plate position SHALL have fields for barcode, transplant date, and custom note

#### Scenario: Save plate assignments

- **GIVEN** at least one plate has metadata assigned
- **WHEN** the user clicks Save on the Metadata page
- **THEN** the system SHALL call `graviscanPlateAssignments.upsertMany` to persist assignments
- **AND** the assignments SHALL be loadable when starting a scan

#### Scenario: Experiment and phenotyper selection

- **GIVEN** the user is on the Metadata page
- **WHEN** the page loads
- **THEN** the system SHALL display dropdowns for experiment and phenotyper selection populated from the database
- **AND** a wave number input field with auto-increment from the max wave for the selected experiment
- **AND** these selections SHALL be available to `startScan` metadata when scanning begins

#### Scenario: No config saved — redirect to Scanner Config

- **GIVEN** no GraviConfig exists in the database
- **WHEN** the user navigates to the Metadata page
- **THEN** the system SHALL display a message indicating scanner configuration is required
- **AND** provide a link to the Scanner Configuration page

#### Scenario: Barcode uniqueness enforcement

- **GIVEN** a plate barcode is already assigned to another plate in the same experiment and wave
- **WHEN** the user enters that barcode in a plate assignment field and the field loses focus
- **THEN** a validation warning SHALL be displayed identifying the conflicting plate
- **AND** the system SHALL call `checkBarcodeUniqueInWave` to verify

### Requirement: GraviScan Scanning Page

The system SHALL provide a scanning page at `/graviscan` (visible only in GraviScan mode) that allows users to start, monitor, and cancel GraviScan sessions (both single and interval scans) with real-time event display.

#### Scenario: Start single scan

- **GIVEN** all readiness conditions are met (validated scanners, valid config, metadata filled)
- **WHEN** the user clicks Start Scan with scan mode set to "single"
- **THEN** the system SHALL call `startScan` with scanner configs, plate assignments, and metadata
- **AND** display real-time scan progress via event listeners (onGridStart, onGridComplete, onCycleComplete)
- **AND** the Start Scan button SHALL be replaced with a Cancel button

#### Scenario: Start interval scan

- **GIVEN** all readiness conditions are met and scan mode is "continuous"
- **WHEN** the user configures interval parameters (interval seconds, duration seconds) and clicks Start
- **THEN** the system SHALL call `startScan` with interval parameters
- **AND** display interval-specific events (onIntervalStart, onIntervalWaiting, onIntervalComplete, onOvertime)
- **AND** show countdown to next scan during waiting periods

#### Scenario: Cancel active scan

- **GIVEN** a scan is currently in progress
- **WHEN** the user clicks Cancel
- **THEN** the system SHALL call `cancelScan`
- **AND** listen for the `onCancelled` event to confirm cancellation
- **AND** re-enable the Start Scan button after cancellation completes
- **AND** the GraviScanSession record SHALL be marked as cancelled with completed_at timestamp

#### Scenario: Scan error handling

- **GIVEN** a scan is in progress
- **WHEN** a scan error occurs (onScanError event)
- **THEN** the system SHALL display the error message with scanner and plate context
- **AND** the error SHALL NOT crash the page
- **AND** the user SHALL be able to cancel the session

#### Scenario: SANE initialization failure after USB validation

- **GIVEN** USB scanner validation has passed (scanners physically present)
- **WHEN** the user clicks Start Scan and `startScan` fails because SANE initialization fails
- **THEN** the system SHALL display a clear error message indicating scanner connection failed
- **AND** re-enable the Start Scan button
- **AND** a "connecting to scanners..." loading state SHALL be visible between button click and scan start

#### Scenario: Rename error surfaced to UI

- **GIVEN** a scan completes but file rename with `_et_` suffix fails
- **WHEN** the `onRenameError` event fires
- **THEN** the system SHALL display a warning about the rename failure
- **AND** the scan image SHALL still be accessible via the pre-rename path

#### Scenario: Navigate away during active scan

- **GIVEN** a scan is in progress (single or continuous)
- **WHEN** the user navigates away from the GraviScan scanning page
- **THEN** the scan SHALL continue running in the main process (coordinator is not cancelled)
- **AND** the `useScanSession` hook shall clean up event listeners on unmount
- **AND** when the user navigates back, `getScanStatus` SHALL restore the current session state

#### Scenario: Cancel during continuous mode waiting phase

- **GIVEN** a continuous scan is in the waiting phase between cycles (countdown active)
- **WHEN** the user clicks Cancel
- **THEN** the system SHALL call `cancelScan`
- **AND** the countdown timer SHALL stop immediately
- **AND** the GraviScanSession SHALL be marked as cancelled with `completed_at` timestamp
- **AND** all previously completed cycles SHALL be preserved in the database

### Requirement: GraviScan Start Scan Readiness Gate

The Start Scan button SHALL be disabled until all readiness conditions are met. This prevents users from starting scans before hardware is initialized (fixes #159).

#### Scenario: Button disabled when scanners not validated

- **GIVEN** the user is on the GraviScan scanning page
- **WHEN** scanner validation has not completed or `sessionValidated` is false
- **THEN** the Start Scan button SHALL be disabled
- **AND** a status message SHALL indicate scanners are not ready

#### Scenario: Button disabled when config incomplete

- **GIVEN** the user is on the GraviScan scanning page
- **WHEN** `validateConfig` returns status other than 'valid'
- **THEN** the Start Scan button SHALL be disabled
- **AND** a message SHALL direct the user to Scanner Configuration

#### Scenario: Button disabled when metadata missing

- **GIVEN** the user is on the GraviScan scanning page
- **WHEN** required metadata fields (experiment, phenotyper) are not selected
- **THEN** the Start Scan button SHALL be disabled

#### Scenario: Button disabled when no plates selected

- **GIVEN** the user is on the GraviScan scanning page
- **WHEN** no plate assignments are selected for any enabled scanner
- **THEN** the Start Scan button SHALL be disabled

#### Scenario: Button enabled when all conditions met

- **GIVEN** scanner validation passes AND config is valid AND required metadata is filled AND at least one plate is selected AND no scan is in progress
- **WHEN** the user views the scanning page
- **THEN** the Start Scan button SHALL be enabled

### Requirement: GraviScan Browse Page

The system SHALL provide a Browse GraviScans page at `/browse-graviscan` that displays GraviScan history with session grouping, grid-based image thumbnails, and cycle/wave metadata. This route SHALL be accessible regardless of the current scanner mode to preserve data access.

#### Scenario: List scans with session grouping

- **GIVEN** GraviScan records exist in the database
- **WHEN** the user navigates to Browse GraviScans
- **THEN** the system SHALL display GraviScan records grouped by session
- **AND** each session SHALL show: experiment name, phenotyper name, date, cycle count, wave number, grid mode
- **AND** sessions SHALL be sorted by date (newest first)

#### Scenario: Display scan thumbnails

- **GIVEN** a scan session has associated GraviImage records
- **WHEN** a scan session is expanded
- **THEN** the system SHALL call `readScanImage` with thumbnail mode (400px, quality 85) for each image
- **AND** display images in a grid layout matching the plate arrangement

#### Scenario: Filter scans

- **GIVEN** the user is on the Browse GraviScans page
- **WHEN** the user applies a filter by experiment, date range, or scanner
- **THEN** the displayed scan list SHALL update to show only matching records
- **AND** filters SHALL be AND-ed when multiple are active

#### Scenario: Empty state

- **GIVEN** no GraviScan records exist in the database
- **WHEN** the user navigates to Browse GraviScans
- **THEN** the system SHALL display a message indicating no scans found
- **AND** provide guidance to start scanning if in GraviScan mode

#### Scenario: Soft-deleted scans filtered out

- **GIVEN** some GraviScan records have `deleted = true`
- **WHEN** the Browse GraviScans page loads
- **THEN** deleted scans SHALL NOT be displayed in the list

#### Scenario: Orphaned images show placeholder

- **GIVEN** a GraviScan record exists but its image file is missing from disk
- **WHEN** `readScanImage` returns `{ success: false, error: 'File not found' }`
- **THEN** the system SHALL display a placeholder icon for the missing image
- **AND** SHALL NOT crash or show a blank space

#### Scenario: Cancelled session indicator

- **GIVEN** a GraviScanSession has `cancelled = true`
- **WHEN** the session is displayed in the browse list
- **THEN** the session SHALL show a cancelled indicator
- **AND** only the completed cycles SHALL be shown

### Requirement: GraviScan Event Listener Cleanup

All GraviScan event listener subscriptions in renderer hooks SHALL return cleanup functions and be properly disposed when components unmount or hook dependencies change, preventing memory leaks.

#### Scenario: Hook cleanup on unmount

- **GIVEN** the `useScanSession` hook has subscribed to scan events (onScanEvent, onGridStart, onGridComplete, onCycleComplete, onIntervalStart, onIntervalWaiting, onIntervalComplete, onOvertime, onCancelled, onScanError, onRenameError, onUploadProgress, onDownloadProgress)
- **WHEN** the component using the hook unmounts
- **THEN** all 13 event listener cleanup functions SHALL be called
- **AND** no events SHALL be processed after unmount

#### Scenario: No duplicate listeners on re-render

- **GIVEN** a component using `useScanSession` re-renders
- **WHEN** useEffect dependencies change
- **THEN** previous listeners SHALL be cleaned up before new ones are registered
- **AND** only ONE set of listeners SHALL be active at any time

#### Scenario: Timer cleanup on unmount

- **GIVEN** the `useContinuousMode` hook has active timers (countdown, elapsed, overtime)
- **WHEN** the component using the hook unmounts
- **THEN** all timers SHALL be cleared via clearInterval/clearTimeout
- **AND** no timer callbacks SHALL fire after unmount

### Requirement: GraviScan Routing and Navigation

The system SHALL register GraviScan-specific routes conditionally based on the app mode, and provide mode-aware navigation links in the sidebar.

#### Scenario: GraviScan routes registered in GraviScan mode

- **GIVEN** `useAppMode()` returns `mode === 'graviscan'`
- **WHEN** the router renders
- **THEN** routes `/scanner-config`, `/metadata`, `/graviscan` SHALL be registered
- **AND** `/browse-graviscan` SHALL be registered regardless of mode

#### Scenario: GraviScan nav links in sidebar

- **GIVEN** the app is in GraviScan mode
- **WHEN** the Layout sidebar renders
- **THEN** the sidebar SHALL show links for Scanner Config, Metadata, Capture Scan (GraviScan), and Browse GraviScans
- **AND** shared links (Home, Scientists, Phenotypers, Experiments, Machine Config) SHALL remain visible

#### Scenario: GraviScan workflow steps updated

- **GIVEN** `useAppMode()` returns `mode === 'graviscan'`
- **WHEN** the Home page renders
- **THEN** the Metadata workflow step SHALL route to `/metadata`
- **AND** the Capture Scan workflow step SHALL route to `/graviscan`
- **AND** the Browse Scans workflow step SHALL route to `/browse-graviscan`

#### Scenario: Browse GraviScans accessible in CylinderScan mode

- **GIVEN** `useAppMode()` returns `mode === 'cylinderscan'`
- **WHEN** the user navigates to `/browse-graviscan`
- **THEN** the page SHALL render and display any existing GraviScan data
- **AND** this preserves data access after a mode switch

### Requirement: GraviScan File Path DB Synchronization

GraviScan and GraviImage database records SHALL be created with the correct post-rename file paths (including `_et_` end timestamp suffix) from the start, because record creation happens in the main process on `grid-complete` events AFTER file renaming is complete. This eliminates the path mismatch described in #154. The `resolveGraviScanPath()` fallback is retained for scans recorded before this fix.

#### Scenario: Records created with post-rename paths

- **GIVEN** a scan completes and files are renamed with `_et_` suffix
- **WHEN** the main-process `scan-persistence.ts` creates GraviScan and GraviImage records on `grid-complete`
- **THEN** the `GraviImage.path` fields SHALL contain the post-rename filenames (with `_et_` suffix)
- **AND** the `GraviScan.path` field SHALL reference the correct output directory
- **AND** `renameErrors` SHALL be filtered by scannerId so that rename failures for one scanner do not prevent record creation for other scanners

#### Scenario: Fallback for pre-fix scans

- **GIVEN** a GraviScan record has a path without `_et_` suffix (created before this fix)
- **WHEN** the system attempts to read the scan image via `readScanImage`
- **THEN** `resolveGraviScanPath()` SHALL search for the renamed file as a fallback
- **AND** a warning SHALL be logged indicating the fallback was used

#### Scenario: Ambiguous fallback match logged

- **GIVEN** a pre-fix GraviScan record's path matches multiple `_et_` variants on disk
- **WHEN** `resolveGraviScanPath()` finds more than one candidate
- **THEN** the function SHALL return null (no guess)
- **AND** a distinct diagnostic warning SHALL be logged identifying the ambiguous files

### Requirement: GraviScan Test Scan Workflow

The system SHALL provide a test scan workflow that allows users to verify scanner alignment and connectivity before committing to a full scan session. Test scans use low resolution and scan a single plate per scanner.

#### Scenario: Initiate test scan

- **GIVEN** at least one scanner is configured and available
- **WHEN** the user clicks "Test Scanners" on the scanning page
- **THEN** the system SHALL start a low-resolution single-plate scan per enabled scanner
- **AND** display phase progress (idle → connecting → scanning → complete)

#### Scenario: Test scan preview images

- **GIVEN** a test scan completes successfully
- **WHEN** the test result is displayed
- **THEN** the system SHALL load a preview image for each scanned plate via `readScanImage`
- **AND** display the preview alongside the scanner name

#### Scenario: Test scan error per scanner

- **GIVEN** a test scan is in progress with multiple scanners
- **WHEN** one scanner fails while others succeed
- **THEN** the system SHALL display the error for the failed scanner
- **AND** show success results for the other scanners
- **AND** NOT abort the entire test

### Requirement: GraviScan Wave Number Tracking

The system SHALL track wave numbers across scan sessions to prevent data overwrite and enable sequential experiment progression.

#### Scenario: Auto-increment wave number

- **GIVEN** the user selects an experiment on the Metadata page
- **WHEN** the page queries `graviscans.getMaxWaveNumber` for that experiment
- **THEN** the suggested wave number SHALL be max_wave + 1
- **AND** the user MAY override the suggested value

#### Scenario: Barcode uniqueness per wave

- **GIVEN** the user enters a plate barcode
- **WHEN** the barcode is already used in a GraviScan record for the same experiment and wave number
- **THEN** a conflict warning SHALL be displayed
- **AND** the warning SHALL identify the conflicting scan

### Requirement: GraviScan Continuous Mode Timing

The system SHALL manage interval timing, countdown display, and overtime detection for continuous (interval) scans, with all timers properly cleaned up on unmount.

#### Scenario: Countdown between cycles

- **GIVEN** a continuous scan is in the waiting phase between cycles
- **WHEN** the `onIntervalWaiting` event fires with `nextScanAt` timestamp
- **THEN** the system SHALL display a countdown timer showing time until next scan
- **AND** update the countdown every second

#### Scenario: Overtime detection

- **GIVEN** a continuous scan cycle takes longer than the configured interval
- **WHEN** the `onOvertime` event fires with elapsed and expected durations
- **THEN** the system SHALL display an overtime warning
- **AND** show how much the scan exceeded the planned interval

#### Scenario: Cycle progress tracking

- **GIVEN** a continuous scan is in progress
- **WHEN** `onCycleComplete` fires
- **THEN** the system SHALL update the current cycle count display
- **AND** the cycle number SHALL be consistent with the GraviScan DB records

### Requirement: GraviScan Metadata CSV Validation

The system SHALL validate metadata CSV files uploaded for GraviScan plate assignments, checking for consistent accessions, valid dates, and unique plant QR codes per plate.

#### Scenario: Valid metadata CSV

- **GIVEN** a CSV file with consistent accession per plate, valid YYYY-MM-DD transplant dates, and unique plant QR codes
- **WHEN** `validateGraviMetadata` is called
- **THEN** the function SHALL return an empty error array

#### Scenario: Inconsistent accession per plate

- **GIVEN** a CSV file where the same plate_id has rows with different accession values
- **WHEN** `validateGraviMetadata` is called
- **THEN** the function SHALL return an error identifying the plate with inconsistent accessions

#### Scenario: Duplicate plant QR per plate

- **GIVEN** a CSV file where the same plant_qr appears multiple times for the same plate_id
- **WHEN** `validateGraviMetadata` is called
- **THEN** the function SHALL return an error identifying the duplicate QR code

#### Scenario: Invalid transplant date format

- **GIVEN** a CSV file with a transplant_date not matching YYYY-MM-DD format
- **WHEN** `validateGraviMetadata` is called
- **THEN** the function SHALL return an error identifying the invalid date

### Requirement: GraviScan Metadata JSON Writer

The system SHALL write a GraviScan-specific `metadata.json` file to the scan output directory BEFORE image capture begins, containing all fields necessary for offline scientific analysis. The writer SHALL follow the same atomic write pattern used by CylinderScan's `scan-metadata-json.ts`.

#### Scenario: GraviScan metadata.json written before scan

- **GIVEN** the user starts a GraviScan (single or continuous)
- **WHEN** the scan coordinator prepares to scan a grid
- **THEN** a `metadata.json` file SHALL be written to the grid's output directory before the Python scan command is sent
- **AND** the file SHALL contain: `metadata_version` (1), `scan_type` ("graviscan"), `experiment_id`, `phenotyper_id`, `scanner_id`, `scanner_name`, `grid_mode`, `resolution_dpi`, `format`, `plate_index`, `plate_barcode`, `transplant_date`, `custom_note`, `wave_number`, `cycle_number`, `session_id`, `scan_started_at`, `capture_date`
- **AND** for interval scans: `interval_seconds`, `duration_seconds`

#### Scenario: GraviScan metadata.json uses atomic write

- **GIVEN** the system is writing a GraviScan metadata.json
- **WHEN** the write is performed
- **THEN** the content SHALL first be written to `metadata.json.tmp`
- **AND** then renamed atomically to `metadata.json`
- **AND** stale `.tmp` files from previous failed writes SHALL be cleaned up

#### Scenario: GraviScan metadata.json write failure does not abort scan

- **GIVEN** the scan output directory is not writable or a write error occurs
- **WHEN** the GraviScan metadata.json write fails
- **THEN** the error SHALL be logged as a warning
- **AND** the scan SHALL proceed with image capture
- **AND** scan metadata SHALL still be saved to the SQLite database via the main-process `scan-persistence.ts` module on `grid-complete`

## MODIFIED Requirements

### Requirement: Scan Metadata JSON File

The system SHALL write a `metadata.json` file to the scan output directory BEFORE image capture begins. The file SHALL contain all scan metadata fields so that scan data is self-describing and portable without requiring the SQLite database. The file SHALL include a `metadata_version` field for forward-compatible schema evolution. For GraviScan mode, the metadata SHALL additionally include scan_type, grid_mode, resolution_dpi, plate_index, plate_barcode, transplant_date, custom_note, scanner_id, scanner_name, session_id, cycle_number, wave_number, scan_started_at, and interval parameters when applicable.

#### Scenario: metadata.json written before image capture

- **GIVEN** the user starts a scan with valid metadata
- **WHEN** the scanner process begins the scan workflow
- **THEN** a `metadata.json` file SHALL be written to the scan output directory
- **AND** the file SHALL be written BEFORE the Python scan command is sent
- **AND** the file SHALL exist on disk before any image files are created

#### Scenario: metadata.json contains all scan metadata fields

- **GIVEN** a scan is started with experiment, phenotyper, plant, and camera metadata
- **WHEN** `metadata.json` is written
- **THEN** the file SHALL contain the following fields: `metadata_version`, `experiment_id`, `phenotyper_id`, `scanner_name`, `plant_id`, `capture_date`, `num_frames`, `exposure_time`, `gain`, `brightness`, `contrast`, `gamma`, `seconds_per_rot`, `wave_number`, `plant_age_days`
- **AND** `brightness` SHALL default to 0 and `contrast` SHALL default to 0 (Basler identity values; these parameters are not supported on the acA2000-50gm)
- **AND** optional fields (`accession_name`, `scan_path`) SHALL be included when provided
- **AND** `metadata_version` SHALL be set to `1` for the current schema

#### Scenario: GraviScan metadata.json includes mode-specific fields

- **GIVEN** a GraviScan is started with grid configuration and plate metadata
- **WHEN** `metadata.json` is written
- **THEN** the file SHALL additionally contain: `scan_type` ("graviscan"), `grid_mode`, `resolution_dpi`, `format`, `plate_index`, `plate_barcode` (if assigned), `transplant_date` (if assigned), `custom_note` (if assigned), `scanner_id`, `scanner_name`, `session_id`, `cycle_number`, `wave_number`, `scan_started_at`
- **AND** for interval scans: `interval_seconds`, `duration_seconds`
- **AND** `metadata_version` SHALL be set to `1`

#### Scenario: ISO 8601 timestamp for capture_date

- **GIVEN** a scan is started
- **WHEN** `metadata.json` is written
- **THEN** the `capture_date` field SHALL be an ISO 8601 formatted string (e.g., `"2026-03-05T14:30:00.000Z"`)

#### Scenario: metadata.json is valid JSON with trailing newline

- **GIVEN** `metadata.json` has been written to a scan directory
- **WHEN** the file is read and parsed with `JSON.parse()`
- **THEN** parsing SHALL succeed without errors
- **AND** the content SHALL be formatted with 2-space indentation for human readability
- **AND** the file SHALL end with a trailing newline character (`\n`) per POSIX convention

#### Scenario: scan_path prefers relative path for portability

- **GIVEN** the scan metadata includes both a relative `scan_path` and an absolute `output_path`
- **WHEN** `metadata.json` is written
- **THEN** `scan_path` SHALL use the relative path from `metadata.scan_path`
- **AND** SHALL fall back to `settings.output_path` only when `metadata.scan_path` is not set
- **AND** consumers SHOULD expect either a relative or absolute path

#### Scenario: num_frames uses top-level setting when available

- **GIVEN** `settings.num_frames` is provided and `settings.daq.num_frames` is also set
- **WHEN** `buildMetadataObject` constructs the metadata
- **THEN** `num_frames` SHALL use the top-level value (which originates from Machine Configuration)
