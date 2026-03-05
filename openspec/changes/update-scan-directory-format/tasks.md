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

- [x] 5.1 Write Playwright E2E tests — `tests/e2e/scan-directory-format.e2e.ts` (5 tests)
  - Relative path resolution: scansDir prepending for image display
  - Backward compatibility: absolute paths still work
  - Pilot format validation: YYYY-MM-DD/plant_qr_code/uuid format
  - Sanitized plant QR code in path
  - Multi-frame navigation with relative paths
- [ ] 5.2 E2E test execution — requires manual run or CI

### Phase 6: Pre-merge

- [x] 6.1 Unit tests — 325 passed, 0 failed
- [x] 6.2 TypeScript — clean
- [x] 6.3 ESLint — clean
- [ ] 6.4 Open PR referencing #100
