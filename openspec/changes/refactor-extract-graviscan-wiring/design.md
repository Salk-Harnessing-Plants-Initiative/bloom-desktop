# Design: Extract GraviScan Wiring

## Module Boundary

### New file: `src/main/graviscan/wiring.ts`

This module owns all GraviScan wiring state and orchestration. It is **side-effect-free** at load time — no code runs on import, only declarations and type-only imports.

#### State (module-level, not exported)

| Variable               | Type                                    | Purpose                                   |
| ---------------------- | --------------------------------------- | ----------------------------------------- |
| `scanSession`          | `ScanSessionState \| null`              | Current scan session                      |
| `scanCoordinator`      | `ScanCoordinator \| null`               | Lazy-created coordinator singleton        |
| `_getMainWindow`       | `(() => BrowserWindow \| null) \| null` | Cached window getter for event forwarding |
| `_coordinatorCreating` | `Promise<ScanCoordinator> \| null`      | Race guard for concurrent creation        |

#### Exports

| Export                              | Type                 | Purpose                                                         |
| ----------------------------------- | -------------------- | --------------------------------------------------------------- |
| `graviSessionFns`                   | `SessionFns` (const) | Session state getter/setter/marker                              |
| `setupCoordinatorEventForwarding()` | function             | Wires coordinator events to renderer IPC                        |
| `getOrCreateCoordinator()`          | async function       | Lazy singleton with promise memoization                         |
| `initGraviScan()`                   | async function       | Conditional init: mode check, handler registration, log cleanup |
| `shutdownGraviScan()`               | async function       | **NEW** — coordinator shutdown + scan log close                 |
| `_resetWiringState()`               | function             | Test-only: reset all module state for clean test isolation      |

### Dependencies

`wiring.ts` uses only type-only imports at module level — no runtime Electron imports:

```typescript
// Type-only (no side effects, erased at compile time)
import type { SessionFns } from './session-handlers';
import type { ScanSessionState } from '../../types/graviscan';
import type { ScanCoordinator } from './scan-coordinator';
import type { BrowserWindow } from 'electron';
```

The `app.isPackaged` value needed by `getOrCreateCoordinator()` is obtained via a dynamic import inside the function body:

```typescript
const { app } = await import('electron');
const isPackaged = app.isPackaged;
```

This keeps the module free of runtime Electron imports at the top level, meaning it can be imported in a Node test environment with only `vi.mock('electron')` intercepting the dynamic import inside `getOrCreateCoordinator()`. The dynamic import is already in an async function that does other dynamic imports (`scan-coordinator`, `python-paths`), so this adds no architectural overhead.

## Changes to main.ts

After extraction, main.ts:

1. **Removes**: Lines 102-240 (GraviScan state + 4 functions + type imports for `SessionFns`, `ScanSessionState`, `ScanCoordinator`), lines 1383-1406 (shutdown logic)
2. **Adds**: `import { initGraviScan, shutdownGraviScan } from './graviscan/wiring';`
3. **Replaces** shutdown block with: `await shutdownGraviScan();`
4. **Keeps**: The `initGraviScan(...)` call site unchanged (same arguments)

## Changes to barrel (index.ts)

Add re-exports for the public API consumed by main.ts:

```typescript
export { initGraviScan, shutdownGraviScan } from './wiring';
```

Note: `graviSessionFns`, `setupCoordinatorEventForwarding`, and `getOrCreateCoordinator` are **not** re-exported from the barrel. They are internal to the graviscan module — consumed only by `wiring.ts` itself and directly imported in tests. This keeps the barrel surface area minimal.

## Shutdown Ordering

### Current sequence (main.ts before-quit handler)

1. Coordinator shutdown (`scanCoordinator.shutdown()`) — lines 1383-1393
2. Database close (`closeDatabase()`) — lines 1396-1398
3. Scan log close (`closeScanLog()`) — lines 1401-1406

### New sequence

1. `await shutdownGraviScan()` — coordinator shutdown + scan log close
2. `await closeDatabase()`

`closeScanLog()` moves from after database close to before it. **This is safe** because `closeScanLog()` closes a filesystem write stream (`~/.bloom/logs/graviscan-YYYY-MM-DD.log`) with no database dependency. The database close has no dependency on the scan log either. The coordinator shutdown still happens before database close, preserving the critical ordering (coordinator may flush events that trigger database writes).

### Shutdown during in-flight coordinator creation

If `shutdownGraviScan()` is called while `_coordinatorCreating` is pending, the function awaits the pending creation, then shuts down the resulting coordinator. This prevents orphaned coordinator instances.

The await must be wrapped in try/catch — if `_coordinatorCreating` rejects (coordinator creation failed), the error is caught and logged, and shutdown proceeds to `closeScanLog()`. A bare `await _coordinatorCreating` would propagate the rejection and skip remaining cleanup:

```typescript
if (_coordinatorCreating) {
  try {
    scanCoordinator = await _coordinatorCreating;
  } catch {
    // Creation failed — nothing to shut down, proceed to closeScanLog
  }
  _coordinatorCreating = null;
}
```

## Test Strategy

`main-wiring.test.ts` is rewritten to:

1. Import `graviSessionFns`, `setupCoordinatorEventForwarding`, `getOrCreateCoordinator`, `initGraviScan`, `shutdownGraviScan`, `_resetWiringState` from `../../../src/main/graviscan/wiring`.
2. Call `_resetWiringState()` in `beforeEach` for test isolation.
3. Mock only external dependencies (`electron`, `./scan-coordinator`, `../python-paths`, `./register-handlers`, `./scan-logger`).
4. Test the **real** exported functions instead of inline reimplementations.
5. Add tests for the new `shutdownGraviScan()` function (3 scenarios: active, no-op, error handling).
6. Add explicit test for side-effect-free import.

### `_resetWiringState()` specification

Resets all 4 pieces of module-level state to initial values AND calls `_resetRegistration()` from `register-handlers.ts` to clear the `registered` boolean guard. Without this, tests calling `initGraviScan()` after reset would throw `"GraviScan IPC handlers are already registered"`.

The `_resetRegistration` import is **dynamic** (not static) to avoid pulling in `register-handlers.ts` and its transitive dependencies (`scanner-handlers` → `image-handlers` → `sharp`) at module load time. A static import would defeat the lazy-loading strategy and cause the packaged app to load `sharp` even in cylinderscan mode.

```typescript
export async function _resetWiringState(): Promise<void> {
  scanSession = null;
  scanCoordinator = null;
  _getMainWindow = null;
  _coordinatorCreating = null;
  const { _resetRegistration } = await import('./register-handlers');
  _resetRegistration();
}
```

## Decisions

1. **`_resetWiringState()` for tests**: Prefixed with underscore to signal test-only usage. Resets all module-level variables to their initial values. This is the standard pattern in this codebase (see `_resetRegistration` in register-handlers).

2. **`shutdownGraviScan()` encapsulation**: The shutdown logic in main.ts directly accesses `scanCoordinator` and calls `closeScanLog()`. After extraction, main.ts cannot access `scanCoordinator` (it's private to wiring.ts), so shutdown must be exposed as a function. This is a minor API addition, not a pure move.

3. **No runtime `app` import at module level**: `getOrCreateCoordinator()` uses `app.isPackaged`. Rather than importing `app` at module level (which would couple the module to Electron at import time), we use a dynamic `await import('electron')` inside the function. This keeps `wiring.ts` genuinely importable in Node test environments — tests only need to mock `electron` for the dynamic import inside `getOrCreateCoordinator()`, not at module load time.

4. **Minimal barrel re-exports**: Only `initGraviScan` and `shutdownGraviScan` are re-exported from the barrel. Internal wiring functions are available via direct import from `wiring.ts` when needed (e.g., in tests).
