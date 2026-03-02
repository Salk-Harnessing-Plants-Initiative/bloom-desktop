# TDD Implementation Plan

## Background Analysis

### Scope of the Bug

The `Scanner.perform_scan()` method in `python/hardware/scanner.py` captures frames via `camera.grab_frame()` but **never saves them to disk**. This affects:

1. **CaptureScan workflow** - Scans complete but have 0 images
2. **BrowseScans page** - Shows scans with "Images: 0"
3. **ScanPreview page** - Shows "No images" message
4. **Upload feature** - Nothing to upload

### Pilot Reference for File Naming

The pilot implementation uses this filename format:

- **pylon.py:62-63**: `fname = output_path / f'{i + 1:03d}.png'` → `001.png`, `002.png`, etc.
- **pylon_rot.py:45**: `image_paths = [f'{idx + 1}.png' for idx in range(len(frames))]`
- Source: https://github.com/eberrigan/bloom-desktop-pilot/tree/main/pylon

Our `camera.py:251` also uses: `fname = output_path / f"{i + 1:03d}.png"`

### Current Test Behavior

| Test File                      | Current Behavior                                            | Change Needed                     |
| ------------------------------ | ----------------------------------------------------------- | --------------------------------- |
| `test_scanner.py`              | Tests pass without verifying file creation                  | Add image file verification       |
| `test-scanner-database.ts`     | Comment says "mock doesn't create files" (line 285)         | Update to expect images after fix |
| `scan-preview.e2e.ts`          | Creates DB records with fake paths, doesn't load real files | No change - tests UI interactions |
| `renderer-database-ipc.e2e.ts` | Creates DB records with fake paths                          | No change - tests IPC handlers    |
| `image-uploader.test.ts`       | Uses Prisma mocks                                           | No change - unit tests            |

### CI Disk Space Impact

- Mock camera uses 480x640 grayscale images (~300KB PNG after compression)
- Most tests use 5 frames = ~1.5MB per test
- Tests use temp directories, cleaned up after each test
- **Minimal CI impact** with proper cleanup

---

## Phase 1: RED - Write Failing Tests

### 1.1 Python Unit Tests

- [x] Add test `test_perform_scan_creates_output_directory` - verify directory is created if it doesn't exist
- [x] Add test `test_perform_scan_saves_images_to_disk` - verify PNG files exist in output_path
- [x] Add test `test_perform_scan_image_filenames_are_correct` - verify `001.png`, `002.png`, etc. (pilot format)
- [x] Add test `test_perform_scan_image_count_matches_frames_captured` - verify file count equals frames_captured
- [x] Add test `test_perform_scan_images_are_readable` - verify saved images can be read back with imageio
- [x] Run tests to confirm they fail

### 1.2 TypeScript Test Update

- [x] Update `test-scanner-database.ts` to assert `savedScan.images.length > 0` after fix
- [x] Update `scanner-process.ts` to parse `NNN.png` format (extract number directly, no +1 needed)
- [x] Update path format check to match pilot-compatible NNN.png format

---

## Phase 2: GREEN - Implement Fix

### 2.1 Scanner Implementation (Python)

- [x] Use `pathlib.Path` with `.as_posix()` for cross-platform path handling
- [x] In `perform_scan()`, create output directory before capture loop:
  ```python
  from pathlib import Path
  output_dir = Path(output_path)
  output_dir.mkdir(parents=True, exist_ok=True)
  ```
- [x] After each successful `grab_frame()`, save the image with pilot-compatible naming:
  ```python
  if image is not None:
      frames_captured += 1
      filepath = output_dir / f"{frame_idx + 1:03d}.png"  # Pilot format
      iio.imwrite(filepath.as_posix(), image)  # Use POSIX path for cross-platform
  ```

### 2.2 Scanner Process Fix (TypeScript)

- [x] Update regex from `/frame_(\d+)/` to `/^(\d+)\.png$/`
- [x] Use extracted number directly as frame_number (already 1-indexed)

### 2.3 Verify Tests Pass

- [x] Run `uv run pytest python/tests/test_scanner.py -v` - all tests should pass
- [x] Run `npm run build:python` - rebuild bundled Python
- [x] Run `npm run test:scanner-database` - scanner-database test should pass with images

---

## Phase 3: REFACTOR - Clean Up and Verify ✅ COMPLETE

### 3.1 Test Cleanup

- [x] Ensure Python tests use temp directories and clean up (pytest `tmp_path` fixture)
- [x] Verify no leftover test files

### 3.2 Linting

- [x] Run `uv run ruff check python/` - fix any issues
- [x] Run `npm run lint` - verify TypeScript unchanged

### 3.3 CI Verification

- [x] CI passes (GitHub Actions)

---

## Phase 4: Manual Verification ✅ COMPLETE

- [x] Start app in mock mode: `npm run start`
- [x] Navigate to Capture Scan
- [x] Create a scan with metadata (experiment, phenotyper, plant ID)
- [x] Complete mock capture (72 frames)
- [x] Verify files exist in `SCANS_DIR/{experimentId}/{plantId}_{timestamp}/`
- [x] Verify files are named `001.png` through `072.png`
- [x] Navigate to Browse Scans
- [x] Verify scan shows "Images: 72"
- [x] Click scan to open ScanPreview
- [x] Verify images load and frame navigation works

---

## Verification Checklist

- [x] All Python scanner tests pass
- [x] Integration test `test-scanner-database.ts` passes with images > 0
- [x] E2E tests still pass (unchanged, use fake DB records)
- [x] CI completes successfully
- [x] Mock capture creates real PNG files with pilot-compatible naming (`001.png`)
- [x] Scan saved to database includes Image records with correct paths
- [x] Images load correctly in ScanPreview
