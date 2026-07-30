## Why

Three IPC handlers that exist on the production `bloom-desktop-pilot` GraviScan
implementation are missing on `main`: `graviscan:get-scanner-status`,
`graviscan:list-scan-files`, and `graviscan:ensure-dir`. Without them the
renderer has no way to (a) show per-scanner ready/starting/error/disconnected
status on page mount, (b) browse previously-captured scan images, or (c)
pre-create a session's output folder before a scan cycle begins.

`get-scanner-status` has a hard compile-time dependency on
`ScanCoordinator.getScannerStatuses()`, which also doesn't exist on `main` yet
— it was ported from production as dead infra in a prior increment (the
`initErrors` map exists but nothing reads it). Adding the handler and the
coordinator method are one increment, not two, since the handler cannot be
implemented without it.

While wiring `getScannerStatuses()` up, two more coordinator bugs surfaced
that must be fixed in the same pass or the new handler reports wrong data:

1. `initialize()` never clears `initErrors`, so a scanner that failed once and
   later reconnects successfully keeps reporting a stale `error` status
   forever.
2. `addScanner()`'s mid-scan queue path has no per-scanner deduplication, so
   two concurrent `addScanner()` calls for the same `scannerId` (e.g. an
   operator double-clicking "Detect" mid-scan) each spawn a subprocess in the
   same `cycle-complete` tick — the second call finds the first's
   not-yet-ready subprocess already in the map and shuts it down mid-spawn
   before spawning a replacement. Production's fix for this (Copilot PR #237
   review) has the queued handler re-enter the public `addScanner()` so the
   `hasWorker()` guard re-runs; that fix does not work, because
   `addScanner()`'s own `isScanning` check is still `true` at the synchronous
   instant a `cycle-complete` listener runs, so the re-entrant call re-queues
   itself forever and the spawn never happens at all. This change dedupes
   queued spawns with a per-`scannerId` pending-add map instead — see
   `design.md`, Decision 2.

All three fixes are narrow, self-contained bug fixes to
`src/main/graviscan/scan-coordinator.ts` that wouldn't warrant a proposal on
their own, but are bundled here since they're one PR with the new IPC
handlers and directly determine what `get-scanner-status` reports.

## What Changes

- **`ScanCoordinator.getScannerStatuses()`** (new public method,
  `src/main/graviscan/scan-coordinator.ts`): merges live subprocess state
  (`ready` / `starting` / `dead`) with the existing `initErrors` map
  (`error`) into a single per-scanner status array.
- **`initialize()` clears `initErrors` at the top**, before repopulating,
  so a previously-failed scanner that later initializes successfully does
  not keep reporting a stale error.
- **`addScanner()` dedupes mid-scan spawns with a per-`scannerId`
  pending-add map**, so concurrent requests for the same scanner share one
  queued spawn — closing the double-spawn-with-premature-shutdown race
  without the never-spawns livelock that re-entering `addScanner()` from the
  `cycle-complete` handler causes (`design.md`, Decision 2).
- **`graviscan:get-scanner-status`** (new IPC handler +
  `scannerHandlers.getScannerStatus()`): merges `coordinator.getScannerStatuses()`
  with saved, enabled `GraviScanner` DB rows, reporting `disconnected` for
  rows with no matching live subprocess.
  - **Deliberate deviation from production**: production's handler reads
    `scanner.grid_mode` directly off the per-scanner `GraviScanner` row.
    `main`'s `GraviScanner` Prisma model has no `grid_mode` column at all —
    the field only exists on `GraviScan` (a per-scan record) and
    `GraviConfig` (a global singleton config row). This change sources
    `gridMode` from the `GraviConfig` singleton instead (one query, the same
    value applied to every scanner in the response) rather than attempting a
    schema migration to add a column production itself doesn't treat as
    scanner-specific config in practice. This is a documented port deviation,
    not a bug.
- **`graviscan:list-scan-files`** (new IPC handler +
  `imageHandlers.listScanFiles()`): lists image files (`.tif`/`.tiff`/`.png`/
  `.jpg`/`.jpeg`), sorted newest-first. Recurses one level into subfolders of
  the default output directory when no `dirPath` is given (base-dir/browse-
  all mode); lists files directly inside `dirPath` when one is given
  (single-session mode).
- **`graviscan:ensure-dir`** (new IPC handler + `imageHandlers.ensureDir()`):
  idempotent `fs.promises.mkdir(dirPath, { recursive: true })`, for the
  renderer to pre-create a session's output folder before a scan cycle
  starts.

## Impact

- Affected specs: `scanning`
- Affected code:
  - `src/main/graviscan/scan-coordinator.ts` — `getScannerStatuses()`,
    `initErrors.clear()` in `initialize()`, `addScanner()` mid-scan spawn
    dedupe (`pendingAdds`)
  - `src/main/graviscan/session-handlers.ts` — `ScanCoordinatorLike`
    interface gains `getScannerStatuses()`
  - `src/main/graviscan/scanner-handlers.ts` — new `getScannerStatus()`
  - `src/main/graviscan/image-handlers.ts` — new `ensureDir()`,
    `listScanFiles()`
  - `src/main/graviscan/register-handlers.ts` — 3 new `ipcMain.handle()`
    registrations (17 → 20 channels)
  - Tests: `tests/unit/scan-coordinator-add-scanner.test.ts`,
    `tests/unit/graviscan/scan-coordinator.test.ts` (n/a — race-guard test
    lives in the add-scanner file), `tests/unit/graviscan/image-handlers.test.ts`,
    `tests/unit/graviscan/get-scanner-status-handler.test.ts` (new),
    `tests/unit/graviscan/register-handlers.test.ts`
- No renderer/preload/`electron.d.ts` wiring in this change — these are new
  main-process IPC handlers only; renderer consumption is a follow-up.
