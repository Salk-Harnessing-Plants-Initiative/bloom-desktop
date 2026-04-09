## 1. Scanner Handlers Module

- [ ] 1.1 Write `scanner-handlers.test.ts` tests first:
  - `detectScanners`: returns detected scanners, mock mode returns simulated scanners, handles detection failure
  - `saveScannersToDB`: persists scanner records with USB port matching, updates existing scanners
  - `getConfig`: reads GraviConfig from DB, returns null when no config exists
  - `saveConfig`: persists grid mode + resolution, creates or updates singleton
  - `getPlatformInfo`: returns correct backend per platform (linux=sane, win32=twain, darwin=unsupported), mock mode override
  - `validateScanners`: compares cached IDs with connected hardware, returns validation state
  - `validateConfig`: matches saved USB ports with detected scanners, categorizes matched/missing/new
  - `runStartupScannerValidation`: skips validation when no cached scanners, sets validation state
  - `getSessionValidationState` / `resetSessionValidation`: state accessors
- [ ] 1.2 Implement `scanner-handlers.ts` — extract and adapt 7 handlers + 3 validation state functions from Ben's `graviscan-handlers.ts`. Export pure async functions with `db: PrismaClient` injected. Scanner model: Epson Perfection V600 (USB `04b8:013a`).

## 2. Session Handlers Module

- [ ] 2.1 Write `session-handlers.test.ts` tests first:
  - `startScan`: one-shot mode calls `coordinator.scanOnce()`, continuous mode calls `coordinator.scanInterval()`, rejects when coordinator not initialized, rejects when scan already in progress, builds session state correctly
  - `getScanStatus`: returns session state when active, returns `{ isActive: false }` when no session
  - `markJobRecorded`: marks specified job as DB-recorded in session state
  - `cancelScan`: calls `coordinator.cancelScan()`, clears session state, handles no active scan gracefully
- [ ] 2.2 Implement `session-handlers.ts` — extract and adapt 4 handlers from Ben's file. Dependencies (`ScanCoordinator`, `getScanSession`/`setScanSession`/`markScanJobRecorded`) injected as parameters for testability.

## 3. Image Handlers Module

- [ ] 3.1 Write `image-handlers.test.ts` tests first:
  - `getOutputDir`: returns configured output path, handles missing config
  - `readScanImage`: converts TIFF to JPEG via sharp, thumbnail mode resizes to 400px, full mode uses quality 95, handles missing file with `resolveGraviScanPath` fallback, returns base64 data URI
  - `uploadAllScans`: triggers Box backup, reports progress via callback, handles upload-already-in-progress guard
  - `downloadImages`: queries scans by experiment, groups by wave number, writes metadata CSV per wave, copies files with 4-concurrency, reports progress via callback, handles cancelled dialog
- [ ] 3.2 Implement `image-handlers.ts` — extract and adapt 4 handlers from Ben's file. Progress events use callback injection (`onProgress?: (p) => void`) instead of direct `mainWindow.webContents.send()`.

## 4. Barrel Export + Verification

- [ ] 4.1 Create `index.ts` barrel export re-exporting all public functions from the 3 modules
- [ ] 4.2 Run all tests, verify passing: `npx vitest run --reporter=verbose tests/unit/graviscan/`
- [ ] 4.3 Run TypeScript compilation: `npx tsc --noEmit`
- [ ] 4.4 Run lint: `npx eslint src/main/graviscan/`
