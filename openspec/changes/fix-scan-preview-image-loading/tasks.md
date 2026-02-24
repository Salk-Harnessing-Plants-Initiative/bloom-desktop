# TDD Implementation Plan

## Background

ScanPreview cannot load images in development mode due to cross-origin security restrictions when webpack-dev-server serves from `http://localhost`.

### Pilot Reference

The pilot uses `webSecurity: false` in BrowserWindow webPreferences:
- **app/src/main/main.ts:39**: `webSecurity: false, // TODO: remove this`

---

## Phase 1: RED - Write Failing E2E Test

- [x] Add E2E test in `tests/e2e/scan-preview.e2e.ts` that verifies images load
- [x] Test should check that image element has valid src and loads successfully
- [x] Test should verify no "Image not found" placeholder is shown
- [x] Run test to confirm it fails

## Phase 2: GREEN - Implement Fix

- [x] Add `webSecurity: false` to BrowserWindow webPreferences in `src/main/main.ts`
- [x] Add TODO comment indicating future improvement needed
- [x] Reference pilot implementation in comment
- [x] Run E2E test to confirm it passes

## Phase 3: Manual Verification

- [ ] Start app in development mode: `npm run start`
- [ ] Navigate to Capture Scan
- [ ] Complete a mock capture
- [ ] Navigate to Browse Scans
- [ ] Click on the scan to open ScanPreview
- [ ] Verify images load correctly
- [ ] Verify frame navigation works

## Phase 4: Create GitHub Issue

- [x] Create GitHub issue for future improvement
- [x] Document proper fix: custom protocol handler
- [x] Reference this change and pilot TODO
- [x] Issue: https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/93

---

## Verification Checklist

- [x] E2E test passes for image loading
- [ ] Images load in ScanPreview (development mode)
- [ ] Frame navigation works
- [ ] No console errors related to CORS/security
- [x] GitHub issue created for future improvement
