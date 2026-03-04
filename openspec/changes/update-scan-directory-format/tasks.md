# Tasks: Update Scan Directory Path Format

TDD Workflow: Red (write failing test) → Green (implement) → Refactor → Verify → Commit

## Phase 1: Date Helper

- [ ] 1.1 Write unit test for `getLocalDateYYYYMMDD()` — verifies local timezone date formatting as `YYYY-MM-DD`
  - Test with known dates, timezone edge cases (near midnight UTC)
  - File: `src/utils/__tests__/date-helpers.test.ts`
- [ ] 1.2 Implement `getLocalDateYYYYMMDD()` in `src/utils/date-helpers.ts`
- [ ] 1.3 Verify test passes

## Phase 2: Scan Path Builder

- [ ] 2.1 Write unit test for `buildScanPath()` — verifies path format `YYYY-MM-DD/<plant_qr_code>/<scan_uuid>`
  - Test normal case: valid plant QR code, date, UUID
  - Test sanitization: plant QR code with special characters gets sanitized
  - Test edge cases: empty plant QR code → "unknown"
  - File: `src/utils/__tests__/scan-path.test.ts`
- [ ] 2.2 Implement `buildScanPath()` in `src/utils/scan-path.ts`
  - Uses `getLocalDateYYYYMMDD()`, `sanitizePathComponent()`, and a UUID
  - Returns relative path (no scans_dir prefix)
- [ ] 2.3 Verify tests pass

## Phase 3: Integration with CaptureScan

- [ ] 3.1 Update `CaptureScan.tsx` `handleStartScan` to use `buildScanPath()`
  - Replace `sanitizePath([experimentId, plantQrCode_timestamp])` with `buildScanPath()`
  - Store relative path; prepend `scansDir` only for `output_path`
- [ ] 3.2 Verify existing E2E tests still pass (scan capture workflow)

## Phase 4: Database Path Storage

- [ ] 4.1 Verify `Scan.path` stores the relative path (not absolute)
  - Check how `scanner-process.ts` creates the Scan record
  - Update if needed to store relative path
- [ ] 4.2 Update any code that reads `Scan.path` to prepend `scansDir` when constructing absolute paths
  - Check Browse Scans page, scan preview, upload code

## Phase 5: Verification

- [ ] 5.1 Run full test suite (`npm test`)
- [ ] 5.2 Run pre-merge checks
- [ ] 5.3 Verify cloud upload compatibility (bloom-fs uses flat paths, no change expected)
- [ ] 5.4 Manual verification: scan capture produces `YYYY-MM-DD/<plant_qr_code>/<uuid>/` directory structure
