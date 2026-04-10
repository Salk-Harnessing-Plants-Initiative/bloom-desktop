## Context

Increment 3a of the GraviScan integration. PR #138 (`origin/graviscan/4-main-process`) contains a monolithic `graviscan-handlers.ts` (1,338 lines, 15 IPC handlers) that needs restructuring before integration into `main.ts`.

The design spec (`docs/superpowers/specs/2026-04-03-graviscan-integration-design.md`, line 304) lists 4 modules for Increment 3a. We are delivering 3 modules now because `scan-handlers.ts` (GraviScan DB CRUD) has no source handlers in Ben's file — those will be added in Increment 3c when `database-handlers.ts` is extended. This divergence is intentional and documented here.

## Goals / Non-Goals

- Goals: Split Ben's monolithic file into 3 focused, independently testable modules in `src/main/graviscan/`. Write comprehensive unit tests. No integration with `main.ts` yet.
- Non-Goals: IPC wiring (Increment 3c), `scan-handlers.ts` for DB CRUD (Increment 3c), renderer changes, preload changes, coverage threshold increases (tracked in issue #181).

## Decisions

### Separate-module pattern (testable via direct import)

The key insight from the CylinderScan codebase: `camera-process.ts` and `scanner-process.ts` are testable because they live in **separate modules from `main.ts`**, not because they're pure. They are stateful EventEmitter classes — `ScannerProcess` even calls `getDatabase()` directly. But they can be imported and tested without booting Electron, which is what matters.

We follow the same principle: **business logic in separate modules, testable via direct import, with module-mocked external dependencies.** We are NOT claiming pure-function purity. These modules have module-level state (`sessionValidation`, `uploadInProgress`) and use module-level imports (`detectEpsonScanners`, `sharp`, `fs`) that are mocked in tests via `vi.mock()`.

What IS dependency-injected (passed as parameters):

- `db: PrismaClient` — enables mocking without singleton coupling
- `coordinator: ScanCoordinator` — does not exist yet (Increment 3b), injected to avoid import coupling
- Session state functions (`getScanSession`, `setScanSession`, `markScanJobRecorded`) — currently live in `main.ts`, injected to break circular dependency
- Progress/error callbacks — replace `mainWindow.webContents.send()` for testability

What is NOT dependency-injected (module-mocked in tests via `vi.mock()`):

- `detectEpsonScanners` from `../lsusb-detection`
- `resolveGraviScanPath` from `../graviscan-path-utils`
- `sharp` (native image processing)
- `fs` / `fs.promises` (filesystem operations)
- `runBoxBackup` from `../box-backup`
- `app` from `electron` (used by `getOutputDir` for path resolution — `app.getAppPath()`, `app.getPath('home')`)

Alternatives considered:

- **Handler files own `ipcMain.handle()`**: Rejected. This is the `database-handlers.ts` pattern that led to 942 untested lines. Requires mocking Electron's IPC runtime.
- **Pure stateless functions with full DI**: Rejected. Overstates purity — we have real module-level state and it's simpler to let external deps be module imports rather than threading 6+ parameters through every call.

### Handler-to-module mapping (lifecycle split)

Grouped by workflow phase rather than strict domain object:

| Module                | Handlers                                                                                                                                           | Rationale                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `scanner-handlers.ts` | `detect-scanners`, `save-scanners-db`, `get-config`, `save-config`, `platform-info`, `validate-scanners`, `validate-config` + validation state fns | Everything about scanner hardware setup and readiness |
| `session-handlers.ts` | `start-scan`, `get-scan-status`, `mark-job-recorded`, `cancel-scan`                                                                                | Scan execution lifecycle via ScanCoordinator          |
| `image-handlers.ts`   | `get-output-dir`, `read-scan-image`, `upload-all-scans`, `download-images`                                                                         | Image output, export, and backup                      |

### Cherry-pick dependencies from Ben's branch

These utility files must be cherry-picked from `origin/graviscan/4-main-process` as they are imported by the handler modules but don't exist on `main` yet:

- `src/main/graviscan-path-utils.ts` — `resolveGraviScanPath()` used by `image-handlers.ts`
- `src/main/lsusb-detection.ts` — `detectEpsonScanners()` used by `scanner-handlers.ts`
- `src/main/box-backup.ts` — `runBoxBackup()` used by `image-handlers.ts`

Without these, `tsc --noEmit` will fail on unresolved imports.

### ScanCoordinator interface contract

`ScanCoordinator` is implemented in Increment 3b, but `session-handlers.ts` depends on it now. We define the interface based on Ben's existing implementation (`origin/graviscan/4-main-process:src/main/scan-coordinator.ts`):

```typescript
interface ScanCoordinatorLike {
  readonly isScanning: boolean;
  initialize(scanners: ScannerConfig[]): Promise<void>;
  scanOnce(platesPerScanner: Map<string, PlateConfig[]>): Promise<void>;
  scanInterval(
    platesPerScanner: Map<string, PlateConfig[]>,
    intervalMs: number,
    durationMs: number
  ): Promise<void>;
  cancelAll(): void;
  shutdown(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
}
```

We code against this interface. If 3b changes the coordinator API, we update the interface and the tests. The interface lives in `session-handlers.ts` as a local type (not exported to shared types) since it's an internal contract.

`ScannerConfig` and `PlateConfig` are also defined locally in `session-handlers.ts` (not imported from 3b's `scan-coordinator.ts` / `scanner-subprocess.ts`, which don't exist yet):

```typescript
interface ScannerConfig {
  scannerId: string;
  saneName: string;
  plates: PlateConfig[];
}

interface PlateConfig {
  plate_index: string;
  grid_mode: string;
  resolution: number;
  output_path: string;
}
```

Known coordinator event types (for test mock fidelity): `scan-event`, `grid-complete`, `interval-start`, `cycle-complete`, `interval-waiting`, `overtime`, `interval-complete`. These are documented here for 3c reference but not typed in the interface (kept as `string` via the EventEmitter `on` signature).

### Event forwarding for long-running scans

`startScan` triggers fire-and-forget operations (`coordinator.scanOnce()` / `coordinator.scanInterval()`) that run for minutes and emit streaming progress events. A single `onProgress` callback is insufficient for this.

The service function accepts an `onError` callback for the detached promise's catch handler. Real-time progress event wiring (coordinator → renderer) is deferred to the IPC wiring layer in Increment 3c, where `main.ts` owns the coordinator instance and wires `coordinator.on('scan-complete', ...)` → `mainWindow.webContents.send()`. This is consistent with how CylinderScan's `ensureScannerProcess()` wires event forwarding in `main.ts` (lines 672-709).

In 3a, `session-handlers.ts` functions handle the request/response portion (validate, build session state, call coordinator methods, return success/failure). The streaming event layer is 3c's responsibility.

**Session state ownership split**: `startScan` (3a) builds the initial `ScanSession` state object. However, coordinator events in 3c mutate that same state (updating `jobs[key].status`, `coordinatorState`, `currentCycle`, `nextScanAt`, writing `completed_at` to DB). This means session state is built in 3a but mutated in 3c. We accept this split — 3a owns construction and request/response queries, 3c owns event-driven mutation. The `ScanSession` shape is the contract between them.

### Progress callbacks for batch operations

`uploadAllScans` and `downloadImages` are batch operations with bounded progress (not streaming events). These accept `onProgress` callbacks:

```typescript
export async function downloadImages(
  db: PrismaClient,
  params: DownloadParams,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult>;
```

The IPC wiring layer (3c) converts callbacks to `webContents.send()`.

### Dialog handling for downloadImages

Ben's `download-images` handler opens a native folder picker via `dialog.showOpenDialog()`. The service function accepts `targetDir: string` as a parameter. The IPC wiring layer (3c) handles the dialog and passes the result.

### Module-level mutable state

Two pieces of module-level state exist:

- **`sessionValidation`** in `scanner-handlers.ts` — startup validation state. Exposed via `getSessionValidationState()` / `resetSessionValidation()`. Tests call `resetSessionValidation()` in `beforeEach`.
- **`uploadInProgress`** in `image-handlers.ts` — upload guard boolean. Prevents concurrent Box uploads. Managed as module-level closure state with `resetUploadState()` exported for testing.

This is the same pattern as CylinderScan's module-level state in `main.ts` (`scannerIdentity`, `currentCameraSettings`). We own it honestly rather than claiming purity.

## Risks / Trade-offs

- **Risk**: 3c wiring layer will be substantial. It must own coordinator lifecycle (construction, shutdown), event forwarding (7 event types with session state mutation and DB writes), dialog handling, and IPC registration — estimated 200+ lines of stateful orchestration, not one-liner wrappers.
  - Mitigation: Accepted. This complexity exists regardless of module organization; keeping it out of 3a makes each increment reviewable. The session state shape and `ScanCoordinatorLike` interface are the contracts that make the split manageable.
- **Risk**: `ScanCoordinatorLike` interface may diverge from actual 3b implementation.
  - Mitigation: Interface is derived from Ben's existing code. If 3b changes the API, update the interface — tests are the canary.
- **Risk**: Module-level state (`sessionValidation`, `uploadInProgress`) shared across test files in Vitest's parallel execution.
  - Mitigation: Export `reset*()` functions. All test files call them in `beforeEach`. Vitest isolates module instances per worker thread by default.
- **Risk**: `sharp` chain mock is brittle (tied to builder API call order).
  - Mitigation: Unit tests verify behavior (correct data URI returned, thumbnail vs full), not implementation details (call order). Add a small real TIFF fixture for a focused sharp integration test.

## Open Questions

None — all resolved during design discussion and review.
