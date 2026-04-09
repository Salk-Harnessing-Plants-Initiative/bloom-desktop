## 1. Scanner Handlers Module

- [ ] 1.1 Write `scanner-handlers.test.ts` tests first (use `// @vitest-environment node` directive):
  - `detectScanners`: returns detected scanners, mock mode returns simulated scanners from DB records, handles detection failure (upstream error propagation)
  - `saveScannersToDB`: persists scanner records with USB port matching, upserts existing scanners
  - `getConfig`: reads GraviConfig from DB, returns null when no config exists
  - `saveConfig`: persists grid mode + resolution, creates or updates singleton
  - `getPlatformInfo`: returns correct backend per platform (linux=sane, win32=twain, darwin=unsupported), mock mode override. Use `vi.stubEnv` for `GRAVISCAN_MOCK` and `vi.stubGlobal` / `Object.defineProperty` for `process.platform`.
  - `validateScanners`: compares cached IDs with connected hardware, returns validation state
  - `validateConfig`: matches saved USB ports with detected scanners, categorizes matched/missing/new, returns 'no-config' when no saved scanners
  - `runStartupScannerValidation`: skips validation when no cached scanners, sets module-level validation state
  - `getSessionValidationState` / `resetSessionValidation`: state accessors, reset in `beforeEach`
  - Module-mock `detectEpsonScanners` via `vi.mock('../lsusb-detection')`
- [ ] 1.2 Implement `scanner-handlers.ts` — extract and adapt 7 handlers + 3 validation state functions from Ben's `graviscan-handlers.ts`. Inject `db: PrismaClient` as parameter. Module-level `sessionValidation` state with exported reset function. Scanner model: Epson Perfection V600 (USB `04b8:013a`). Types from `src/types/graviscan.ts`: `DetectedScanner`, `GraviConfig`, `GraviConfigInput`, `GraviScanner`, `GraviScanPlatformInfo`.

## 2. Session Handlers Module

- [ ] 2.1 Write `session-handlers.test.ts` tests first (use `// @vitest-environment node` directive):
  - `startScan`: one-shot mode calls `coordinator.scanOnce()`, continuous mode calls `coordinator.scanInterval()` with correct interval/duration, rejects when coordinator is null, rejects when `coordinator.isScanning` is true, builds session state correctly (verify `jobs` shape, `totalCycles` calculation)
  - Fire-and-forget error path: mock `coordinator.scanOnce()` to return a promise that rejects *after* the function returns; verify `setScanSession(null)` and `onError` callback are called
  - `getScanStatus`: returns session state when active, returns `{ isActive: false }` when no session
  - `markJobRecorded`: marks specified job key as DB-recorded in session state
  - `cancelScan`: calls coordinator cancel, clears session state, handles no active scan gracefully
  - Mock coordinator via object literal implementing `ScanCoordinatorLike` interface
  - Mock session functions (`getScanSession`, `setScanSession`, `markScanJobRecorded`) as `vi.fn()` parameters
- [ ] 2.2 Implement `session-handlers.ts` — extract and adapt 4 handlers from Ben's file. Define `ScanCoordinatorLike` interface locally (based on Ben's `ScanCoordinator` from `origin/graviscan/4-main-process:src/main/scan-coordinator.ts`). Inject coordinator, session fns, and `onError` callback as parameters. Types from Ben's file: `ScannerConfig`, `PlateConfig`.

## 3. Image Handlers Module

- [ ] 3.1 Write `image-handlers.test.ts` tests first (use `// @vitest-environment node` directive):
  - `getOutputDir`: returns configured output path, returns error/default when not configured
  - `readScanImage`: thumbnail mode returns base64 data URI (quality 85, 400px resize), full mode returns quality 95 data URI, handles missing file with `resolveGraviScanPath` fallback, returns error when file not found after resolution. Module-mock `sharp` and `resolveGraviScanPath`. Test behavior (correct URI returned), not implementation details (sharp call order).
  - `uploadAllScans`: triggers Box backup, reports progress via callback, guards against concurrent uploads (`uploadInProgress`), returns error when upload already in progress. Module-mock `runBoxBackup`.
  - `downloadImages`: queries scans by experiment, groups by wave into subdirectories, writes metadata CSV per wave, copies files concurrently, reports progress via callback, returns `{ total: 0, copied: 0 }` when no images found. Module-mock `fs` and `resolveGraviScanPath`. Test file copy results, NOT concurrency mechanics (defer to E2E).
  - Reset `uploadInProgress` state in `beforeEach` via exported `resetUploadState()`
- [ ] 3.2 Implement `image-handlers.ts` — extract and adapt 4 handlers from Ben's file. Module-level `uploadInProgress` guard with exported `resetUploadState()` for testing. Progress events use callback injection (`onProgress?: (p) => void`). `downloadImages` accepts `targetDir: string` parameter (dialog handling deferred to 3c). `resolveGraviScanPath` imported from `../graviscan-path-utils` (existing utility in Ben's branch, cherry-picked as dependency).

## 4. Barrel Export + Verification

- [ ] 4.1 Create `index.ts` barrel export re-exporting all public functions from the 3 modules. Add JSDoc mapping IPC channel names → exported functions for 3c wiring reference.
- [ ] 4.2 Run all tests, verify passing: `npx vitest run --reporter=verbose tests/unit/graviscan/`
- [ ] 4.3 Run TypeScript compilation: `npx tsc --noEmit`
- [ ] 4.4 Run lint: `npx eslint src/main/graviscan/`
