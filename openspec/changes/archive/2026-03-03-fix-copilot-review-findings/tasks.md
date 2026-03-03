# TDD Implementation Plan

Fixes for 7 issues identified during GitHub Copilot review of PR #92.

---

## Phase 1: RED - Write Failing Tests ✅ COMPLETE

### 1.1 Metadata Validation Leading Zeros

- [x] Added tests to existing `tests/unit/metadata-validation.test.ts`
- [x] Test: `validateWaveNumber("01")` returns valid with value=1
- [x] Test: `validateWaveNumber("007")` returns valid with value=7
- [x] Test: `validatePlantAgeDays("01")` returns valid with value=1
- [x] Test: existing tests cover `validateWaveNumber("12a")`, `""`, `"-1"`, `"1.5"`, `"0"`

### 1.2 Cross-Platform File URL

- [x] Create `tests/unit/file-url.test.ts` (8 tests)
- [x] Test: macOS path `/Users/foo/bar.png` → `file:///Users/foo/bar.png`
- [x] Test: Windows path `C:\Users\foo\bar.png` → `file:///C:/Users/foo/bar.png`
- [x] Test: path with spaces `/Users/foo bar/img.png` → `file:///Users/foo%20bar/img.png`
- [x] Test: Windows path with spaces `C:\Users\foo bar\img.png` → `file:///C:/Users/foo%20bar/img.png`

### 1.3 Run Tests (RED)

- [x] New leading zeros tests FAILED (3 failures), file-url module not found

---

## Phase 2: GREEN - Implement Fixes ✅ COMPLETE

### 2.1 Fix Leading Zeros in Metadata Validation

- [x] Replaced `parsed.toString() !== trimmed` with `/^\d+$/.test(trimmed)` regex
- [x] Moved negative check before regex (since `-1` doesn't match `/^\d+$/`)

### 2.2 Fix parseInt Coercion in Session Persistence

- [x] `validateWaveNumber`/`validatePlantAgeDays` already imported in CaptureScan.tsx
- [x] Replaced raw `parseInt` calls with validation-guarded parsing in the save effect

### 2.3 Create Cross-Platform File URL Utility

- [x] Created `src/utils/file-url.ts` with `pathToFileUrl()` function
- [x] Handles backslash normalization, Windows drive letters, space encoding

### 2.4 Use File URL Utility in ScanPreview

- [x] Replaced `` `file://${currentImage.path}` `` with `pathToFileUrl(currentImage.path)`

### 2.5 Optimize Images Select in Paginated Query

- [x] Changed `images: true` to `images: { select: { id: true, status: true } }` in database-handlers.ts
- [x] Updated `PaginatedScansResponse.scans` from `ScanWithRelations[]` to `ScanWithImageSummary[]`
- [x] Updated BrowseScans.tsx imports, state type, and `getUploadStatus` parameter type

### 2.6 Reset currentFrame on Scan Change

- [x] Added useEffect that resets `currentFrame` to 0 and `imageError` to false when `scanId` changes

### 2.7 Fix Double Fetch on Filter Change

- [x] Removed page-reset effect (was lines 102-105)
- [x] Added `setPage(1)` inline in experiment, dateFrom, dateTo, pageSize onChange handlers
- [x] Added `setPage(1)` in `handleClearFilters`

### 2.8 Fix Misleading E2E Test Name

- [x] Renamed to "should handle deleted scan gracefully when navigating back"

### 2.9 Run Tests (GREEN)

- [x] `npm run test:unit` — 296 tests pass (was 284, +12 new: 4 metadata + 8 file-url)

---

## Phase 3: REFACTOR - Clean Up ✅ COMPLETE

### 3.1 Code Quality

- [x] `npm run lint` — no warnings
- [x] `npm run format` — no changes needed

### 3.2 Verification

- [x] `npm run test:unit` — 296 tests pass
- [x] `npx tsc --noEmit` — TypeScript compiles
- [x] `npm run lint` — no warnings
