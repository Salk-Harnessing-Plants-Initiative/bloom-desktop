## 0. Foundation & Infrastructure

- [x] 0.1 Create directory structure: `src/renderer/graviscan/`, `src/components/graviscan/`, `src/renderer/utils/`
- [x] 0.2 Update `.eslintrc.json`: add overrides for `src/renderer/graviscan/**`, `src/components/graviscan/**`, and `src/renderer/App.tsx` to allow imports from graviscan directories
- [x] 0.3 Update `tests/unit/setup.ts`: add baseline `window.electron.gravi` mock with all 15 invoke methods + 13 event listeners stubbed (onScanEvent, onGridStart, onGridComplete, onCycleComplete, onIntervalStart, onIntervalWaiting, onIntervalComplete, onOvertime, onCancelled, onScanError, onRenameError, onUploadProgress, onDownloadProgress), and `window.electron.database.graviscans.*`, `graviscanPlateAssignments.*`, `graviPlateAccessions.*` mock namespaces
- [x] 0.4 Create test fixtures: `tests/fixtures/graviscan.ts` with factory functions for GraviScanner, GraviScan, GraviConfig, GraviImage, GraviScanSession, GraviScanPlateAssignment, DetectedScanner, PlateAssignment
- [x] 0.5 Create IPC mock helpers: `tests/unit/mocks/gravi-api.ts` with configurable mock implementations for each IPC method
- [x] 0.6 Create sample TIFF images in `tests/fixtures/sample_scan/graviscan/` (4 small synthetic files, <50KB each)
- [x] 0.7 Extract pilot hook files from `origin/graviscan/6-renderer-hooks` as raw files into a working area for reference (do NOT commit pilot code directly)
- [x] 0.8 Create shared E2E fixture: `tests/e2e/helpers/graviscan-launch.ts` — shared setup for GraviScan Electron launch (SCANNER_MODE=graviscan, GRAVISCAN_MOCK=true, test DB, ~/.bloom/.env config) to avoid duplication across 5 E2E test files

**Check gate:** `npm run lint && npx tsc --noEmit`

## 1. GraviScan Data Persistence Layer (main process)

**Tests first:**
- [x] 1.1 Write unit tests for `scan-persistence.ts`: GraviScan + GraviImage record creation on `grid-complete` event (with post-rename paths, atomic Prisma nested create), GraviScanSession creation on scan start, GraviScanSession completion (with cancelled flag), records created even without renderer (crash safety), plate metadata snapshot (transplant_date, custom_note, plate_barcode copied from params, not from mutable PlateAssignment table)
- [x] 1.2 Write unit tests for GraviScan DB read IPC handlers: `graviscans.list`, `graviscans.getMaxWaveNumber`, `graviscans.checkBarcodeUniqueInWave`
- [x] 1.3 Write unit tests for GraviScanPlateAssignment CRUD: `graviscanPlateAssignments.list`, `graviscanPlateAssignments.upsert`, `graviscanPlateAssignments.upsertMany`
- [x] 1.4 Write unit tests for GraviPlateAccession query: `graviPlateAccessions.list`

**Implementation:**
- [x] 1.5 Create `src/main/graviscan/scan-persistence.ts`: main-process module exporting `setupCoordinatorPersistence(coordinator, db, sessionFns)` that registers listeners on the coordinator for `grid-complete` (create GraviScan + GraviImage records via Prisma nested create) and session lifecycle events (create/complete GraviScanSession). Reads session metadata from `sessionFns.getScanSession()`. Wire into `wiring.ts:getOrCreateCoordinator()` alongside `setupCoordinatorEventForwarding()` — same pattern, parallel function.
- [x] 1.6 Add GraviScan DB read IPC handlers + plate assignment CRUD to `src/main/database-handlers.ts`
- [x] 1.7 Add preload bridge methods to `src/main/preload.ts` under `database.graviscans.*` (read ops), `database.graviscanPlateAssignments.*`, `database.graviPlateAccessions.*`
- [x] 1.8 Add strongly-typed interfaces to `src/types/electron.d.ts` and `src/types/database.ts` for all GraviScan database methods
- [x] 1.9 Add `onRenameError` listener to preload.ts `graviAPI` (missing from current preload)
- [x] 1.10 Extend `StartScanParams` and `PlateConfig` types in `src/types/graviscan.ts` to carry `transplant_date` and `custom_note` (currently only `plate_barcode` flows through)

**Check gate:** `npm run test:unit && npm run lint && npx tsc --noEmit`

## 2. Port useScannerConfig Hook (vertical slice)

**Tests first:**
- [ ] 2.1 Write unit tests for `useScannerConfig`: platform info loading, scanner detection (0/1/2+ scanners), detection errors/timeout, config load from DB, config save (grid_mode + resolution), scanner DB save, validation state transitions (loading→detected→validated→ready, loading→error, detected→validation-failed), scanner assignment management, re-detect flow, stale scanner indicators

**Implementation:**
- [ ] 2.2 Port `useScannerConfig.ts` from pilot branch, adapt `window.electron.graviscan.*` → `window.electron.gravi.*`, type parameters, verify all IPC calls match our preload API
- [ ] 2.3 Fix any issues found during adaptation (e.g., event name mismatches, type incompatibilities)

**Check gate:** `npm run test:unit -- --grep "useScannerConfig" && npx tsc --noEmit`

## 3. Port usePlateAssignments Hook (vertical slice)

**Tests first:**
- [ ] 3.1 Write unit tests for `usePlateAssignments`: load plate assignments per scanner/experiment, save via upsertMany, barcode autocomplete from experiment accessions, GraviScan-specific plate metadata (graviPlateAccessions), toggle plate selection, barcode uniqueness enforcement, empty state (no experiment selected)

**Implementation:**
- [ ] 3.2 Port `usePlateAssignments.ts` from pilot branch, adapt DB calls to `window.electron.database.graviscanPlateAssignments.*` etc.
- [ ] 3.3 Fix any issues (type mappings, experiment/accession API shape differences)

**Check gate:** `npm run test:unit -- --grep "usePlateAssignments" && npx tsc --noEmit`

## 4. Port useContinuousMode Hook (vertical slice)

**Tests first:**
- [ ] 4.1 Write unit tests for `useContinuousMode`: initialization defaults, mode switching (single/continuous), interval/duration setting and validation, cycle tracking, countdown timer accuracy, overtime detection and timer, elapsed time tracking, timer cleanup on unmount, localStorage persistence

**Implementation:**
- [ ] 4.2 Port `useContinuousMode.ts` from pilot branch (no IPC calls — purely local state + localStorage)

**Check gate:** `npm run test:unit -- --grep "useContinuousMode" && npx tsc --noEmit`

## 5. Port useWaveNumber Hook (vertical slice)

**Tests first:**
- [ ] 5.1 Write unit tests for `useWaveNumber`: wave auto-increment from DB max, barcode uniqueness check per experiment+wave, suggested wave number on experiment change, wave restoration across navigation, conflict detection and display

**Implementation:**
- [ ] 5.2 Port `useWaveNumber.ts` from pilot branch, adapt `database.graviscans.getMaxWaveNumber` and `database.graviscans.checkBarcodeUniqueInWave` calls

**Check gate:** `npm run test:unit -- --grep "useWaveNumber" && npx tsc --noEmit`

## 6. Port useTestScan Hook (vertical slice)

**Tests first:**
- [ ] 6.1 Write unit tests for `useTestScan`: test scan initiation (low-resolution single plate per scanner), phase tracking (idle→connecting→scanning→complete), preview image loading, error handling per scanner, result tracking, cleanup on unmount (event listener removal)

**Implementation:**
- [ ] 6.2 Port `useTestScan.ts` from pilot branch, adapt IPC calls and event names

**Check gate:** `npm run test:unit -- --grep "useTestScan" && npx tsc --noEmit`

## 7. Port useScanSession Hook (vertical slice)

**Tests first:**
- [ ] 7.1a Write unit tests for `useScanSession` event subscriptions: all 13 event listener subscriptions (onScanEvent, onGridStart, onGridComplete, onCycleComplete, onIntervalStart, onIntervalWaiting, onIntervalComplete, onOvertime, onCancelled, onScanError, onRenameError, onUploadProgress, onDownloadProgress) with cleanup on unmount, no duplicate listeners on re-render, navigate-away restores state via getScanStatus on remount
- [ ] 7.1b Write unit tests for `useScanSession` state tracking: pending job tracking with jobKey deduplication, scan image URI loading on grid-complete (preview images via readScanImage), session status display (cycle count, elapsed time, waiting state). Note: DB record creation is tested in Section 1 (main-process scan-persistence.ts), NOT in this hook. Auto-upload trigger is tested in 7.1c (scan lifecycle).
- [ ] 7.1c Write unit tests for `useScanSession` scan lifecycle: start single scan (startScan IPC call with correct params including transplantDate and customNote), start interval scan (with interval/duration), cancel scan (including cancel during continuous wait phase), session state restoration (getScanStatus on mount), error handling (scan error, rename error, SANE init failure), auto-upload trigger on session complete
- [ ] 7.2 Write unit tests for `useScanSession` readiness gate (#159): button disabled when scanners not validated, button disabled when config incomplete, button disabled when metadata missing (no experiment/phenotyper), button disabled when no plates selected for any enabled scanner, button disabled when scan in progress, button enabled when all conditions met

**Implementation:**
- [ ] 7.3 Port `useScanSession.ts` from pilot branch, adapt all IPC calls (`graviscan.*` → `gravi.*`), event names, type parameters. Remove pilot's renderer-side DB writes (record creation now handled by main-process `scan-persistence.ts`).
- [ ] 7.4 Verify `transplantDate` and `customNote` are passed from plate assignments into startScan params (fix pilot hardcoded nulls in session-handlers.ts:114-115 if needed)

**Check gate:** `npm run test:unit -- --grep "useScanSession" && npx tsc --noEmit`

## 8. Port graviMetadataValidation Utility

**Tests first:**
- [ ] 8.1 Write unit tests for `graviMetadataValidation`: valid metadata rows, inconsistent accession per plate, duplicate plant QR per plate, invalid transplant date format, empty rows, edge cases (missing fields, extra fields)

**Implementation:**
- [ ] 8.2 Port `graviMetadataValidation.ts` from pilot branch (pure utility, no IPC)

**Check gate:** `npm run test:unit -- --grep "graviMetadataValidation" && npx tsc --noEmit`

## 8b. GraviScan Metadata JSON Writer

**Tests first:**
- [ ] 8b.1 Write unit tests for `buildGraviMetadataObject`: verify output includes all required fields (metadata_version, scan_type, experiment_id, phenotyper_id, scanner_id, scanner_name, grid_mode, resolution_dpi, format, plate_index, plate_barcode, transplant_date, custom_note, wave_number, cycle_number, session_id, scan_started_at, capture_date), verify interval scans include interval_seconds and duration_seconds, verify metadata_version is 1, verify ISO 8601 capture_date, verify optional fields omitted when null
- [ ] 8b.2 Write unit tests for `writeGraviMetadataJson`: atomic write via .tmp + rename, valid JSON with 2-space indent and trailing newline, stale .tmp cleanup, write failure does not throw (logs warning), directory created if missing

**Implementation:**
- [ ] 8b.3 Create `GraviScanMetadataJson` interface in `src/types/graviscan.ts`
- [ ] 8b.4 Implement `buildGraviMetadataObject()` and `writeGraviMetadataJson()` in `src/main/graviscan/scan-metadata-json.ts` (parallel to CylinderScan's `src/main/cylinderscan/scan-metadata-json.ts`)
- [ ] 8b.5 Wire metadata.json write into scan coordinator flow: call before Python scan command in `scanOnce()` per grid

**Check gate:** `npm run test:unit -- --grep "graviMetadata" && npx tsc --noEmit`

## 9. Scanner Config Page (UI vertical slice)

**Tests first:**
- [ ] 9.1 Write component tests for ScannerConfig page: renders detected scanners with status indicators, grid_mode selector (2grid/4grid), resolution selector from GRAVISCAN_RESOLUTIONS, save button calls saveConfig + saveScannersToDB, re-detect button triggers detection, empty state (no scanners), platform info display (SANE/TWAIN status, mock mode indicator), validation status display, scanner assignment management (enable/disable, grid mode per scanner)

**Implementation:**
- [ ] 9.2 Implement ScannerConfig page (`src/renderer/graviscan/ScannerConfig.tsx`) using `useScannerConfig` hook
- [ ] 9.3 Add `/scanner-config` route to App.tsx (conditional on `mode === 'graviscan'`)
- [ ] 9.4 Add Scanner Config nav link to Layout.tsx for GraviScan mode
- [ ] 9.5 Write E2E test: `tests/e2e/graviscan-scanner-config.e2e.ts` — detect mock scanners, save config, verify persistence, re-detect

**Check gate:** `npm run test:unit && npm run test:e2e -- graviscan-scanner-config && npx tsc --noEmit`

## 10. Metadata Page (UI vertical slice)

**Tests first:**
- [ ] 10.1 Write component tests for PlateGridEditor: renders correct plate count for 2grid (2 plates) and 4grid (4 plates), accepts barcode/date/note input per plate, validates barcode uniqueness, shows accession info from barcode lookup, toggle plate selection
- [ ] 10.2 Write component tests for Metadata page: loads config to determine grid layout, loads experiment/phenotyper lists, shows wave number with auto-increment, saves plate assignments on Save, navigates to scanning page on Continue, handles no-config state (redirect to Scanner Config)

**Implementation:**
- [ ] 10.3 Implement PlateGridEditor component (`src/components/graviscan/PlateGridEditor.tsx`) using `usePlateAssignments` hook
- [ ] 10.4 Implement Metadata page (`src/renderer/graviscan/Metadata.tsx`) using `usePlateAssignments`, `useWaveNumber` hooks + shared experiment/phenotyper dropdowns
- [ ] 10.5 Add `/metadata` route to App.tsx (conditional on `mode === 'graviscan'`)
- [ ] 10.6 Update WorkflowSteps.tsx: change GraviScan step 3 "Metadata" route from `/experiments` to `/metadata`
- [ ] 10.7 Write E2E test: `tests/e2e/graviscan-metadata.e2e.ts` — fill plate assignments, verify save, navigate to scan page

**Check gate:** `npm run test:unit && npm run test:e2e -- graviscan-metadata && npx tsc --noEmit`

## 11. GraviScan Scanning Page (UI vertical slice)

**Tests first:**
- [ ] 11.1 Write component tests for ScanControlSection: Start button disabled until all readiness conditions met (#159), shows "connecting to scanners..." loading state after click, Cancel button active during scan, progress display per scanner, event log display, interval mode controls (interval/duration inputs), countdown display during waiting, overtime warning display
- [ ] 11.2 Write component tests for GraviScan page: orchestrates useScannerConfig + useScanSession + usePlateAssignments + useContinuousMode, displays scanner status panel, scan form with mode toggle (single/continuous), real-time event feed, session summary after completion

**Implementation:**
- [ ] 11.3 Implement ScanControlSection component (`src/components/graviscan/ScanControlSection.tsx`)
- [ ] 11.4 Implement GraviScan scanning page (`src/renderer/graviscan/GraviScan.tsx`) — target under 600 lines by delegating to hooks and components
- [ ] 11.5 Add `/graviscan` route to App.tsx (conditional on `mode === 'graviscan'`)
- [ ] 11.6 Add GraviScan Capture nav link to Layout.tsx for GraviScan mode
- [ ] 11.7 Update WorkflowSteps.tsx: update GraviScan "Capture Scan" step route to `/graviscan`
- [ ] 11.8 Write E2E test: `tests/e2e/graviscan-scanning.e2e.ts` — verify Start button readiness gate (disabled before config), start mock scan, observe events, cancel scan

**Check gate:** `npm run test:unit && npm run test:e2e -- graviscan-scanning && npx tsc --noEmit`

## 12. BrowseGraviScans Page (UI vertical slice)

**Tests first:**
- [ ] 12.1 Write component tests for BrowseGraviScans: renders scan list grouped by session, filters by experiment/date/scanner, displays grid thumbnails via readScanImage (thumbnail mode), shows session metadata (cycles, waves, interval, grid mode), shows placeholder for missing image files (orphaned images), filters out soft-deleted scans, empty state with guidance, cancelled session indicator, pagination/lazy-load for large scan sets
- [ ] 12.2 Write component tests for GraviScan preview: displays TIFF image (mocked via readScanImage IPC), shows plate metadata (barcode, transplant date, note), navigation between images in session

**Implementation:**
- [ ] 12.3 Implement BrowseGraviScans page (`src/renderer/graviscan/BrowseGraviScans.tsx`) using `database.graviscans.list` + `gravi.readScanImage`
- [ ] 12.4 Add `/browse-graviscan` route to App.tsx (**accessible in all modes** for data integrity)
- [ ] 12.5 Add Browse GraviScans nav link to Layout.tsx for GraviScan mode
- [ ] 12.6 Update WorkflowSteps.tsx: update GraviScan "Browse Scans" step route to `/browse-graviscan`
- [ ] 12.7 Write E2E test: `tests/e2e/graviscan-browse.e2e.ts` — seed scan data, verify list rendering, test filters, open preview

**Check gate:** `npm run test:unit && npm run test:e2e -- graviscan-browse && npx tsc --noEmit`

## 13. Bug Fixes

**Tests first:**
- [ ] 13.1 Write test for #154 fallback: verify `resolveGraviScanPath()` fallback works for pre-fix records (scans created before main-process persistence) and logs warning; verify ambiguous match (multiple `_et_` candidates) logs distinct diagnostic warning. Note: #154 is primarily resolved by task 1.5 (scan-persistence.ts creates records with post-rename paths from the start).
- [ ] 13.2 Write test for #159: verify Start Scan button is disabled when scanners not validated, config incomplete, or metadata missing; verify button enabled only when all conditions met (covered in task 7.2 + 11.1, verified here end-to-end)

**Implementation:**
- [ ] 13.3 Add warning log to `resolveGraviScanPath()` when filesystem fallback is used; add distinct warning for ambiguous match (multiple candidates)
- [ ] 13.4 Fix `session-handlers.ts:114-115`: pass `transplant_date` and `custom_note` from plate assignment params into session jobs instead of hardcoding null (also covered by task 1.10 type extension)
- [ ] 13.5 Verify #159 readiness gate in GraviScan.tsx E2E test (task 11.8)

**Check gate:** `npm run test:unit && npx tsc --noEmit`

## 14. Routing & Navigation Tests

**Tests:**
- [ ] 14.1 Write/update `tests/unit/pages/App.test.tsx`: GraviScan routes registered when mode=graviscan (`/scanner-config`, `/metadata`, `/graviscan`), `/browse-graviscan` accessible when mode=cylinderscan (cross-mode data access), GraviScan routes NOT registered when mode=cylinderscan
- [ ] 14.2 Write component tests for Layout sidebar: GraviScan nav links rendered when mode=graviscan (Scanner Config, Metadata, Capture Scan, Browse GraviScans), shared links always present, CylinderScan links NOT shown in GraviScan mode
- [ ] 14.3 Write component tests for Home workflow steps: GraviScan steps route to `/metadata`, `/graviscan`, `/browse-graviscan` (not to `/experiments`, `/capture-scan`, `/browse-scans`)

**Check gate:** `npm run test:unit -- --grep "App\|Layout\|Home" && npx tsc --noEmit`

## 15. Integration & Final Verification

- [ ] 15.1 Run full test suite: `npm run test:unit`, `npm run test:e2e` (including existing `graviscan-ipc.e2e.ts` regression)
- [ ] 15.2 Run ESLint: `npm run lint` — verify no `no-restricted-imports` violations
- [ ] 15.3 Verify TypeScript compilation: `npx tsc --noEmit`
- [ ] 15.4 Verify existing tests not broken: `tests/unit/pages/App.test.tsx`, `tests/e2e/graviscan-ipc.e2e.ts`
- [ ] 15.5 Manual smoke test: launch app in GraviScan mode, navigate all new pages, verify workflow steps link correctly
