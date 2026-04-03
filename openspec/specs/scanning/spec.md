# scanning Specification

## Purpose

TBD - created by archiving change fix-scanner-event-listener-leak. Update Purpose after archive.

## Requirements

### Requirement: Scanner Event Listener Lifecycle

Scanner event listeners SHALL be properly cleaned up when component unmounts or dependencies change to prevent memory leaks and duplicate event handling.

#### Scenario: Event listeners return cleanup functions

- **GIVEN** the scanner API is available
- **WHEN** a component registers event listeners using `onProgress`, `onComplete`, or `onError`
- **THEN** each listener registration SHALL return a cleanup function
- **AND** calling the cleanup function SHALL remove the specific listener
- **AND** the cleanup function SHALL follow the same pattern as `camera.onFrame`

#### Scenario: Component cleanup on unmount

- **GIVEN** a component has registered scanner event listeners
- **WHEN** the component unmounts
- **THEN** all registered listeners SHALL be automatically removed
- **AND** no event handlers SHALL fire after unmount
- **AND** no memory leaks SHALL occur

#### Scenario: Component cleanup on dependency change

- **GIVEN** a useEffect has registered scanner event listeners
- **AND** the useEffect has dependencies
- **WHEN** any dependency value changes
- **THEN** all listeners from the previous effect SHALL be removed
- **AND** new listeners SHALL be registered with current dependency values
- **AND** only ONE set of listeners SHALL be active at any time

#### Scenario: Single scan completion event

- **GIVEN** a user starts a scan
- **AND** the user has typed in the Plant QR Code field multiple times
- **WHEN** the scan completes successfully
- **THEN** exactly ONE `onComplete` event SHALL fire
- **AND** exactly ONE scan entry SHALL be added to the recent scans list
- **AND** the scan SHALL appear exactly once in the UI

### Requirement: Interval Cleanup

useEffect hooks that create intervals or timers SHALL clean them up when dependencies change or component unmounts.

#### Scenario: Polling interval cleanup

- **GIVEN** a useEffect creates an interval for polling
- **WHEN** the component unmounts
- **THEN** the interval SHALL be cleared
- **AND** no polling SHALL continue after unmount

#### Scenario: Polling interval cleanup on dependency change

- **GIVEN** a useEffect with an interval and dependencies
- **WHEN** any dependency changes
- **THEN** the previous interval SHALL be cleared
- **AND** a new interval SHALL be created with current dependency values
- **AND** only ONE interval SHALL be active at any time

### Requirement: Numeric Field Input Behavior

Numeric input fields (Wave Number, Plant Age) SHALL allow users to clear the field and type new values directly, matching standard HTML number input behavior.

#### Scenario: User clears Wave Number field to type new value

- **GIVEN** the user is on the Capture Scan page
- **AND** the Wave Number field contains a value (e.g., "5")
- **WHEN** the user selects all text and deletes it
- **THEN** the field SHALL become empty (not reset to 0)
- **AND** the user SHALL be able to type a new value directly
- **AND** a validation error SHALL appear indicating the field is required

#### Scenario: User clears Plant Age field to type new value

- **GIVEN** the user is on the Capture Scan page
- **AND** the Plant Age field contains a value (e.g., "14")
- **WHEN** the user selects all text and deletes it
- **THEN** the field SHALL become empty (not reset to 0)
- **AND** the user SHALL be able to type a new value directly
- **AND** a validation error SHALL appear indicating the field is required

### Requirement: Numeric Field Integer Validation

Wave Number and Plant Age fields SHALL only accept non-negative integers (whole numbers including 0). Non-integer values SHALL display a validation error to inform the user. Leading zeros SHALL be accepted and parsed to their numeric value (e.g., "01" → 1).

#### Scenario: Decimal values show validation error

- **GIVEN** the user is on the Capture Scan page
- **WHEN** the user enters a decimal value (e.g., "1.5") in Wave Number
- **THEN** a validation error SHALL appear: "Wave number must be a whole number"
- **AND** the Start Scan button SHALL be disabled

#### Scenario: Decimal Plant Age shows validation error

- **GIVEN** the user is on the Capture Scan page
- **WHEN** the user enters a decimal value (e.g., "14.5") in Plant Age
- **THEN** a validation error SHALL appear: "Plant age must be a whole number"
- **AND** the Start Scan button SHALL be disabled

#### Scenario: Integer values are accepted

- **GIVEN** the user is on the Capture Scan page
- **WHEN** the user enters a whole number (e.g., "0", "1", "14") in Wave Number or Plant Age
- **THEN** the value SHALL be accepted without error

#### Scenario: Leading zeros are accepted

- **GIVEN** the user is on the Capture Scan page
- **WHEN** the user enters a value with leading zeros (e.g., "01", "007") in Wave Number or Plant Age
- **THEN** the value SHALL be accepted without error
- **AND** the parsed value SHALL be the numeric equivalent (e.g., "01" → 1, "007" → 7)

### Requirement: Wave Number Zero Validation

Wave Number SHALL accept 0 as a valid value, matching the pilot application behavior.

#### Scenario: Wave Number of 0 is valid

- **GIVEN** the user is on the Capture Scan page
- **AND** all other required fields are filled correctly
- **WHEN** the user enters "0" in the Wave Number field
- **THEN** no validation error SHALL appear for Wave Number
- **AND** the Start Scan button SHALL be enabled (assuming other requirements met)

#### Scenario: Wave Number of negative value is invalid

- **GIVEN** the user is on the Capture Scan page
- **WHEN** the user enters a negative number in the Wave Number field
- **THEN** a validation error SHALL appear: "Wave number must be 0 or greater"
- **AND** the Start Scan button SHALL be disabled

#### Scenario: Empty Wave Number is invalid

- **GIVEN** the user is on the Capture Scan page
- **WHEN** the Wave Number field is empty
- **THEN** a validation error SHALL appear indicating Wave Number is required
- **AND** the Start Scan button SHALL be disabled

### Requirement: Scanner Image Persistence

The Scanner SHALL save captured frames to disk during the scanning workflow, creating the output directory if needed and naming files with 3-digit zero-padded frame numbers matching the pilot implementation.

#### Scenario: Output directory created automatically

- **GIVEN** the scanner is initialized with `output_path` set to a non-existent directory
- **WHEN** `perform_scan()` is called
- **THEN** the output directory SHALL be created before capturing begins
- **AND** parent directories SHALL be created recursively if needed

#### Scenario: Images saved as PNG files with pilot-compatible naming

- **GIVEN** the scanner is capturing frames during `perform_scan()`
- **WHEN** a frame is successfully captured via `grab_frame()`
- **THEN** the frame SHALL be saved as a PNG file in the output directory
- **AND** the filename SHALL follow the pattern `NNN.png` where NNN is 3-digit zero-padded frame number (1-indexed)
- **AND** this matches pilot format: `pylon.py:62` uses `f'{i + 1:03d}.png'`

#### Scenario: All captured frames persisted

- **GIVEN** a scan with `num_frames` configured via Machine Configuration (default 72)
- **WHEN** `perform_scan()` completes successfully
- **THEN** the configured number of PNG files SHALL exist in the output directory
- **AND** files SHALL be named `001.png` through `{num_frames:03d}.png`
- **AND** each file SHALL contain the image data from the corresponding frame capture

#### Scenario: Frame count matches file count

- **GIVEN** `perform_scan()` returns `ScanResult` with `frames_captured = N`
- **THEN** exactly N image files SHALL exist in `output_path`
- **AND** database Image records created by `scanner-process.ts` SHALL reference these files

### Requirement: Cross-Platform Path Handling

The Scanner SHALL use `pathlib.Path` with `.as_posix()` for all file path operations to ensure consistent behavior across Windows, macOS, and Linux.

#### Scenario: File paths use POSIX format

- **GIVEN** the scanner is saving images on any operating system
- **WHEN** file paths are constructed for image saving
- **THEN** paths SHALL be created using `pathlib.Path`
- **AND** paths SHALL be converted using `.as_posix()` for file I/O operations
- **AND** this ensures forward slashes are used consistently across platforms

#### Scenario: Image files are readable after saving

- **GIVEN** an image has been saved using `.as_posix()` path
- **WHEN** the image file is read back
- **THEN** the file SHALL be readable via `imageio`
- **AND** the image data SHALL match the original captured frame

### Requirement: Scanner-Process Frame Number Extraction

The scanner-process.ts SHALL extract frame numbers from filenames using the pilot-compatible format and use them directly as 1-indexed database values.

#### Scenario: Frame number extracted from 3-digit filename

- **GIVEN** an image file named `001.png`
- **WHEN** scanner-process.ts parses the filename
- **THEN** frame_number SHALL be set to 1 (extracted directly, no conversion needed)
- **AND** this matches pilot database convention (1-indexed frame numbers)

### Requirement: Scan Directory Path Format

The system SHALL generate scan output directories following the pilot-compatible format `YYYY-MM-DD/<plant_qr_code>/<scan_uuid>/` relative to the configured `scans_dir`. The date SHALL use the local timezone, the plant QR code SHALL be sanitized for filesystem safety, and the scan UUID SHALL be a newly generated `crypto.randomUUID()` for each scan.

#### Scenario: Standard scan directory creation

- **GIVEN** the user starts a scan with plant QR code "PLANT-001"
- **AND** the local date is "2026-03-04"
- **AND** a scan UUID "abc-123-def" is generated via `crypto.randomUUID()`
- **WHEN** the scan output directory is created
- **THEN** the directory path SHALL be `<scans_dir>/2026-03-04/PLANT-001/abc-123-def/`
- **AND** the `Scan.path` database field SHALL store the relative path `2026-03-04/PLANT-001/abc-123-def`
- **AND** each `Image.path` SHALL store the relative path `2026-03-04/PLANT-001/abc-123-def/NNN.png`

#### Scenario: Plant QR code with special characters is sanitized

- **GIVEN** the user starts a scan with plant QR code "PLANT/001..bad"
- **WHEN** the scan output directory path is built
- **THEN** the plant QR code segment SHALL be sanitized to a filesystem-safe string
- **AND** path traversal sequences SHALL be removed
- **AND** only alphanumeric characters, hyphens, underscores, and periods SHALL be retained

#### Scenario: Date uses local timezone

- **GIVEN** the user starts a scan at 11:30 PM local time on March 4th
- **AND** the UTC date has already rolled over to March 5th
- **WHEN** the date segment of the scan path is generated
- **THEN** the date SHALL be "2026-03-04" (local date, not UTC)

#### Scenario: Scan path stored as relative path

- **GIVEN** a scan completes successfully
- **WHEN** the scan record is created in the database
- **THEN** `Scan.path` SHALL contain the relative path (e.g., `2026-03-04/PLANT-001/abc-123-def`)
- **AND** `Image.path` SHALL contain the relative path (e.g., `2026-03-04/PLANT-001/abc-123-def/001.png`)
- **AND** neither path SHALL include the `scans_dir` prefix
- **AND** the full absolute path SHALL be reconstructable by joining `scans_dir` with the stored path

#### Scenario: Scan UUID is unique per scan

- **GIVEN** two scans of the same plant on the same date
- **WHEN** each scan generates its directory path
- **THEN** each scan SHALL have a unique UUID directory name
- **AND** the two scan directories SHALL not conflict

#### Scenario: Backward-compatible absolute path detection on all platforms

- **GIVEN** existing scans may have absolute paths stored in `Scan.path` or `Image.path`
- **AND** the application runs on macOS, Linux, or Windows
- **WHEN** a consumer (ScanPreview, image-uploader) resolves an image path
- **THEN** the system SHALL detect Unix absolute paths (starting with `/`)
- **AND** the system SHALL detect Windows absolute paths (starting with a drive letter like `C:\` or `D:/`)
- **AND** absolute paths SHALL be used as-is without prepending `scans_dir`
- **AND** relative paths SHALL have `scans_dir` prepended to construct the full path

### Requirement: Scan Metadata JSON File

The system SHALL write a `metadata.json` file to the scan output directory BEFORE image capture begins. The file SHALL contain all scan metadata fields so that scan data is self-describing and portable without requiring the SQLite database. The file SHALL include a `metadata_version` field for forward-compatible schema evolution.

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

### Requirement: Atomic Metadata File Write

The system SHALL use an atomic write pattern for `metadata.json` to prevent partial or corrupt files in case of interruption. Stale temporary files from previous failed writes SHALL be cleaned up.

#### Scenario: Write to temporary file then rename

- **GIVEN** the system is writing `metadata.json` to a scan directory
- **WHEN** the write operation is performed
- **THEN** the content SHALL first be written to a temporary file (`metadata.json.tmp`)
- **AND** the temporary file SHALL then be renamed to `metadata.json`
- **AND** the rename operation SHALL be atomic on the filesystem

#### Scenario: No temporary file remains after successful write

- **GIVEN** `metadata.json` has been successfully written
- **WHEN** the scan directory is inspected
- **THEN** only `metadata.json` SHALL exist (no `metadata.json.tmp`)

#### Scenario: Stale temporary file cleaned up before write

- **GIVEN** a stale `metadata.json.tmp` file exists from a previous failed write
- **WHEN** a new `metadata.json` write is initiated
- **THEN** the stale `.tmp` file SHALL be removed before the new write begins
- **AND** the new `metadata.json` SHALL be written successfully

### Requirement: Metadata Write Error Handling

The system SHALL handle `metadata.json` write failures gracefully without aborting the scan. Image capture is the primary operation and MUST NOT be blocked by metadata file write errors.

#### Scenario: Scan continues if metadata write fails

- **GIVEN** the scan output directory is not writable or a write error occurs
- **WHEN** `metadata.json` write fails
- **THEN** the error SHALL be logged as a warning
- **AND** the scan SHALL proceed with image capture
- **AND** scan metadata SHALL still be saved to the SQLite database

### Requirement: Scan Directory Creation Before Metadata Write

The system SHALL ensure the scan output directory exists before writing `metadata.json`. If the directory does not exist, it SHALL be created recursively.

#### Scenario: Directory created before metadata write

- **GIVEN** the scan output directory does not yet exist
- **WHEN** the system prepares to write `metadata.json`
- **THEN** the directory SHALL be created recursively (equivalent to `mkdir -p`)
- **AND** `metadata.json` SHALL then be written to the newly created directory

### Requirement: Idle Session Timeout

The system SHALL implement an idle timer in the main process that resets session state after a configurable period of inactivity to prevent scan misattribution in shared lab environments.

#### Scenario: Session resets after 10 minutes of inactivity

- **GIVEN** a phenotyper has selected their identity and experiment
- **AND** no scanning activity occurs for 10 minutes
- **WHEN** the idle timeout expires
- **THEN** the session state SHALL be reset (phenotyperId, experimentId, waveNumber, plantAgeDays, accessionName set to null)
- **AND** the renderer SHALL be notified via a `session:idle-reset` event

#### Scenario: Timer resets on session changes

- **GIVEN** the idle timer is running
- **AND** at least one session field is non-null
- **WHEN** the user changes phenotyper or experiment selection (triggering `session:set`)
- **THEN** the idle timer SHALL restart from zero

#### Scenario: Timer does not reset on session:set when no session data exists

- **GIVEN** the idle timer is running
- **AND** no session data has been set (all fields are null)
- **WHEN** `session:set` is called with a partial update
- **THEN** the idle timer SHALL NOT be reset

#### Scenario: Timer resets on scanner initialization

- **GIVEN** the idle timer is running
- **WHEN** the scanner is initialized (triggering `scanner:initialize`)
- **THEN** the idle timer SHALL restart from zero

#### Scenario: Timer does not fire during active scan

- **GIVEN** the idle timer is running
- **AND** a scan is in progress (`scanner:scan` has been called)
- **WHEN** the configured timeout elapses
- **THEN** the idle timer SHALL NOT fire
- **AND** the timer SHALL resume only after the scan completes or errors

#### Scenario: Timer does not reset on non-activity events

- **GIVEN** the idle timer is running
- **WHEN** IPC events other than `session:set`, `scanner:initialize`, or `scanner:scan` are received (e.g., `scanner:status`, `camera:get-status`, page navigation)
- **THEN** the idle timer SHALL NOT restart
- **AND** the timer SHALL continue counting down from its current position

#### Scenario: Idle timeout is a no-op when no session is active

- **GIVEN** no phenotyper or experiment has been selected (all session fields are null)
- **WHEN** the idle timeout expires
- **THEN** `resetSessionState()` SHALL NOT be called
- **AND** no `session:idle-reset` event SHALL be sent to the renderer

#### Scenario: Idle callback fires exactly once per timeout cycle

- **GIVEN** the idle timer has been started
- **WHEN** the timeout elapses
- **THEN** the `onIdle` callback SHALL fire exactly once
- **AND** SHALL NOT fire again unless the timer is explicitly restarted via `start()` or `resetTimer()`

### Requirement: Configurable Idle Timeout Duration

The idle timeout duration SHALL be configurable programmatically (e.g., for unit tests) with a default value of 10 minutes (600,000 milliseconds). The timeout is not configurable at runtime via environment variables or user settings.

#### Scenario: Default timeout is 10 minutes

- **GIVEN** no custom timeout is configured
- **WHEN** the idle timer is created
- **THEN** the timeout SHALL default to 600,000 milliseconds (10 minutes)

#### Scenario: Custom timeout value is respected

- **GIVEN** a positive finite `timeoutMs` value is passed to the constructor
- **WHEN** the idle timer is created with the custom value
- **THEN** the timer SHALL use the configured duration instead of the default

#### Scenario: Invalid timeout value is rejected

- **GIVEN** a non-positive, non-finite, or NaN `timeoutMs` value is passed
- **WHEN** the idle timer constructor is called
- **THEN** the constructor SHALL throw a `RangeError`

### Requirement: Idle Reset User Notification

The system SHALL visibly notify the user when a session is reset due to inactivity so they understand why their selections were cleared.

#### Scenario: User sees notification after idle reset

- **GIVEN** the idle timeout has expired
- **WHEN** the session state is reset
- **THEN** the renderer SHALL display a visible notification to the user
- **AND** the notification SHALL indicate the reset was due to inactivity
- **AND** the phenotyper and experiment dropdowns SHALL show their empty/placeholder state

#### Scenario: Notification is dismissed when next scan starts

- **GIVEN** the idle reset notification banner is visible
- **WHEN** the user fills all required fields and starts a new scan
- **THEN** the notification banner SHALL no longer be visible
- **AND** the scan SHALL proceed normally

#### Scenario: Idle reset does not affect UI during an active scan

- **GIVEN** a scan is actively in progress in the renderer (`isScanning` is true)
- **WHEN** a `session:idle-reset` IPC event is received
- **THEN** the renderer SHALL NOT clear metadata state
- **AND** the idle reset notification banner SHALL NOT be shown

#### Scenario: Notification enumerates all cleared fields and the timeout duration

Scientists need to know both what was cleared and why, so they can plan workflows around the threshold
(e.g., pausing between scans for sample preparation).

- **GIVEN** the idle timeout has expired and the session state has been reset
- **WHEN** the renderer shows the notification banner
- **THEN** the notification text SHALL reference all cleared fields: phenotyper, experiment, wave number, plant age, accession name, and plant QR code
- **AND** the notification text SHALL state the idle timeout duration (10 minutes)

#### Scenario: Banner shown on CaptureScan mount after navigation-away idle reset

- **GIVEN** an idle reset occurred while the user was navigated away from CaptureScan
- **WHEN** the user navigates back to CaptureScan (component mounts)
- **THEN** the idle reset notification banner SHALL be displayed
- **AND** the form fields SHALL be in their empty/placeholder state

#### Scenario: On-mount idle reset detection clears form fields

The `onIdleReset` IPC handler clears metadata fields and shows the banner. The on-mount
`checkIdleReset()` path must produce identical UI state so both code paths are consistent,
regardless of whether the user was on CaptureScan when the idle reset fired.

- **GIVEN** `window.electron.session.checkIdleReset` resolves `true` on mount (idle reset flag was set)
- **WHEN** CaptureScan mounts and the `checkIdleReset()` promise resolves
- **THEN** the component SHALL clear all metadata form fields (phenotyper, experiment, wave number, plant age, plant QR code, accession name) to empty
- **AND** SHALL show the idle reset notification banner

#### Scenario: Explicit session reset clears the idle-reset notification flag

When the user explicitly resets the session, any pending idle-reset notification flag from a prior
idle reset (that fired while the user was navigated away) is no longer meaningful and must be cleared
so CaptureScan does not show a stale banner on the next mount.

- **GIVEN** an idle reset has occurred while the user was navigated away (`wasIdleResetFlag` is set)
- **AND** the `onIdleReset` IPC listener never fired because CaptureScan was unmounted
- **WHEN** the user explicitly triggers a `session:reset` IPC call
- **THEN** `consumeIdleResetFlag()` SHALL return `false` on the next call
- **AND** a subsequent mount of CaptureScan SHALL NOT show the idle reset banner

#### Scenario: isScanningRef set to true synchronously on scan start

The `onIdleReset` IPC listener is registered once with empty deps and reads `isScanningRef.current`
to guard against clearing metadata during an active scan. Because the main process calls
`pauseForScan()` before a scan starts, this guard is defense-in-depth against in-flight IPC
messages queued before the pause. Setting the ref synchronously before any `await` in
`handleStartScan` closes the window between `setIsScanning(true)` (which schedules a React state
update) and the `useEffect([isScanning])` flush that mirrors it into the ref.

- **GIVEN** CaptureScan has an `onIdleReset` listener registered with empty-dependency `useEffect`
- **AND** the listener reads `isScanningRef.current` to guard against clearing metadata during a scan
- **WHEN** `handleStartScan` is called
- **THEN** `isScanningRef.current` SHALL be set to `true` synchronously as the first statement of `handleStartScan` (before any `await`)

#### Scenario: isScanningRef reset to false synchronously on all scan-exit paths

By the same synchronous discipline applied at scan start, `isScanningRef.current` must be reset to
`false` synchronously on every code path that exits a scan. This closes the window between the
`setIsScanning(false)` call (which only schedules a React state update) and the
`useEffect([isScanning])` flush — preventing the double-click guard from blocking retries and
ensuring idle reset IPC messages are not suppressed during error recovery or after scan completion.

- **GIVEN** `isScanningRef.current` has been set to `true` at the start of `handleStartScan`
- **WHEN** `handleStartScan` exits via the `catch` block (scan initialization error)
- **THEN** `isScanningRef.current` SHALL be reset to `false` synchronously as the first statement of the `catch` block
- **AND** `isScanningRef.current` SHALL be reset to `false` synchronously as the first statement of the `handleComplete` scan-complete event callback
- **AND** `isScanningRef.current` SHALL be reset to `false` synchronously as the first statement of the `handleError` scan-error event callback

#### Scenario: Mount-time checkIdleReset call does not setState after component unmounts

- **GIVEN** CaptureScan mounts and immediately issues a `checkIdleReset()` IPC call
- **AND** the component unmounts before `checkIdleReset()` resolves (e.g., rapid navigation)
- **WHEN** the `checkIdleReset()` promise resolves with any value
- **THEN** `setShowIdleResetBanner` SHALL NOT be called
- **AND** no setState-on-unmounted-component side-effect SHALL occur

### Requirement: Streaming Frame Encoding

The camera streaming pipeline SHALL encode preview frames as JPEG (quality 85) with `data:image/jpeg;base64,...` data URIs. This applies to both mock and real camera implementations via `grab_frame_base64()`. The single-frame `capture` action SHALL remain PNG to preserve lossless quality for diagnostic use. Scan capture (disk-saved images via `grab_frames()` + `iio.imwrite()`) SHALL remain unaffected and continue using lossless formats.

JPEG quality 85 is adequate for exposure/gain tuning: it introduces ~0.8% quantization error (+/-2 intensity levels on 8-bit grayscale), well below the threshold where a scientist would choose a materially different exposure setting. Highlight/shadow clipping remains clearly visible.

#### Scenario: Mock camera streams JPEG frames

- **GIVEN** the mock camera is configured and streaming is started
- **WHEN** `grab_frame_base64()` is called
- **THEN** the returned data URI SHALL start with `data:image/jpeg;base64,`
- **AND** the decoded image SHALL be valid JPEG
- **AND** the base64 payload size SHALL be less than 500 KB

#### Scenario: Real camera encodes streaming frames as JPEG

- **GIVEN** a 2048×1080 grayscale numpy array from a Basler camera
- **WHEN** `Camera._img_to_base64()` encodes the frame
- **THEN** the output SHALL be JPEG-encoded at quality 85
- **AND** the decoded image SHALL be valid JPEG with mode "L" (grayscale)

#### Scenario: Grayscale image preserved through JPEG encoding

- **GIVEN** a grayscale (mode "L") numpy array
- **WHEN** encoded to JPEG via `_img_to_base64()` and decoded back
- **THEN** the decoded image SHALL have mode "L" (single channel grayscale)
- **AND** the decoded image dimensions SHALL match the input

#### Scenario: Single-frame capture remains PNG

- **GIVEN** the camera is configured
- **WHEN** a single-frame capture is requested via the `capture` IPC command
- **THEN** the returned data URI SHALL start with `data:image/png;base64,`
- **AND** the lossless PNG contract SHALL be preserved

#### Scenario: Scan capture is not affected

- **GIVEN** a scan is in progress via `scanner.scan()`
- **WHEN** frames are captured to disk via `grab_frames()` and saved via `iio.imwrite()`
- **THEN** images SHALL be saved as lossless PNG files
- **AND** the streaming JPEG encoding SHALL NOT be used for disk writes

### Requirement: Stdout Buffer Efficiency

The `PythonProcess.handleStdout` method SHALL use an array-based buffer (accumulating `Buffer` chunks in an array) instead of string concatenation to reassemble newline-delimited protocol messages from the Python subprocess stdout. This is a behavior-preserving refactor that prevents O(n²) intermediate string allocations when processing large payloads (e.g., base64-encoded frames).

#### Scenario: Large frame payload does not cause excessive allocations

- **GIVEN** the Python subprocess sends a FRAME: message of ~270 KB (JPEG base64)
- **AND** Node receives it as multiple ~64 KB stdout chunks
- **WHEN** `handleStdout` reassembles the chunks into a complete line
- **THEN** the buffer SHALL accumulate `Buffer` objects in an array
- **AND** the method SHALL call `Buffer.concat()` and `toString()` only once when a complete line (newline) is found

#### Scenario: Small protocol messages still work correctly

- **GIVEN** the Python subprocess sends a STATUS: message of ~50 bytes
- **WHEN** `handleStdout` processes the chunk
- **THEN** the message SHALL be parsed and emitted correctly
- **AND** behavior SHALL be identical to the previous string-concatenation approach

#### Scenario: Multi-line chunks are handled correctly

- **GIVEN** a single stdout chunk contains multiple complete lines (e.g., STATUS: followed by FRAME:)
- **WHEN** `handleStdout` processes the chunk
- **THEN** each complete line SHALL be parsed and emitted separately
- **AND** any trailing incomplete line SHALL be retained in the buffer for the next chunk

#### Scenario: Empty stdout chunks are handled safely

- **GIVEN** Node emits a zero-length data event from the child process stdout
- **WHEN** `handleStdout` receives the empty Buffer
- **THEN** the method SHALL not emit any lines
- **AND** the buffer state SHALL remain unchanged

#### Scenario: Buffer cleared on process stop

- **GIVEN** the Python process is stopped or exits
- **WHEN** `stop()` is called on the PythonProcess
- **THEN** the stdout buffer SHALL be cleared
- **AND** no partial data from the previous session SHALL persist

### Requirement: Stdout Buffer Memory Safety

The `PythonProcess.handleStdout` method SHALL NOT retain references to parent `Buffer` objects when extracting partial chunks. Chunk extraction MUST use `Buffer.from(data.subarray(...))` to create independent copies. Note: `Buffer.slice()` and `Buffer.subarray()` both return views in Node.js — neither copies. Only `Buffer.from()` creates a true copy.

#### Scenario: Extracted mid-line chunks are independent copies

- **GIVEN** the Python subprocess sends a stdout chunk containing a complete line
- **WHEN** `handleStdout` extracts the line content via subarray
- **THEN** the extracted chunk SHALL be wrapped in `Buffer.from()` to create an independent copy
- **AND** mutating the original data Buffer after extraction SHALL NOT affect the extracted chunk

#### Scenario: Trailing partial line is an independent copy

- **GIVEN** a stdout data event ends mid-line (no trailing newline)
- **WHEN** `handleStdout` stores the trailing partial in the chunks array
- **THEN** the stored chunk SHALL be wrapped in `Buffer.from()` to create an independent copy
- **AND** mutating the original data Buffer after storage SHALL NOT affect the stored partial

### Requirement: Frame Forwarding Backpressure

The main process frame forwarding to the renderer SHALL implement a latest-frame-wins drop gate to prevent unbounded IPC message queue growth. The gate logic SHALL be extracted into a testable `createFrameForwarder()` function that accepts a getter for the send function (not a snapshot) to handle window recreation. The gate SHALL use `try/catch` around the send call to prevent permanent gate jamming if `webContents.send()` throws.

#### Scenario: Frame forwarded when gate is open

- **GIVEN** no frame is currently pending delivery
- **WHEN** the camera process emits a frame event
- **THEN** the frame SHALL be forwarded to the renderer via `webContents.send()`
- **AND** the gate SHALL close until `setImmediate` yields to the event loop

#### Scenario: Latest frame sent when gate reopens

- **GIVEN** a frame was sent and the gate is closed
- **AND** one or more additional frames arrive while the gate is closed
- **WHEN** `setImmediate` fires and the gate reopens
- **THEN** only the most recent (latest) frame SHALL be sent
- **AND** intermediate frames SHALL be silently dropped

#### Scenario: No frames dropped under normal conditions

- **GIVEN** frames arrive at 5 FPS (200ms interval)
- **AND** the event loop is not blocked
- **WHEN** each frame arrives after the previous `setImmediate` has fired
- **THEN** all frames SHALL be forwarded (no unnecessary drops)

#### Scenario: Frame silently discarded when main window is unavailable

- **GIVEN** the main window is null or has been destroyed
- **WHEN** the camera process emits a frame event
- **THEN** the frame SHALL be silently discarded
- **AND** no error SHALL be thrown

#### Scenario: Gate resets when camera process is recreated

- **GIVEN** the camera process exits and is recreated via `ensureCameraProcess()`
- **WHEN** the new process emits its first frame
- **THEN** the frame SHALL be forwarded (gate starts open for each new process instance)
- **AND** stale gate state from the previous process SHALL NOT affect the new process

#### Scenario: Gate recovers after send failure

- **GIVEN** `webContents.send()` throws an exception (e.g., renderer destroyed mid-send)
- **WHEN** the next frame arrives after `setImmediate` fires
- **THEN** the gate SHALL be open and the frame SHALL be forwarded
- **AND** the gate SHALL NOT be permanently jammed

#### Scenario: Send function re-evaluated on each frame

- **GIVEN** the main window is destroyed and recreated (e.g., macOS dock click)
- **WHEN** a frame arrives after window recreation
- **THEN** the forwarder SHALL use the new window's `webContents.send()` (not the old one)
- **AND** no frames SHALL be sent to the destroyed window

#### Scenario: Empty data URI is silently ignored

- **GIVEN** the camera process emits a frame event with an empty string
- **WHEN** the forwarder receives the empty data URI
- **THEN** no `webContents.send()` call SHALL be made
- **AND** the gate state SHALL remain unchanged

#### Scenario: Gate state is independent per forwarder instance

- **GIVEN** two forwarder instances created by separate `createFrameForwarder()` calls
- **WHEN** the first forwarder's gate is closed (frame pending)
- **THEN** the second forwarder's gate SHALL still be open
- **AND** each forwarder SHALL maintain fully independent state
