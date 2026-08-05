# Hardware & Packaged App Troubleshooting

Consolidated troubleshooting guide for CylinderScan hardware (Basler camera, NI-DAQ turntable) and the packaged app's database integration. Previously scattered across `CAMERA_TESTING.md`, `DAQ_TESTING.md`, `SCANNER_TESTING.md`, and `PACKAGED_APP_TESTING.md` — this doc is now the canonical source; those docs link here instead of duplicating the content.

## Camera

### "Camera module not available"

This means the Python camera modules weren't included in the build.

**Solution:**

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

## DAQ

### "Unknown command: daq"

**Solution**: Rebuild the Python executable to include DAQ handlers:

```bash
npm run build:python
```

### "DAQ not initialized"

**Solution**: Call `initialize()` before other DAQ operations:

```javascript
await window.electron.daq.initialize({
  /* settings */
});
```

### Position doesn't update

**Solution**: Check that operations return `success: true`:

```javascript
const result = await window.electron.daq.rotate(90);
if (!result.success) {
  console.error('Rotation failed:', result.error);
}
```

### Real DAQ not detected

**Solution**: Verify:

1. NI-DAQmx drivers are installed
2. Device is connected and powered
3. Device name matches your hardware
4. `BLOOM_USE_MOCK_DAQ=false` is set

## Scanner

### "Unknown command: scanner"

**Solution**: Rebuild the Python executable to include scanner handlers:

```bash
npm run build:python
```

### "Scanner not initialized"

**Solution**: Call `initialize()` before other scanner operations:

```javascript
await window.electron.scanner.initialize({
  camera: {
    /* settings */
  },
  daq: {
    /* settings */
  },
  num_frames: 72,
  output_path: './scans',
});
```

### Scan captures fewer frames than expected

**Solution**: Check that scanner completed successfully:

```javascript
const result = await window.electron.scanner.scan();
if (!result.success) {
  console.error('Scan failed:', result.error);
}
console.log(`Captured ${result.frames_captured}/${num_frames} frames`);
```

### Position doesn't return to zero after scan

**Solution**: The scanner automatically calls `home()` after scanning. If position is not zero, check for errors:

```javascript
const status = await window.electron.scanner.getStatus();
if (Math.abs(status.position) > 1) {
  console.error(`Scanner not at home: ${status.position}°`);
}
```

### Real hardware not detected

**Solution**: Verify:

1. **Camera**: Pylon SDK installed, camera connected and powered
2. **DAQ**: NI-DAQmx drivers installed, device connected
3. **Environment**: `BLOOM_USE_MOCK_HARDWARE=false` is set
4. **Settings**: Device names match your hardware

## Packaged App Database

### Database Not Initializing

**Symptom:** App starts but no database logs appear

**Solution:**

1. Check that schema is applied: `BLOOM_DATABASE_URL="file:$HOME/.bloom/data/bloom.db" npx prisma db push`
2. Verify database file exists: `ls -la ~/.bloom/data/bloom.db`
3. Run with logs: `"out/.../Bloom Desktop" 2>&1 | grep Database`

### Foreign Key Constraint Error

**Symptom:** Error when saving scan: `Foreign key constraint violated`

**Cause:** The Experiment ID or Phenotyper ID doesn't exist in the database

**Solution:**

1. Open Prisma Studio: `BLOOM_DATABASE_URL="file:$HOME/.bloom/data/bloom.db" npx prisma studio`
2. Verify the Experiment and Phenotyper exist
3. Copy the exact UUID `id` values (not human-readable names)
4. Use those UUIDs in the Capture Scan form

### No Images Saved

**Symptom:** Scan is saved but Image table is empty

**Cause:** Mock scanner doesn't create actual image files when `num_frames = 0`

**Expected Behavior:** This is normal for mock mode. Real hardware scans will create `.png`/`.jpg`/`.tiff` files that get saved to the database.

**To Verify it Works:** Check the logs for:

```
[Scanner] Saving scan to database: { ..., frames: 0, ... }
[Scanner] Successfully saved scan to database: { scan_id: '...', image_count: 0 }
```

### Prisma Studio Shows Empty Database

**Cause:** You're viewing the dev database (`prisma/dev.db`) instead of the production database

**Solution:** Always specify the production database URL:

```bash
BLOOM_DATABASE_URL="file:$HOME/.bloom/data/bloom.db" npx prisma studio
```

### Packaged App Not Found

**Symptom:** `out/` directory doesn't exist or is empty

**Solution:** Run the packaging command:

```bash
npm run package
```

Wait 1-2 minutes for it to complete.

### Old Package (Changes Not Reflected)

**Symptom:** Code changes don't appear in the packaged app

**Solution:** Rebuild the package after every code change:

```bash
npm run package
```

The packaged app is a snapshot. Unlike `npm run dev`, it doesn't auto-reload.

## Related Documentation

- [Camera Testing Guide](CAMERA_TESTING.md)
- [DAQ Testing Guide](DAQ_TESTING.md)
- [Scanner Testing Guide](SCANNER_TESTING.md)
- [Packaged App Testing Guide](PACKAGED_APP_TESTING.md)
- [Configuration Reference](CONFIGURATION.md)
