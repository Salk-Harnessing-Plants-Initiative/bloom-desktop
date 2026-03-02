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

Wave Number and Plant Age fields SHALL only accept non-negative integers (whole numbers including 0). Non-integer values SHALL display a validation error to inform the user.

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

- **GIVEN** a scan with `num_frames` set to 72
- **WHEN** `perform_scan()` completes successfully
- **THEN** 72 PNG files SHALL exist in the output directory
- **AND** files SHALL be named `001.png` through `072.png`
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

