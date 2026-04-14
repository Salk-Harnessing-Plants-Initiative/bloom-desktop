# Tasks: Wire GraviScan IPC Handlers

## Task 1: Async FS fixes in scan-coordinator.ts (#187)

**TDD approach:**
- Write tests first: verify `handleScanComplete()` uses async FS (mock `fs.promises.access`, `fs.promises.stat`, `fs.promises.rename`)
- Write tests for error handling: file not found after scan, rename failure, zero-size file
- Implement: replace `fs.existsSync/statSync/renameSync` with `fs.promises` equivalents
- Update existing test mocks to use `fs.promises` variants (existing tests mock sync APIs via `vi.mock('fs')` which will break — need to mock `fs.promises.access`, `fs.promises.stat`, `fs.promises.rename` instead)

**Files:** `src/main/graviscan/scan-coordinator.ts`, `tests/unit/graviscan/scan-coordinator.test.ts`

**Verify:** `npx vitest run tests/unit/graviscan/scan-coordinator.test.ts`

- [x] Write async FS tests for handleScanComplete
- [x] Replace sync FS calls with fs.promises
- [x] Update existing test mock setup to use fs.promises variants
- [x] Add scanLog() calls for successful renames and grid-complete events
- [x] Verify all scan-coordinator tests pass

## Task 2: Readline cleanup in scanner-subprocess.ts (#187)

**TDD approach:**
- Write tests first: verify `stderrRl` is stored as field, verify both readline interfaces closed in `shutdown()` and `kill()`
- Write test for double-close safety (calling shutdown then kill should not error)
- Implement: add `stderrRl` field, close in cleanup methods

**Files:** `src/main/graviscan/scanner-subprocess.ts`, `tests/unit/graviscan/scanner-subprocess.test.ts`

**Verify:** `npx vitest run tests/unit/graviscan/scanner-subprocess.test.ts`

- [x] Write readline cleanup tests (shutdown closes both, kill closes both, double-close safe)
- [x] Store stderrRl as class field, close in shutdown/kill
- [x] Verify existing scanner-subprocess tests still pass

## Task 3: Add ScanSessionState type to graviscan types

**Files:** `src/types/graviscan.ts`

- [x] Add ScanSessionJob interface (status: 'pending' | 'scanning' | 'complete' | 'error' | 'recorded')
- [x] Add ScanSessionState interface (derived from session-handlers.ts lines 140-157, plus `scanEndedAt: number | null`)

**Verify:** `npx tsc --noEmit`

## Task 4: Create register-handlers.ts with IPC wiring

**TDD approach:**
- Write parametric/table-driven tests: iterate all 15 channels, verify each registered and delegates to correct handler with correct args
- Write tests for error handling: handler throws → IPC returns `{ success: false, error }` and logs via console.error
- Write tests for path validation: readScanImage rejects paths outside output directory (uses `path.resolve()` before `startsWith`)
- Write tests for upload guard: upload-all-scans rejects when coordinator is scanning
- Write test for double registration: calling registerGraviScanHandlers twice throws
- Implement: `registerGraviScanHandlers(ipcMain, db, getMainWindow, sessionFns, getCoordinator)`

**Files:** `src/main/graviscan/register-handlers.ts` (new), `tests/unit/graviscan/register-handlers.test.ts` (new)

**Verify:** `npx vitest run tests/unit/graviscan/register-handlers.test.ts`

- [x] Write parametric registration tests (15 channels, correct delegation)
- [x] Write error handling tests
- [x] Write path validation test for readScanImage (including path.resolve normalization)
- [x] Write upload guard test (reject when scanning)
- [x] Write double registration test (throws on second call)
- [x] Implement registerGraviScanHandlers
- [x] Verify all graviscan unit tests pass

## Task 5: Update barrel exports in index.ts

**Files:** `src/main/graviscan/index.ts`

- [x] Export `registerGraviScanHandlers` from register-handlers
- [x] Export `ScanCoordinator` from scan-coordinator
- [x] Export `ScannerSubprocess` from scanner-subprocess
- [x] Export `scanLog`, `cleanupOldLogs`, `closeScanLog` from scan-logger

**Verify:** `npx tsc --noEmit`

## Task 6: Wire into main.ts — session state + conditional registration

**TDD approach:**
- Extract GraviScan wiring logic into a testable function (e.g., `initGraviScan(config, ipcMain, db, getMainWindow)`) to avoid testing main.ts side effects directly
- Write Vitest unit tests with mocked ipcMain: verify GraviScan handlers registered when mode is `graviscan`, NOT registered when mode is `cylinderscan` or empty/unset
- Write tests for session state lifecycle (getScanSession, setScanSession, markScanJobRecorded — including unknown job key)
- Write test for concurrent start-scan: reject if session already active
- Implement: add session state, conditionally call registerGraviScanHandlers based on loaded config mode
- Insert coordinator.shutdown() before closeDatabase() and closeScanLog() after it in the before-quit handler

**Files:** `src/main/main.ts`, `tests/unit/graviscan/main-wiring.test.ts` (new)

**Depends on:** Task 4, Task 5

**Gate:** `npx tsc --noEmit && npx vitest run tests/unit/graviscan/`

- [x] Write conditional registration tests (graviscan mode → registered, cylinderscan mode → not registered, empty mode → not registered)
- [x] Write session state lifecycle tests (get/set/markJobRecorded including unknown key)
- [x] Write concurrent start-scan rejection test
- [x] Extract initGraviScan() function for testability
- [x] Add ScanSessionState + getters/setters to main.ts
- [x] Add conditional registerGraviScanHandlers call
- [x] Add cleanupOldLogs() on app startup (when graviscan mode)
- [x] Add closeScanLog() on app quit (after closeDatabase)
- [x] Add coordinator shutdown on app quit (before closeDatabase, if active)

**Verify:** `npx vitest run tests/unit/graviscan/`

## Task 7: Wire coordinator event forwarding in main.ts

**TDD approach:**
- Write tests first: mock coordinator EventEmitter, verify all 10 events forwarded to `mainWindow.webContents.send` with correct channel names and payloads
- Write tests for guards: no crash when mainWindow is null, when mainWindow.isDestroyed() is true
- Implement: `setupCoordinatorEventForwarding(coordinator, getMainWindow)` called from within startScan handler

**Files:** `src/main/main.ts` (or helper in register-handlers.ts), `tests/unit/graviscan/main-wiring.test.ts`

**Depends on:** Task 6

- [x] Write event forwarding tests (10 coordinator events → correct IPC channels)
- [x] Write null window guard test (mainWindow is null → no crash)
- [x] Write destroyed window guard test (mainWindow.isDestroyed() → no crash)
- [x] Implement event forwarding with guards
- [x] Verify tests pass

## Task 8: Extend preload.ts with gravi namespace

**TDD approach:**
- Write tests first: verify `window.electron.gravi` has all expected methods (15 invoke + 12 listeners)
- Write tests for listener registration: `on*` methods call `ipcRenderer.on`
- Write tests for listener cleanup: returned cleanup function calls `ipcRenderer.removeListener`
- Implement: add graviAPI object, expose in contextBridge (requires `vi.mock('electron')`)

**Files:** `src/main/preload.ts`, `tests/unit/preload-gravi.test.ts` (new)

**Depends on:** Task 4 (channel names must match)

- [x] Write preload gravi API shape tests (all methods present)
- [x] Write listener registration tests
- [x] Write listener cleanup tests (cleanup function removes listener)
- [x] Implement gravi namespace in preload.ts

**Verify:** `npx tsc --noEmit && npx vitest run tests/unit/preload`

## Task 9: Add GraviAPI type to electron.d.ts

**Files:** `src/types/electron.d.ts`

**Depends on:** Task 8 (to know exact API shape)

- [x] Define GraviAPI interface with all invoke methods and on* listener types
- [x] Add `gravi: GraviAPI` to ElectronAPI interface

**Verify:** `npx tsc --noEmit`

## Task 10: Pre-merge verification

**Depends on:** All above tasks

- [x] All unit tests pass: `npx vitest run`
- [x] TypeScript compiles: `npx tsc --noEmit`
- [x] Lint passes: `npx eslint src/`
- [x] Format passes: `npx prettier --check src/`
- [x] Integration tests pass
- [x] E2E tests pass: `npm run test:e2e`
- [x] CylinderScan regression: existing E2E and scanner tests unaffected
- [x] Run full pre-merge checks per project claude commands

## Parallelizable work

- Tasks 1, 2, 3, and 4 are all independent (register-handlers uses handler module APIs via dependency injection, not scan-coordinator directly)
- Task 5 is quick, can be done alongside Task 4
- Tasks 6 and 8 depend on Task 4+5 but are partially parallelizable (touch different files)
- Task 7 depends on Task 6
- Task 9 depends on Task 8
- Task 10 is sequential, after all others

## Check gates

- After Tasks 1-2: `npx vitest run tests/unit/graviscan/scan-coordinator.test.ts tests/unit/graviscan/scanner-subprocess.test.ts`
- After Tasks 3-5: `npx tsc --noEmit && npx vitest run tests/unit/graviscan/`
- After Tasks 6-7: `npx vitest run tests/unit/graviscan/ && npx tsc --noEmit`
- After Tasks 8-9: `npx tsc --noEmit && npx vitest run`
- Task 10: full pre-merge suite
