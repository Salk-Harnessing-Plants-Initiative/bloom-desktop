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

### Requirement: Deterministic Streaming Bitmap Lifecycle

The Streamer component SHALL render camera preview frames using a `<canvas>` element with `createImageBitmap()` decoding and explicit `bitmap.close()` to deterministically free decoded C++ bitmap memory. The rendering pipeline SHALL NOT use `fetch()`, `URL.createObjectURL()`, `URL.revokeObjectURL()`, or `Image` objects, as these create C++ allocations that Chromium does not reliably free (confirmed by diagnostic: IPC-only test survived 20+ min, rendering test OOMed at 15 min).

#### Scenario: Frame decoded via createImageBitmap and drawn to canvas

- **GIVEN** a JPEG frame arrives as a base64 data URI from IPC
- **WHEN** the Streamer processes the frame
- **THEN** the base64 data SHALL be decoded to a `Uint8Array` via `atob()`
- **AND** a `Blob` SHALL be created from the binary data
- **AND** `createImageBitmap(blob)` SHALL be called to decode the image
- **AND** the bitmap SHALL be drawn to the canvas via `ctx.drawImage(bitmap, ...)`
- **AND** `bitmap.close()` SHALL be called immediately after drawing to free C++ memory

#### Scenario: Canvas preserves aspect ratio with letterboxing

- **GIVEN** the camera frame is 2048×1080 (~1.9:1 aspect ratio)
- **AND** the canvas display area is 800×600 (~1.33:1)
- **WHEN** the frame is drawn to the canvas
- **THEN** the frame SHALL be scaled to fit within the canvas using `bitmap.width` and `bitmap.height` for the source dimensions
- **AND** the canvas SHALL be cleared before drawing (CSS background provides black letterbox bars)
- **AND** the frame SHALL NOT be stretched or distorted

#### Scenario: Renderer-side busy gate prevents concurrent decodes

- **GIVEN** a frame is currently being decoded (`createImageBitmap` pending)
- **WHEN** a new frame arrives from IPC
- **THEN** the new frame's data URI SHALL be stored as a pending frame (latest-frame-wins, overwriting any previous pending)
- **AND** when the current decode completes, only the most recent pending frame SHALL be decoded next

#### Scenario: bitmap.close() called after every drawImage

- **GIVEN** a frame was decoded and drawn to canvas
- **WHEN** the draw operation completes
- **THEN** `bitmap.close()` SHALL be called in the same execution path
- **AND** no decoded bitmap SHALL remain in memory after drawing

#### Scenario: bitmap.close() called even after unmount

- **GIVEN** a frame is being decoded (`createImageBitmap` pending)
- **AND** the component unmounts before the decode resolves
- **WHEN** `createImageBitmap` resolves with a bitmap
- **THEN** `bitmap.close()` SHALL still be called to free C++ memory
- **AND** `drawImage` SHALL NOT be called (canvas may no longer be in DOM)

#### Scenario: Decode failure does not jam the busy gate

- **GIVEN** `createImageBitmap()` rejects (e.g., corrupt JPEG data)
- **WHEN** the rejection handler runs
- **THEN** the busy gate SHALL be cleared (`isDecoding = false`)
- **AND** if a pending frame exists, it SHALL be decoded next
- **AND** the stream SHALL NOT be permanently stalled

#### Scenario: Invalid base64 does not crash the component

- **GIVEN** a frame arrives with invalid base64 data (not valid base64 encoding)
- **WHEN** `atob()` throws synchronously
- **THEN** the error SHALL be caught
- **AND** the busy gate SHALL be cleared
- **AND** if a pending frame exists, it SHALL be decoded next

#### Scenario: Clean resource release on unmount

- **GIVEN** the Streamer component is mounted and streaming
- **WHEN** the component unmounts
- **THEN** `mountedRef.current` SHALL be set to `false` first
- **AND** the pending frame buffer SHALL be cleared
- **AND** the frame listener SHALL be removed
- **AND** the stream SHALL be stopped

#### Scenario: Pre-first-frame connecting state preserved

- **GIVEN** the Streamer has mounted but no frame has been drawn yet
- **WHEN** the component renders
- **THEN** "Connecting..." text SHALL be displayed
- **AND** the canvas SHALL be hidden (display:none) until the first frame is drawn
- **AND** once the first frame draws, the placeholder SHALL be hidden and the canvas shown

### Requirement: Mode-Specific Directory Boundaries

CylinderScan-specific main process modules SHALL reside in `src/main/cylinderscan/`. Shared infrastructure code in `src/main/` SHALL NOT import from `src/main/cylinderscan/` or `src/main/graviscan/` (when it exists). This one-way dependency rule is enforced by an ESLint `no-restricted-imports` rule.

#### Scenario: CylinderScan process files are in the cylinderscan directory

- **GIVEN** the project source code
- **WHEN** a developer looks for CylinderScan-specific main process modules
- **THEN** `camera-process.ts`, `daq-process.ts`, `scanner-process.ts`, and `scan-metadata-json.ts` SHALL be located in `src/main/cylinderscan/`
- **AND** they SHALL NOT be in `src/main/` root

#### Scenario: Shared code cannot import from mode-specific directories

- **GIVEN** a TypeScript file in `src/main/` (not inside `cylinderscan/` or `graviscan/`)
- **WHEN** the file attempts to import from `**/cylinderscan/**` or `**/graviscan/**`
- **THEN** ESLint SHALL report an error with the message "Shared code must not import from cylinderscan/" or "Shared code must not import from graviscan/"

#### Scenario: Mode-specific code can import from shared code

- **GIVEN** a TypeScript file inside `src/main/cylinderscan/`
- **WHEN** the file imports from `src/main/python-process.ts` or other shared modules
- **THEN** the import SHALL be allowed (no ESLint error)

#### Scenario: All existing tests pass after directory restructure

- **GIVEN** the 4 CylinderScan files have been moved to `src/main/cylinderscan/`
- **AND** all import statements across the impacted files have been updated (including dynamic `import()` calls)
- **WHEN** the full test suite runs (`npx vitest run` and `uv run pytest`)
- **THEN** all tests SHALL pass with zero failures
- **AND** `npx tsc --noEmit` SHALL report zero type errors

#### Scenario: main.ts imports CylinderScan modules from new paths

- **GIVEN** `src/main/main.ts` registers CylinderScan IPC handlers
- **WHEN** it imports `CameraProcess`, `DAQProcess`, `ScannerProcess`
- **THEN** the imports SHALL use paths relative to `./cylinderscan/` (e.g., `'./cylinderscan/camera-process'`)
- **AND** the `no-restricted-imports` rule SHALL NOT flag these imports (main.ts is the orchestrator, not shared library code — see ESLint override)

### Requirement: Mode-Aware Routing

The app SHALL conditionally render routes based on the configured scanner mode. Capture and config routes are mode-gated. Browse and view routes are always visible regardless of mode. The app SHALL show a loading state until the mode is resolved from the main process.

#### Scenario: CylinderScan capture routes visible in cylinderscan mode

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the app renders routes
- **THEN** `/capture-scan` and `/camera-settings` routes SHALL be available
- **AND** `/graviscan` and `/configure-scanner` routes SHALL NOT be available (`/graviscan` when added in a later increment)

#### Scenario: GraviScan configure-scanner route visible in graviscan mode

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the app renders routes
- **THEN** the `/configure-scanner` route SHALL be available
- **AND** `/capture-scan` and `/camera-settings` routes SHALL NOT be available

#### Scenario: Browse routes always visible

- **GIVEN** any scanner mode (cylinderscan, graviscan, or full)
- **WHEN** the app renders routes
- **THEN** `/browse-scans` and `/scan/:scanId` routes SHALL always be available
- **AND** GraviScan browse routes SHALL also be available when added in later increments

#### Scenario: Loading state while mode resolves

- **GIVEN** the app has just launched
- **WHEN** the `useAppMode()` hook is fetching the mode via IPC
- **THEN** the app SHALL display a loading indicator
- **AND** no routes SHALL be rendered until mode is known
- **AND** no flash of wrong routes SHALL occur

#### Scenario: Unknown route redirects to home

- **GIVEN** any scanner mode
- **WHEN** the user navigates to a route that does not exist or was removed by mode gating
- **THEN** the app SHALL redirect to `/`

#### Scenario: Empty mode (first run) redirects to machine config

- **GIVEN** no config exists or scanner_mode is empty string
- **WHEN** the `useAppMode()` hook resolves with mode `''`
- **THEN** the app SHALL redirect to `/machine-config`
- **AND** no capture or browse routes SHALL be rendered

---

### Requirement: Mode-Aware Home Page

The Home page SHALL display a numbered workflow guide specific to the configured scanner mode. Each step is a clickable card that navigates to the relevant page.

#### Scenario: CylinderScan workflow steps

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the Home page renders
- **THEN** the workflow steps SHALL be: Scientists → Phenotypers → Accessions → Experiments → Camera Settings → Capture Scan → Browse Scans
- **AND** each step SHALL be clickable and navigate to the corresponding page

#### Scenario: GraviScan workflow steps

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the Home page renders
- **THEN** the workflow steps SHALL be: Scientists → Phenotypers → Metadata → Experiments → Capture Scan → Browse Scans
- **AND** each step SHALL be clickable and navigate to the corresponding page

#### Scenario: First-run redirect to Machine Config

- **GIVEN** no config file exists (`~/.bloom/.env` missing)
- **WHEN** the Home page mounts
- **THEN** the user SHALL be redirected to `/machine-config`
- **AND** the Machine Config wizard SHALL require scanner mode selection before proceeding

### Requirement: Mode-Aware Navigation

The Layout sidebar navigation SHALL conditionally show capture-related links based on the configured scanner mode. Browse links are always shown.

#### Scenario: CylinderScan nav items

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the Layout sidebar renders
- **THEN** "Capture Scan" and "Camera Settings" nav links SHALL be visible
- **AND** the subtitle SHALL say "CylinderScan" (not hardcoded "Cylinder Scanner")

#### Scenario: GraviScan nav items

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the Layout sidebar renders
- **THEN** "Capture Scan" and "Camera Settings" nav links SHALL be replaced by GraviScan equivalents (when added in later increments)
- **AND** the subtitle SHALL say "GraviScan"

#### Scenario: Layout subtitle reflects configured mode

- **GIVEN** any scanner mode
- **WHEN** the Layout renders
- **THEN** the subtitle under "Bloom Desktop" SHALL display the mode name
- **AND** the footer SHALL continue to show the scanner name from config

### Requirement: GraviScan Database Schema

The database SHALL include 8 GraviScan models for multi-scanner flatbed phenotyping data. All models are additive — no existing CylinderScan models (Scan, Image) are modified. The Experiment model gains an `experiment_type` field to distinguish scan modes.

#### Scenario: GraviScan models exist after migration

- **GIVEN** the database has been migrated to the current schema
- **WHEN** a developer inspects the database tables
- **THEN** all 8 GraviScan tables SHALL exist: GraviScan, GraviScanSession, GraviScanner, GraviConfig, GraviImage, GraviScanPlateAssignment, GraviPlateAccession, GraviPlateSectionMapping
- **AND** all existing CylinderScan tables SHALL remain unchanged

#### Scenario: Experiment type backfill for existing data

- **GIVEN** a database with pre-existing experiments (no experiment_type field)
- **WHEN** the migration is applied
- **THEN** all existing experiments SHALL have `experiment_type = 'cylinderscan'`
- **AND** new experiments SHALL default to `'cylinderscan'` unless explicitly set

#### Scenario: Cascade delete on plate accession chain

- **GIVEN** an Accessions record with linked GraviPlateAccession and GraviPlateSectionMapping records
- **WHEN** the Accessions record is deleted
- **THEN** all linked GraviPlateAccession records SHALL be cascade-deleted
- **AND** all linked GraviPlateSectionMapping records SHALL be cascade-deleted

#### Scenario: Session delete preserves scans

- **GIVEN** a GraviScanSession with linked GraviScan records
- **WHEN** the session is deleted
- **THEN** the GraviScan records SHALL be preserved
- **AND** their `session_id` field SHALL be set to NULL

#### Scenario: Database upgrade from v3 to v4

- **GIVEN** a v3 database (current schema without GraviScan models)
- **WHEN** the upgrade script runs
- **THEN** all 8 GraviScan tables SHALL be created
- **AND** the `experiment_type` column SHALL be added to Experiment
- **AND** all existing data SHALL be preserved
- **AND** migration checksums SHALL match the migration SQL files

#### Scenario: Migration verification passes

- **GIVEN** the Prisma schema and migration SQL files
- **WHEN** `scripts/verify-migrations.sh` runs
- **THEN** the schema produced by `prisma migrate deploy` SHALL match `prisma db push`
- **AND** no column or constraint differences SHALL exist

#### Scenario: Prisma client generation succeeds

- **GIVEN** the updated `prisma/schema.prisma` with all 8 new models
- **WHEN** `npx prisma generate` runs
- **THEN** the Prisma client SHALL be generated successfully
- **AND** all new model types SHALL be available in TypeScript

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

The system SHALL provide scan region geometry for 2-grid and 4-grid plate configurations in `python/graviscan/scan_regions.py`, with coordinates in millimeters calibrated for the Epson Perfection V600 flatbed scanner (USB ID `04b8:013a`, A4 scan bed 215.9mm x 297.0mm). Coordinates are hardcoded constants derived from the original GraviScan calibration (`graviscan.cfg`, not shipped in this repo) and validated against the V600 scan bed dimensions.

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
- **AND** when started without `--mock`, the worker SHALL emit an error event and return false from `initialize()`
- **AND** when started with `--mock`, the worker SHALL operate in mock scanning mode without SANE
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
- **THEN** the worker SHALL set a cancel flag and stop after the current plate finishes
- **AND** emit `scan-cancelled` events on stdout for remaining unscanned plates
- **AND** return to a state ready to accept new commands

#### Scenario: Scan worker handles quit command

- **GIVEN** a scan worker subprocess is running
- **WHEN** a `{"action":"quit"}` message is sent on stdin
- **THEN** the worker SHALL exit cleanly with exit code 0

#### Scenario: Scan worker handles malformed input gracefully

- **GIVEN** a scan worker subprocess is running
- **WHEN** invalid JSON is received on stdin
- **THEN** the worker SHALL log the error to stderr and continue accepting commands
- **AND** SHALL NOT crash or exit

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

### Requirement: GraviScan PyInstaller Bundling

The system SHALL bundle GraviScan Python modules into the PyInstaller executable alongside existing CylinderScan hardware modules.

#### Scenario: Hidden imports include only existing GraviScan modules

- **GIVEN** the PyInstaller spec file (`python/main.spec`) is used to build the Python executable
- **WHEN** the build completes
- **THEN** `graviscan`, `graviscan.scan_regions`, `graviscan.scan_worker`, and `graviscan.qr_reader` modules SHALL be importable at runtime
- **AND** `cv2` SHALL be importable at runtime (required by `graviscan.qr_reader`)
- **AND** the `sane` module SHALL be included as a hidden import (fails gracefully if unavailable)
- **AND** no references to non-existent modules (e.g., `graviscan.models`, `graviscan.functions`) SHALL be present

### Requirement: GraviScan Python Dependencies

The system SHALL declare GraviScan-specific Python dependencies as optional dependency groups to avoid forcing SANE/TWAIN installation on all platforms.

#### Scenario: Pillow available as core dependency

- **GIVEN** the Python environment is set up via `uv sync`
- **WHEN** the scan worker imports `PIL`
- **THEN** Pillow SHALL be available (declared as core dependency `pillow>=10.0.0`; already a transitive dep via `imageio`, this makes it explicit)

#### Scenario: OpenCV available as core dependency

- **GIVEN** the Python environment is set up via `uv sync`
- **WHEN** `graviscan.qr_reader` imports `cv2`
- **THEN** OpenCV SHALL be available (declared as core dependency
  `opencv-python-headless>=4.9.0,<5`)
- **AND** the headless build SHALL be used, so no GUI/Qt or X11 dependency is introduced on the rig or in the PyInstaller bundle
- **AND** the declaration SHALL carry an upper major-version bound, so
  resolution cannot silently jump past the major version
  `pyinstaller-hooks-contrib`'s bundled `cv2` hook was written against
- **NOTE**: an unbounded `>=4.9.0` resolved to `5.0.0.93`, a major version
  newer than what `pyinstaller-hooks-contrib@2025.9` supports. The frozen
  build was only ever verified on Windows, never macOS or Linux, so the bound
  stays at the major version the hooks are known good for. Raising it
  requires rebuilding and running the frozen executable on all three
  platforms first.

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

#### Scenario: Download experiment images with metadata, plates, and sections CSVs

- **GIVEN** an experiment has GraviScan images across multiple waves, with plate accessions and section mappings linked via the experiment's legacy accession
- **WHEN** `downloadImages(db, { experimentId, experimentName, targetDir?, waveNumber? })` is called
- **THEN** the system SHALL group images by wave number into subdirectories
- **AND** write a `metadata.csv` per wave with experiment, plate, accession, and image columns (header: `experiment,wave_number,plate_barcode,plate_index,grid_mode,capture_date,accession,transplant_date,custom_note,image_filename`)
- **AND** write a `plates.csv` per wave with one row per plate accession linked to the wave (header: `experiment,wave_number,plate_id,accession,transplant_date,custom_note`), only when there is at least one plate accession
- **AND** write a `sections.csv` per wave with one row per section mapping under each plate (header: `experiment,wave_number,plate_id,section_id,plant_qr,medium`), only when there is at least one section mapping
- **AND** copy image files with concurrent file copy operations
- **AND** report progress via the injected `onProgress` callback

#### Scenario: Omit plates.csv and sections.csv when there is no plate/section data

- **GIVEN** an experiment's accession has no linked `GraviPlateAccession` records
- **WHEN** `downloadImages(db, params)` is called
- **THEN** the system SHALL still write `metadata.csv` per wave
- **AND** SHALL NOT write `plates.csv` or `sections.csv` for that wave

#### Scenario: Omit sections.csv when a plate has no section mappings

- **GIVEN** a wave's plate accessions exist but none has any linked `GraviPlateSectionMapping` records
- **WHEN** `downloadImages(db, params)` is called
- **THEN** the system SHALL write `plates.csv` for that wave
- **AND** SHALL NOT write `sections.csv` for that wave

#### Scenario: Default target directory to the Downloads folder

- **GIVEN** `downloadImages()` is called without a `targetDir`
- **WHEN** the function resolves where to write the experiment's export folder
- **THEN** the system SHALL default to `app.getPath('downloads')`
- **AND** an explicitly-provided `targetDir` SHALL be used instead, without consulting `app.getPath('downloads')`

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

### Requirement: ScanCoordinator Multi-Scanner Orchestration

The system SHALL provide a `ScanCoordinator` class in `src/main/graviscan/scan-coordinator.ts` that orchestrates multiple `ScannerSubprocess` instances for parallel scanning, with staggered initialization, grid-based scan sequencing, interval/continuous mode timing, and graceful shutdown. The USB stagger delay SHALL be defined as a named module-level constant `USB_STAGGER_DELAY_MS = 5000`. File verification in `handleScanComplete()` SHALL use asynchronous filesystem operations (`fs.promises`) instead of synchronous calls to avoid blocking the Electron main process event loop during scan completion. Critical events (`grid-complete` with file paths) SHALL be logged via `scanLog()` for scientific traceability. Per-job scan events SHALL be emitted on three granular channels — `scan-started`, `scan-complete`, `scan-error` — each carrying `jobId` (`` `${scannerId}:${plateIndex}` `` when a single plate applies, or `scannerId` alone for a whole-row failure with no single plate), `scannerId`, and `plateIndex` in addition to that event's existing fields. The generic `scan-event` channel (an embedded `type` field distinguishing these three cases) SHALL NOT be emitted. **Note on the bare-`scannerId` `jobId` shape**: it is a novel third shape relative to the per-plate `` `${scannerId}:${plateIndex}` `` shape used everywhere else, including `session-handlers.ts`'s existing `session.jobs` map — there is no existing single-key lookup pattern for it. A future consumer (e.g. a Tier 3/4 UI) that needs to mark every plate on a row as affected by a whole-row failure will have to enumerate all `` `${scannerId}:*` `` job-map entries for that scanner rather than perform a single key lookup. This is stated explicitly so a future implementer designs for it deliberately rather than discovering it during implementation.

#### Scenario: Staggered scanner initialization

- **GIVEN** a `ScanCoordinator` is constructed with a Python path and packaging flag
- **WHEN** `initialize(scanners)` is called with a list of `ScannerConfig` objects
- **THEN** the coordinator SHALL spawn one `ScannerSubprocess` per scanner
- **AND** subprocesses SHALL be initialized sequentially (one at a time) to prevent SANE global state contention
- **AND** existing subprocesses not in the new config SHALL be shut down
- **AND** existing subprocesses that are already ready SHALL be reused

#### Scenario: Initialize with zero scanners

- **GIVEN** a `ScanCoordinator` is constructed
- **WHEN** `initialize([])` is called with an empty list
- **THEN** the coordinator SHALL shut down any existing subprocesses
- **AND** the subprocess map SHALL be empty
- **AND** the coordinator SHALL resolve without error

#### Scenario: Single-cycle scan with grid sequencing

- **GIVEN** the coordinator is initialized with scanners
- **WHEN** `scanOnce(platesPerScanner)` is called with a `Map<string, PlateConfig[]>`
- **THEN** the coordinator SHALL scan grids sequentially (all scanners scan grid 0, then grid 1, etc.)
- **AND** within each grid, scanners SHALL be triggered with a `USB_STAGGER_DELAY_MS` (5-second) stagger delay
- **AND** each stagger delay SHALL be logged via `scanLog()` with the scanner ID and delay duration
- **AND** the coordinator SHALL wait for all scanners to complete a grid before proceeding to the next
- **AND** each plate's final output path (already including the `_et_YYYYMMDDTHHMMSS` end-timestamp, composed by the Python scan worker at save time) SHALL be learned from that plate's `scan-complete` event — the coordinator SHALL NOT assume the path it sent to the worker is the path that was saved
- **AND** the coordinator SHALL emit `grid-start`, `grid-complete`, and `cycle-complete` events

#### Scenario: File verification after scan-complete uses async FS

- **GIVEN** a subprocess emits a `scan-complete` event with an output file path
- **WHEN** the coordinator processes the completion
- **THEN** the coordinator SHALL use `fs.promises.access()` to verify the output file exists
- **AND** SHALL use `fs.promises.stat()` to verify the file has non-zero size
- **AND** if the file is missing or zero-size, the coordinator SHALL emit a `scan-error` event for that scanner/plate with a `jobId` of `` `${scannerId}:${plateIndex}` ``

#### Scenario: Partial scanner failure mid-grid

- **GIVEN** the coordinator is scanning a grid with multiple scanners
- **WHEN** one scanner emits a `scan-error` while others complete successfully
- **THEN** the coordinator SHALL mark the failed scanner's output as errored
- **AND** the coordinator SHALL still wait for remaining scanners to complete
- **AND** the coordinator SHALL proceed to the next grid

#### Scenario: Interval scanning with duration

- **GIVEN** the coordinator is initialized with scanners
- **WHEN** `scanInterval(platesPerScanner, intervalMs, durationMs)` is called
- **THEN** the coordinator SHALL repeat `scanOnce()` at the specified interval
- **AND** scanning SHALL stop when the duration is exceeded or `cancelAll()` is called
- **AND** the coordinator SHALL emit `interval-start`, `interval-waiting`, and `interval-complete` events
- **AND** if a cycle takes longer than the interval, the coordinator SHALL emit an `overtime` event

#### Scenario: Cancel all scanning

- **GIVEN** the coordinator is actively scanning
- **WHEN** `cancelAll()` is called
- **THEN** all active scans SHALL be cancelled
- **AND** any interval timer SHALL be cleared
- **AND** a `cancelled` event SHALL be emitted

#### Scenario: Cancel during interval wait resets state to idle

- **GIVEN** the coordinator is waiting between interval cycles (state is `waiting`)
- **WHEN** `cancelAll()` is called
- **THEN** the interval timer SHALL be cleared
- **AND** a `cancelled` event SHALL be emitted
- **AND** no further scan cycles SHALL be started
- **AND** after `scanInterval()` returns, `isScanning` SHALL be `false`

#### Scenario: Per-row scan timeout prevents infinite hang

- **GIVEN** the coordinator is scanning a grid row
- **AND** one or more subprocesses have not emitted `cycle-done` or `exit`
- **WHEN** a configurable per-row timeout (`SCAN_ROW_TIMEOUT_MS`) is exceeded
- **THEN** the timed-out subprocesses SHALL be treated as failed
- **AND** the coordinator SHALL proceed to the next row group
- **AND** a `scan-error` event SHALL be emitted for each timed-out subprocess, with `jobId` equal to the bare `scannerId` (no single `plateIndex` applies to a whole-row timeout)

#### Scenario: Forwarded scan events use granular per-job channels, not a generic bus

- **GIVEN** a `ScannerSubprocess` emits a generic `event` with `type: 'scan-started'`, `'scan-complete'`, or `'scan-error'`
- **WHEN** the coordinator forwards it
- **THEN** the coordinator SHALL emit on the correspondingly-named channel (`scan-started`, `scan-complete`, or `scan-error`) — NOT on a generic `scan-event` channel with an embedded `type` field
- **AND** the forwarded payload SHALL include `jobId` (`` `${scannerId}:${plateIndex}` ``), `scannerId`, and `plateIndex` in addition to the source event's own fields
- **AND** a `scan-complete` event emitted before the row has finished SHALL include `scan_started_at` (the row start time) and SHALL NOT include `scan_ended_at` (which is unknown until the row completes)

#### Scenario: Cancel during active scanOnce aborts cleanly

- **GIVEN** the coordinator is actively awaiting `scanOnce()` completion
- **WHEN** `cancelAll()` is called
- **THEN** the coordinator SHALL check `this.cancelled` after each row completes
- **AND** the coordinator SHALL skip file verification for unfinished rows
- **AND** `isScanning` SHALL return `false` after `scanOnce()` returns

#### Scenario: Graceful shutdown

- **GIVEN** the coordinator has active subprocesses
- **WHEN** `shutdown()` is called
- **THEN** the coordinator SHALL send quit commands to all subprocesses
- **AND** force-kill any subprocess that does not exit within 5 seconds
- **AND** clear the subprocess map

#### Scenario: Coordinator implements ScanCoordinatorLike

- **GIVEN** the `ScanCoordinatorLike` interface is defined in session-handlers.ts
- **WHEN** the `ScanCoordinator` class is compiled
- **THEN** it SHALL explicitly `implements ScanCoordinatorLike`
- **AND** the `isScanning` readonly property SHALL return `true` when state is `scanning` or `waiting`

#### Scenario: Grid-complete events logged to persistent storage

- **GIVEN** the coordinator completes a grid
- **WHEN** the `grid-complete` event is emitted
- **THEN** the event payload (including scanned file paths and timestamps) SHALL be logged via `scanLog()`
- **AND** the log entry SHALL survive renderer crashes

### Requirement: ScannerSubprocess Worker Management

The system SHALL provide a `ScannerSubprocess` class in `src/main/graviscan/scanner-subprocess.ts` that manages a single long-lived Python `scan_worker.py` subprocess per physical scanner, communicating via line-delimited JSON on stdin and `EVENT:`-prefixed JSON on stdout. The class SHALL store all readline interfaces as class fields and close them during shutdown and kill operations to prevent file descriptor leaks.

#### Scenario: Subprocess spawn and ready signal

- **GIVEN** a `ScannerSubprocess` is constructed with a scanner ID and SANE name
- **WHEN** `spawn()` is called
- **THEN** the subprocess SHALL spawn a Python process with appropriate arguments
- **AND** in development mode, SHALL use `python -m graviscan.scan_worker`
- **AND** in packaged mode, SHALL use `bloom-hardware --scan-worker`
- **AND** the subprocess SHALL wait for an `EVENT:ready` signal before resolving

#### Scenario: Spawn failure

- **GIVEN** a `ScannerSubprocess` is constructed
- **WHEN** `spawn()` is called and the Python binary is not found (ENOENT) or not executable (EACCES)
- **THEN** the spawn promise SHALL reject with a descriptive error
- **AND** the subprocess state SHALL transition to `dead`

#### Scenario: Send scan command

- **GIVEN** the subprocess is in the `ready` state
- **WHEN** `scan(plates)` is called with a list of `PlateConfig` objects
- **THEN** the subprocess SHALL write `{action: 'scan', plates}` as JSON to stdin
- **AND** the state SHALL transition to `scanning`

#### Scenario: Parse EVENT protocol messages

- **GIVEN** the subprocess stdout emits lines prefixed with `EVENT:`
- **WHEN** a line like `EVENT:{"type":"scan-complete","scanner_id":"..."}` is received
- **THEN** the subprocess SHALL parse the JSON payload
- **AND** emit typed events: `scan-started`, `scan-complete`, `scan-error`, `scan-cancelled`, `cycle-done`
- **AND** emit a generic `event` for the coordinator to forward

#### Scenario: Malformed EVENT protocol line

- **GIVEN** the subprocess stdout emits a line `EVENT:not-valid-json`
- **WHEN** the line is parsed
- **THEN** the malformed line SHALL be logged as a warning via `scanLog()`
- **AND** the subprocess SHALL NOT crash or change state

#### Scenario: Partial stdout line buffering

- **GIVEN** the subprocess stdout emits a JSON event split across multiple data chunks
- **WHEN** the chunks are received
- **THEN** the line reader SHALL reassemble complete lines before parsing
- **AND** no partial JSON SHALL be passed to the parser

#### Scenario: Cancel scan

- **GIVEN** the subprocess is scanning
- **WHEN** `cancel()` is called
- **THEN** the subprocess SHALL write `{action: 'cancel'}` to stdin
- **AND** the worker SHALL finish the current plate then return to idle

#### Scenario: Process exit with non-zero code

- **GIVEN** the subprocess is alive
- **WHEN** the process exits with a non-zero exit code or a signal
- **THEN** the subprocess SHALL emit an `exit` event with the code and signal
- **AND** the state SHALL transition to `dead`
- **AND** any pending operations SHALL be rejected

#### Scenario: Graceful subprocess shutdown

- **GIVEN** the subprocess is alive
- **WHEN** `shutdown(timeoutMs)` is called
- **THEN** the subprocess SHALL send a `quit` command
- **AND** force-kill with SIGKILL if the process does not exit within the timeout
- **AND** resolve when the process exits

#### Scenario: Readline interfaces cleaned up on shutdown

- **GIVEN** a `ScannerSubprocess` has been spawned
- **AND** both stdout readline (`this.rl`) and stderr readline (`this.stderrRl`) interfaces exist
- **WHEN** `shutdown()` is called
- **THEN** both `this.rl` and `this.stderrRl` SHALL be closed via `.close()`
- **AND** `this.stderrRl` SHALL be stored as a class field (not a local variable)

#### Scenario: Readline interfaces cleaned up on kill

- **GIVEN** a `ScannerSubprocess` has been spawned
- **WHEN** `kill()` is called
- **THEN** both `this.rl` and `this.stderrRl` SHALL be closed via `.close()`

#### Scenario: Double cleanup is safe

- **GIVEN** `shutdown()` has already been called and readline interfaces were closed
- **WHEN** `kill()` is subsequently called
- **THEN** the cleanup SHALL NOT throw an error (closing an already-closed readline is safe)

### Requirement: GraviScan Persistent Scan Logging

The system SHALL provide scan logging in `src/main/graviscan/scan-logger.ts` that writes timestamped entries to `~/.bloom/logs/graviscan-YYYY-MM-DD.log` with configurable log retention (default 180 days).

#### Scenario: Write scan log entry

- **GIVEN** the scan logger is available
- **WHEN** `scanLog(message)` is called
- **THEN** the message SHALL be written with an ISO timestamp to the daily log file
- **AND** the log directory SHALL be created if it does not exist

#### Scenario: Configurable log retention

- **GIVEN** `LOG_RETENTION_DAYS` is set to N days (default 180)
- **WHEN** `cleanupOldLogs()` is called
- **THEN** log files older than N days SHALL be deleted
- **AND** recent log files SHALL be preserved

#### Scenario: Close scan log stream

- **GIVEN** the scan logger has an open write stream
- **WHEN** `closeScanLog()` is called
- **THEN** the write stream SHALL be flushed and closed
- **AND** subsequent calls to `scanLog()` SHALL open a new stream

### Requirement: GraviScan Shared Type Definitions

The `PlateConfig` and `ScannerConfig` interfaces SHALL be defined in `src/types/graviscan.ts` (moved from local definitions in session-handlers.ts) so they can be shared across session-handlers, scan-coordinator, and scanner-subprocess modules.

#### Scenario: PlateConfig available as shared type

- **GIVEN** the `PlateConfig` interface is defined in `src/types/graviscan.ts`
- **WHEN** any GraviScan module needs plate configuration
- **THEN** it SHALL import `PlateConfig` from `../../types/graviscan` (or appropriate relative path)
- **AND** `PlateConfig` SHALL have fields: `plate_index: string`, `grid_mode: string`, `resolution: number`, `output_path: string`

#### Scenario: ScannerConfig available as shared type

- **GIVEN** the `ScannerConfig` interface is defined in `src/types/graviscan.ts`
- **WHEN** any GraviScan module needs scanner configuration
- **THEN** it SHALL import `ScannerConfig` from `../../types/graviscan` (or appropriate relative path)
- **AND** `ScannerConfig` SHALL have fields: `scannerId: string`, `saneName: string`, `plates: PlateConfig[]`

#### Scenario: Session-handlers imports shared types

- **GIVEN** `PlateConfig` and `ScannerConfig` are defined in `src/types/graviscan.ts`
- **WHEN** `session-handlers.ts` is compiled
- **THEN** it SHALL import both types from `../../types/graviscan`
- **AND** the local type definitions SHALL be removed
- **AND** the `ScanCoordinatorLike` interface SHALL remain in session-handlers.ts

### Requirement: GraviScan IPC Handler Registration

The system SHALL provide a `registerGraviScanHandlers` function in `src/main/graviscan/register-handlers.ts` that registers all GraviScan IPC channels via `ipcMain.handle()`, delegating to the pure handler functions in `scanner-handlers.ts`, `session-handlers.ts`, and `image-handlers.ts`.

#### Scenario: All GraviScan IPC channels registered

- **GIVEN** `registerGraviScanHandlers(ipcMain, db, getMainWindow, sessionFns, getCoordinator)` is called
- **WHEN** the function completes
- **THEN** the following 20 IPC channels SHALL be registered:
  - `graviscan:detect-scanners`
  - `graviscan:get-config`
  - `graviscan:save-config`
  - `graviscan:save-scanners-db`
  - `graviscan:disable-scanner`
  - `graviscan:platform-info`
  - `graviscan:validate-scanners`
  - `graviscan:validate-config`
  - `graviscan:reset-usb`
  - `graviscan:get-scanner-status`
  - `graviscan:start-scan`
  - `graviscan:get-scan-status`
  - `graviscan:mark-job-recorded`
  - `graviscan:cancel-scan`
  - `graviscan:get-output-dir`
  - `graviscan:read-scan-image`
  - `graviscan:upload-all-scans`
  - `graviscan:ensure-dir`
  - `graviscan:list-scan-files`
  - `graviscan:download-images`

#### Scenario: Handler delegates to correct module function

- **GIVEN** `registerGraviScanHandlers` has been called
- **WHEN** the renderer invokes any of the 20 registered `graviscan:*` IPC channels
- **THEN** the handler SHALL delegate to the corresponding handler module function with the correct arguments
- **AND** return the result to the renderer
- **AND** `graviscan:get-scanner-status`, `graviscan:ensure-dir`, and
  `graviscan:list-scan-files` SHALL return their handler function's result
  shape directly (matching production's un-nested `{ success, ... }`
  contract), the same convention already used for `graviscan:disable-scanner`
  — not wrapped in the generic `wrapHandler`'s `{ success: true, data }`
  envelope used by most other channels

#### Scenario: Handler returns error on exception

- **GIVEN** `registerGraviScanHandlers` has been called
- **AND** a handler function throws an error
- **WHEN** the renderer invokes the corresponding channel
- **THEN** the handler SHALL return `{ success: false, error: <message> }`
- **AND** the error SHALL be logged via `console.error`

#### Scenario: Double registration throws

- **GIVEN** `registerGraviScanHandlers` has already been called once
- **WHEN** it is called a second time (e.g., during hot-reload)
- **THEN** the function SHALL throw an error indicating handlers are already registered
- **AND** the existing handlers SHALL remain intact

### Requirement: GraviScan Conditional Mode Registration

The system SHALL register GraviScan IPC handlers only when the configured scanner mode is `graviscan`. When mode is `cylinderscan` or empty, no GraviScan handlers SHALL be registered. The `initGraviScan()` function SHALL be exported from `src/main/graviscan/wiring.ts`.

#### Scenario: GraviScan handlers registered in graviscan mode

- **GIVEN** `SCANNER_MODE=graviscan` in the `.env` config
- **WHEN** the app starts and `initGraviScan()` is called
- **THEN** `registerGraviScanHandlers` SHALL be called
- **AND** all 18 `graviscan:*` IPC channels SHALL be available

#### Scenario: GraviScan handlers not registered in cylinderscan mode

- **GIVEN** `SCANNER_MODE=cylinderscan` in the `.env` config
- **WHEN** the app starts
- **THEN** `registerGraviScanHandlers` SHALL NOT be called
- **AND** invoking any `graviscan:*` IPC channel SHALL result in an unhandled channel error

#### Scenario: GraviScan handlers not registered when mode is empty

- **GIVEN** `SCANNER_MODE` is not set or is an empty string in the `.env` config
- **WHEN** the app starts
- **THEN** `registerGraviScanHandlers` SHALL NOT be called

### Requirement: GraviScan Session State Management

The system SHALL maintain scan session state at module level in `src/main/graviscan/wiring.ts` and expose it via getter/setter functions passed to handler modules through dependency injection. The session state type `ScanSessionState` SHALL be defined in `src/types/graviscan.ts`.

#### Scenario: Session state accessible via getters

- **GIVEN** the GraviScan session state is initialized in `src/main/graviscan/wiring.ts`
- **WHEN** `sessionFns.getScanSession()` is called
- **THEN** it SHALL return the current `ScanSessionState` or `null` if no scan is active

#### Scenario: Session state updated by handlers

- **GIVEN** a scan is started via `graviscan:start-scan`
- **WHEN** `startScan()` calls `sessionFns.setScanSession(newState)`
- **THEN** `sessionFns.getScanSession()` SHALL return the updated state
- **AND** the state SHALL include `isActive`, `isContinuous`, `experimentId`, `phenotyperId`, `resolution`, `sessionId`, `jobs`, `currentCycle`, `totalCycles`, `intervalMs`, `scanStartedAt`, `scanEndedAt`, `scanDurationMs`, `coordinatorState`, `nextScanAt`, and `waveNumber` fields

#### Scenario: Session state cleared on cancel

- **GIVEN** an active scan session exists
- **WHEN** `graviscan:cancel-scan` is invoked
- **THEN** `cancelScan()` SHALL call `sessionFns.setScanSession(null)`
- **AND** `sessionFns.getScanSession()` SHALL return `null`

#### Scenario: Concurrent start-scan rejected when session active

- **GIVEN** an active scan session exists (`getScanSession()` returns non-null with `isActive: true`)
- **WHEN** the renderer invokes `graviscan:start-scan`
- **THEN** the handler SHALL return `{ success: false, error: 'Scan already in progress' }`
- **AND** the existing session SHALL NOT be modified

#### Scenario: markScanJobRecorded updates job status

- **GIVEN** an active scan session exists with a job keyed by `scannerId:plateIndex`
- **WHEN** `sessionFns.markScanJobRecorded('scanner1:00')` is called
- **THEN** the job's `status` field SHALL be set to `'recorded'`

#### Scenario: markScanJobRecorded ignores unknown job key

- **GIVEN** an active scan session exists
- **WHEN** `sessionFns.markScanJobRecorded('nonexistent:99')` is called
- **THEN** the session state SHALL NOT be modified
- **AND** no error SHALL be thrown

#### Scenario: markScanJobRecorded no-ops when session is null

- **GIVEN** no scan session is active (`getScanSession()` returns `null`)
- **WHEN** `sessionFns.markScanJobRecorded('scanner1:00')` is called
- **THEN** no error SHALL be thrown
- **AND** `getScanSession()` SHALL still return `null`

### Requirement: GraviScan Coordinator Lazy Instantiation

The `ScanCoordinator` SHALL be instantiated lazily — created only when `graviscan:start-scan` is invoked, not at app startup. The `getOrCreateCoordinator()` function SHALL be exported from `src/main/graviscan/wiring.ts`. This matches the CylinderScan pattern where `ScannerProcess` is created in the `scanner:initialize` handler.

#### Scenario: No coordinator at startup

- **GIVEN** the app starts in `graviscan` mode
- **WHEN** no scan has been initiated
- **THEN** no `ScanCoordinator` instance SHALL exist
- **AND** no Python subprocesses SHALL be spawned

#### Scenario: Coordinator created on first call

- **GIVEN** the app is in `graviscan` mode
- **AND** no `ScanCoordinator` instance exists
- **WHEN** `getOrCreateCoordinator()` is called
- **THEN** a new `ScanCoordinator` SHALL be instantiated
- **AND** its events SHALL be wired to the renderer via `setupCoordinatorEventForwarding()`

#### Scenario: Coordinator returned from cache on subsequent calls

- **GIVEN** a `ScanCoordinator` instance already exists
- **WHEN** `getOrCreateCoordinator()` is called
- **THEN** the existing instance SHALL be returned
- **AND** no new `ScanCoordinator` SHALL be created

#### Scenario: Concurrent calls return same instance

- **GIVEN** `getOrCreateCoordinator()` is called concurrently from multiple callers
- **WHEN** both calls resolve
- **THEN** both SHALL return the same `ScanCoordinator` instance
- **AND** only one `ScanCoordinator` SHALL have been created (promise memoization)

#### Scenario: Coordinator shutdown on app quit

- **GIVEN** a `ScanCoordinator` instance exists (scan was started)
- **WHEN** the app is quitting
- **THEN** `shutdownGraviScan()` SHALL be called
- **AND** the coordinator SHALL be shut down gracefully via `coordinator.shutdown()`
- **AND** `closeScanLog()` SHALL be called

### Requirement: GraviScan Coordinator Event Forwarding

The system SHALL forward `ScanCoordinator` events to the renderer process via IPC. The `setupCoordinatorEventForwarding()` function SHALL be exported from `src/main/graviscan/wiring.ts`. All forwarding SHALL use the `if (mainWindow && !mainWindow.isDestroyed())` guard pattern.

#### Scenario: Scan events forwarded to renderer

- **GIVEN** a `ScanCoordinator` is active and `mainWindow` exists
- **WHEN** the coordinator emits `scan-started`, `scan-complete`, `scan-error`, `grid-start`, `grid-complete`, `cycle-complete`, `interval-start`, `interval-waiting`, `interval-complete`, `overtime`, `cancelled`, or `scanner-init-status`
- **THEN** the event SHALL be forwarded to the renderer via `mainWindow.webContents.send('graviscan:<event-name>', payload)`

#### Scenario: No crash when mainWindow is null

- **GIVEN** a `ScanCoordinator` is active
- **AND** `mainWindow` is `null`
- **WHEN** the coordinator emits an event
- **THEN** the event SHALL be silently dropped (no crash, no error log)

#### Scenario: No crash when mainWindow is destroyed

- **GIVEN** a `ScanCoordinator` is active
- **AND** `mainWindow.isDestroyed()` returns `true`
- **WHEN** the coordinator emits an event
- **THEN** the event SHALL be silently dropped (no crash, no error log)

### Requirement: GraviScan Preload Context Bridge

The preload script SHALL expose a `gravi` namespace on `window.electron` with methods for all GraviScan IPC channels and event listeners.

#### Scenario: Invoke methods available

- **GIVEN** the preload script has run
- **WHEN** renderer code accesses `window.electron.gravi`
- **THEN** the following 15 invoke methods SHALL be available: `detectScanners`, `getConfig`, `saveConfig`, `saveScannersToDB`, `getPlatformInfo`, `validateScanners`, `validateConfig`, `startScan`, `getScanStatus`, `markJobRecorded`, `cancelScan`, `getOutputDir`, `readScanImage`, `uploadAllScans`, `downloadImages`
- **AND** the following 13 event listener methods SHALL be available: `onScanStarted`, `onScanComplete`, `onGridStart`, `onGridComplete`, `onCycleComplete`, `onIntervalStart`, `onIntervalWaiting`, `onIntervalComplete`, `onOvertime`, `onCancelled`, `onScanError`, `onUploadProgress`, `onDownloadProgress`
- **AND** `onScanEvent` SHALL NOT be present

#### Scenario: Granular event listener registration

- **GIVEN** the preload script has run
- **WHEN** renderer code calls `window.electron.gravi.onScanStarted(callback)`, `onScanComplete(callback)`, or `onScanError(callback)`
- **THEN** each SHALL register a listener for its correspondingly-named channel (`graviscan:scan-started`, `graviscan:scan-complete`, `graviscan:scan-error`) via `ipcRenderer.on()`
- **AND** the callback SHALL be invoked when the main process sends the matching message, with a payload including `jobId`, `scannerId`, and `plateIndex`

#### Scenario: Event listener cleanup

- **GIVEN** renderer code has registered an event listener via `window.electron.gravi.onScanStarted(callback)` (or `onScanComplete`/`onScanError`)
- **AND** the call returned a cleanup function
- **WHEN** the cleanup function is called
- **THEN** the listener SHALL be removed via `ipcRenderer.removeListener()`
- **AND** subsequent messages on that channel SHALL NOT invoke the callback

### Requirement: GraviScan Barrel Exports

The `src/main/graviscan/index.ts` barrel SHALL export all existing handler exports unchanged, plus `initGraviScan` and `shutdownGraviScan` from `wiring`. The full barrel export list SHALL include: `registerGraviScanHandlers` from `register-handlers`, `ScanCoordinator` from `scan-coordinator`, `ScannerSubprocess` from `scanner-subprocess`, `scanLog`, `cleanupOldLogs`, `closeScanLog` from `scan-logger`, `initGraviScan` and `shutdownGraviScan` from `wiring`, in addition to all existing handler module re-exports.

#### Scenario: All public symbols exported

- **GIVEN** a TypeScript file imports from `./graviscan`
- **WHEN** it references `registerGraviScanHandlers`, `ScanCoordinator`, `ScannerSubprocess`, `scanLog`, `cleanupOldLogs`, `closeScanLog`, `initGraviScan`, or `shutdownGraviScan`
- **THEN** the imports SHALL resolve without TypeScript compilation errors

### Requirement: GraviScan Graceful Shutdown

The system SHALL provide a `shutdownGraviScan()` function in `src/main/graviscan/wiring.ts` that encapsulates all GraviScan cleanup: coordinator shutdown and scan log closing. This function SHALL be called from `main.ts` during the `before-quit` handler.

#### Scenario: Coordinator shutdown when active

- **GIVEN** a `ScanCoordinator` instance exists
- **WHEN** `shutdownGraviScan()` is called
- **THEN** `coordinator.shutdown()` SHALL be called
- **AND** the internal coordinator reference SHALL be set to `null`
- **AND** `closeScanLog()` SHALL be called

#### Scenario: No-op when no coordinator exists

- **GIVEN** no `ScanCoordinator` instance exists (no scan was started)
- **WHEN** `shutdownGraviScan()` is called
- **THEN** no error SHALL be thrown
- **AND** `closeScanLog()` SHALL still be called (safe to call even if not opened)

#### Scenario: Coordinator shutdown error handled gracefully

- **GIVEN** a `ScanCoordinator` instance exists
- **AND** `coordinator.shutdown()` throws an error
- **WHEN** `shutdownGraviScan()` is called
- **THEN** the error SHALL be caught and logged via `console.error`
- **AND** the coordinator reference SHALL still be set to `null`
- **AND** `closeScanLog()` SHALL still be called

#### Scenario: Shutdown awaits in-flight coordinator creation

- **GIVEN** `getOrCreateCoordinator()` has been called and its creation promise is pending
- **WHEN** `shutdownGraviScan()` is called before creation completes
- **THEN** the function SHALL await the pending creation
- **AND** shut down the resulting coordinator
- **AND** no orphaned coordinator instance SHALL remain

#### Scenario: Shutdown handles rejected coordinator creation

- **GIVEN** `getOrCreateCoordinator()` has been called and its creation promise is pending
- **AND** the creation promise will reject (e.g., Python executable not found)
- **WHEN** `shutdownGraviScan()` is called
- **THEN** the rejection SHALL be caught and logged via `console.error`
- **AND** the coordinator reference SHALL remain `null`
- **AND** `closeScanLog()` SHALL still be called

### Requirement: GraviScan Wiring Module Side-Effect-Free

The `src/main/graviscan/wiring.ts` module SHALL be side-effect-free at load time. Importing the module SHALL NOT execute any code beyond variable declarations and function definitions. The module SHALL use only `import type` at the top level — no runtime Electron imports.

#### Scenario: Module importable in Node test environment

- **GIVEN** a Node.js test environment without Electron
- **AND** the `electron` module is mocked (intercepting dynamic imports inside functions)
- **WHEN** `wiring.ts` is imported
- **THEN** no side effects SHALL occur (no IPC registration, no subprocess spawning, no file I/O)
- **AND** all exported functions (`initGraviScan`, `shutdownGraviScan`, `getOrCreateCoordinator`, `setupCoordinatorEventForwarding`, `graviSessionFns`, `_resetWiringState`) SHALL be defined and callable

### Requirement: GraviScan Scan Log Lifecycle

The system SHALL call `cleanupOldLogs()` during app startup and `closeScanLog()` during app quit to manage scan log file lifecycle.

#### Scenario: Old logs cleaned on startup

- **GIVEN** the app starts in `graviscan` mode
- **AND** scan log files older than the retention window (default 180 days) exist in `~/.bloom/logs/`
- **WHEN** initialization completes
- **THEN** `cleanupOldLogs()` SHALL be called
- **AND** log files older than the retention window SHALL be deleted
- **AND** recent log files SHALL be preserved

#### Scenario: Log stream closed on quit

- **GIVEN** the app is quitting
- **AND** the scan log write stream is open
- **WHEN** the `before-quit` or `will-quit` event fires
- **THEN** `closeScanLog()` SHALL be called
- **AND** the write stream SHALL be flushed and closed
- **AND** subsequent `scanLog()` calls SHALL not throw

### Requirement: GraviScan IPC Path Validation

The `graviscan:read-scan-image` IPC handler SHALL validate that the resolved file path is within the configured scan output directory before reading the file. This prevents path traversal attacks from a compromised renderer.

#### Scenario: Valid path within output directory

- **GIVEN** `getOutputDir()` returns `/home/user/.bloom/graviscan/`
- **WHEN** the renderer invokes `graviscan:read-scan-image` with path `/home/user/.bloom/graviscan/exp1/scan.tiff`
- **THEN** the handler SHALL proceed with reading the image

#### Scenario: Path traversal attempt rejected

- **GIVEN** `getOutputDir()` returns `/home/user/.bloom/graviscan/`
- **WHEN** the renderer invokes `graviscan:read-scan-image` with path `/etc/passwd` or `../../etc/passwd`
- **THEN** the handler SHALL return `{ success: false, error: 'Path outside scan directory' }`
- **AND** the file SHALL NOT be read

#### Scenario: Path validation uses resolved paths

- **GIVEN** `getOutputDir()` returns a path that may contain symlinks or relative components
- **WHEN** the handler validates a candidate file path
- **THEN** both the output directory and the candidate path SHALL be resolved via `path.resolve()` before the `startsWith` comparison
- **AND** paths with `..` components SHALL be normalized before comparison

### Requirement: GraviScan Upload Guard

The `graviscan:upload-all-scans` IPC handler SHALL reject upload requests when the coordinator is actively scanning to prevent uploading partially written scan files.

#### Scenario: Upload rejected during active scan

- **GIVEN** a `ScanCoordinator` is active and `isScanning` is `true`
- **WHEN** the renderer invokes `graviscan:upload-all-scans`
- **THEN** the handler SHALL return `{ success: false, error: 'Cannot upload while scanning is in progress' }`

#### Scenario: Upload allowed when no scan active

- **GIVEN** no `ScanCoordinator` exists or `isScanning` is `false`
- **WHEN** the renderer invokes `graviscan:upload-all-scans`
- **THEN** the handler SHALL proceed with the upload

### Requirement: GraviScan Type Definitions for Preload API

The system SHALL define a `GraviAPI` interface in `src/types/electron.d.ts` and add `gravi: GraviAPI` to the `ElectronAPI` interface, providing type safety for renderer code accessing GraviScan IPC channels.

#### Scenario: GraviAPI type available in renderer

- **GIVEN** a renderer TypeScript file accesses `window.electron.gravi`
- **WHEN** the file is compiled with `npx tsc --noEmit`
- **THEN** the compiler SHALL recognize all 15 invoke methods and 12 event listener methods with correct parameter and return types

### Requirement: GraviScan IPC Integration Testing

The system SHALL include integration tests verifying the full IPC round-trip for GraviScan handlers, both via Vitest (mocked ipcMain) and Playwright E2E (real Electron app).

#### Scenario: Handler invocation returns wrapped response

- **GIVEN** `registerGraviScanHandlers` has been called with a mock database
- **WHEN** a registered handler is invoked (e.g., `graviscan:detect-scanners`)
- **THEN** the response SHALL be `{ success: true, data: <result> }` where `<result>` is the return value of the corresponding handler module function

#### Scenario: E2E round-trip from renderer via gravi namespace

- **GIVEN** the Electron app is running in `graviscan` mode with `GRAVISCAN_MOCK=true`
- **WHEN** renderer code calls `window.electron.gravi.detectScanners()`
- **THEN** the response SHALL contain mock scanner data
- **AND** `window.electron.gravi.getPlatformInfo()` SHALL return platform information
- **AND** `window.electron.gravi.getScanStatus()` SHALL return `null` (no active scan)

#### Scenario: E2E event listener cleanup

- **GIVEN** the Electron app is running in `graviscan` mode
- **WHEN** renderer code calls `window.electron.gravi.onScanEvent(callback)`
- **THEN** it SHALL return a function (cleanup)
- **AND** the cleanup function SHALL be callable without error

### Requirement: Scan File Saved with Final Filename

The scan worker SHALL save scan output files with both `_st_TIMESTAMP` (start) and `_et_TIMESTAMP` (end) in the filename at write time, via `compose_output_path()`. No post-save rename SHALL occur.

#### Scenario: Plate scan completes with final filename on disk

- **GIVEN** the worker receives `output_path = "..._st_20260413T120530_cy1_S1_00.tif"`
- **WHEN** the plate scan completes
- **THEN** the file SHALL be saved as `..._st_20260413T120530_et_20260413T120545_cy1_S1_00.tif`
- **AND** no rename operation SHALL occur after save
- **AND** the `scan-complete` event SHALL contain the final path (with `_et_`)

#### Scenario: Coordinator learns the real path from scan-complete, not the path it sent

- **GIVEN** a scan completes successfully
- **WHEN** the coordinator verifies and reports the output file
- **THEN** the path used SHALL be the one reported in the plate's `scan-complete` event
- **AND** SHALL NOT be assumed from the path the coordinator originally sent to the worker

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

### Requirement: Reset USB Scanner Connection

The system SHALL provide a "Reset USB" button on the Configure Scanner page that gracefully shuts down all SANE connections, clears stale USB addresses from the database, re-detects scanners via lsusb, and re-initializes subprocesses.

#### Scenario: Reset with all scanners connected

- **GIVEN** scanners are configured and initialized
- **WHEN** the user clicks "Reset USB"
- **THEN** all scanner subprocesses SHALL be gracefully shut down via `coordinator.shutdown()`
- **AND** `usb_bus` and `usb_device` SHALL be set to null on all enabled GraviScanner records
- **AND** `usb_port` SHALL be preserved for stable matching
- **AND** scanners SHALL be re-detected via lsusb with fresh bus/device numbers
- **AND** detected scanners SHALL be matched to DB records by `usb_port`
- **AND** subprocesses SHALL be re-initialized for matched scanners
- **AND** the handler SHALL return per-scanner status (ready or disconnected)

#### Scenario: Reset when a scanner is unplugged

- **GIVEN** 5 scanners were configured but 1 has been physically unplugged
- **WHEN** the user clicks "Reset USB"
- **THEN** the 4 connected scanners SHALL be re-initialized with status "ready"
- **AND** the unplugged scanner SHALL have status "disconnected"

#### Scenario: Reset USB blocked during active scan

- **GIVEN** a scan is in progress
- **WHEN** the user views the Configure Scanner page
- **THEN** the "Reset USB" button SHALL be disabled

### Requirement: scan-error Event Payload Extended with Timing and Bytes Fields

The `python/graviscan/scan_worker.py` worker SHALL emit `scan-error` events with two new payload fields in addition to the existing fields (`type`, `scanner_id`, `plate_index`, `job_id`, `error`):

- `bytes_received: int` — number of image bytes successfully read from
  the device before failure. `0` when the failure occurs before any
  bytes are transferred (e.g., `sane.start()` raises).
- `wall_seconds: float` — elapsed seconds from scan start to error
  emission. Measured via `time.monotonic()` (not wall-clock time).

These fields are required by the `WedgeDetector` module's
`device_io_120s_zero_bytes` signature. They are additive and do not
break existing consumers of `scan-error` events.

#### Scenario: scan-error includes bytes_received and wall_seconds

- **GIVEN** a SANE scan fails mid-stream after transferring 5 MB of
  data over 87 seconds
- **WHEN** the worker emits a `scan-error` event
- **THEN** the event payload SHALL include `bytes_received: 5242880`
  (or the actual bytes count) and `wall_seconds: 87.x`
- **AND** SHALL still include the existing fields unchanged

#### Scenario: zero-byte failure reports bytes_received=0

- **GIVEN** a SANE scan fails before any image data is transferred
  (e.g., `sane.start()` raises `LIBUSB_ERROR_TIMEOUT`)
- **WHEN** the worker emits the `scan-error` event
- **THEN** `bytes_received` SHALL be `0`
- **AND** `wall_seconds` SHALL be the elapsed time from scan start to
  emit (typically ~120 s for a libusb-timeout failure)

---

### Requirement: V600 Wedge Detection from Scan-Error Events

The system SHALL provide a `WedgeDetector` module in
`src/main/wedge-detector.ts` that subscribes to scan-error events from
the scan-coordinator and emits a `wedge-detected` event when any of
three signatures is observed. Detection SHALL be event-driven (not
exit-code-driven), matching the existing pattern where SANE/scanimage
exceptions are emitted as `scan-error` events from
`python/graviscan/scan_worker.py`.

The three signatures are:

1. **`sane_start_invalid`** — the scan-error event's `error.message`
   field contains the substring `sane_start: Invalid argument`.
2. **`device_io_120s_zero_bytes`** — the scan-error event's
   `error.message` contains `Error during device I/O`, AND its
   `bytes_received` field is `0`, AND its `wall_seconds` field is
   `>= 120` (matching the empirically-observed libusb timeout
   threshold from investigation summary Section 1.2).
3. **`consecutive_failures`** — two or more scan-error events from the
   same `scanner_id` are observed within the same scan cycle (the
   counter resets on `cycle-start`).

The detector SHALL be pure logic: no I/O, no network calls, no
database writes. It SHALL be deterministic — feeding the same event
sequence twice produces identical `wedge-detected` output.

#### Scenario: sane_start signature emits one wedge event

- **GIVEN** a `WedgeDetector` instance
- **WHEN** a scan-error event arrives with `error.message` containing
  `sane_start: Invalid argument`
- **THEN** the detector SHALL emit exactly one `wedge-detected` event
  with `signature='sane_start_invalid'`
- **AND** the emitted event SHALL include the `scanner_id`,
  `session_id`, and `cycle_number` from the source scan-error event

#### Scenario: device-I/O signature requires all three sub-conditions

- **GIVEN** a `WedgeDetector` instance
- **WHEN** a scan-error event arrives with `error.message` containing
  `Error during device I/O` but `bytes_received > 0`
- **THEN** the detector SHALL NOT emit a `wedge-detected` event for the
  `device_io_120s_zero_bytes` signature (the signature requires all
  three sub-conditions: message match + zero bytes + ≥100 s wall)
- **AND** the detector MAY still emit a `consecutive_failures` event if
  the cycle counter reaches threshold

#### Scenario: consecutive-failures counter is per-scanner per-cycle

- **GIVEN** a `WedgeDetector` instance
- **AND** a cycle is in progress
- **WHEN** scan-error events arrive for scannerId `A`, then `B`, then
  `A` again (all within the same cycle)
- **THEN** the detector SHALL emit one `wedge-detected` event for `A`
  with `signature='consecutive_failures'` (because `A` reached
  count 2)
- **AND** the detector SHALL NOT emit a `wedge-detected` event for `B`
  (because `B` only reached count 1)

#### Scenario: cycle boundary resets the counter

- **GIVEN** a `WedgeDetector` instance
- **AND** scannerId `A` has emitted one scan-error in cycle 1
- **WHEN** a `cycle-start` event arrives (cycle 2 begins)
- **AND** scannerId `A` emits one more scan-error in cycle 2
- **THEN** the detector SHALL NOT emit a `consecutive_failures` event
  (the counter reset on `cycle-start`)

#### Scenario: detector is deterministic and idempotent

- **GIVEN** a fixed sequence of scan-error and cycle-start events
- **WHEN** the events are replayed through two independent
  `WedgeDetector` instances
- **THEN** both instances SHALL emit identical `wedge-detected` event
  sequences (same order, same payloads)

#### Scenario: same-signature dedup within a cycle

- **GIVEN** a `WedgeDetector` instance
- **WHEN** two `scan-error` events from the same scanner_id `A` arrive
  in the same cycle, both with `error.message` containing
  `sane_start: Invalid argument`
- **THEN** the detector SHALL emit exactly ONE `wedge-detected` event
  with signature `sane_start_invalid` (not two — the same signature
  on the same scanner in the same cycle is deduplicated)

#### Scenario: recovered scan does not emit a wedge

- **GIVEN** a `scan-error` event arrives that matches a wedge signature
  for `(scanner_id=A, plate_index=00)`
- **WHEN** a subsequent `scan-complete` event for the same
  `(scanner_id=A, plate_index=00)` arrives in the same cycle (the scan
  recovered)
- **THEN** the detector SHALL NOT emit a `wedge-detected` event for
  this case
- **AND** the consecutive-failure counter for `A` SHALL still
  reflect the failed attempt (in case a subsequent failure brings the
  counter to threshold within the cycle)

#### Scenario: duplicate cycle-start events are idempotent

- **GIVEN** a `WedgeDetector` instance has counters reset for cycle
  number `N`
- **WHEN** a second `cycle-start` event arrives with the same cycle
  number `N`
- **THEN** the detector SHALL NOT reset counters again (it tracks the
  last-seen cycle number and ignores duplicates)
- **AND** subsequent scan-error events SHALL be tracked against the
  existing per-scanner counts

---

### Requirement: Slack Notification on Wedge Detection

The system SHALL provide a `SlackNotifier` module in
`src/main/slack-notifier.ts` that POSTs a structured message to a
configurable Slack webhook URL when the `WedgeDetector` emits a
`wedge-detected` event. The webhook URL SHALL be loaded from the
`BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` environment variable via
`config-store.ts`.

If the env var is absent (or empty), the notifier SHALL be a no-op:
no fetch call, no error, no log spam.

The notifier SHALL rate-limit at most one notification per
`(scanner_id, session_id)` per 60 seconds. The rate-limit key is the
tuple — different scanners or different sessions are independent.

The Slack message body SHALL be JSON-encoded with a `text` field
containing all of:

- Scanner ID and display name
- USB path
- Session ID
- Cycle number
- Timestamp (ISO 8601 with timezone)
- The matched wedge signature (one of `sane_start_invalid`,
  `device_io_120s_zero_bytes`, `consecutive_failures`)
- Operator call-to-action: `Physical AC power-cycle required.`
- Link to the investigation summary PDF on Box

An example payload SHALL match the following shape:

```json
{
  "text": "🚨 V600 wedge on Scanner 3 (port 17-2)\nSession: 4e23d765-...\nCycle: 47 of 96\nTime: 2026-05-21T14:32:18-07:00\nSignature: sane_start_invalid\nPhysical AC power-cycle required.\nDetails: https://salkinstitute.box.com/s/rj7dcdv8g8wo6kps1qy36ffaj21cwx0x"
}
```

The fetch request SHALL be bounded by a configurable timeout
(default 10 seconds) using `AbortController` so a hung webhook
cannot block the notifier indefinitely.

A fetch failure (network error, non-2xx status, timeout) SHALL be
logged but SHALL NOT throw or crash the caller. The error log message
SHALL NOT contain the webhook URL, the full error object, or any
request headers — only a sanitized one-line description (e.g.,
`"Slack POST failed: timeout after 10s"` or
`"Slack POST failed: HTTP 503"`). This prevents the webhook URL from
leaking into stderr, log files, or any downstream log aggregation.

#### Scenario: Absent webhook URL disables notifications

- **GIVEN** `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` is unset
- **WHEN** a `wedge-detected` event arrives
- **THEN** the notifier SHALL NOT call fetch
- **AND** SHALL NOT log an error
- **AND** SHALL NOT throw

#### Scenario: First wedge for a scanner+session triggers a Slack POST

- **GIVEN** `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` is set to a valid URL
- **AND** no prior notification for `(scanner_id=A, session_id=S)` in
  this process
- **WHEN** a `wedge-detected` event arrives for `(A, S)`
- **THEN** the notifier SHALL issue exactly one fetch POST to the
  webhook URL
- **AND** the POST body SHALL include the scanner ID, USB path, session
  ID, cycle number, signature, timestamp, power-cycle CTA, and Box link

#### Scenario: Rate limit suppresses repeats within 60 seconds

- **GIVEN** the notifier has just notified for `(A, S)` at time T
- **WHEN** another `wedge-detected` event for `(A, S)` arrives at time
  T+30 seconds
- **THEN** the notifier SHALL NOT issue a fetch POST
- **AND** the suppressed event SHALL be counted in an internal
  `suppressedCount` metric for observability

#### Scenario: Rate limit is per (scanner_id, session_id)

- **GIVEN** the notifier has just notified for `(A, S1)`
- **WHEN** a `wedge-detected` event for `(A, S2)` arrives within
  60 seconds (same scanner, different session)
- **THEN** the notifier SHALL issue a fetch POST (different
  rate-limit key)

#### Scenario: Rate limit expires after 60 seconds

- **GIVEN** the notifier has just notified for `(A, S)` at time T
- **WHEN** another `wedge-detected` event for `(A, S)` arrives at time
  T+61 seconds
- **THEN** the notifier SHALL issue a fetch POST

#### Scenario: Fetch failure does not crash

- **GIVEN** `BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` is set to an
  unreachable URL
- **WHEN** a `wedge-detected` event arrives and the fetch rejects
- **THEN** the notifier SHALL log the failure
- **AND** SHALL NOT throw or propagate the error to its caller

#### Scenario: Fetch timeout aborts after configured duration

- **GIVEN** the notifier has a timeout of 10 seconds
- **WHEN** a `wedge-detected` event arrives and the fetch hangs
- **THEN** the notifier SHALL abort the request via `AbortController`
  after 10 seconds
- **AND** SHALL log a sanitized failure message
- **AND** SHALL NOT block subsequent `notify()` calls

#### Scenario: Error log does not contain the webhook URL

- **GIVEN** the notifier is configured with
  `https://hooks.slack.com/services/SECRET/PATH`
- **WHEN** a fetch fails with any error (network, status, timeout)
- **AND** the notifier writes a log message via `console.error` or
  the bloom logger
- **THEN** the log message SHALL NOT contain the substring
  `hooks.slack.com` or `/services/SECRET` or any portion of the URL
  past the protocol
- **AND** SHALL NOT contain the request body or headers

---

### Requirement: USBDEVFS_RESET Removed from Recovery Path

The `_reopen_device()` recovery path in `python/graviscan/scan_worker.py` SHALL NOT invoke `_reset_usb_device()` (the helper that issues `USBDEVFS_RESET` ioctl via `/dev/bus/usb/<bus>/<dev>`).

Per investigation summary Section 1.2 ("kernel evidence showed every USB read got a response — the failure is inside the scanner, firmware most likely") and issue #228 ("USBDEVFS_RESET makes wedges worse; controller FLR detaches the scanner entirely; only physical AC power-cycle recovers"), the kernel-level reset is actively harmful on V600 wedges and provides no demonstrated benefit on non-wedge transient failures.

The `_reset_usb_device()` method itself MAY remain in the codebase for testability and potential future reconsideration. No production code path SHALL invoke it. The remaining recovery sequence — `device.cancel()` (line 504–507) → `device.close()` (line 508–511) → `sane.exit()` (line 512–516) → `time.sleep(3)` (line 522) → `sane.init()` (line 532) → `sane.open()` (line 533) — SHALL be sufficient for non-wedge transient failures and SHALL fail fast (via `sane.open()` raising) on wedged scanners rather than compounding the wedge via the `USBDEVFS_RESET` ioctl (which per #228 can trigger controller FLR and detach the scanner entirely).

The 3-second `time.sleep()` at line 522 SHALL be preserved as a conservative bus-settle interval. It is annotated with a doc-comment explaining its retained purpose now that `USBDEVFS_RESET` no longer immediately precedes it.

#### Scenario: Recovery path does not call USBDEVFS_RESET

- **GIVEN** a `ScanWorker` whose most recent scan attempt failed
- **WHEN** `_reopen_device()` is invoked on the next scan attempt
- **THEN** the method SHALL NOT invoke `_reset_usb_device()`
- **AND** the method SHALL invoke (in order): `device.cancel()`, `device.close()`, `sane.exit()`, `time.sleep(3)`, `sane.init()`, `sane.open()`
- **AND** the 3-second sleep SHALL be preserved as a bus-settle interval (allows USB bus to quiesce before `sane.init()`)
- **AND** the existing 3-attempt retry-with-backoff loop around `sane.open()` (lines 530–550) SHALL be preserved

#### Scenario: \_reset_usb_device method preserved for testability

- **GIVEN** the codebase after this change
- **WHEN** a test or maintenance script imports `_reset_usb_device` from `scan_worker`
- **THEN** the method SHALL still exist on the `ScanWorker` class
- **AND** SHALL behave identically to its current implementation (issues USBDEVFS_RESET on Linux, silent skip on other platforms)
- **AND** SHALL carry a doc-comment explaining why no production code calls it

#### Scenario: Non-wedge transient failure still recovers

- **GIVEN** a scanner is healthy but a single scan fails (e.g., SANE busy, transient bus contention)
- **WHEN** `_reopen_device()` runs without USBDEVFS_RESET
- **THEN** `sane.init()` + `sane.open()` SHALL succeed (existing retry-with-backoff logic preserved)
- **AND** the next scan attempt in the outer retry loop SHALL proceed normally

---

### Requirement: libusb Endpoint Recovery Wrapper

The `src/main/native/libusb-filter.c` LD_PRELOAD shim SHALL intercept
`libusb_bulk_transfer` in addition to the existing `libusb_open`
interception. On `LIBUSB_ERROR_TIMEOUT` or `LIBUSB_ERROR_PIPE` for an
IN endpoint (endpoint address has the high bit `0x80` set), the
wrapper SHALL call `libusb_clear_halt()` on the endpoint before
returning the error to the caller.

The wrapper SHALL be controlled by the `LIBUSB_ENDPOINT_RECOVERY`
environment variable:

- `LIBUSB_ENDPOINT_RECOVERY=false` ⇒ wrapper is a pass-through (no
  `libusb_clear_halt` call).
- Any other value (or unset) ⇒ wrapper is active (default-on).

The shim SHALL log a single init-time message to stderr indicating
whether endpoint recovery is on or off:

```
[libusb-filter] endpoint recovery: on
```

`src/main/scanner-subprocess.ts` SHALL pass `LIBUSB_ENDPOINT_RECOVERY`
to the subprocess environment when LD_PRELOAD is set (Linux, non-mock).

#### Scenario: Endpoint recovery active by default

- **GIVEN** `LIBUSB_ENDPOINT_RECOVERY` is unset
- **AND** the shim is loaded via LD_PRELOAD into a process
- **WHEN** the shim initializes
- **THEN** the shim SHALL log `endpoint recovery: on` to stderr
- **AND** subsequent `libusb_bulk_transfer` calls that return TIMEOUT
  or PIPE for an IN endpoint SHALL invoke `libusb_clear_halt()` on
  that endpoint

#### Scenario: Explicit opt-out via env var

- **GIVEN** `LIBUSB_ENDPOINT_RECOVERY=false`
- **AND** the shim is loaded via LD_PRELOAD
- **WHEN** the shim initializes
- **THEN** the shim SHALL log `endpoint recovery: off` to stderr
- **AND** subsequent `libusb_bulk_transfer` calls SHALL NOT trigger
  `libusb_clear_halt()` regardless of return code

#### Scenario: Non-IN-endpoint timeout does not call clear_halt

- **GIVEN** endpoint recovery is active
- **WHEN** `libusb_bulk_transfer` is called with an OUT endpoint
  (high bit `0x80` clear) and returns `LIBUSB_ERROR_TIMEOUT`
- **THEN** the shim SHALL NOT call `libusb_clear_halt()`
  (clear-halt-on-out is not the documented recovery for OUT
  endpoints)

#### Scenario: TypeScript env-var injection skips non-Linux platforms

- **GIVEN** the main process is running on macOS or Windows
- **WHEN** `ScannerSubprocess.spawn()` is called
- **THEN** the subprocess env SHALL NOT contain `LIBUSB_ENDPOINT_RECOVERY`
  (and SHALL NOT contain `LD_PRELOAD` — pre-existing platform guard
  remains in effect)

---

### Requirement: Scanner Resolution Runtime Validation

The Python scan worker (`python/graviscan/scan_worker.py`) SHALL
maintain an authoritative validated DPI set:

```python
V600_VALIDATED_DPI = {200, 400, 600, 800, 1200, 1600}
```

Before setting `x_resolution` and `y_resolution` on the SANE device,
the worker SHALL check whether the requested DPI value is in the
validated set. If not, the worker SHALL:

1. Log a warning to stderr including the requested value and the
   validated set.
2. Emit an `EVENT:` line on stdout with a documented JSON shape:

   ```json
   {
     "type": "dpi-warning",
     "scanner_id": "<scanner_id>",
     "requested_dpi": <int>,
     "validated_set": [200, 400, 600, 800, 1200, 1600],
     "timestamp": "<ISO 8601 with timezone>"
   }
   ```

3. Proceed with the scan attempt, passing the requested DPI value
   UNMODIFIED to `device.x_resolution` and `device.y_resolution`. The
   worker SHALL NOT clamp the value to the maximum validated DPI —
   the SANE backend may round internally, and the worker's job is to
   warn, not silently alter the operator's request.

This is defense-in-depth against future code paths that might bypass
the trimmed UI dropdown (e.g., programmatic config imports).

#### Scenario: Validated DPI proceeds silently

- **GIVEN** the worker is asked to scan at `resolution=1200`
- **WHEN** the worker reaches the DPI-setting step
- **THEN** the worker SHALL NOT log a warning
- **AND** SHALL NOT emit a `dpi-warning` event
- **AND** SHALL proceed to set `x_resolution=1200` and
  `y_resolution=1200`

#### Scenario: Unvalidated DPI logs and emits warning

- **GIVEN** the worker is asked to scan at `resolution=3200`
  (outside the validated set)
- **WHEN** the worker reaches the DPI-setting step
- **THEN** the worker SHALL log a stderr warning containing the
  requested value and the validated set
- **AND** SHALL emit `EVENT:` JSON with type `dpi-warning` and
  `requested_dpi=3200`
- **AND** SHALL proceed to attempt the scan

---

### Requirement: Coordinator Single-Scanner Spawn API

The `ScanCoordinator` class SHALL expose `addScanner(config)` and
`hasWorker(scannerId)` public methods.

- `addScanner(config: ScannerConfig): Promise<void>` — spawns a
  `ScannerSubprocess` for the given config and adds it to the
  subprocess map. If a worker for `config.scannerId` is already in
  the map and in `ready` state, this is a no-op. The `ScannerConfig`
  type is the existing shared type at `src/types/graviscan.ts`. When
  `isScanning === true`, the spawn request SHALL be queued internally
  and executed on the next `cycle-complete` event so that mid-scan
  event-loop traffic is not disrupted. Queued requests SHALL be
  deduplicated per `scannerId`: a mid-scan call for a `scannerId` that
  already has a queued spawn SHALL return that pending request's own
  `Promise` instead of queueing a second spawn. This prevents two
  concurrent `addScanner()` calls for the same `scannerId` from each
  constructing a subprocess within the same `cycle-complete` tick and
  racing to shut one another down mid-spawn, while still guaranteeing
  that a queued spawn actually executes. The queued request's record
  SHALL be cleared once its spawn settles, so a later call for the same
  `scannerId` is not handed an already-settled `Promise`.
  - Deduplication SHALL NOT be implemented by having the queued handler
    re-invoke the public `addScanner(config)` method: `scanOnce()` emits
    `cycle-complete` before it resets its state to `'idle'`, so
    `isScanning` is still `true` at the synchronous instant every
    listener runs, and a re-entrant call would re-queue itself
    indefinitely instead of ever spawning (see `design.md`).
- `hasWorker(scannerId: string): boolean` — returns `true` if the
  subprocess map contains a worker for that scanner_id AND the
  worker is in `ready` state. Returns `false` otherwise (missing,
  `initializing`, or `dead`).

The existing `initialize(scanners[])` method SHALL be refactored to
use `addScanner()` internally so worker spawn logic lives in one
place.

#### Scenario: addScanner spawns one worker without disturbing existing

- **GIVEN** a `ScanCoordinator` with workers in `ready` state for
  scannerIds `[A, B]`
- **WHEN** `addScanner({scannerId: 'C', ...})` is called
- **THEN** a new `ScannerSubprocess` SHALL be spawned for `C`
- **AND** workers for `A` and `B` SHALL NOT be torn down or respawned
- **AND** after the spawn settles, `hasWorker('A')`, `hasWorker('B')`,
  and `hasWorker('C')` all return `true`

#### Scenario: addScanner is idempotent for already-ready workers

- **GIVEN** a `ScanCoordinator` has a `ready` worker for scannerId `A`
- **WHEN** `addScanner({scannerId: 'A', ...})` is called
- **THEN** the existing worker SHALL be reused (no new subprocess
  spawned)
- **AND** the method SHALL resolve without error

#### Scenario: hasWorker semantics

- **GIVEN** a `ScanCoordinator` has subprocesses in different states
- **WHEN** `hasWorker(scannerId)` is queried
- **THEN** it SHALL return `true` only if the worker is in `ready`
  state
- **AND** it SHALL return `false` for `initializing`, `dead`, or
  missing workers

#### Scenario: addScanner during active scan is queued

- **GIVEN** a `ScanCoordinator` with `isScanning === true` (a cycle
  is in flight)
- **WHEN** `addScanner({scannerId: 'C', ...})` is called
- **THEN** the coordinator SHALL NOT immediately spawn a new
  subprocess
- **AND** the request SHALL be recorded in an internal per-`scannerId`
  pending-add map
- **AND** after the next `cycle-complete` event, the queued spawn
  SHALL execute and `hasWorker('C')` SHALL return `true`
- **AND** the method's returned `Promise` SHALL resolve once that spawn
  has settled

#### Scenario: Two concurrent addScanner calls for the same id spawn exactly one subprocess

- **GIVEN** a `ScanCoordinator` with `isScanning === true` (a cycle is in
  flight) and no worker yet for `scannerId` `'NEW'`
- **WHEN** `addScanner({scannerId: 'NEW', ...})` is called twice,
  concurrently, before the cycle completes
- **AND** the in-flight cycle's `cycle-complete` event then fires
- **THEN** the coordinator SHALL construct exactly one
  `ScannerSubprocess` for `'NEW'` — neither zero (a never-executed
  queued spawn) nor two
- **AND** SHALL NOT call `shutdown()` on a subprocess that is still
  mid-spawn as a side effect of the second call
- **AND** both returned `Promise`s SHALL resolve

### Requirement: Coordinator Stop-Scanner API

The `ScanCoordinator` class SHALL expose
`stopScanner(scannerId): Promise<void>` to support per-scanner
shutdown without affecting other workers. The method SHALL kill the
subprocess (or send quit + force-kill after timeout), remove the
entry from the subprocess map, and resolve. If no worker exists for
`scannerId`, the method SHALL resolve without error (idempotent).

#### Scenario: stopScanner removes one worker

- **GIVEN** a `ScanCoordinator` with workers for `[A, B]`
- **WHEN** `stopScanner('A')` is called
- **THEN** the worker for `A` SHALL be killed and removed from the
  subprocess map
- **AND** the worker for `B` SHALL be unaffected
- **AND** after the call, `hasWorker('A')` returns `false` and
  `hasWorker('B')` returns `true`

#### Scenario: stopScanner on unknown id is a no-op

- **GIVEN** a `ScanCoordinator` with no workers
- **WHEN** `stopScanner('does-not-exist')` is called
- **THEN** the method SHALL resolve without error

### Requirement: GraviScan Post-Scan Plate Position Verification

The system SHALL provide a `graviscan:verify-plates` capability that reads
the QR code embedded in each plate's scan image, looks up which plate that QR
code belongs to via `GraviPlateSectionMapping`, and compares it against the
plate the operator assigned to that scanner/position
(`GraviScanPlateAssignment`). Each plate SHALL be classified as one of
`verified`, `incorrect`, `swapped`, `unreadable`, `needs_review`,
`duplicate_qr`, or `lookup_failed`, and the final `verification_status` SHALL
be persisted onto `GraviScanPlateAssignment` for every plate submitted in the
batch.

#### Scenario: Detected plate matches assigned plate

- **GIVEN** a plate's scan image contains a QR code that maps (via
  `GraviPlateSectionMapping`) to the same plate ID as its
  `assignedPlateId`
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the plate's status SHALL be `verified`
- **AND** `GraviScanPlateAssignment.verification_status` SHALL be set to
  `verified` for that scanner/plate-index

#### Scenario: Detected plate matches assigned plate with different letter casing

- **GIVEN** a plate's `assignedPlateId` is `"Plate_13"` and the detected QR
  code maps to a `plate_id` of `"Plate_13"` in the DB (or any differing
  casing of the same identifier)
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the comparison SHALL be case-insensitive on **both** sides
- **AND** the plate's status SHALL be `verified`

#### Scenario: No QR code detected on a plate's image

- **GIVEN** a plate's scan image yields zero decoded QR codes
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the plate's status SHALL be `unreadable`
- **AND** `GraviScanPlateAssignment.verification_status` SHALL be set to
  `unreadable`

#### Scenario: Detected plate does not match assigned plate and no swap partner is found

- **GIVEN** a plate's detected QR code maps to a different plate ID than its
  `assignedPlateId`
- **AND** no other plate in the same batch forms a reciprocal swap with it
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the plate's status SHALL be `incorrect`
- **AND** `GraviScanPlateAssignment.verification_status` SHALL be set to
  `incorrect` — **not** remapped to `unreadable`
- **NOTE**: production's own implementation remaps this case to
  `unreadable` and its renderer shows an identical label for both cases.
  This is a deliberate departure from production: `incorrect` (QR read
  successfully, wrong plate) and `unreadable` (QR could not be read at all)
  are distinct, actionable-differently outcomes for an operator and SHALL
  remain distinguishable in persisted data. A future renderer consuming this
  status SHALL give `incorrect` its own label, not reuse "QR Unreadable".

#### Scenario: The plate-id lookup itself fails for a plate

- **GIVEN** a plate's image decoded one or more QR codes successfully
- **AND** the `GraviPlateSectionMapping` lookup for those codes throws (a
  locked, unavailable, or otherwise transiently failing database)
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the plate's status SHALL be `lookup_failed` — **not** collapsed
  into `unreadable`
- **AND** `GraviScanPlateAssignment.verification_status` SHALL be set to
  `lookup_failed`
- **AND** the decoded QR codes SHALL still be reported in the result
- **AND** the plate SHALL NOT be paired into any swap, since nothing is known
  about which plate it actually holds
- **AND** the rest of the batch SHALL be verified normally
- **NOTE**: this is the same status-collapse this capability already refuses
  to make for `incorrect`. `unreadable` tells an operator to go re-image the
  plate; the image was fine and the correct response is to retry the run.
  Persisting the wrong reason sends them to the wrong remedy.

#### Scenario: QR codes on one plate disagree about which plate they belong to

- **GIVEN** a plate's image yields multiple QR codes that map to more than
  one distinct plate ID via `GraviPlateSectionMapping`
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the plate's status SHALL be `needs_review`
- **AND** the result SHALL include the conflicting `plate_id -> qr codes`
  breakdown
- **AND** no automatic swap correction SHALL be attempted for that plate

#### Scenario: Same QR code detected on two different plates in one batch

- **GIVEN** two plates in the same verification batch each yield a detected
  QR code that is identical
- **WHEN** `graviscan:verify-plates` runs
- **THEN** both plates' status SHALL be `duplicate_qr`
- **AND** normal verified/incorrect classification SHALL be skipped for both

#### Scenario: Two plates were swapped during loading

- **GIVEN** plate A (assigned `Plate_13`) has a scan image whose detected QR
  code maps to `Plate_16`, and plate B (assigned `Plate_16`) has a scan image
  whose detected QR code maps to `Plate_13`
- **WHEN** `graviscan:verify-plates` runs
- **THEN** a swap SHALL be detected between plate A's position and plate B's
  position
- **AND** `GraviScanPlateAssignment.plate_barcode` SHALL be updated for both
  positions so each now holds the other's original assigned plate ID
- **AND** **every** non-deleted `GraviScan` record for each position within
  that experiment that still carries the pre-correction `plate_barcode` SHALL
  have its `plate_barcode` updated to match — not only the most recent one
- **AND** both positions' final `verification_status` SHALL be `swapped`
- **AND** both positions' `status` in the **returned results** SHALL also be
  `swapped`, not left at `incorrect` — the returned payload and the row the
  same run just wrote SHALL NOT disagree about the same plate
- **NOTE**: a swap can only be recognised once the whole batch has been
  classified, so the per-plate `verify-result` progress event for those two
  plates has already been emitted as `incorrect`. `verify-complete` carries
  the upgraded results.
- **NOTE**: a time-lapse session writes one `GraviScan` row per cycle for the
  same scanner/position, and `graviscan-upload.ts` reads `plate_barcode`
  **per row**. Correcting only the newest row left every earlier cycle
  uploading to Bloom and Box under the wrong plate. A mis-loaded plate is
  wrong for every cycle it was scanned in. Filtering on the pre-correction
  `plate_barcode` is what keeps this safe and idempotent: only rows that are
  actually wrong are touched, so a re-run cannot swap anything back.

#### Scenario: A write that matched no rows is reported, not silently ignored

- **GIVEN** a swap correction or `verification_status` write whose `where`
  clause matches no rows (for example, no `GraviScanPlateAssignment` row
  exists for the submitted `(experimentId, scannerId, plateIndex)`)
- **WHEN** that `updateMany` completes
- **THEN** its returned `count` SHALL be checked, and a count of zero where a
  match was expected SHALL be logged as a clear warning naming the
  experiment, scanner, and plate index
- **AND** the returned result SHALL carry those mismatches in a `warnings`
  field, so a swap SHALL NOT be reported in `swaps[]` alongside
  `success: true` with no indication that nothing was persisted
- **AND** `warnings` SHALL be absent when every write matched a row
- **NOTE**: Prisma does not treat an `updateMany` that matches nothing as an
  error — it returns `{ count: 0 }`. Discarding that count made "corrected
  three cycles' worth of scan records" and "wrote nothing at all"
  indistinguishable in both the return value and the logs.

#### Scenario: A swap correction is atomic per swap pair

- **GIVEN** a detected swap whose correction comprises four writes (two
  `GraviScanPlateAssignment` updates and two `GraviScan` updates)
- **WHEN** one of those writes fails part-way through
- **THEN** all four SHALL be rolled back — no partially-corrected pair SHALL
  be left in the database
- **AND** the transactional boundary SHALL be per **swap pair**, not per
  batch, so a failing pair still SHALL NOT abort the corrections for the
  other pairs in the same run
- **AND** the failure SHALL be caught and logged, and the batch SHALL
  continue
- **AND** the "swap corrected" audit log line SHALL be emitted only after the
  transaction commits
- **NOTE**: without this, a mid-sequence failure left the plate assignment
  and the scan history disagreeing about which plate sat in that position,
  with nothing in the data to indicate which one is right.

#### Scenario: experimentId scopes both the plate lookup and every DB write

- **GIVEN** an `experimentId` is passed to `graviscan:verify-plates`
- **WHEN** looking up which plate a detected QR code belongs to, **and** when
  persisting swap corrections or the final `verification_status`
- **THEN** the `GraviPlateSectionMapping` lookup SHALL be scoped to plates
  whose accession's metadata file is linked to that experiment
- **AND** every `GraviScanPlateAssignment`/`GraviScan` write SHALL be scoped
  to `(experimentId, scanner_id, plate_index)` — matching the actual
  `@@unique([experiment_id, scanner_id, plate_index])` constraint — so a
  scanner reused across experiments can never have one experiment's
  verification run overwrite a different experiment's historical data
  sharing the same scanner and plate position

#### Scenario: Every value that reaches a query scope is validated as a string

- **GIVEN** the `graviscan:verify-plates` IPC payload is untyped at the
  boundary, so `experimentId` and each plate's `scannerId`, `plateIndex`,
  `assignedPlateId`, and `imagePath` can be any JavaScript value at runtime
- **WHEN** verification runs
- **THEN** each of those values SHALL be validated with an explicit
  `typeof value === 'string' && value.length > 0` check — a truthiness check
  SHALL NOT be treated as sufficient
- **AND** a non-string `experimentId` (a number, an array, `null`, or a
  Prisma filter object such as `{ not: 'zzz' }`) SHALL fail the whole run
  before any decode or DB access, at **both** the IPC handler and the top of
  `verifyPlates()`
- **AND** a plate whose own fields are not all non-empty strings SHALL be
  skipped with a logged warning while the rest of the batch is verified
  normally, matching this module's per-record error isolation
- **AND** a `plates` payload that is not an array at all SHALL yield an empty
  result rather than throwing
- **NOTE**: Prisma silently DROPS a `where` key whose value is `undefined`
  and accepts a filter _object_ where a scalar was intended. Either shape
  turns the scoped `updateMany` calls described above into an
  experiment-wide overwrite of `plate_barcode`, `previous_plate_barcode`, and
  `verification_status`. The required-`experimentId` guarantee is only real
  if the _type_ is checked, not just the truthiness.

#### Scenario: A DB write failure for one plate does not abort the batch

- **GIVEN** a batch of multiple plates being verified
- **WHEN** the DB write for one plate's swap correction or
  `verification_status` update throws
- **THEN** that failure SHALL be caught and logged without throwing
- **AND** processing SHALL continue for the remaining plates in the batch

#### Scenario: imagePath is validated before decoding

- **GIVEN** a plate's `imagePath` resolves (via symlink or `..` traversal)
  outside the configured scan output directory
- **WHEN** `graviscan:verify-plates` processes that plate
- **THEN** the path SHALL be rejected before being passed to the QR decoder,
  using the same realpath-containment check this repo's `read-scan-image`
  handler already applies
- **AND** the rejected plate SHALL be excluded from the decode batch entirely
  and reported as `unreadable`
- **AND** the containment check SHALL be a shared, importable helper used by
  both `read-scan-image` and `graviscan:verify-plates`, not logic duplicated
  or inlined in a handler closure
- **AND** a path that merely could not be resolved (the capture has not been
  written yet, or was moved) SHALL be distinguished from a path that resolved
  outside the directory: the former is logged as an ordinary skip, only the
  latter as a containment rejection
- **AND** an IPC response SHALL nevertheless return the same generic error
  for both, so it cannot be used to probe whether an arbitrary path exists
- **AND** the directory to validate against SHALL be supplied to
  `verifyPlates()` as a parameter by its caller, so the verification module
  itself acquires no Electron dependency

#### Scenario: Duplicate QR detection is keyed on scanner and plate index together

- **GIVEN** a verification batch spanning more than one scanner
- **AND** plate indices repeat across scanners (index `00` exists on every
  scanner)
- **WHEN** duplicate QR codes are detected
- **THEN** a QR code SHALL be treated as duplicated only when it appears at
  two distinct `(scannerId, plateIndex)` positions
- **AND** a plate whose own QR codes are unique SHALL NOT be flagged
  `duplicate_qr` merely because a different scanner's plate at the same
  index was
- **AND** the same code appearing on two scanners at the same plate index
  SHALL be detected as a duplicate rather than collapsing into one position

#### Scenario: Swap pairing is keyed on position, and a position joins at most one swap

- **GIVEN** two reciprocal swap pairs in one batch that happen to share the
  same `assignedPlateId` values (a duplicated assignment, or duplicated
  `plant_qr -> plate_id` metadata)
- **WHEN** swaps are detected
- **THEN** both pairs SHALL be recorded and corrected independently — swap
  deduplication SHALL be keyed on `(scannerId, plateIndex)`, not on
  `assignedPlateId`
- **AND** a position already consumed by one recorded swap SHALL NOT be
  paired into a second swap
- **AND** a plate that was not itself part of a recorded swap SHALL NOT be
  persisted as `swapped` merely because it shares an `assignedPlateId` with
  one that was
- **AND** two rows claiming the same `(scannerId, plateIndex)` SHALL NOT be
  paired with each other — distinctness is by position, not object identity,
  so a position can never be "swapped" with itself

#### Scenario: An ambiguous swap prefers a same-scanner partner

- **GIVEN** an `incorrect` plate with more than one reciprocal swap candidate
  in the batch
- **AND** at least one of those candidates is on the same scanner
- **WHEN** swaps are detected
- **THEN** the same-scanner candidate SHALL be paired in preference to a
  cross-scanner one
- **AND** a cross-scanner candidate left with no other partner SHALL remain
  `incorrect` rather than be mis-paired
- **NOTE**: this tie-break decides which position stays `incorrect` in an
  ambiguous multi-swap batch. Plates are physically loaded per scanner, so a
  same-scanner mix-up is by far the likelier explanation. It narrows — but
  does not eliminate — the influence of input order: pairing is still
  greedy and first-come, so where three or more positions are mutually
  reciprocal on the same scanner, which pair forms can still depend on the
  order the caller submitted them in. The rule guarantees only that a
  same-scanner candidate is never passed over in favour of a cross-scanner
  one, not that the batch as a whole resolves order-independently.

#### Scenario: A genuine cross-scanner swap is still detected

- **GIVEN** two plates on **different** scanners that each hold the other's
  assigned plate
- **AND** neither has a reciprocal candidate on its own scanner
- **WHEN** swaps are detected
- **THEN** the swap SHALL be detected and corrected across the scanner
  boundary
- **NOTE**: the same-scanner preference above is a preference, not a
  restriction — an operator can move a plate between scanners.

#### Scenario: A swap correction records what it corrected from

- **GIVEN** a detected swap is auto-corrected
- **WHEN** `GraviScanPlateAssignment.plate_barcode` is rewritten for a
  position
- **THEN** `previous_plate_barcode` SHALL be set to the pre-correction value
  in the same write
- **AND** the provenance of a corrected plate assignment SHALL therefore be a
  queryable database fact, not something recoverable only from application
  logs

#### Scenario: Re-running verification on an already-corrected batch is a no-op

- **GIVEN** `graviscan:verify-plates` has already detected and corrected a
  swap for a session
- **WHEN** it is invoked again for the same session, with assignments read
  back from the now-corrected `GraviScanPlateAssignment` rows
- **THEN** the affected plates SHALL classify as `verified`
- **AND** no further swap SHALL be detected
- **AND** no additional `plate_barcode` or `GraviScan` correction write SHALL
  be issued

#### Scenario: Every per-plate result has the same declared shape

- **GIVEN** any plate in a verification batch, whatever its outcome
- **WHEN** its result is returned and its `verify-result` progress event is
  emitted
- **THEN** the result SHALL declare and carry the `imagePath` it came from,
  rather than acquiring one only as an undeclared runtime spread
- **AND** `detectedPlateId` (and the `inconsistentMappings` breakdown) SHALL
  be reported in the plate id's original database casing — lower-casing SHALL
  be applied only to the internal comparison, never to the reported value
- **AND** the plate-id comparison SHALL remain case-insensitive on both sides
- **AND** the `verify-result` payload SHALL be the complete result object on
  **every** branch, not a hand-built partial on some of them, so a renderer
  can rely on the same fields being present regardless of outcome

#### Scenario: Progress events are emitted for a future renderer

- **GIVEN** a main window is available
- **WHEN** `graviscan:verify-plates` starts, produces a per-plate result, and
  completes
- **THEN** `graviscan:verify-started`, `graviscan:verify-result`, and
  `graviscan:verify-complete` events SHALL be sent to the renderer via
  `webContents.send`
- **AND** the handler SHALL function correctly even when no renderer listens
  for these events

#### Scenario: Verification must complete before upload reads plate_barcode (documented, NOT enforced by this change)

- **GIVEN** a scan session has completed and `graviscan:verify-plates` has
  been invoked for it
- **WHEN** a future renderer/orchestration layer sequences post-session work
- **THEN** `graviscan:verify-plates` results SHALL be fully persisted before
  `graviscan:upload-all-scans` reads `plate_barcode` for the same session,
  so swap corrections are reflected in both the Bloom (Supabase) and Box
  uploads
- **NOTE**: **Nothing in this change enforces this ordering, and no code in
  this change implements it.** `main` has no renderer, and
  `graviscan:upload-all-scans` neither knows nor asks whether verification
  has run. This scenario exists so the ordering constraint is not silently
  lost between now and whenever that orchestration is built; it is a
  requirement on that future work, not a claim about current behavior.

#### Scenario: verification_status does not gate uploads (documented, deferred to a separate proposal)

- **GIVEN** a plate whose persisted `verification_status` is `incorrect`,
  `unreadable`, `needs_review`, or `duplicate_qr`
- **WHEN** `graviscan:upload-all-scans` runs for that session
- **THEN** the scan SHALL currently be uploaded to Bloom (Supabase) and Box
  regardless of its verification outcome — **this change adds no gating**
- **AND** a future change SHALL decide, as an explicit product decision,
  which statuses block an upload, which merely warn, and whether an operator
  can override
- **NOTE**: deferred deliberately. Choosing severity thresholds and
  warn-vs-block behavior is a product decision with operator-workflow
  consequences (a blocked upload on a rig mid-experiment is disruptive), and
  it needs the renderer surface that does not exist on `main` yet. Recording
  it here so the gap is a known, tracked one rather than an oversight: today
  a misidentified plate's data reaches both destinations with no barrier.

### Requirement: QR Code Reading from Scan Images

The system SHALL provide a `readQrCodesBatch(imagePaths)` function that
decodes QR codes for a whole batch of scan images in a **single** Python
subprocess invocation (`python/graviscan/qr_reader.py`, using OpenCV's
`QRCodeDetector.detectAndDecodeMulti()`), rather than decoding in-process via
a Node WebAssembly dependency. A `readQrCodes(imagePath)` single-image
convenience wrapper SHALL also be provided. Both SHALL support multiple QR
codes detected within a single image.

#### Scenario: A whole verification batch costs one subprocess spawn

- **GIVEN** a verification batch of N plate images
- **WHEN** the QR codes for that batch are read
- **THEN** exactly ONE decode subprocess SHALL be spawned, not one per image
- **AND** the result SHALL contain exactly one entry per requested path, in
  the requested order
- **AND** results SHALL be attributed back to plates by path, never by array
  position
- **NOTE**: the one-shot-subprocess design is only justified because the
  spawn cost is paid once per completed scan session. Spawning per image
  would invalidate that rationale.

#### Scenario: Image file does not exist

- **GIVEN** `imagePath` does not exist on disk
- **WHEN** `readQrCodes(imagePath)` is called
- **THEN** it SHALL return an empty array without throwing

#### Scenario: Multiple QR codes in one image are all detected

- **GIVEN** a single scan image contains more than one QR code (e.g. from
  adjacent plates bleeding into frame)
- **WHEN** `readQrCodes(imagePath)` is called
- **THEN** it SHALL return all detected codes, not just the first

#### Scenario: Subprocess failure is handled gracefully

- **GIVEN** the Python subprocess fails to spawn, exits non-zero, or returns
  malformed output
- **WHEN** `readQrCodes(imagePath)` is called
- **THEN** the error SHALL be caught and logged
- **AND** the function SHALL return an empty array rather than rejecting

#### Scenario: A native decoder crash is isolated to the image that caused it

- **GIVEN** a batch of more than one image
- **AND** the decode subprocess exits non-zero (the signature of a native
  crash inside OpenCV's decoder on a corrupt or hostile image)
- **WHEN** `readQrCodesBatch(imagePaths)` handles that failure
- **THEN** each image SHALL be retried in its own subprocess
- **AND** images that decode successfully on retry SHALL return their codes
- **AND** only the image that keeps failing SHALL return empty codes
- **NOTE**: without this, one bad image blanks the codes for every plate in
  the session and `graviscan:verify-plates` reports them all `unreadable`,
  indistinguishable from genuinely blank QR codes.

#### Scenario: Non-ASCII image paths survive the subprocess pipe

- **GIVEN** an image path containing non-ASCII characters
- **WHEN** it is sent to the decode subprocess and echoed back in the
  response
- **THEN** UTF-8 SHALL be set explicitly on both the Node side (subprocess
  environment) and the Python side (stdin/stdout/stderr reconfiguration),
  rather than relying on the platform's locale codepage

#### Scenario: A non-ASCII image path is still decodable

- **GIVEN** a scan image whose filesystem path contains non-ASCII characters
- **WHEN** the decoder opens it
- **THEN** the file SHALL be read by Python and handed to OpenCV as an
  in-memory buffer (`cv2.imdecode`), not opened by OpenCV itself
  (`cv2.imread`)
- **AND** the QR codes SHALL be decoded normally
- **NOTE**: `cv2.imread` takes a `const char*` and on Windows passes it to
  the ANSI file API, so a non-ASCII path silently fails to open and the plate
  is misclassified `unreadable`. Found by running the actual PyInstaller
  build against a non-ASCII path, not by unit tests.

### Requirement: GraviScanPlateAssignment Verification Status Field

The `GraviScanPlateAssignment` Prisma model SHALL include a
`verification_status` string field, defaulting to `"pending"`, to record the
outcome of the most recent `graviscan:verify-plates` run for that
scanner/plate-index assignment. Valid values SHALL include `pending`,
`verified`, `incorrect`, `unreadable`, `needs_review`, `duplicate_qr`,
`swapped`, and `lookup_failed`.

The model SHALL also include a nullable `previous_plate_barcode` string
field, recording the `plate_barcode` value a swap auto-correction replaced.

#### Scenario: New plate assignment defaults to pending

- **GIVEN** a new `GraviScanPlateAssignment` row is created without an
  explicit `verification_status`
- **WHEN** the row is read back
- **THEN** `verification_status` SHALL be `"pending"`

#### Scenario: previous_plate_barcode is null until a correction happens

- **GIVEN** a `GraviScanPlateAssignment` row that has never been
  swap-corrected
- **WHEN** the row is read back
- **THEN** `previous_plate_barcode` SHALL be null

### Requirement: Coordinator Scanner Status Query API

The `ScanCoordinator` class SHALL expose a `getScannerStatuses()` method
that returns the current status of every managed scanner subprocess,
merging live subprocess state with recorded initialization failures.

- `getScannerStatuses(): Array<{ scannerId: string; status: 'ready' |
'starting' | 'error' | 'dead'; error?: string }>`
- For each entry currently in the subprocess map: `status` SHALL be
  `'ready'` if the subprocess is in the ready state, `'starting'` if it is
  alive but not yet ready, or `'dead'` otherwise.
- For each `scannerId` recorded in the internal `initErrors` map that is
  NOT currently in the subprocess map (i.e. the spawn failed and the entry
  was removed), an entry with `status: 'error'` and the recorded failure
  message SHALL be included.
- A `scannerId` present in the subprocess map SHALL NOT also produce a
  duplicate `'error'` entry from `initErrors`, even if a stale entry exists
  for that id.

`initialize()` SHALL clear the `initErrors` map at the start of the
method, before repopulating it, so a scanner that failed to initialize
once and later succeeds does not keep reporting a stale `'error'` status
forever.

#### Scenario: Reports ready and error statuses together

- **GIVEN** a `ScanCoordinator` has one scanner (`A`) that spawned
  successfully and one scanner (`B`) whose spawn failed with message
  `"SANE device not found"`
- **WHEN** `getScannerStatuses()` is called
- **THEN** the result SHALL include `{ scannerId: 'A', status: 'ready' }`
- **AND** SHALL include `{ scannerId: 'B', status: 'error', error: 'SANE
device not found' }`

#### Scenario: Stale error clears after a later successful initialize()

- **GIVEN** `initialize([A])` was called once and `A`'s spawn failed,
  so `getScannerStatuses()` reports `{ scannerId: 'A', status: 'error' }`
- **WHEN** `initialize([A])` is called again and this time `A` spawns
  successfully
- **THEN** `getScannerStatuses()` SHALL report only
  `{ scannerId: 'A', status: 'ready' }`, with no lingering `'error'` entry

#### Scenario: No subprocesses and no init errors

- **GIVEN** a freshly-constructed `ScanCoordinator` that has never been
  initialized
- **WHEN** `getScannerStatuses()` is called
- **THEN** the result SHALL be an empty array

### Requirement: GraviScan Scanner Status IPC

The system SHALL provide a `graviscan:get-scanner-status` IPC handler,
backed by `getScannerStatus(coordinator, db)` in
`src/main/graviscan/scanner-handlers.ts`, that merges live coordinator
subprocess status with saved, enabled `GraviScanner` database rows so the
renderer can show per-scanner status on page mount — including scanners
that are configured but currently disconnected.

- For each enabled `GraviScanner` row (ordered by `createdAt` ascending),
  the response SHALL include `scannerId`, `displayName` (the row's
  `display_name`, falling back to `name` when not set), `usbPort`,
  `gridMode`, `status`, and `error` (when applicable).
- `status` SHALL be the matching entry from
  `coordinator.getScannerStatuses()` when one exists for that
  `scannerId`, or `'disconnected'` when no live subprocess status exists
  for it (including when `coordinator` is `null`, e.g. before any scan has
  ever started).
- **Deviation from production**: production's equivalent handler reads
  `grid_mode` directly off the per-scanner `GraviScanner` database row.
  `main`'s `GraviScanner` Prisma model has no `grid_mode` column (it exists
  only on `GraviScan`, a per-scan record, and `GraviConfig`, a global
  singleton config row) — see `design.md` for the rationale. This handler
  SHALL instead query the `GraviConfig` singleton once per call and apply
  its `grid_mode` value uniformly to every scanner in the response,
  defaulting to `'2grid'` when no `GraviConfig` row exists yet.
- On a database error, the handler SHALL return
  `{ success: false, scanners: [], error: <message> }` rather than
  throwing.

#### Scenario: Merges live status onto saved scanner rows

- **GIVEN** an enabled `GraviScanner` row with id `s1`
- **AND** `coordinator.getScannerStatuses()` returns
  `[{ scannerId: 's1', status: 'ready' }]`
- **WHEN** `graviscan:get-scanner-status` is invoked
- **THEN** the response SHALL include a scanner entry for `s1` with
  `status: 'ready'`

#### Scenario: Reports disconnected for a saved scanner with no live subprocess

- **GIVEN** an enabled `GraviScanner` row with id `s1`
- **AND** the coordinator (or a `null` coordinator) reports no status for
  `s1`
- **WHEN** `graviscan:get-scanner-status` is invoked
- **THEN** the response SHALL include a scanner entry for `s1` with
  `status: 'disconnected'`

#### Scenario: gridMode is sourced from the GraviConfig singleton, not per-row

- **GIVEN** two enabled `GraviScanner` rows and a `GraviConfig` singleton
  row with `grid_mode: '4grid'`
- **WHEN** `graviscan:get-scanner-status` is invoked
- **THEN** every scanner entry in the response SHALL have
  `gridMode: '4grid'`
- **AND** the `GraviConfig` table SHALL be queried exactly once regardless
  of scanner count

### Requirement: GraviScan Scan File Listing and Directory Creation

The system SHALL provide `graviscan:list-scan-files` and
`graviscan:ensure-dir` IPC handlers, backed by pure functions in
`src/main/graviscan/image-handlers.ts`, so the renderer can browse
previously-captured scan images and pre-create a session's output
directory before a scan cycle begins.

- `listScanFiles(dirPath?: string): { success: boolean; files:
Array<{ name, path, size, modifiedAt, folder }>; error?: string }`
  - When `dirPath` is omitted, the system SHALL resolve the default scan
    output directory and recurse one level into each of its subfolders
    (each subfolder treated as an experiment/session folder).
  - When `dirPath` is given, the system SHALL list image files directly
    inside that directory only (no recursion).
  - Only files with extension `.tif`, `.tiff`, `.png`, `.jpg`, or `.jpeg`
    SHALL be included.
  - Results SHALL be sorted by modification time, newest first.
  - If the resolved directory does not exist, the system SHALL return
    `{ success: true, files: [] }` rather than an error.
- `ensureDir(dirPath: string): Promise<{ success: boolean; path?: string;
error?: string }>`
  - SHALL create the directory recursively (`fs.promises.mkdir(dirPath,
{ recursive: true })`) and SHALL be idempotent — a call for an
    already-existing directory SHALL still report success.
  - SHALL return `{ success: false, error: 'dirPath is required' }` when
    `dirPath` is missing or not a string, without attempting to create
    anything.

Both IPC handlers SHALL confine a caller-supplied path to the scan output
directory before touching the filesystem, applying the same
`fs.realpathSync`-based containment check the existing
`graviscan:read-scan-image` handler uses — symlinks resolved on both
sides, so a symlink inside the output directory cannot be used to escape
it. `ensure-dir` calls `mkdir` recursively and `list-scan-files` calls
`readdirSync`/`statSync`, so an unvalidated path would let a caller create
directory trees, or enumerate files, anywhere the app user can reach.

- A path that resolves outside the scan output directory SHALL be rejected
  with error `Path outside scan directory`, and the underlying
  `image-handlers.ts` function SHALL NOT be called.
- Because both handlers legitimately act on a directory that does not exist
  yet (`ensure-dir` creates it; `list-scan-files` reports an empty list for
  it), containment SHALL be judged against the deepest ancestor of the path
  that does exist, with the not-yet-existing tail re-appended to the
  resolved ancestor. A contained-but-missing path SHALL therefore still be
  accepted, preserving both documented contracts.
- The validated, resolved path SHALL be the one passed downstream, not the
  caller's original string.
- When the scan output directory cannot be resolved at all, the handler
  SHALL reject with error
  `Cannot determine scan directory for path validation`.
- `graviscan:list-scan-files` invoked with no `dirPath` (base-dir mode) has
  no untrusted path to validate and SHALL delegate directly.

#### Scenario: Lists image files in a given session directory

- **GIVEN** a directory containing `scan_00.tif`, `scan_01.png`, and
  `notes.txt`
- **WHEN** `listScanFiles(dirPath)` is called with that directory
- **THEN** the result SHALL include `scan_00.tif` and `scan_01.png`
- **AND** SHALL NOT include `notes.txt`

#### Scenario: Recurses into subfolders when no dirPath is given

- **GIVEN** the default output directory contains a subfolder `exp1` with
  an image file inside it
- **WHEN** `listScanFiles()` is called with no arguments
- **THEN** the result SHALL include that image file with `folder: 'exp1'`

#### Scenario: Creates a directory recursively and is idempotent

- **GIVEN** a session directory path that does not yet exist
- **WHEN** `ensureDir(dirPath)` is called
- **THEN** the directory (and any missing parent directories) SHALL be
  created
- **AND** a second call with the same `dirPath` SHALL still return
  `{ success: true, path: dirPath }`

#### Scenario: Rejects an ensure-dir path outside the scan output directory

- **GIVEN** a resolvable scan output directory
- **WHEN** `graviscan:ensure-dir` is invoked with a path that resolves
  outside it — whether directly, via `..` traversal, or via a symlink
  inside the output directory pointing elsewhere
- **THEN** the handler SHALL return
  `{ success: false, error: 'Path outside scan directory' }`
- **AND** SHALL NOT call `ensureDir()` / `mkdir`

#### Scenario: Rejects a list-scan-files path outside the scan output directory

- **GIVEN** a resolvable scan output directory
- **WHEN** `graviscan:list-scan-files` is invoked with a `dirPath` that
  resolves outside it — whether directly, via `..` traversal, or via a
  symlink inside the output directory pointing elsewhere
- **THEN** the handler SHALL return
  `{ success: false, files: [], error: 'Path outside scan directory' }`
- **AND** SHALL NOT call `listScanFiles()` / `readdirSync`

#### Scenario: Accepts a contained path that does not exist yet

- **GIVEN** a path inside the scan output directory whose final segment does
  not exist on disk
- **WHEN** `graviscan:ensure-dir` or `graviscan:list-scan-files` is invoked
  with it
- **THEN** containment SHALL be judged against its deepest existing
  ancestor and the path SHALL be accepted
- **AND** the resolved path SHALL be passed to the underlying
  `image-handlers.ts` function

### Requirement: GraviScan Database Handlers — graviscans.\*

The system SHALL provide `database.graviscans.*` IPC handlers in `src/main/database-handlers.ts` (`create`, `getMaxWaveNumber`, `checkBarcodeUniqueInWave`, `updateGridTimestamps`, `browseByExperiment`, `experimentDetail`), following the existing `db:{model}:{action}` naming convention and `DatabaseResponse` return shape used by every other handler in that file. Every handler that accepts an `experiment_id` (directly or via an id that resolves to one) SHALL scope its query or write to that `experiment_id` — no handler SHALL read or write `GraviScan` rows belonging to a different experiment than the one identified in its arguments, except `browseByExperiment`, which is deliberately cross-experiment by design (a listing view). A future caller (Tier 4/5) writing `GraviScan.resolution` from a completed scan MUST source it from that scan's `achieved_resolution` (the field added by the "GraviScan Scan-Worker Achieved-Resolution Readback" requirement below, threaded through the `scan-complete` event payload) rather than the pre-scan requested value `create` persisted — otherwise the #232 fix never reaches the queryable database record.

#### Scenario: create validates id fields are strings

- **GIVEN** `graviscans.create` is called with a payload where `experiment_id` is a number or object instead of a string
- **WHEN** the handler processes the request
- **THEN** the handler SHALL reject the request (return `{success: false}` or throw a caught, descriptive error) rather than passing the malformed value through to Prisma
- **AND** no `GraviScan` row SHALL be created

#### Scenario: getMaxWaveNumber is scoped per experiment

- **GIVEN** two experiments, A and B, where B has a `GraviScan` row with a higher `wave_number` than any row in A
- **WHEN** `graviscans.getMaxWaveNumber(A.id)` is called
- **THEN** the result SHALL reflect only experiment A's rows
- **AND** SHALL be `-1` if experiment A has zero non-deleted `GraviScan` rows

#### Scenario: checkBarcodeUniqueInWave is case-insensitive and wave/experiment scoped

- **GIVEN** a `GraviScan` row in experiment A, wave 2, with `plate_barcode = "ABC123"`
- **WHEN** `checkBarcodeUniqueInWave({experiment_id: A.id, wave_number: 2, plate_barcode: "abc123"})` is called
- **THEN** the result SHALL report `isDuplicate: true`
- **AND** the same check against experiment B (a different experiment) or wave 3 of experiment A SHALL report `isDuplicate: false`
- **AND** rows with `deleted: true` SHALL be excluded from the comparison

#### Scenario: updateGridTimestamps only updates rows in the given experiment

- **GIVEN** a set of `GraviScan` ids where one id belongs to a different experiment than the `experiment_id` argument
- **WHEN** `updateGridTimestamps({experiment_id, ids, scan_started_at, scan_ended_at})` is called
- **THEN** only the rows whose `experiment_id` matches the argument SHALL be updated
- **AND** the returned count SHALL reflect only the rows actually updated, not `ids.length`

#### Scenario: browseByExperiment paginates and filters across experiments

- **GIVEN** multiple experiments with non-deleted `GraviScan` rows
- **WHEN** `browseByExperiment({offset, limit, filters})` is called
- **THEN** the result SHALL return at most `limit` experiments starting at `offset`, each including its non-deleted scans
- **AND** each experiment entry SHALL include `hasNeedsReview: true` when any of its plate assignments has `verification_status === 'needs_review'`
- **AND** `dateFrom`/`dateTo` SHALL each filter on non-deleted `GraviScan.capture_date` values and SHALL both be inclusive: `dateFrom` as `capture_date >= dateFrom`, `dateTo` as `capture_date <= dateTo` with `dateTo`'s time advanced to 23:59:59.999 of that calendar day (so scans captured anywhere in that day are included, not just up to midnight)
- **AND** `experimentName` SHALL match by substring against `Experiment.name` (not exact-match)
- **AND** `accession` SHALL match by substring against the linked `Accessions.name` (via `Experiment.accession`) — not by `Accessions.id`
- **AND** `uploadStatus` SHALL be evaluated per experiment over the aggregated `GraviImage.status` values across all of that experiment's non-deleted scans: an experiment with zero images SHALL match only `uploadStatus: 'pending'`; `'uploaded'` SHALL require every image's `status` to be `'uploaded'`; `'failed'` SHALL require at least one image's `status` to be `'failed'`; `'pending'` SHALL require every image's `status` to be `'pending'`; any other `uploadStatus` value SHALL pass every experiment through unfiltered

#### Scenario: experimentDetail never leaks another experiment's data

- **GIVEN** two experiments sharing the same `GraviScanner`
- **WHEN** `experimentDetail(experimentId)` is called for one of them
- **THEN** the returned `scans` and `verificationStatusMap` SHALL include only rows belonging to the requested experiment
- **AND** SHALL return an error result (not throw) when `experimentId` does not exist

### Requirement: GraviScan Database Handlers — graviscanSessions.\*

The system SHALL provide `database.graviscanSessions.*` IPC handlers (`create`, `complete`) in `src/main/database-handlers.ts`, following the existing convention.

#### Scenario: create persists a new session with defaults

- **GIVEN** `graviscanSessions.create` is called with only the required fields (`experiment_id`, `phenotyper_id`, `scan_mode`)
- **WHEN** the handler processes the request
- **THEN** a `GraviScanSession` row SHALL be created with `interval_seconds`, `duration_seconds`, and `total_cycles` set to `null`

#### Scenario: complete marks a session finished

- **GIVEN** an existing `GraviScanSession` row
- **WHEN** `graviscanSessions.complete({session_id, cancelled})` is called
- **THEN** the row's `completed_at` SHALL be set to the current time
- **AND** `cancelled` SHALL be set to the passed value, defaulting to `false` when omitted

#### Scenario: complete on a nonexistent session fails cleanly

- **GIVEN** a `session_id` that does not correspond to any `GraviScanSession` row
- **WHEN** `graviscanSessions.complete({session_id})` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** SHALL NOT throw an unhandled error across the IPC boundary

### Requirement: GraviScan Database Handlers — graviscanPlateAssignments.\*

The system SHALL provide `database.graviscanPlateAssignments.*` IPC handlers (`list`, `upsertMany`) in `src/main/database-handlers.ts`, following the existing convention. `upsertMany` SHALL perform all writes inside a single `db.$transaction` so a partial failure leaves no partial state.

#### Scenario: list is scoped to experiment and scanner together

- **GIVEN** a `GraviScanner` shared across two experiments, each with its own `GraviScanPlateAssignment` rows for that scanner
- **WHEN** `list(experimentId, scannerId)` is called for one experiment
- **THEN** only that experiment's assignments for the given scanner SHALL be returned, ordered by `plate_index`

#### Scenario: upsertMany validates id fields are strings

- **GIVEN** `upsertMany` is called with `experimentId` or `scannerId` that is not a string
- **WHEN** the handler processes the request
- **THEN** the handler SHALL reject the request rather than passing the malformed value through to Prisma

#### Scenario: upsertMany is atomic

- **GIVEN** a batch of assignments where one entry would violate a database constraint
- **WHEN** `upsertMany(experimentId, scannerId, assignments)` is called
- **THEN** none of the batch's rows SHALL be persisted (the whole transaction rolls back)
- **AND** the handler SHALL return `{success: false, error: <message>}`

### Requirement: GraviScan Database Handlers — graviPlateAccessions.\*

The system SHALL provide `database.graviPlateAccessions.*` IPC handlers (`createWithSections`, `list`, `listFiles`, `delete`) in `src/main/database-handlers.ts`, following the existing convention. `createWithSections` and `delete` SHALL perform all writes inside a single `db.$transaction`. `listFiles` accepts no filesystem path argument — it queries `Accessions` rows with linked `GraviPlateAccession` children, not a directory listing. `delete` SHALL block deletion of a metadata file that is still referenced either by `Experiment.accession_id` or by any `GraviExperimentWaveMetadata.accession_id`, via a shared `countMetadataReferences()` helper that sums both reference counts.

#### Scenario: createWithSections is atomic across the whole batch

- **GIVEN** a `plates` array where one plate's sections would violate the `(gravi_plate_id, plant_qr)` uniqueness constraint
- **WHEN** `createWithSections(accessionData, plates)` is called
- **THEN** no `Accessions`, `GraviPlateAccession`, or `GraviPlateSectionMapping` row from the batch SHALL be persisted
- **AND** the handler SHALL return `{success: false, error: <message>}`

#### Scenario: list returns natural-sorted plates and sections

- **GIVEN** a metadata file with plates named `"P2"` and `"P10"`
- **WHEN** `list(metadataFileId)` is called
- **THEN** `"P2"` SHALL sort before `"P10"` (natural order, not lexicographic)
- **AND** each plate's `sections` SHALL be sorted the same way by `plate_section_id`

#### Scenario: listFiles takes no path and lists linked accession files only

- **GIVEN** a mix of `Accessions` rows, some with linked `GraviPlateAccession` children and some without
- **WHEN** `listFiles()` is called with no arguments
- **THEN** only the rows with at least one linked `GraviPlateAccession` SHALL be returned, each annotated with linked experiment names and a plate count

#### Scenario: delete is blocked while linked to an experiment via accession_id

- **GIVEN** a metadata file (`Accessions` row) referenced by `Experiment.accession_id` on at least one experiment
- **WHEN** `delete(metadataFileId)` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}` and delete nothing

#### Scenario: delete is blocked while linked via GraviExperimentWaveMetadata

- **GIVEN** a metadata file (`Accessions` row) with no `Experiment.accession_id` reference, but referenced by at least one `GraviExperimentWaveMetadata.accession_id`
- **WHEN** `delete(metadataFileId)` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}` and delete nothing

#### Scenario: delete is allowed again after the blocking wave-link is unlinked

- **GIVEN** a metadata file blocked from deletion only by a single `GraviExperimentWaveMetadata` link (no `Experiment.accession_id` reference)
- **WHEN** that link is removed via `unlinkGraviMetadata`, and `delete(metadataFileId)` is then called
- **THEN** the handler SHALL return `{success: true}` and the `Accessions` row SHALL be deleted

#### Scenario: delete cascades its own children when unlinked

- **GIVEN** an unlinked metadata file with `GraviPlateAccession` and `GraviPlateSectionMapping` children
- **WHEN** `delete(metadataFileId)` is called
- **THEN** the `Accessions` row and all of its `GraviPlateAccession`/`GraviPlateSectionMapping` children SHALL be deleted
- **AND** no orphaned section rows SHALL remain

### Requirement: GraviScan Scan-Worker Achieved-Resolution Readback

The `python/graviscan/scan_worker.py` worker SHALL read back the SANE device's actual `x_resolution`/`y_resolution` after setting them and before scanning, log a warning when the achieved value differs from the requested value, and include the achieved value as `achieved_resolution` in both the TIFF metadata and the emitted `scan-complete` event payload.

#### Scenario: achieved resolution matches request

- **GIVEN** the SANE device accepts the requested resolution exactly
- **WHEN** a scan completes
- **THEN** the `scan-complete` event payload SHALL include `achieved_resolution` equal to the requested value
- **AND** no warning SHALL be logged

#### Scenario: achieved resolution differs from request

- **GIVEN** the SANE device reports a different `x_resolution`/`y_resolution` than requested after being set
- **WHEN** a scan completes
- **THEN** a warning SHALL be logged including both the requested and achieved values
- **AND** the `scan-complete` event payload's `achieved_resolution` SHALL reflect the device-reported value, not the requested value
- **AND** the TIFF's embedded resolution metadata SHALL reflect the achieved value

### Requirement: Configure Scanner Navigation Link

The Layout sidebar SHALL show a "Configure Scanner" navigation link
(pointing to `/configure-scanner`) when, and only when, the configured
scanner mode is `graviscan`. This link is independent of the "Capture
Scan"/"Camera Settings" capture-links group governed by the
Mode-Aware Navigation requirement — Configure Scanner has no
CylinderScan equivalent and is not one of the six named Home-page
workflow steps.

#### Scenario: Configure Scanner nav link visible in graviscan mode

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the Layout sidebar renders
- **THEN** a "Configure Scanner" nav link SHALL be visible
- **AND** it SHALL navigate to `/configure-scanner`

#### Scenario: Configure Scanner nav link hidden in cylinderscan mode

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the Layout sidebar renders
- **THEN** no "Configure Scanner" nav link SHALL be rendered

### Requirement: GraviScan Wedge Auto-Pause on Detection

When the `WedgeDetector` emits a `wedge-detected` event, `setupWedgeDetection()` SHALL immediately stop that scanner's worker subprocess via the coordinator's existing `stopScanner(scanner_id)`, excluding it from all subsequent scan cycles in the active session unless and until a later `retry-scanner` call (see below) respawns it — without waiting for any operator action to trigger the initial pause.

The auto-pause call SHALL NOT be gated behind (or delayed by) the Slack notification or the renderer-forwarding path: a slow or failing Slack webhook SHALL NOT delay stopping the wedged scanner. A durable log entry (via the existing `scanLog()` facility) SHALL record the auto-pause, including the scanner_id, signature, session_id, and cycle_number, in addition to — not instead of — the pre-existing `wedge-detected` log entry.

#### Scenario: Wedge detection auto-pauses the scanner

- **GIVEN** an active scan session with a running worker for scanner `sc-1`
- **WHEN** the `WedgeDetector` emits a `wedge-detected` event for `sc-1`
- **THEN** `coordinator.stopScanner('sc-1')` SHALL be called
- **AND** subsequent scan cycles SHALL NOT include `sc-1`
- **AND** a log entry recording the auto-pause SHALL be written

#### Scenario: Auto-pause is not delayed by a slow Slack notification

- **GIVEN** the configured `SlackNotifier.notify()` call would hang or reject
- **WHEN** the `WedgeDetector` emits a `wedge-detected` event
- **THEN** `coordinator.stopScanner()` SHALL still be called for the wedged scanner without waiting for the Slack call to settle

---

### Requirement: GraviScan Wedge Event Forwarding to Renderer

`setupWedgeDetection()` SHALL forward every `wedge-detected` event emitted by the `WedgeDetector` to the renderer, in addition to — not instead of — the existing `SlackNotifier.notify()` call and the auto-pause action.

The forwarded event SHALL be sent as a `graviscan:wedge-detected` IPC message carrying the same enriched payload (including `display_name`/`usb_port` when available) that is sent to Slack. Forwarding SHALL be best-effort: a missing or destroyed main window SHALL NOT throw or block the Slack notification or the auto-pause.

#### Scenario: Wedge event reaches Slack, the renderer, and triggers auto-pause

- **GIVEN** a `WedgeDetector` wired via `setupWedgeDetection(coordinator, db, getMainWindow)` with a live, non-destroyed main window
- **WHEN** the detector emits a `wedge-detected` event
- **THEN** `SlackNotifier.notify()` SHALL be called with the enriched event
- **AND** `getMainWindow().webContents.send('graviscan:wedge-detected', ...)` SHALL be called with the same enriched event
- **AND** `coordinator.stopScanner()` SHALL be called for the wedged scanner

#### Scenario: No main window available

- **GIVEN** a `WedgeDetector` wired via `setupWedgeDetection(coordinator, db)` with no third argument (or a `getMainWindow` that returns `null` or a destroyed window)
- **WHEN** the detector emits a `wedge-detected` event
- **THEN** the Slack notification path and the auto-pause SHALL be unaffected
- **AND** no `webContents.send` call SHALL occur
- **AND** no error SHALL be thrown

---

### Requirement: GraviScan Retry-Scanner Action

The system SHALL provide a `graviscan:retry-scanner` IPC handler that, given a `scannerId`, stops that scanner's worker (`stopScanner`, a no-op if already stopped by auto-pause) and respawns it (`addScanner`) using a `saneName` rebuilt from a fresh database read of the scanner's current `usb_bus`/`usb_device` (not a value cached from session start). The action SHALL require an active scan session and a live coordinator. If the scanner's `usb_bus` or `usb_device` is null (e.g. mid `reset-usb`), the scanner row's `enabled` field is `false`, or the scanner row cannot be found, the handler SHALL fail without calling `addScanner`. After `addScanner` resolves, the handler SHALL check `coordinator.getScannerStatuses()` for the retried `scannerId` and SHALL resolve `{ success: false, error }` if that scanner is not reported with status `'ready'` — `addScanner`/`spawnSingleScanner` do not throw on spawn failure, so a resolved promise alone does not indicate the worker came online. The handler SHALL write a durable log entry (via `scanLog()`) recording the retry attempt and its outcome, including the silent-failure case.

#### Scenario: Retry respawns the worker with a fresh saneName

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_bus: 3, usb_device: 7, enabled: true`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** `coordinator.stopScanner('sc-1')` SHALL be called
- **AND** `coordinator.addScanner({ scannerId: 'sc-1', saneName: 'epkowa:interpreter:003:007', plates: [] })` SHALL be called
- **AND** `coordinator.getScannerStatuses()` SHALL be checked for `sc-1`
- **AND**, given that status is `'ready'`, the handler SHALL resolve `{ success: true }`
- **AND** a log entry recording the successful retry SHALL be written

#### Scenario: Retry fails without respawning when USB identity is unknown

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `usb_bus: null` (e.g. a `reset-usb` is in progress)
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error: '...' }`
- **AND** `coordinator.addScanner` SHALL NOT be called

#### Scenario: Retry fails without respawning a disabled scanner

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has `enabled: false` (the operator disabled it via ConfigureScanner's "Remove" action)
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error: '...' }`
- **AND** `coordinator.addScanner` SHALL NOT be called

#### Scenario: Retry fails when the scanner row cannot be found

- **GIVEN** an active scan session with a running coordinator
- **AND** no `GraviScanner` row exists for `sc-1`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **THEN** the handler SHALL resolve `{ success: false, error: '...' }`
- **AND** neither `coordinator.stopScanner` nor `coordinator.addScanner` SHALL be called

#### Scenario: Retry fails cleanly with no active session or no coordinator

- **GIVEN** either no active scan session (or a session with `isActive: false`), or no live coordinator
- **WHEN** `graviscan:retry-scanner` is invoked with any `scannerId`
- **THEN** the handler SHALL resolve `{ success: false, error: '...' }` without throwing
- **AND** the database SHALL NOT be queried and `coordinator.addScanner` SHALL NOT be called

#### Scenario: A rejected respawn is caught and surfaced, not left unhandled

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has valid `usb_bus`/`usb_device`/`enabled: true`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **AND** `coordinator.addScanner()` rejects
- **THEN** the handler SHALL resolve `{ success: false, error: msg }` (the rejection SHALL be caught, not left as an unhandled promise rejection)
- **AND** a log entry recording the failed retry SHALL be written

#### Scenario: Retry reports failure when the respawned worker silently fails to come online

- **GIVEN** an active scan session with a running coordinator
- **AND** the database's `GraviScanner` row for `sc-1` has valid `usb_bus`/`usb_device`/`enabled: true`
- **WHEN** `graviscan:retry-scanner` is invoked with `scannerId: 'sc-1'`
- **AND** `coordinator.addScanner()` resolves without throwing
- **AND** `coordinator.getScannerStatuses()` reports `sc-1` with status `'error'` or `'dead'`, or does not include `sc-1` at all
- **THEN** the handler SHALL resolve `{ success: false, error }`, where `error` is the status's recorded `error` message when present, or a message stating the scanner did not come online
- **AND** a log entry recording the failed retry SHALL be written

### Requirement: GraviScan Database Handler — experiments.linkGraviMetadata

The system SHALL provide a `database.experiments.linkGraviMetadata(experimentId, waveNumber, accessionId)` IPC handler in `src/main/database-handlers.ts`, backed by a `GraviExperimentWaveMetadata` Prisma model with a unique `(experiment_id, wave_number)` pair, FK to `Experiment` (`onDelete: Cascade`) and FK to `Accessions` (`onDelete: Restrict`). It SHALL validate, returning `{success: false, error: <message>}` and persisting nothing on any failure:

- `experimentId` and `accessionId` are non-empty strings and `waveNumber` is a non-negative integer within the range Prisma's `Int` column can store (32-bit signed: 0 to 2147483647);
- an `Experiment` with `id === experimentId` exists and its `experiment_type` is `"graviscan"`;
- an `Accessions` row with `id === accessionId` exists and has at least one linked `GraviPlateAccession` child;
- no `GraviExperimentWaveMetadata` row already exists for `(experimentId, waveNumber)`, regardless of whether the new `accessionId` would be the same as or different from the existing link's.

#### Scenario: link succeeds for a valid graviscan experiment and metadata file

- **GIVEN** a `graviscan`-typed experiment and an `Accessions` row with at least one `GraviPlateAccession` child, neither yet linked for wave `2`
- **WHEN** `linkGraviMetadata(experimentId, 2, accessionId)` is called
- **THEN** a `GraviExperimentWaveMetadata` row SHALL be created for `(experimentId, 2, accessionId)`
- **AND** the handler SHALL return `{success: true, data: <row with accession included>}`

#### Scenario: link accepts wave 0 as a valid boundary value

- **GIVEN** a `graviscan`-typed experiment and a valid metadata file, wave `0` not yet linked
- **WHEN** `linkGraviMetadata(experimentId, 0, accessionId)` is called
- **THEN** a `GraviExperimentWaveMetadata` row SHALL be created for `(experimentId, 0, accessionId)`
- **AND** the handler SHALL return `{success: true, data: <row with accession included>}`

#### Scenario: link rejects a non-string, missing, or empty experimentId

- **GIVEN** `experimentId` is a non-string value (e.g. a number, object, or `undefined`), or an empty string `""`
- **WHEN** `linkGraviMetadata` is called with that `experimentId`
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects a non-string, missing, or empty accessionId

- **GIVEN** `accessionId` is a non-string value (e.g. a number, object, or `undefined`), or an empty string `""`
- **WHEN** `linkGraviMetadata` is called with that `accessionId`
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects a malformed waveNumber

- **GIVEN** `waveNumber` is negative, non-integer (e.g. `1.5`), not a number, or exceeds `2147483647` (one past the maximum value Prisma's `Int` column can store)
- **WHEN** `linkGraviMetadata` is called with that `waveNumber`
- **THEN** the handler SHALL return `{success: false, error: <message>}` — a friendly validation error, not a raw database range error
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects an unknown experimentId

- **GIVEN** an `experimentId` that is a non-empty string but does not correspond to any `Experiment` row
- **WHEN** `linkGraviMetadata` is called with that `experimentId`
- **THEN** the handler SHALL return `{success: false, error: <message>}` indicating the experiment was not found
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects an unknown accessionId

- **GIVEN** an `accessionId` that is a non-empty string but does not correspond to any `Accessions` row
- **WHEN** `linkGraviMetadata` is called with that `accessionId`, for an otherwise-valid `graviscan` experiment
- **THEN** the handler SHALL return `{success: false, error: <message>}` indicating the metadata file was not found
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects a non-graviscan experiment

- **GIVEN** an experiment with `experiment_type === "cylinderscan"`
- **WHEN** `linkGraviMetadata(experimentId, 0, accessionId)` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects a metadata file with no GraviPlateAccession children

- **GIVEN** an `Accessions` row created via `accessions.createWithMappings` (a CylinderScan barcode-mapping file, no `GraviPlateAccession` children)
- **WHEN** `linkGraviMetadata(experimentId, 0, thatAccessionId)` is called on a `graviscan`-typed experiment
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects an already-linked wave, even to the same accession

- **GIVEN** wave `3` of an experiment is already linked to metadata file A
- **WHEN** `linkGraviMetadata(experimentId, 3, metadataFileB)` is called, where metadata file B is either a different file or the same file A
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** wave `3` SHALL remain linked to metadata file A, unchanged

#### Scenario: link succeeds again after the wave was unlinked, even with a different accession

- **GIVEN** wave `3` of an experiment was linked to metadata file A, then unlinked via `unlinkGraviMetadata`
- **WHEN** `linkGraviMetadata(experimentId, 3, metadataFileB)` is called with a different metadata file B
- **THEN** a new `GraviExperimentWaveMetadata` row SHALL be created linking wave `3` to metadata file B
- **AND** the handler SHALL return `{success: true, data: <row with accession B included>}`

#### Scenario: deleting the linked Experiment cascades away the link

- **GIVEN** wave `1` of an experiment is linked to a metadata file
- **WHEN** that `Experiment` row is deleted
- **THEN** the corresponding `GraviExperimentWaveMetadata` row SHALL no longer exist
- **AND** the linked `Accessions` row (the metadata file itself) SHALL be unaffected

### Requirement: GraviScan Database Handler — experiments.unlinkGraviMetadata

The system SHALL provide a `database.experiments.unlinkGraviMetadata(experimentId, waveNumber)` IPC handler in `src/main/database-handlers.ts`.

#### Scenario: unlink succeeds and removes the link

- **GIVEN** wave `3` of an experiment is linked to a metadata file
- **WHEN** `unlinkGraviMetadata(experimentId, 3)` is called
- **THEN** the `GraviExperimentWaveMetadata` row for `(experimentId, 3)` SHALL be deleted
- **AND** the handler SHALL return `{success: true}`

#### Scenario: unlink on a non-existent link returns a friendly error

- **GIVEN** an experiment with no `GraviExperimentWaveMetadata` row for wave `5`
- **WHEN** `unlinkGraviMetadata(experimentId, 5)` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}` rather than a raw Prisma `P2025` error

#### Scenario: unlink rejects a non-string, missing, or empty experimentId

- **GIVEN** `experimentId` is a non-string value (e.g. a number, object, or `undefined`), or an empty string `""`
- **WHEN** `unlinkGraviMetadata` is called with that `experimentId`
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be deleted

#### Scenario: unlink rejects a malformed waveNumber

- **GIVEN** `waveNumber` is negative, non-integer, missing, or not a number
- **WHEN** `unlinkGraviMetadata` is called with that `waveNumber`
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be deleted

### Requirement: GraviScan Database Handler — experiments.listGraviMetadata

The system SHALL provide a `database.experiments.listGraviMetadata(experimentId)` IPC handler in `src/main/database-handlers.ts`, returning the experiment's linked metadata files ordered by `wave_number` ascending, each including its `accession`.

#### Scenario: list returns links ordered by wave number, scoped to one experiment

- **GIVEN** experiment A has metadata linked for waves `2` and `0`, and experiment B has metadata linked for wave `1`
- **WHEN** `listGraviMetadata(experimentA.id)` is called
- **THEN** the result SHALL contain exactly experiment A's two links, ordered `[wave 0, wave 2]`, each with its `accession` included
- **AND** experiment B's link SHALL NOT be included

#### Scenario: list returns an empty array for an experiment with no links

- **GIVEN** a `graviscan`-typed experiment with zero `GraviExperimentWaveMetadata` rows
- **WHEN** `listGraviMetadata(experimentId)` is called
- **THEN** the handler SHALL return `{success: true, data: []}`

#### Scenario: list rejects a non-string, missing, or empty experimentId

- **GIVEN** `experimentId` is a non-string value, missing, or an empty string `""`
- **WHEN** `listGraviMetadata` is called with that `experimentId`
- **THEN** the handler SHALL return `{success: false, error: <message>}` rather than passing the malformed value to Prisma

### Requirement: Mode-Aware Python Backend Status

The `PythonStatus` component SHALL only render when the configured scanner mode is `cylinderscan`. In `graviscan` mode, the component SHALL render nothing at all (not a heading with an empty body), since GraviScan does not use the Basler camera or NI-DAQ hardware this status panel describes and this tier adds no GraviScan-relevant content to show in its place.

#### Scenario: Camera/DAQ status shown in cylinderscan mode

- **GIVEN** scanner mode is `cylinderscan`
- **WHEN** the Home page renders `<PythonStatus mode={mode} />`
- **THEN** the "Python Backend Status" heading and the Camera/DAQ hardware status rows SHALL be visible

#### Scenario: Component renders nothing in graviscan mode

- **GIVEN** scanner mode is `graviscan`
- **WHEN** the Home page renders `<PythonStatus mode={mode} />`
- **THEN** the component SHALL render `null`
- **AND** no "Python Backend Status" heading or Camera/DAQ content SHALL appear anywhere on the Home page

