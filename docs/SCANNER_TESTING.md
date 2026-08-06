## Scanner Testing Guide

This guide explains how to test the Scanner coordination functionality with mock hardware for automated cylinder scanning.

## Quick Test

The fastest way to test the Scanner functionality is using the integration test:

```bash
# Run the full integration test
npm run test:scanner
```

This tests the complete Scanner workflow: initialization, status checks, full scan with coordinate rotation and image capture, and cleanup operations.

## What is the Scanner?

The Scanner coordinates **Camera** and **DAQ** hardware to perform automated cylinder scanning:

1. **Initialize**: Set up both camera and DAQ with their respective settings
2. **Home**: Move turntable to 0° starting position
3. **Scan Loop**: For each frame (default 72 frames for 360°):
   - Rotate turntable by calculated degrees (e.g., 5° per frame)
   - Wait for stabilization (50ms)
   - Capture image with camera
   - Report progress
4. **Return Home**: Move turntable back to 0°
5. **Cleanup**: Release camera and DAQ resources

The Scanner provides a **clean separation of concerns**:

- Camera module: Only handles camera operations
- DAQ module: Only handles turntable operations
- Scanner module: Coordinates both for automated workflows

## Manual Command-Line Testing

You can test individual Scanner commands by piping JSON to the Python executable:

### 1. Check Scanner Status

```bash
echo '{"command":"scanner","action":"status"}' | ./dist/bloom-hardware --ipc
```

Expected output:

```
STATUS:IPC handler ready
DATA:{"success": true, "initialized": false, "camera_status": "unknown", "daq_status": "unknown", "position": 0.0, "mock": true}
```

### 2. Initialize Scanner

```bash
echo '{"command":"scanner","action":"initialize","settings":{"camera":{"exposure_time":10000,"gain":100,"camera_ip_address":"mock","gamma":1.0},"daq":{"device_name":"cDAQ1Mod1","sampling_rate":40000,"step_pin":0,"dir_pin":1,"steps_per_revolution":6400,"num_frames":72,"seconds_per_rot":7.0},"num_frames":72,"output_path":"./scans"}}' | ./dist/bloom-hardware --ipc
```

Expected output:

```
STATUS:IPC handler ready
STATUS:Using mock scanner
STATUS:Using mock camera for scanner
STATUS:Scanner camera initialized
STATUS:Using mock DAQ for scanner
STATUS:Initializing mock DAQ
STATUS:Mock DAQ initialized successfully
STATUS:Scanner DAQ initialized
STATUS:Scanner initialized successfully
DATA:{"success": true, "initialized": true}
```

### 3. Perform Scan

**Important**: Scanner operations require an interactive session:

```bash
# Start the IPC handler
./dist/bloom-hardware --ipc

# Then type these commands (one per line):
{"command":"scanner","action":"initialize","settings":{"camera":{"exposure_time":10000,"gain":100,"camera_ip_address":"mock","gamma":1.0},"daq":{"device_name":"cDAQ1Mod1","sampling_rate":40000,"step_pin":0,"dir_pin":1,"steps_per_revolution":6400,"num_frames":72,"seconds_per_rot":7.0},"num_frames":72,"output_path":"./scans"}}
{"command":"scanner","action":"scan"}
{"command":"scanner","action":"status"}
{"command":"scanner","action":"cleanup"}
```

You should see status messages showing the scan progress through all 72 frames.

## Testing with the Electron App

Once the Electron app is running, you can test the Scanner from the renderer process:

```javascript
// Quick test script - paste into browser console
(async () => {
  console.log('=== Scanner Test ===\n');

  // 1. Check initial status
  const status1 = await window.electron.scanner.getStatus();
  console.log('Initial status:', status1);

  // 2. Initialize Scanner with camera and DAQ settings
  const scannerSettings = {
    camera: {
      exposure_time: 10000,
      gain: 100, // GainRaw integer, ~9.9 dB for the acA2000-50gm
      camera_ip_address: 'mock',
      gamma: 1.0,
    },
    daq: {
      device_name: 'cDAQ1Mod1',
      sampling_rate: 40000,
      step_pin: 0,
      dir_pin: 1,
      steps_per_revolution: 6400,
      num_frames: 72,
      seconds_per_rot: 7.0,
    },
    num_frames: 72,
    output_path: './scans',
    // Optional: if provided, the scan is automatically saved to the database
    // and metadata.json is written alongside the images. See "Metadata &
    // metadata.json" below.
    // metadata: { experiment_id, phenotyper_id, scanner_name, plant_id,
    //             plant_age_days, wave_number, accession_name?, scan_path? },
  };

  await window.electron.scanner.initialize(scannerSettings);
  console.log('✅ Scanner initialized');

  // 3. Check status after initialization
  const status2 = await window.electron.scanner.getStatus();
  console.log('Status after init:', status2);

  // 4. Perform a complete scan
  console.log(
    'Starting scan (this will take ~4-5 seconds with mock hardware)...'
  );
  const scanResult = await window.electron.scanner.scan();
  console.log(
    `✅ Scan complete: ${scanResult.frames_captured} frames captured`
  );

  // 5. Check status after scan (should be back at home)
  const status3 = await window.electron.scanner.getStatus();
  console.log(`Position after scan: ${status3.position}° (should be ~0)`);

  // 6. Cleanup
  await window.electron.scanner.cleanup();
  console.log('✅ Scanner cleaned up');

  console.log('\n=== Test Complete ===');
})();
```

**Expected Output:**

```
=== Scanner Test ===

Initial status: {success: true, initialized: false, camera_status: 'unknown', ...}
✅ Scanner initialized
Status after init: {success: true, initialized: true, camera_status: 'connected', daq_status: 'initialized', position: 0, mock: true}
Starting scan (this will take ~4-5 seconds with mock hardware)...
✅ Scan complete: 72 frames captured
Position after scan: 0° (should be ~0)
✅ Scanner cleaned up

=== Test Complete ===
```

## Scanner Settings

The Scanner accepts configuration settings for both camera and DAQ:

### Camera Settings

This is the real, current `CameraSettings` shape (`src/types/camera.ts`) — not the legacy shape (`serial_number`/`width`/`height`/`pixel_format`/`trigger_mode`) this doc previously documented, which does not exist in the current code.

| Setting             | Type   | Default  | Description                                                                                              |
| ------------------- | ------ | -------- | -------------------------------------------------------------------------------------------------------- |
| `exposure_time`     | number | `10000`  | Exposure time in microseconds                                                                            |
| `gain`              | number | `100`    | Camera gain — `GainRaw` integer, ~9.9 dB for the acA2000-50gm (see [CONFIGURATION.md](CONFIGURATION.md)) |
| `camera_ip_address` | string | `"mock"` | IP address for network camera, or `"mock"` for testing                                                   |
| `gamma`             | number | `1.0`    | Gamma correction value                                                                                   |
| `num_frames`        | number | `72`     | Number of frames (optional; scanner-level `num_frames` takes precedence — see below)                     |
| `seconds_per_rot`   | number | `7.0`    | Time for one complete rotation (optional; DAQ-level setting is authoritative for actual rotation timing) |

`brightness` and `contrast` are **not** part of `CameraSettings` — the acA2000-50gm doesn't support them. See "Metadata & metadata.json" below for why they still appear in `metadata.json`.

### DAQ Settings

| Setting                | Type   | Default       | Description                    |
| ---------------------- | ------ | ------------- | ------------------------------ |
| `device_name`          | string | `"cDAQ1Mod1"` | NI-DAQ device name             |
| `sampling_rate`        | number | `40000`       | DAQ sampling rate in Hz        |
| `step_pin`             | number | `0`           | Digital output for step signal |
| `dir_pin`              | number | `1`           | Digital output for direction   |
| `steps_per_revolution` | number | `6400`        | Steps for full 360° rotation   |
| `num_frames`           | number | `72`          | Number of frames to capture    |
| `seconds_per_rot`      | number | `7.0`         | Time for complete rotation     |

### Scanner Settings

| Setting       | Type             | Default     | Description                                                                                                          |
| ------------- | ---------------- | ----------- | -------------------------------------------------------------------------------------------------------------------- |
| `camera`      | object           | (required)  | Camera configuration settings                                                                                        |
| `daq`         | object           | (required)  | DAQ configuration settings                                                                                           |
| `num_frames`  | number           | `72`        | Number of frames (overrides both)                                                                                    |
| `output_path` | string           | `"./scans"` | Directory for saved images                                                                                           |
| `metadata`    | object, optional | (none)      | If provided, the scan is saved to the database and `metadata.json` is written — see "Metadata & metadata.json" below |

**Note**: The `num_frames` setting at the scanner level overrides the individual camera and DAQ `num_frames` settings to ensure synchronization.

## Metadata & metadata.json

When `ScannerSettings.metadata` is provided, `src/main/cylinderscan/scan-metadata-json.ts`'s `buildMetadataObject()` writes a `metadata.json` file alongside the captured images (via `writeMetadataJson()`), so scan data is self-describing and portable without requiring the SQLite database.

**`metadata` input fields** (`ScanMetadata`, `src/types/scanner.ts`) — all required unless marked optional: `experiment_id`, `phenotyper_id`, `scanner_name`, `plant_id`, `plant_age_days`, `wave_number`, `accession_name?`, `scan_path?`.

**`metadata.json` output fields** (`ScanMetadataJson`): `metadata_version`, `experiment_id`, `phenotyper_id`, `scanner_name`, `plant_id`, `accession_name?`, `plant_age_days`, `wave_number`, `capture_date`, `num_frames`, `scan_path?`, `exposure_time`, `gain`, `brightness`, `contrast`, `gamma`, `seconds_per_rot`.

Two of these are worth calling out explicitly, since they're easy to get backwards:

- **`brightness` and `contrast` ARE present in `metadata.json`**, always written as fixed `0` values — even though neither field exists in the configurable `CameraSettings` type. This preserves the pilot app's metadata format for backward compatibility (the acA2000-50gm doesn't support these settings at all, so there's nothing real to record; `0` is the identity/no-op value). Do not read their absence from `CameraSettings` as meaning they're absent from `metadata.json` too — they are two different things.
- **`gain` and `seconds_per_rot` always reflect the actual values used at capture time**, not today's defaults — `buildMetadataObject()` reads them from the `settings` object passed in, never a hardcoded constant. A scan captured under an old default remains fully self-describing and reproducible even after the app's defaults later change.

**Write behavior**: `writeMetadataJson()` uses an atomic write pattern — it writes to `metadata.json.tmp` first, then renames it to `metadata.json`, so a crash or interruption during write can never leave a partial/corrupt `metadata.json` behind. Any stale `.tmp` file left by a previous failed write is cleaned up before the next write attempt.

## Mock vs Real Hardware

### Mock Hardware (Default)

The mock scanner is used by default when `BLOOM_USE_MOCK_HARDWARE=true` (or unset):

- **Simulates** complete scanning workflow
- **No hardware** required - runs entirely in software
- **Fast execution** - ~4-5 seconds for 72 frames
- **Position tracking** with realistic rotation
- **Console output** shows scan progress

Example console output:

```
STATUS:Starting scan: 72 frames, 5.00° per frame
STATUS:Turntable homed to 0°
STATUS:Capturing frame 1/72 at 5.00°
STATUS:Capturing frame 2/72 at 10.00°
...
STATUS:Capturing frame 72/72 at 360.00°
STATUS:Turntable returned to home position
STATUS:Scan completed successfully: 72/72 frames
```

### Real Hardware

To test with real camera and DAQ hardware, set the environment variable:

```bash
BLOOM_USE_MOCK_HARDWARE=false npm start
```

Requirements:

- Basler Pylon SDK with connected camera
- NI-DAQmx drivers with compatible DAQ device (e.g., cDAQ-9174)
- Stepper motor controller wired to digital outputs
- Proper device names configured in settings

## Scanner Operations

### Initialize

Initializes both camera and DAQ with the provided settings:

```javascript
const result = await window.electron.scanner.initialize({
  camera: {
    /* camera settings */
  },
  daq: {
    /* DAQ settings */
  },
  num_frames: 72,
  output_path: './scans',
});
```

### Scan

Performs a complete automated scan:

```javascript
const result = await window.electron.scanner.scan();
// Returns: { success, frames_captured, output_path, error? }
```

The scan workflow:

1. Homes turntable to 0°
2. Loops through frames:
   - Rotates to position (degrees = frame × 360/num_frames)
   - Waits 50ms for stabilization
   - Captures image
3. Returns to home position (0°)

### Get Status

Retrieves current scanner, camera, and DAQ status:

```javascript
const status = await window.electron.scanner.getStatus();
// Returns: { success, initialized, camera_status, daq_status, position, mock }
```

### Cleanup

Cleans up both camera and DAQ resources:

```javascript
await window.electron.scanner.cleanup();
```

## Event Listeners

The Scanner API supports event listeners for real-time updates:

```javascript
// Listen for scan progress (frame-by-frame updates)
window.electron.scanner.onProgress((progress) => {
  console.log(
    `Frame ${progress.frame_number}/${progress.total_frames} at ${progress.position}°`
  );
});

// Listen for scan completion
window.electron.scanner.onComplete((result) => {
  console.log(`Scan complete: ${result.frames_captured} frames`);
});

// Listen for errors
window.electron.scanner.onError((error) => {
  console.error('Scanner error:', error);
});
```

**Note**: Progress events are currently emitted after each frame capture during the scan operation.

## Scan Workflow Details

### Frame Calculation

For a 72-frame scan (default):

- **Degrees per frame**: 360° / 72 = 5°
- **Frame 0**: 0° (home)
- **Frame 1**: 5°
- **Frame 2**: 10°
- ...
- **Frame 71**: 355°
- **After scan**: Returns to 0° (home)

### Timing

With mock hardware (default settings):

- **Rotation time per frame**: ~50ms (stabilization wait)
- **Capture time per frame**: ~10ms (mock camera)
- **Total scan time**: ~72 frames × 60ms = ~4.5 seconds

With real hardware:

- **Rotation time**: Based on `seconds_per_rot` / `num_frames`
- **Capture time**: Based on camera exposure time
- **Total scan time**: `seconds_per_rot` (e.g., 7 seconds for default settings)

### Position Tracking

The scanner maintains accurate position throughout:

- **Initial**: 0° (home position)
- **During scan**: Accumulates rotation (wraps at 360°)
- **After scan**: Returns to 0° (home position)
- **Precision**: Based on DAQ step count (default: 6400 steps/360°)

## Troubleshooting

See the [Troubleshooting Guide](TROUBLESHOOTING.md#scanner) for scanner-specific issues (unknown command, not-initialized errors, frame-count mismatches, position not returning home, real hardware not detected).

## Comparison: Scanner vs Manual Control

### Using Scanner (Recommended)

```javascript
// One command for complete scan
await window.electron.scanner.initialize(settings);
const result = await window.electron.scanner.scan();
// Automatic: rotation + capture + home for all 72 frames
```

### Using Manual Control

```javascript
// Manual coordination required
await window.electron.camera.connect(cameraSettings);
await window.electron.daq.initialize(daqSettings);
await window.electron.daq.home();

for (let i = 0; i < 72; i++) {
  await window.electron.daq.rotate(5); // Rotate 5°
  await new Promise((resolve) => setTimeout(resolve, 50)); // Wait
  await window.electron.camera.capture(); // Capture
}

await window.electron.daq.home();
await window.electron.camera.disconnect();
await window.electron.daq.cleanup();
```

The Scanner provides:

- **Simplified API**: Single scan() call vs manual loop
- **Automatic coordination**: Handles timing and synchronization
- **Error handling**: Automatic cleanup on failure
- **Progress tracking**: Built-in progress events

## Next Steps

1. **Test with real hardware**: Set `BLOOM_USE_MOCK_HARDWARE=false` and connect devices
2. **Integrate into UI**: Add scanner controls to React components (see [Issue #34](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/34))
3. **Implement progress display**: Show real-time scan progress in the UI
4. **Add image preview**: Display captured frames during scanning
5. **Tune parameters**: Adjust `num_frames`, `seconds_per_rot`, and `steps_per_revolution` for your setup

## Scanner Identity Service

Each scanner instance holds an in-memory `scannerIdentity` (`src/main/main.ts`), initialized from `.env` at startup and re-synced whenever Machine Configuration is saved. It's exposed to the renderer via the `scanner:get-scanner-id` IPC handler, which returns the configured scanner name (or an empty string if unset). This is a fast, file-I/O-free way for UI components to read the current scanner's name — it does not persist independently of `.env`/config; restarting the app re-reads it from there.

## Idle Session Reset

`IdleTimer` (`src/main/idle-timer.ts`) tracks inactivity in the main process and resets in-memory session state (`src/main/session-store.ts`'s `phenotyperId`, `experimentId`, `waveNumber`, `plantAgeDays`, `accessionName`) after a period of inactivity — 10 minutes by default. This exists to prevent scan misattribution in shared lab environments, where a phenotyper might walk away mid-session and someone else could otherwise continue capturing scans under the previous person's session context.

The timer resets on explicit activity events (`session:set`, `scanner:initialize`) and pauses during an active scan (`scanner:scan`) so a long-running scan is never interrupted by an idle timeout. It does **not** reset on page navigation or polling alone.

## Related Documentation

- [Camera Testing Guide](CAMERA_TESTING.md)
- [DAQ Testing Guide](DAQ_TESTING.md)
- [Troubleshooting Guide](TROUBLESHOOTING.md)
- [GraviScan Scanner Driver Setup](GRAVISCAN_SCANNER_DRIVER_SETUP.md) —
  the Epson flatbed scanner used by GraviScan, a different scanner
  subsystem from the CylinderScan turntable+camera "Scanner" this doc covers
- [Python Backend API](../python/README.md)
- [Integration Tests](../tests/integration/)
