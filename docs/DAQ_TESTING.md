# DAQ Testing Guide

This guide explains how to test the DAQ (Data Acquisition) interface functionality with the mock DAQ for turntable control.

## Quick Test

The fastest way to test the DAQ functionality is using the integration test:

```bash
# Run the full integration test
npm run test:daq
```

This tests the complete DAQ workflow: status, initialize, rotate, step, home, and cleanup operations with position tracking.

## Manual Command-Line Testing

You can test individual DAQ commands by piping JSON to the Python executable:

### 1. Check DAQ Status

```bash
echo '{"command":"daq","action":"status"}' | ./dist/bloom-hardware --ipc
```

Expected output:

```
STATUS:IPC handler ready
DATA:{"success": true, "initialized": false, "position": 0, "mock": true, "available": true}
```

### 2. Initialize DAQ

```bash
echo '{"command":"daq","action":"initialize","settings":{"device_name":"cDAQ1Mod1","sampling_rate":40000,"step_pin":0,"dir_pin":1,"steps_per_revolution":6400,"num_frames":72,"seconds_per_rot":36.0}}' | ./dist/bloom-hardware --ipc
```

Expected output:

```
STATUS:IPC handler ready
STATUS:Using mock DAQ
STATUS:Initializing mock DAQ
STATUS:Mock DAQ initialized successfully
DATA:{"success": true, "initialized": true}
```

### 3. Rotate Turntable

**Important**: DAQ operations require the process to stay running. Use an interactive session:

```bash
# Start the IPC handler
./dist/bloom-hardware --ipc

# Then type these commands (one per line):
{"command":"daq","action":"initialize","settings":{"device_name":"cDAQ1Mod1","sampling_rate":40000,"step_pin":0,"dir_pin":1,"steps_per_revolution":6400,"num_frames":72,"seconds_per_rot":36.0}}
{"command":"daq","action":"rotate","degrees":90}
{"command":"daq","action":"status"}
{"command":"daq","action":"home"}
```

You should see status messages and position updates after each command.

## Testing with the Electron App

Once the Electron app is running, you can test the DAQ from the renderer process:

```javascript
// Quick test script - paste into browser console
(async () => {
  console.log('=== DAQ Test ===\n');

  // 1. Check initial status
  const status1 = await window.electron.daq.getStatus();
  console.log('Initial status:', status1);

  // 2. Initialize DAQ with default settings
  // Note: You can import DEFAULT_DAQ_SETTINGS from src/types/daq.ts
  // For browser console, we'll use the values directly:
  await window.electron.daq.initialize({
    device_name: 'cDAQ1Mod1',
    sampling_rate: 40000,
    step_pin: 0,
    dir_pin: 1,
    steps_per_revolution: 6400,
    num_frames: 72,
    seconds_per_rot: 36.0,
  });
  console.log('✅ DAQ initialized');

  // 3. Rotate 90 degrees
  const rotate1 = await window.electron.daq.rotate(90);
  console.log(`✅ Rotated to ${rotate1.position}°`);

  // 4. Rotate 45 more degrees
  const rotate2 = await window.electron.daq.rotate(45);
  console.log(`✅ Rotated to ${rotate2.position}°`);

  // 5. Return home
  const home = await window.electron.daq.home();
  console.log(`✅ Returned home to ${home.position}°`);

  // 6. Cleanup
  await window.electron.daq.cleanup();
  console.log('✅ DAQ cleaned up');

  console.log('\n=== Test Complete ===');
})();
```

**Expected Output:**

```
=== DAQ Test ===

Initial status: {success: true, initialized: false, position: 0, mock: true, available: true}
✅ DAQ initialized
✅ Rotated to 90°
✅ Rotated to 135°
✅ Returned home to 0°
✅ DAQ cleaned up

=== Test Complete ===
```

## DAQ Settings

The DAQ accepts the following configuration settings:

| Setting                | Type   | Default       | Description                              |
| ---------------------- | ------ | ------------- | ---------------------------------------- |
| `device_name`          | string | `"cDAQ1Mod1"` | NI-DAQ device name                       |
| `sampling_rate`        | number | `40000`       | DAQ sampling rate in Hz                  |
| `step_pin`             | number | `0`           | Digital output line for step signal      |
| `dir_pin`              | number | `1`           | Digital output line for direction signal |
| `steps_per_revolution` | number | `6400`        | Steps for full 360° rotation             |
| `num_frames`           | number | `72`          | Number of frames to capture              |
| `seconds_per_rot`      | number | `36.0`        | Time for complete rotation               |

## Mock vs Real DAQ

### Mock DAQ (Default)

The mock DAQ is used by default when `BLOOM_USE_MOCK_DAQ=true` (or unset):

- **Simulates** stepper motor timing and position tracking
- **No hardware** required - runs entirely in software
- **Position tracking** with degree wrapping (0-360°)
- **Instant initialization** for rapid testing
- **Console output** shows rotation progress

Example console output:

```
STATUS:Mock DAQ rotating 90.00° (1600 steps)
STATUS:Mock DAQ rotation complete. Position: 90.00°
```

### Real DAQ

To test with real NI-DAQmx hardware, set the environment variable:

```bash
BLOOM_USE_MOCK_DAQ=false npm start
```

Requirements:

- NI-DAQmx drivers installed
- Compatible NI-DAQ device connected (e.g., cDAQ-9174)
- Stepper motor controller wired to digital outputs
- Proper device name configured in settings

## DAQ Operations

### Initialize

Initializes the DAQ with the provided settings and prepares it for operation.

```javascript
const result = await window.electron.daq.initialize({
  device_name: 'cDAQ1Mod1',
  sampling_rate: 40000,
  // ... other settings
});
```

### Rotate

Rotates the turntable by the specified number of degrees:

- **Positive values**: Clockwise rotation
- **Negative values**: Counter-clockwise rotation
- **Position wrapping**: Automatically wraps to 0-360° range

```javascript
await window.electron.daq.rotate(90); // Rotate 90° clockwise
await window.electron.daq.rotate(-45); // Rotate 45° counter-clockwise
```

### Step

Executes a specific number of stepper motor steps (low-level control):

```javascript
await window.electron.daq.step(100, 1); // 100 steps clockwise
await window.electron.daq.step(50, -1); // 50 steps counter-clockwise
```

### Home

Returns the turntable to the home position (0°):

```javascript
await window.electron.daq.home();
```

### Get Status

Retrieves current DAQ status including position:

```javascript
const status = await window.electron.daq.getStatus();
// Returns: { success, initialized, position, mock, available }
```

### Cleanup

Cleans up DAQ resources and closes the connection:

```javascript
await window.electron.daq.cleanup();
```

## Event Listeners

The DAQ API supports event listeners for real-time updates:

```javascript
// Listen for initialization
window.electron.daq.onInitialized(() => {
  console.log('DAQ initialized!');
});

// Listen for position changes
window.electron.daq.onPositionChanged((position) => {
  console.log(`Position: ${position}°`);
});

// Listen for home events
window.electron.daq.onHome(() => {
  console.log('Returned to home position');
});

// Listen for errors
window.electron.daq.onError((error) => {
  console.error('DAQ error:', error);
});
```

## Position Tracking

The DAQ tracks turntable position in degrees (0-360°):

- **Initial position**: 0° (home)
- **Rotation direction**: Positive = clockwise, Negative = counter-clockwise
- **Wrapping**: Position automatically wraps (e.g., 370° → 10°, -10° → 350°)
- **Precision**: Position calculated from step count

Example position flow:

```javascript
await window.electron.daq.initialize(...);  // Position: 0°
await window.electron.daq.rotate(90);       // Position: 90°
await window.electron.daq.rotate(45);       // Position: 135°
await window.electron.daq.rotate(-45);      // Position: 90°
await window.electron.daq.rotate(360);      // Position: 90° (full rotation)
await window.electron.daq.home();           // Position: 0°
```

## Troubleshooting

### Issue: "Unknown command: daq"

**Solution**: Rebuild the Python executable to include DAQ handlers:

```bash
npm run build:python
```

### Issue: "DAQ not initialized"

**Solution**: Call `initialize()` before other DAQ operations:

```javascript
await window.electron.daq.initialize({
  /* settings */
});
```

### Issue: Position doesn't update

**Solution**: Check that operations return `success: true`:

```javascript
const result = await window.electron.daq.rotate(90);
if (!result.success) {
  console.error('Rotation failed:', result.error);
}
```

### Issue: Real DAQ not detected

**Solution**: Verify:

1. NI-DAQmx drivers are installed
2. Device is connected and powered
3. Device name matches your hardware
4. `BLOOM_USE_MOCK_DAQ=false` is set

## Integration with Camera

For synchronized scanning, the DAQ can be coordinated with camera capture:

```javascript
// Initialize both systems
await window.electron.daq.initialize({
  /* DAQ settings */
});
await window.electron.camera.connect({
  /* camera settings */
});

// Perform synchronized scan
const degreesPerFrame = 360 / 72; // 72 frames
for (let i = 0; i < 72; i++) {
  // Rotate to position
  await window.electron.daq.rotate(degreesPerFrame);

  // Wait for stabilization (if needed)
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Capture frame
  const image = await window.electron.camera.capture();
  console.log(`Frame ${i + 1}/72 captured at ${(i + 1) * degreesPerFrame}°`);
}

// Return home
await window.electron.daq.home();
```

## Next Steps

1. **Test with real hardware**: Set `BLOOM_USE_MOCK_DAQ=false` and connect NI-DAQ device
2. **Integrate into UI**: Add DAQ controls to React components
3. **Implement scanning**: Coordinate DAQ rotation with camera capture
4. **Tune parameters**: Adjust `seconds_per_rot` and `steps_per_revolution` for your setup
5. **Add visualization**: Display current turntable position in the UI

## Related Documentation

- [Camera Testing Guide](CAMERA_TESTING.md)
- [Python Backend API](../python/README.md)
- [Integration Tests](../tests/integration/)
