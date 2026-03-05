# Tasks: Update Scan Directory Path Format

## Red-Green TDD Phases

### Phase 1: RED — Unit Tests (written FIRST, all FAIL)

- [x] 1.1 Write unit test for `getLocalDateYYYYMMDD()` — `tests/unit/date-helpers.test.ts` (6 tests)
- [x] 1.2 Write unit test for `buildScanPath()` format — `tests/unit/scan-path.test.ts` (17 tests)
- [x] 1.3 Write unit test for `toRelativeScanPath()` — `tests/unit/scan-path.test.ts` (5 tests)
- [x] 1.4 Write unit test for sanitization and edge cases — `tests/unit/scan-path.test.ts`
- [x] 1.5 **Verified all FAIL (RED) — modules don't exist yet**

### Phase 2: GREEN — Implementation

- [x] 2.1 Implement `getLocalDateYYYYMMDD()` in `src/utils/date-helpers.ts`
- [x] 2.2 Implement `buildScanPath()` and `toRelativeScanPath()` in `src/utils/scan-path.ts`
- [x] 2.3 **All 29 tests PASS (GREEN)**

### Phase 3/4: Integration — Tests + Implementation

- [x] 3.1 Update `src/renderer/CaptureScan.tsx` — use `buildScanPath()` + `crypto.randomUUID()`
- [x] 3.2 Update `src/main/scanner-process.ts` — store relative `Scan.path` and `Image.path`
- [x] 3.3 Update `src/renderer/ScanPreview.tsx` — prepend `scansDir` for image display
- [x] 3.4 Update `src/main/image-uploader.ts` — prepend `scansDir` for upload
- [x] 3.5 Add `scan_path` to `ScanMetadata` type (`src/types/scanner.ts`)
- [x] 3.6 Update `tests/unit/image-uploader.test.ts` — relative path fixtures + assertions
- [x] 3.7 **All 325 tests PASS (GREEN)**

### Phase 5: E2E Tests

- [x] 5.1 Write Playwright E2E tests — `tests/e2e/scan-directory-format.e2e.ts` (6 tests)
  - Relative path resolution: scansDir prepending for image display
  - Backward compatibility: absolute paths still work
  - Local date timezone validation
  - Pilot format validation: YYYY-MM-DD/plant_qr_code/uuid format
  - Sanitized plant QR code in path
  - Multi-frame navigation with relative paths
- [x] 5.2 E2E test execution — 241 passed, 2 skipped (includes 6 scan-directory-format tests)

### Phase 6: Review & Polish

- [x] 6.1 Review: proposal text — fixed `uuidv4()` → `crypto.randomUUID()`
- [x] 6.2 Review: cosmetic display fix — `CaptureScan.tsx:309` now uses `toRelativeScanPath()` for consistent relative path display in RecentScansPreview
- [x] 6.3 Review: added UUID uniqueness unit test — `tests/unit/scan-path.test.ts` (now 24 tests)
- [x] 6.4 Review: added local timezone E2E test — `tests/e2e/scan-directory-format.e2e.ts` (now 6 tests)

### Phase 7: Windows Cross-Platform Path Fix (CI Bug)

#### Phase 7a: RED — Unit Tests (written FIRST, all FAIL)

- [x] 7a.1 Write unit tests for `isAbsolutePath()` — `tests/unit/scan-path.test.ts` (6 tests)
  - Unix absolute: `/Users/test/scans/image.png` → true
  - Windows drive uppercase: `C:\Users\test\scans\image.png` → true
  - Windows drive lowercase: `d:/scans/image.png` → true
  - Relative pilot-format: `2026-03-04/PLANT-001/uuid/001.png` → false
  - Relative bare filename: `001.png` → false
  - Empty string: `` → false
- [x] 7a.2 **Verified all 6 new tests FAIL (RED) — `isAbsolutePath` not exported yet**

#### Phase 7b: GREEN — Implementation

- [x] 7b.1 Implement `isAbsolutePath()` in `src/utils/scan-path.ts` — regex `/^[A-Za-z]:[/\\]/` for Windows + `startsWith('/')` for Unix
- [x] 7b.2 **All 30 scan-path tests PASS (GREEN)**

#### Phase 7c: Integration

- [x] 7c.1 Update `src/renderer/ScanPreview.tsx` — replace `startsWith('/')` with `isAbsolutePath()`
- [x] 7c.2 Update `src/main/image-uploader.ts` — replace `startsWith('/')` with `path.isAbsolute()`
- [x] 7c.3 **All 332 unit tests PASS (GREEN)**

### Phase 8: Pre-merge

- [ ] 8.1 Unit tests — all pass
- [ ] 8.2 TypeScript — clean
- [ ] 8.3 ESLint — clean
- [ ] 8.4 Prettier — clean
- [ ] 8.5 Push and all CI checks pass (including Windows E2E)
