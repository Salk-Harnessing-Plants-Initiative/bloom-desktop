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
STATUS:Mock camera opened
DATA:{"success": true, "connected": true}
```

Note: In development mode, the mock camera automatically loads real plant scan images from `tests/fixtures/sample_scan/`. No warnings should appear.

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
// Quick test script - paste into browser console
(async () => {
  // Connect to camera
  await window.electron.camera.connect({
    exposure_time: 5000,
    gain: 10,
    gamma: 1.0
  });

  // Capture and display
  const image = await window.electron.camera.capture();
  const img = document.createElement('img');
  img.src = image.dataUri;
  img.style.maxWidth = '80%';
  img.style.border = '3px solid #4CAF50';
  img.style.margin = '20px';
  img.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
  document.body.appendChild(img);

  console.log(`✅ Captured ${image.width}x${image.height} image`);
  // Expected: ✅ Captured 2048x1080 image (real plant scan)
})();
```

**What you'll see:**
- A real plant scan image displayed on the page
- Dimensions: 2048x1080 pixels (real images) vs 640x480 (synthetic)
- Image size: ~2-3MB (real) vs ~400KB (synthetic)
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
2. **Loading test images** from `tests/fixtures/sample_scan/` if they exist
3. **Providing the same API** as the real camera

### Test Images

The repository includes a complete set of 72 real plant scan images in `tests/fixtures/sample_scan/` (1.png through 72.png). These images are used by the mock camera to provide realistic test data.

### Image Loading Behavior

The mock camera automatically detects its execution environment:

**Development mode** (`npm start` or `npm run test:camera`):
- ✅ Loads real plant scan images from `tests/fixtures/sample_scan/`
- 📐 Images: 2048x1080 pixels, ~2.2MB each
- 📸 72 images total (5° rotation increments for full 360° scan)

**Source execution** (Python tests with `pytest`):
- ✅ Loads real images from fixtures directory
- ✅ Full test coverage with realistic data

**Production bundle** (if images not found):
- ⚠️ Falls back to synthetic gradient patterns
- 📐 Images: 640x480 pixels, minimal size
- ✅ Still functional, just not realistic

To add your own test images:

```bash
# Add PNG images to the fixtures directory (named 1.png, 2.png, etc.)
# The mock camera will load them automatically
cp your-images/*.png tests/fixtures/sample_scan/
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

### "Python process startup timeout" in Development Mode

If `npm start` shows timeout errors, the Python executable may be taking >5s to start (common with PyInstaller on macOS).

**Fixed in latest version**: Timeout increased to 15s. Update to latest code:

```bash
git pull
npm start
```

### "Camera command error: missing required arguments"

This happens if you call `capture()` or `configure()` before connecting to the camera.

**Solution**: Always connect before capturing:

```javascript
// ✅ Correct workflow
await window.electron.camera.connect(settings);
const image = await window.electron.camera.capture();
```

### Camera capture returns error in integration test

If you're writing custom tests, ensure the camera instance persists between commands. The Python IPC handler maintains camera state between calls, so you must:

1. Connect once: `{"command":"camera","action":"connect",...}`
2. Capture using same process: `{"command":"camera","action":"capture"}`
3. Don't create new process between commands

### No Images Captured / Blank Images

Make sure the camera is connected before capturing:

```javascript
// ❌ Wrong - camera not connected
const image = await window.electron.camera.capture();

// ✅ Correct - connect first
await window.electron.camera.connect(settings);
const image = await window.electron.camera.capture();
```

### Integration Test Works But Dev Mode Fails

This is usually a webpack bundling issue. Try:

```bash
# Clean rebuild
rm -rf .webpack node_modules/.cache
npm start
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
