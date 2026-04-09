## Context

Increment 3a of the GraviScan integration. PR #138 (`origin/graviscan/4-main-process`) contains a monolithic `graviscan-handlers.ts` (1,338 lines, 15 IPC handlers) that needs restructuring before integration into `main.ts`.

The CylinderScan codebase demonstrates two patterns:
- **Testable pattern**: `camera-process.ts`, `scanner-process.ts` — pure classes with no `ipcMain` dependency, full unit test coverage
- **Untestable pattern**: `database-handlers.ts` (942 lines) — business logic coupled to `ipcMain.handle()`, zero unit tests, coverage excluded via `src/main/**` in vitest.config.ts

We follow the testable pattern.

## Goals / Non-Goals

- Goals: Split Ben's monolithic file into 3 focused, independently testable service modules. Write comprehensive unit tests. No integration with `main.ts` yet.
- Non-Goals: IPC wiring (Increment 3c), `scan-handlers.ts` for DB CRUD (Increment 3c), renderer changes, preload changes, coverage threshold increases (tracked in issue #181).

## Decisions

### 3 modules now, 4th in Increment 3c

`scan-handlers.ts` (GraviScan DB CRUD) is deferred because the CRUD handlers don't exist in Ben's file — they'll be added when `database-handlers.ts` is extended in Increment 3c. Shipping an empty placeholder adds no value.

### Service module pattern (no ipcMain dependency)

Each module exports pure async functions. Dependencies (`PrismaClient`, `ScanCoordinator`, session state functions) are injected as parameters. This enables:
- Unit testing with Vitest + mocked Prisma (no Electron mocking)
- Reuse from CLI tools or background workers if needed later
- Clean separation: service modules own business logic, `register-handlers.ts` (3c) owns IPC ceremony

Alternatives considered:
- **Handler files own `ipcMain.handle()`**: Rejected. This is the `database-handlers.ts` pattern that led to 942 untested lines. Couples business logic to Electron runtime.
- **Hybrid (ipcMain + extracted helpers)**: Rejected. Confusing ownership — is the handler responsible for logic or just IPC?

### Handler-to-module mapping (lifecycle split)

Grouped by workflow phase rather than strict domain object:

| Module | Handlers | Rationale |
|---|---|---|
| `scanner-handlers.ts` | `detect-scanners`, `save-scanners-db`, `get-config`, `save-config`, `platform-info`, `validate-scanners`, `validate-config` + validation state fns | Everything about scanner hardware setup and readiness |
| `session-handlers.ts` | `start-scan`, `get-scan-status`, `mark-job-recorded`, `cancel-scan` | Scan execution lifecycle via ScanCoordinator |
| `image-handlers.ts` | `get-output-dir`, `read-scan-image`, `upload-all-scans`, `download-images` | Image output, export, and backup |

### Progress events via callback injection

`uploadAllScans` and `downloadImages` in Ben's code send progress to the renderer via `mainWindow.webContents.send()`. Instead, service functions accept an `onProgress` callback. The IPC wiring layer (3c) converts this to `webContents.send()`:

```typescript
// Service (pure, testable)
export async function downloadImages(
  db: PrismaClient,
  params: DownloadParams,
  onProgress?: (progress: DownloadProgress) => void
): Promise<DownloadResult>

// IPC wiring (Increment 3c)
ipcMain.handle('graviscan:download-images', (_e, params) =>
  downloadImages(db, params, (p) =>
    mainWindow?.webContents.send('graviscan:download-progress', p)
  )
);
```

### Dialog handling for downloadImages

Ben's `download-images` handler opens a native folder picker via `dialog.showOpenDialog()`. This is an Electron API that can't be called from a pure service function. The service function accepts `targetDir: string` as a parameter. The IPC wiring layer (3c) handles the dialog and passes the result.

## Risks / Trade-offs

- **Risk**: Service function signatures diverge from Ben's handler signatures, making 3c wiring non-trivial.
  - Mitigation: Document the mapping in `index.ts` JSDoc. Keep parameter types close to Ben's originals.
- **Risk**: Shared state (`sessionValidation` object) in `scanner-handlers.ts` is module-level mutable state.
  - Mitigation: Expose only via `getSessionValidationState()` / `resetSessionValidation()`. Tests reset between runs.
- **Risk**: `sharp` dependency for image conversion may behave differently across platforms.
  - Mitigation: Mock `sharp` in unit tests. Real sharp behavior tested in E2E (Increment 5).

## Open Questions

None — all resolved during design discussion.
