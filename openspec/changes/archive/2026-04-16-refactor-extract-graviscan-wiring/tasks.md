# Tasks: Extract GraviScan Wiring

## Task 1: Extract wiring module and update main.ts (with tests) ✅

This task is atomic — tests, `wiring.ts` creation, and `main.ts` update happen together to avoid a duplicate-export state where both modules own the same state.

### Tests first

Rewrite `tests/unit/graviscan/main-wiring.test.ts` to:

1. Import `graviSessionFns`, `setupCoordinatorEventForwarding`, `getOrCreateCoordinator`, `initGraviScan`, `shutdownGraviScan`, `_resetWiringState` from the real `../../../src/main/graviscan/wiring` module.
2. Mock `electron` (dynamic import in `getOrCreateCoordinator`), `./scan-coordinator`, `../python-paths`, `./register-handlers`, `./scan-logger`.
3. Call `_resetWiringState()` in `beforeEach` to reset all 4 state variables (`scanSession`, `scanCoordinator`, `_getMainWindow`, `_coordinatorCreating`) plus the `registered` guard in register-handlers.
4. Rewrite all 14 existing tests to use real exports instead of inline reimplementations:
   - `initGraviScan`: registers handlers in graviscan mode, skips in cylinderscan mode, skips when mode is empty, calls `cleanupOldLogs`.
   - Session state lifecycle: `getScanSession` returns null initially, `setScanSession` updates state, `markScanJobRecorded` updates job status, `markScanJobRecorded` ignores unknown key, `setScanSession(null)` clears state.
   - Event forwarding: all 11 events forwarded, null window no-crash, destroyed window no-crash, rename-error forwarded.
   - Coordinator race protection: concurrent calls return same instance.
   - Session completion: session cleared after scan completes.
5. Add new tests:
   - `shutdownGraviScan`: shuts down active coordinator, sets reference to null, calls `closeScanLog()`.
   - `shutdownGraviScan`: no-ops when no coordinator exists, still calls `closeScanLog()`.
   - `shutdownGraviScan`: catches `coordinator.shutdown()` error, logs it, still nulls coordinator, still calls `closeScanLog()`.
   - `shutdownGraviScan`: awaits in-flight `_coordinatorCreating` before shutting down. (Use a deferred promise mock for `scan-coordinator` to keep creation pending, call `shutdownGraviScan()` concurrently, then resolve the deferred, and verify the resulting coordinator is shut down.)
   - `shutdownGraviScan`: handles rejected `_coordinatorCreating` gracefully (creation promise rejects, error caught, `closeScanLog()` still called).
   - `markScanJobRecorded`: no-ops when `scanSession` is null (no error thrown).
   - Side-effect-free: module imports successfully in Node test environment, all exports are defined.
   - Coordinator lazy instantiation: first call creates coordinator, second call returns cached instance.
   - `initGraviScan` wires arguments correctly: after calling `initGraviScan('graviscan', ...)`, verify `registerGraviScanHandlers` was called with `graviSessionFns` and `getOrCreateCoordinator` as arguments, and that the stored `_getMainWindow` is used by `getOrCreateCoordinator` for event forwarding.

### Implementation

1. Create `src/main/graviscan/wiring.ts` containing:
   - Module-level state: `scanSession`, `scanCoordinator`, `_getMainWindow`, `_coordinatorCreating` (all type-only imports at top, no runtime Electron import).
   - `graviSessionFns` const.
   - `setupCoordinatorEventForwarding()` — moved from main.ts lines 128-154.
   - `getOrCreateCoordinator()` — moved from main.ts lines 165-201, with `app` obtained via dynamic `await import('electron')` instead of top-level import.
   - `initGraviScan()` — moved from main.ts lines 207-240.
   - `shutdownGraviScan()` — new, encapsulates main.ts lines 1383-1393 + 1401-1406, awaits `_coordinatorCreating` if pending (with try/catch for rejected creation promises).
   - `_resetWiringState()` — resets all 4 state variables to null and calls `_resetRegistration()` from register-handlers.
2. Remove from main.ts: GraviScan state block (lines 102-122), `setupCoordinatorEventForwarding` (lines 128-154), `_coordinatorCreating` (line 157), `getOrCreateCoordinator` (lines 165-201), `initGraviScan` (lines 207-240), type imports (`SessionFns`, `ScanSessionState`, `ScanCoordinator`), shutdown block (lines 1383-1406).
3. Add to main.ts: `import { initGraviScan, shutdownGraviScan } from './graviscan/wiring';`
4. Replace shutdown block in main.ts with: `await shutdownGraviScan();`

### Validation

- `npx vitest run tests/unit/graviscan/main-wiring.test.ts`
- `npx vitest run` (all 706 tests pass)
- `npx tsc --noEmit`
- `npm run lint`

---

## Task 2: Update barrel exports and spec deltas ✅

### Tests first

No new tests — barrel export correctness verified by TypeScript compilation (`npx tsc --noEmit`). Existing barrel consumers are unaffected since this is additive (no exports removed).

### Implementation

1. Update `src/main/graviscan/index.ts` to add re-exports of `initGraviScan` and `shutdownGraviScan` from `./wiring` (in addition to all existing handler exports).
2. Apply spec deltas to `openspec/specs/scanning/spec.md`.

### Validation

- `npx vitest run` (all 706 tests pass)
- `npx tsc --noEmit`
- `npm run lint`
- `npx openspec validate refactor-extract-graviscan-wiring --strict`
