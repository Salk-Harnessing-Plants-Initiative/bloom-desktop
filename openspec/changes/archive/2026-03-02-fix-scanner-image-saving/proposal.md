## Why

The Scanner.perform_scan() method captures frames via camera.grab_frame() but never saves them to disk. This causes scans to be recorded with 0 images, breaking the BrowseScans and ScanPreview features which expect image files to exist at the output_path.

## What Changes

- Scanner.perform_scan() SHALL save each captured frame to disk as PNG files
- Output directory SHALL be created if it doesn't exist
- Files SHALL be named with 3-digit zero-padded frame numbers (e.g., `001.png`, `002.png`)
- TypeScript scanner-process.ts SHALL extract frame number directly from filename (1-indexed)
- **Cross-platform**: Use `pathlib.Path` with `.as_posix()` for all file paths to ensure consistent behavior across Windows, macOS, and Linux

### Pilot Reference

The filename format matches the pilot implementation:

- **pylon.py:62-63**: `fname = output_path / f'{i + 1:03d}.png'`
- **pylon_rot.py:45**: `image_paths = [f'{idx + 1}.png' for idx in range(len(frames))]`
- Source: https://github.com/eberrigan/bloom-desktop-pilot/tree/main/pylon

Both use 1-indexed filenames. We use `{i + 1:03d}.png` for consistency with `pylon.py` and our `camera.py:251`.

## Impact

- Affected specs: scanning
- Affected code:
  - python/hardware/scanner.py (image saving)
  - python/tests/test_scanner.py (unit tests)
  - src/main/scanner-process.ts (frame number parsing)
  - tests/integration/test-scanner-database.ts (integration test)
