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
- **AND** `/graviscan` and `/scanner-config` routes SHALL NOT be available (when added in later increments)

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

