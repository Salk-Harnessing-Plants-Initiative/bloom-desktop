# Tasks: Update Scan Directory Path Format

TDD Workflow: Red (write failing test) → Green (implement) → Refactor → Verify → Commit

## Phase 1: Date Helper

- [ ] 1.1 Write unit test for `getLocalDateYYYYMMDD()`
  - Test with known dates across timezones
  - Test edge case: near midnight UTC where local date differs
  - Port pilot logic from `scanner.ts:321-327`
  - File: `src/utils/__tests__/date-helpers.test.ts`
- [ ] 1.2 Implement `getLocalDateYYYYMMDD()` in `src/utils/date-helpers.ts`
- [ ] 1.3 Verify test passes

## Phase 2: Scan Path Builder

- [ ] 2.1 Write unit test for `buildScanPath()`
  - Test normal case: `buildScanPath("PLANT-001", "abc-uuid")` → `"2026-03-04/PLANT-001/abc-uuid"`
  - Test sanitization: plant QR code with special characters gets sanitized via `sanitizePathComponent()`
  - Test edge case: empty plant QR code → `"unknown"` segment
  - File: `src/utils/__tests__/scan-path.test.ts`
- [ ] 2.2 Implement `buildScanPath(plantQrCode, scanUuid, date?)` in `src/utils/scan-path.ts`
  - Uses `getLocalDateYYYYMMDD()` and `sanitizePathComponent()` from existing `path-sanitizer.ts`
  - Returns relative path string (no `scans_dir` prefix)
- [ ] 2.3 Verify tests pass

## Phase 3: Update CaptureScan Path Generation

- [ ] 3.1 Update `src/renderer/CaptureScan.tsx` `handleStartScan` (lines 397-401)
  - Generate `scanUuid` via `crypto.randomUUID()` (available in renderer)
  - Replace `sanitizePath([experimentId, plantQrCode_timestamp])` with `buildScanPath(plantQrCode, scanUuid)`
  - Construct absolute `outputPath = scansDir + '/' + relativePath` for `scanner.initialize()`
  - Pass `scanUuid` in metadata so `scanner-process.ts` can reference it

## Phase 4: Store Relative Paths in Database

- [ ] 4.1 Update `src/main/scanner-process.ts:saveScanToDatabase()`
  - Line 235: Derive relative `Scan.path` by stripping `scans_dir` prefix from `scanResult.output_path`
  - Line 202: Build `Image.path` as relative: `path.join(relativeScanPath, filename)` instead of `path.join(scanResult.output_path, file)`
- [ ] 4.2 Update `src/renderer/ScanPreview.tsx:342`
  - Load `scansDir` from config (via `window.electron.config.get()`)
  - Prepend `scansDir` to `currentImage.path` in `pathToFileUrl()` call
- [ ] 4.3 Update `src/main/image-uploader.ts:243`
  - Load `scansDir` from config
  - Prepend `scansDir` to each `image.path` before passing to bloom-fs `uploadImages()`

## Phase 5: Update Test Fixtures

- [ ] 5.1 Update `tests/integration/database.test.ts` — Change `path` values in Scan/Image fixtures from absolute to relative format (e.g., `"2026-03-04/PLANT-001/test-uuid"`)
- [ ] 5.2 Update `tests/unit/image-uploader.test.ts` — Change mock `Image.path` values to relative; update assertions for scansDir prepending
- [ ] 5.3 Update `tests/integration/test-scanner-database.ts` if needed

## Phase 6: Verification

- [ ] 6.1 Run full test suite (`npm test`)
- [ ] 6.2 Run linter (`npm run lint`)
- [ ] 6.3 Run pre-merge checks
- [ ] 6.4 Verify cloud upload compatibility — bloom-fs uses flat Supabase paths (`cyl-images/cyl-image_<id>_<uuid>.png`), independent of local directory structure
