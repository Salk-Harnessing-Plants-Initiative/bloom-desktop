# Tasks: Update Scan Directory Path Format

## Red-Green TDD Phases

### Phase 1: RED — Unit Tests (all tests written FIRST, all should FAIL)

- [ ] 1.1 Write unit test for `getLocalDateYYYYMMDD()` date helper
  - Test with known dates, verify YYYY-MM-DD format
  - Test timezone edge case: near midnight UTC where local date differs
  - Port pilot logic from `scanner.ts:321-327`
  - File: `tests/unit/date-helpers.test.ts`
- [ ] 1.2 Write unit test for `buildScanPath()` format (`YYYY-MM-DD/plant_qr_code/uuid`)
  - Test normal case: `buildScanPath("PLANT-001", "abc-uuid")` → `"2026-03-04/PLANT-001/abc-uuid"`
  - File: `tests/unit/scan-path.test.ts`
- [ ] 1.3 Write unit test for path sanitization of `plant_qr_code`
  - Test special characters: `"PLANT/001..bad"` → sanitized
  - Test path traversal: `"../../../etc"` → sanitized
  - File: `tests/unit/scan-path.test.ts`
- [ ] 1.4 Write unit test for edge cases
  - Empty plant QR code → `"unknown"` segment
  - Long plant QR code (>100 chars) → truncated
  - Multiple underscores collapsed
  - File: `tests/unit/scan-path.test.ts`
- [ ] 1.5 **Run tests — verify they all FAIL (RED)**

### Phase 2: GREEN — Implementation

- [ ] 2.1 Implement `getLocalDateYYYYMMDD()` in `src/utils/date-helpers.ts`
- [ ] 2.2 Implement `buildScanPath()` in `src/utils/scan-path.ts`
  - Uses `getLocalDateYYYYMMDD()` and `sanitizePathComponent()` from existing `path-sanitizer.ts`
  - Returns relative path string (no `scans_dir` prefix)
- [ ] 2.3 **Run tests — verify they all PASS (GREEN)**

### Phase 3: RED — Integration Tests (written FIRST, should FAIL)

- [ ] 3.1 Write integration test for CaptureScan path generation using new format
  - Verify `handleStartScan` passes pilot-format path to `scanner.initialize()`
  - File: `tests/unit/capture-scan-path.test.ts` (unit-level, mocked IPC)
- [ ] 3.2 Write integration test for relative path storage in `Scan.path`
  - Verify `scanner-process.ts:saveScanToDatabase()` stores relative path
  - File: `tests/unit/scanner-process-path.test.ts`
- [ ] 3.3 Write integration test for relative `Image.path` storage
  - Verify each image path is relative (e.g., `2026-03-04/PLANT-001/uuid/001.png`)
  - File: `tests/unit/scanner-process-path.test.ts`
- [ ] 3.4 Write integration test for ScanPreview resolving relative paths to absolute
  - Verify `pathToFileUrl()` receives `scansDir + '/' + relativePath`
  - File: `tests/unit/scan-preview-path.test.ts`
- [ ] 3.5 Write integration test for image-uploader resolving relative paths for upload
  - Verify `uploadImages()` receives absolute paths (scansDir prepended)
  - Update existing `tests/unit/image-uploader.test.ts`
- [ ] 3.6 **Run tests — verify they FAIL (RED)**

### Phase 4: GREEN — Integration Implementation

- [ ] 4.1 Update `src/renderer/CaptureScan.tsx:397-401` to use `buildScanPath()`
  - Generate `scanUuid` via `crypto.randomUUID()`
  - Replace `sanitizePath([experimentId, plantQrCode_timestamp])` with `buildScanPath(plantQrCode, scanUuid)`
  - Construct absolute `outputPath = scansDir + '/' + relativePath` for `scanner.initialize()`
- [ ] 4.2 Update `src/main/scanner-process.ts:235` to store relative `Scan.path`
  - Derive relative path by stripping `scans_dir` prefix from `scanResult.output_path`
- [ ] 4.3 Update `src/main/scanner-process.ts:202` to store relative `Image.path`
  - Build relative: `path.join(relativeScanPath, filename)`
- [ ] 4.4 Update `src/renderer/ScanPreview.tsx:342` to prepend `scansDir`
  - Load `scansDir` from config via `window.electron.config.get()`
  - Prepend to `currentImage.path` in `pathToFileUrl()` call
- [ ] 4.5 Update `src/main/image-uploader.ts:243` to prepend `scansDir`
  - Load `scansDir` from config
  - Prepend to each `image.path` before passing to bloom-fs
- [ ] 4.6 Update test fixtures in `tests/integration/database.test.ts` and `tests/unit/image-uploader.test.ts` to use relative paths
- [ ] 4.7 **Run tests — verify they PASS (GREEN)**

### Phase 5: RED — E2E Tests with Playwright (written FIRST, should FAIL)

- [ ] 5.1 Write Playwright E2E test that verifies scan directory uses `YYYY-MM-DD` format
  - File: `tests/e2e/scan-directory-format.e2e.ts`
- [ ] 5.2 Write Playwright E2E test that verifies `Scan.path` in DB is relative
  - Query database after scan, verify path does not start with `/`
- [ ] 5.3 **Run tests — verify they FAIL (RED)**

### Phase 6: GREEN — E2E fixes

- [ ] 6.1 Fix any issues found by E2E tests
- [ ] 6.2 **Run tests — verify they PASS (GREEN)**

### Phase 7: Pre-merge

- [ ] 7.1 Run full pre-merge checks (lint, tsc, unit tests, integration tests, E2E tests)
- [ ] 7.2 Open PR referencing #100
