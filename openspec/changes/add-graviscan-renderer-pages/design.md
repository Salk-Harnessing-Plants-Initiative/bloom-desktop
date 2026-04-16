## Context

The GraviScan backend (Increments 1-3c) provides 15 IPC channels and 12 event streams via `window.electron.gravi`. Ben's pilot branch (`origin/graviscan/6-renderer-hooks`) contains 7 renderer hooks (~3,300 lines) that implement business logic for scanner configuration, scan sessions, plate assignments, continuous mode timing, test scans, wave tracking, and metadata validation.

These hooks call two categories of API that don't exist on `main`:
1. **GraviScan DB CRUD** — `database.graviscans.create`, `database.graviscanSessions.create`, `database.graviscanPlateAssignments.upsertMany`, etc. (the pilot has a monolithic `graviscan-handlers.ts`; we need focused handlers in `database-handlers.ts`)
2. **Pilot event names** — `onScanStarted`, `onScanComplete` vs our `onScanEvent`, `onGridComplete` (naming differences to reconcile)

This document captures decisions for porting and adapting the hooks, adding the missing data persistence layer, and building UI pages on top.

Stakeholders: Elizabeth (developer), Ben (hardware integration, hook author), scientists/phenotypers (end users).

## Goals / Non-Goals

- Goals:
  - Cherry-pick all 7 hooks from pilot branch, adapt to our IPC/preload API, add comprehensive tests (TDD)
  - Add GraviScan DB CRUD IPC handlers so hooks can persist scan records, images, sessions, and plate assignments
  - Build 4 UI pages as vertical slices on top of the tested hooks
  - Fix #159 (readiness gate) and #154 (path mismatch) in the relevant code paths
  - Maintain scientific traceability: all metadata (cycle_number, scan_started_at, scanner_id, wave_number, plate metadata) recorded in both DB and metadata.json. Note: `scan_ended_at` is recorded in the DB (updated via `updateGridTimestamps` on `grid-complete`) but NOT in metadata.json because the file is written before image capture begins.

- Non-Goals:
  - CylinderScan renderer restructure (separate increment)
  - Upload/cloud backup UI (Increment 6 — though useScanSession includes auto-upload wiring)
  - Build-time mode stripping (Phase 2)
  - Parallel scanner initialization (#144/#185)
  - Download images UI
  - Fixing #162 (QR verification scoping), #167 (stale scanner cleanup), #168 (per-scanner reconnect), #192 (post-shutdown coordinator guard), #188 (subprocess state edge cases) — referenced but deferred

## Decisions

### 1. Cherry-pick-and-adapt pattern (same as Increments 3a-3c)

Extract the 7 hook files + 2 test files from `origin/graviscan/6-renderer-hooks` as raw files (not as a git cherry-pick, since the pilot branch has incompatible architecture changes). Adapt each file to our current API:
- Rename `window.electron.graviscan.*` → `window.electron.gravi.*`
- Map pilot event names to our preload event names:
  - Pilot `onScanStarted` → our `onScanEvent` (filter for scan-start events)
  - Pilot `onScanComplete` → our `onGridComplete` (maps to grid completion per scanner)
  - Pilot `onBoxBackupProgress` → our `onUploadProgress`
  - All other event names match (`onGridStart`, `onCycleComplete`, `onIntervalStart`, `onIntervalWaiting`, `onIntervalComplete`, `onOvertime`, `onCancelled`, `onScanError`)
- Add missing `onRenameError` listener to preload.ts (wiring.ts forwards `graviscan:rename-error` but preload doesn't expose it)
- Type the `any` parameters in our preload API
- Add GraviScan DB CRUD methods to `DatabaseAPI` interface in `electron.d.ts` (NOT to `GraviAPI` which is `any`-typed)

### 2. Add GraviScan DB CRUD to database-handlers.ts

The pilot has a monolithic `graviscan-handlers.ts` (1,338 lines) that mixes scanner hardware handlers with DB CRUD. Our architecture separates these: hardware handlers are in `src/main/graviscan/`, DB handlers belong in `src/main/database-handlers.ts` alongside experiments/scientists/scans.

New IPC channels (registered in `database-handlers.ts`) — **read operations and plate assignment CRUD only**, since scan/image/session record creation is handled directly by `scan-persistence.ts` in the main process (Decision 6):
- `database:graviscans:list`, `database:graviscans:getMaxWaveNumber`, `database:graviscans:checkBarcodeUniqueInWave`
- `database:graviscanPlateAssignments:list`, `database:graviscanPlateAssignments:upsert`, `database:graviscanPlateAssignments:upsertMany`
- `database:graviPlateAccessions:list`

### 3. Bug #154 fix: write post-rename path at DB record creation time

The pilot's `useScanSession.onScanComplete` callback creates GraviScan DB records. The `onGridComplete` callback then updates records with `scan_ended_at` timestamps and renamed file paths via `graviscans.updateGridTimestamps`. This means the correct (post-rename) path is written to the DB via the update, not at initial creation.

Our fix: ensure `updateGridTimestamps` receives the renamed file paths from the `grid-complete` event's `renamedFiles` array and updates `GraviImage.path` accordingly. The `resolveGraviScanPath()` fallback is kept for pre-fix scans with a warning log.

### 4. Bug #159 fix: readiness gate built into GraviScan.tsx

The `canStartScan` computed value in GraviScan.tsx requires:
- `useScannerConfig`: `sessionValidated === true` and `configStatus === 'valid'`
- `usePlateAssignments`: at least one plate selected per enabled scanner
- `useScanSession`: no scan currently in progress
- Required metadata: experiment and phenotyper selected

Note: `validateScanners()` checks USB presence, not SANE initialization. SANE init happens inside `startScan()`. If SANE fails, `startScan()` returns `{ success: false, error }` and the UI shows the error. A "connecting to scanners..." loading state is shown between button click and scan start.

### 5. Separate Metadata page with plate-grid editor

GraviScan metadata is plate-level (barcode, transplant date, custom note per plate position × scanner). With 4grid × 2 scanners = up to 8 assignments. The `usePlateAssignments` hook manages this state and persists via `graviscanPlateAssignments.upsertMany`. The Metadata page is a dedicated workflow step, not inline on the scanning page.

### 6. DB record creation in the main process (deviating from pilot)

The pilot puts DB writes in renderer hooks (`useScanSession.onScanComplete`). This creates a crash-safety risk: if the renderer crashes during a long-running continuous scan, all cycles that complete afterward produce images on disk but zero DB records (#195).

CylinderScan avoids this by creating records in the main process (`scanner-process.ts:saveScanToDatabase()`). **We follow the CylinderScan pattern**, not the pilot:

- **Main process** creates DB records via a new `scan-persistence.ts` module in `src/main/graviscan/`:
  - `grid-complete` event → create `GraviScan` + `GraviImage` records (with post-rename paths from `renamedFiles`, fixing #154)
  - Scan start (in `session-handlers.ts`) → create `GraviScanSession` record
  - Scan end → call `graviscanSessions.complete`
- **Renderer hooks** (`useScanSession`) read and display status via `getScanStatus` and event listeners, but do NOT write to DB
- The `register-handlers.ts` already has `db` (Prisma client) access — persistence wires through there
- This eliminates the #154 fix as a separate concern: records are created with correct post-rename paths from the start

**Persistence wiring pattern (follows existing `setupCoordinatorEventForwarding` pattern):** Rather than modifying `startScan`'s signature, persistence is wired as a parallel setup function in `wiring.ts`:

```
setupCoordinatorPersistence(coordinator, db, sessionFns)
```

This mirrors how `setupCoordinatorEventForwarding(coordinator, getMainWindow)` works — a discrete setup step called when the coordinator is created in `getOrCreateCoordinator()`. The persistence function registers listeners on the coordinator for `grid-complete` (create GraviScan + GraviImage records) and session lifecycle events (create/complete GraviScanSession). It reads session metadata from `sessionFns.getScanSession()` which is already populated by `startScan`.

This is consistent with CylinderScan where `scanner-process.ts` calls `getDatabase()` directly rather than receiving `db` via injection. No existing handler signatures are changed.

**Metadata context sharing:** Both `scan-persistence.ts` (on `grid-complete`) and the metadata.json writer (before scan, in `scanOnce`) need session metadata (experiment_id, phenotyper_id, wave_number, etc.) that the coordinator doesn't have. Define a `GraviScanMetadataContext` interface containing these shared fields. The session handler populates it at scan start and stores it alongside `ScanSessionState` via `sessionFns`. Both the persistence module and metadata writer read from this context via `sessionFns.getScanSession()`.

**Alternatives considered:** Follow the pilot pattern (renderer writes) — rejected because it introduces a known data loss risk for unattended overnight scans, and the CylinderScan main-process pattern is already proven.

**Upcoming simplification:** Ben is planning to remove the row-merge scan pattern (`refactor/remove-row-merge-scan`, per #195 comment). This eliminates the `_et_` rename step entirely — files are saved with both timestamps at creation. When that PR lands, `scan-persistence.ts` simplifies: listen to `scan-complete` (per plate) instead of `grid-complete` (per row), and remove rename-path handling. Our current design works correctly with or without the rename step — the simplification is additive, not a redesign.

### 7. metadata.json for GraviScan

GraviScan metadata.json includes: `metadata_version`, `scan_type` ("graviscan"), `experiment_id`, `phenotyper_id`, `scanner_id`, `scanner_name`, `grid_mode`, `resolution_dpi`, `format`, `plate_index`, `plate_barcode`, `transplant_date`, `custom_note`, `wave_number`, `cycle_number`, `session_id`, `scan_started_at`, `capture_date`, and for interval scans: `interval_seconds`, `duration_seconds`. Written before image capture begins.

### 8. ESLint override for renderer graviscan imports

The `no-restricted-imports` rule blocks `**/graviscan/**` imports. Add overrides for:
- `src/renderer/graviscan/**` (pages can import from graviscan/)
- `src/components/graviscan/**` (components can import from graviscan/)
- `src/renderer/App.tsx` (router imports page components)

### 9. Test strategy

- **Unit tests (Vitest):** Each of the 7 hooks tested with mocked IPC. Test state transitions, error handling, cleanup, event listener lifecycle.
- **Component tests (Vitest + @testing-library/react):** Key interactive components (plate grid editor, scan control buttons).
- **E2E tests (Playwright):** Full page workflows with `GRAVISCAN_MOCK=true` + `SCANNER_MODE=graviscan`.
- **Test fixtures:** `tests/fixtures/graviscan.ts` factory functions. `tests/unit/setup.ts` updated with `gravi` + GraviScan DB mock namespace.
- **Check gates:** Run `npm run test:unit && npx tsc --noEmit && npm run lint` after each vertical slice.

## Risks / Trade-offs

- **Risk:** Pilot hooks are 3,300 lines of untested code (only 2 test files exist). Adaptation may reveal bugs. **Mitigation:** TDD — write tests first for each hook before adapting, using the pilot code as implementation reference.
- **Risk:** Main-process crash during overnight scan loses both DB writes and coordinator state. **Mitigation:** metadata.json is written before each grid scan (Section 8b), providing a durable fallback record on disk independent of the DB. The scan-logger also persists an audit trail to `~/.bloom/logs/`.
- **Risk:** CylinderScan pages remain flat in `src/renderer/` while GraviScan pages are in a subdirectory. **Mitigation:** CylinderScan restructure is a separate planned increment.
- **Risk:** `transplantDate` and `customNote` are hardcoded to null in `session-handlers.ts:114-115`. **Mitigation:** Fix during hook adaptation — pass plate metadata from `startScan` params into session jobs.

## Open Questions

- Should the Metadata page pre-populate plate assignments from a previous scan session?
- Should BrowseGraviScans group by session or show a combined timeline? (Pilot groups by session)
