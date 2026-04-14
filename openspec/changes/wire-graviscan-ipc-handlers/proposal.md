# Wire GraviScan IPC Handlers (Increment 3c)

## Why

The renderer cannot invoke any GraviScan functionality because Increments 3a/3b delivered isolated handler modules with no IPC wiring, no preload bridge, and no barrel exports.

## What Changes

1. **`registerGraviScanHandlers(ipcMain, db, getMainWindow, sessionFns, getCoordinator)` function** — new file `src/main/graviscan/register-handlers.ts` that wraps handler functions with `ipcMain.handle()` for 15 IPC channels
2. **Conditional registration in `main.ts`** — call `registerGraviScanHandlers` only when mode is `graviscan`, following the pattern where CylinderScan processes are created on-demand
3. **Session state in `main.ts`** — module-level `ScanSessionState` with getter/setter functions, passed to session handlers via dependency injection
4. **`ScanSessionState` type** — new interface in `src/types/graviscan.ts` (does not exist yet)
5. **Coordinator lifecycle** — lazy instantiation from `graviscan:start-scan` handler, matching CylinderScan's `ScannerProcess` pattern (created only when needed)
6. **Event forwarding** — coordinator events forwarded to renderer via `mainWindow.webContents.send()` with standard `if (mainWindow && !mainWindow.isDestroyed())` guard
7. **Preload `gravi` namespace** — expose all GraviScan IPC channels via `contextBridge.exposeInMainWorld`, with `on*` listener methods returning cleanup functions (matching `scanner` API pattern)
8. **`GraviAPI` type + `ElectronAPI` extension** — add `gravi: GraviAPI` to `src/types/electron.d.ts`
9. **Barrel export updates** — `graviscan/index.ts` exports `registerGraviScanHandlers`, `ScanCoordinator`, `ScannerSubprocess`, `scanLog`, `cleanupOldLogs`, `closeScanLog`
10. **Async FS fixes (from #187)** — replace `fs.existsSync/statSync/renameSync` with `fs.promises` in `scan-coordinator.ts`; store `stderrRl` as class field and close both readline interfaces in `scanner-subprocess.ts` shutdown/kill
11. **Integration tests** — IPC handler wiring tests, coordinator lifecycle tests
12. **Scan log lifecycle** — call `cleanupOldLogs()` on app startup, `closeScanLog()` on app quit
13. **Persistent logging for critical events** — add `scanLog()` calls for `grid-complete` events and successful file renames (not just errors) for scientific traceability
14. **Upload guard** — reject `graviscan:upload-all-scans` when coordinator is actively scanning
15. **Path validation** — `readScanImage` IPC handler validates file path is within the scan output directory before allowing reads

## Impact

**Affected specs:** `scanning`

**Affected code files:**
- `src/main/graviscan/register-handlers.ts` (new)
- `src/main/graviscan/index.ts` (barrel exports)
- `src/main/graviscan/scan-coordinator.ts` (async FS fixes, persistent logging)
- `src/main/graviscan/scanner-subprocess.ts` (readline cleanup)
- `src/main/main.ts` (session state, conditional registration, event forwarding, app lifecycle)
- `src/main/preload.ts` (gravi namespace)
- `src/types/graviscan.ts` (ScanSessionState type)
- `src/types/electron.d.ts` (GraviAPI type, ElectronAPI extension)

**Affected test files:**
- `tests/unit/graviscan/register-handlers.test.ts` (new)
- `tests/unit/graviscan/scan-coordinator.test.ts` (update mocks for async FS)
- `tests/unit/graviscan/scanner-subprocess.test.ts` (readline cleanup tests)
- `tests/unit/preload-gravi.test.ts` (new)

### Out of scope

- GraviScan CRUD in `database-handlers.ts` — handler modules already use Prisma directly; adding a second layer would duplicate logic. If renderer-specific CRUD is needed, it belongs in Increment 4/5.
- Renderer hooks/UI (Increment 4)
- Upload/Box backup wiring (Increment 6)
- New database migrations
- #188 edge cases (process-error listener, scan() state race, killAll tests, spawn guard, etc.) — deferred to a dedicated edge-case increment

### Decision: No database-handlers.ts extension

The GraviScan handler modules (`scanner-handlers.ts`, `session-handlers.ts`, `image-handlers.ts`) are self-sufficient for database operations — they accept a `db` (Prisma client) parameter and perform queries directly. Adding parallel CRUD handlers in `database-handlers.ts` would:
- Duplicate query logic across two locations
- Create maintenance burden when schemas change
- Violate the handler module's established pattern of encapsulating domain logic with DB access

The existing `database-handlers.ts` pattern (generic CRUD) suits CylinderScan's simpler data model. GraviScan's domain-specific operations (e.g., `saveScannersToDB` with USB port matching, `validateConfig` with detected-vs-saved comparison) don't fit the generic pattern.

## Cherry-pick strategy

Reference Ben's `origin/graviscan/4-main-process` branch for:
- Session state shape (`ScanSessionState` interface)
- Coordinator event forwarding logic
- IPC channel naming conventions

Do NOT cherry-pick commits directly. Instead, rewrite guided by the design spec and existing handler module interfaces, using TDD.

## Related

- Parent: #130 (GraviScan integration — note: this increment does not fully close #130; database-handlers CRUD and IPC coverage script updates remain deferred to Increment 4)
- Epic: #126
- Issues: #187 (async fs), #188 (edge cases — explicitly deferred)
- Unblocks: #179 (hardware validation tests need IPC handlers wired)
- Related: #167 (duplicate scanner records — existing handler logic, not addressed here)
- Related: #182 (USB reconnect bug — touches coordinator/subprocess code being wired here)
- Design spec: `docs/superpowers/specs/2026-04-03-graviscan-integration-design.md`
- Prior increments: 0a, 0b, 1, 2, 3a, 3b (all merged)
