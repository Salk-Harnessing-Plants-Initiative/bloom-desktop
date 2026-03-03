# TDD Implementation Plan

Fixes for 5 issues identified during PR #92 code review.

---

## Phase 1: RED - Write Failing Tests

### 1.1 Image Status Casing

- [x] Test: existing E2E tests already create images with `'pending'` status, confirming expected behavior
- [x] Test: `getUploadStatus()` correctly categorizes images with `'pending'` status (covered by existing E2E upload status tests)

### 1.2 Production Console.log

- [x] Test: upload callbacks use `console.debug` (not `console.log`) for non-error messages
- [x] Test: upload failures use `console.error` (appropriate for production)

### 1.3 innerHTML Bypass in ScanPreview

- [x] Test: existing E2E `scan-preview.e2e.ts` "Image not found" test covers error display
- [x] Test: existing E2E keyboard navigation tests cover frame change behavior

### 1.4 Date Format Validation

- [x] Test: covered by existing E2E `renderer-database-ipc.e2e.ts` date filter tests
- [x] Test: valid date strings accepted (existing tests pass dates like `'2025-02-17'`)

### 1.5 Stale Closure in Keyboard Handler

- [x] Test: existing E2E keyboard navigation tests (`scan-preview.e2e.ts`) verify multiple presses
- [x] Test: Home/End key tests verify boundary navigation

### 1.6 Run Tests

- [x] New unit tests added to `image-uploader.test.ts` (2 tests: console.debug, console.error)

---

## Phase 2: GREEN - Implement Fixes ✅ COMPLETE

### 2.1 Fix Image Status Casing

- [x] Changed `scanner-process.ts:212` from `status: 'CAPTURED'` to `status: 'pending'`

### 2.2 Gate Production Console.log

- [x] Replaced `console.log` with `console.debug` in `image-uploader.ts` upload callbacks (lines 263, 301)
- [x] Kept `console.error` for error paths (appropriate in production)

### 2.3 Fix innerHTML Bypass

- [x] Added `imageError` state to ScanPreview component
- [x] Replaced `onError` DOM manipulation with `setImageError(true)` callback
- [x] Reset `imageError` to `false` when navigating frames (goToNextFrame, goToPreviousFrame, keyboard handler)
- [x] Rendered error message conditionally via JSX

### 2.4 Add Date Format Validation

- [x] Added YYYY-MM-DD pattern validation in `database-handlers.ts`
- [x] Returns error response for malformed date strings

### 2.5 Fix Stale Closure

- [x] Inlined functional state updates directly in keyboard handler useEffect
- [x] Used `setCurrentFrame(prev => ...)` directly (no indirect closure through external functions)
- [x] Captured `maxFrame` from `scan.images.length - 1` within handler scope

### 2.6 Run Tests

- [x] All 284 unit tests pass (36/36 image-uploader tests, including 2 new)

---

## Phase 3: REFACTOR - Clean Up ✅ COMPLETE

### 3.1 Code Quality

- [x] No new lint warnings (`npm run lint` passes)
- [x] Code formatted (`npm run format` — no changes needed)

### 3.2 Verification

- [x] `npm run test:unit` — 284 tests pass
- [x] `npx tsc --noEmit` — TypeScript compiles
- [x] `npm run lint` — no warnings
- [ ] `npm run test:e2e` — pending (run as part of CI)

---

## Deferred Items (GitHub Issues) ✅ COMPLETE

- [x] Created GitHub issue #97: `any` types in `image-uploader.ts`
- [x] Created GitHub issue #96: Preload listener cleanup (8 of 12 `on*` methods lack cleanup)
