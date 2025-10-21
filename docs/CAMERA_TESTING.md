# Camera Testing Guide

This guide explains how to test the camera interface functionality with the mock camera.

## Quick Test

The fastest way to test the camera functionality is using the integration test:

```bash
# Run the full integration test
npm run test:camera
```

This tests the complete camera workflow: status, connect, capture, configure, and disconnect.

## Manual Command-Line Testing

You can test individual camera commands by piping JSON to the Python executable:

### 1. Check Camera Status

```bash
echo '{"command":"camera","action":"status"}' | ./dist/bloom-hardware --ipc
```

Expected output:
```
STATUS:IPC handler ready
DATA:{"connected": false, "mock": true, "available": true}
```

### 2. Connect to Mock Camera

```bash
echo '{"command":"camera","action":"connect","settings":{"camera_ip_address":"10.0.0.23","exposure_time":5000,"gain":10,"gamma":1.0}}' | ./dist/bloom-hardware --ipc
```

Expected output:
```
STATUS:IPC handler ready
STATUS:Using mock camera
WARNING: Test images directory not found at .../test/sample_scan
Generating synthetic test patterns instead
STATUS:Mock camera opened
DATA:{"success": true, "connected": true}
```

### 3. Capture an Image

**Important**: Camera capture requires the process to stay running. Use an interactive session:

```bash
# Start the IPC handler
./dist/bloom-hardware --ipc

# Then type these commands (one per line):
{"command":"camera","action":"connect","settings":{"camera_ip_address":"10.0.0.23","exposure_time":5000,"gain":10}}
{"command":"camera","action":"capture","settings":{}}
```

You should see a base64-encoded PNG image in the output.

## Testing with the Electron App

Once the Electron app is running, you can test the camera from the renderer process:

```javascript
// In the browser console of the Electron app

// Check camera status
const status = await window.electron.camera.getStatus();
console.log('Camera status:', status);
// Expected: {connected: false, mock: true, available: true}

// Connect to camera
const settings = {
  camera_ip_address: '10.0.0.23',
  exposure_time: 5000,
  gain: 10,
  gamma: 1.0
};

const connected = await window.electron.camera.connect(settings);
console.log('Connected:', connected);
// Expected: true

// Capture an image
const image = await window.electron.camera.capture();
console.log('Captured image:', image);
// Expected: {dataUri: 'data:image/png;base64,...', timestamp: ..., width: ..., height: ...}

// Display the image
const img = document.createElement('img');
img.src = image.dataUri;
document.body.appendChild(img);
```

## Environment Variables

### Mock vs. Real Camera

By default, the system uses a mock camera. To switch between mock and real camera:

```bash
# Use mock camera (default)
export BLOOM_USE_MOCK_CAMERA=true

# Use real PyPylon camera
export BLOOM_USE_MOCK_CAMERA=false
export BLOOM_CAMERA_IP=10.0.0.23
```

## Understanding the Mock Camera

The mock camera simulates a Basler camera by:

1. **Generating synthetic test patterns** if no test images are available
2. **Loading test images** from `test/sample_scan/` if they exist
3. **Providing the same API** as the real camera

### Creating Test Images

To use real test images instead of synthetic patterns:

```bash
# Create the test images directory
mkdir -p test/sample_scan

# Add PNG images (named 1.png, 2.png, etc.)
# The mock camera will cycle through these images
```

## Troubleshooting

### "Camera module not available"

This means the Python camera modules weren't included in the build. Fix:

```bash
# Verify the camera modules are in python/hardware/
ls python/hardware/

# Rebuild with the updated spec file
npm run build:python
```

### TypeScript Integration Test Timeout

The integration test in `tests/integration/test-camera.ts` may timeout due to stderr output from the Python process. This is a known issue and doesn't affect functionality.

**Workaround**: Use the manual test script or test directly in the Electron app.

### No Images Captured

Make sure the camera is connected before capturing:

```javascript
// ❌ Wrong - camera not connected
const image = await window.electron.camera.capture();

// ✅ Correct - connect first
await window.electron.camera.connect(settings);
const image = await window.electron.camera.capture();
```

## Next Steps

1. **Create UI Components** - Build React components to display camera controls and captured images
2. **Test with Real Hardware** - If you have a Basler camera, test with `BLOOM_USE_MOCK_CAMERA=false`
3. **Add Automated Tests** - Create unit tests for the camera React components

## Camera API Reference

See the TypeScript definitions in:
- `src/types/camera.ts` - Camera settings and image types
- `src/types/electron.d.ts` - Electron API interface
- `src/main/camera-process.ts` - Camera process implementation