## Why

The GraviScan backend is complete through Increment 3c (IPC handlers wired, coordinator operational, preload bridge exposing 15 invoke + 12 event listener methods). However, the renderer has zero GraviScan-specific pages, hooks, or components. Users in GraviScan mode see shared pages (Scientists, Phenotypers, Experiments) but cannot configure scanners, assign plate metadata, start scans, or browse GraviScan results.

Ben's pilot branch (`origin/graviscan/6-renderer-hooks`) contains 7 hook files (~3,300 lines) that implement the GraviScan renderer business logic. These hooks call IPC channels and DB CRUD operations that don't exist on our `main` branch yet. This proposal ports those hooks using the same cherry-pick-and-adapt pattern used in Increments 3a-3c, adds the missing data persistence layer, builds UI pages on top, and fixes two bugs (#159, #154).

## What Changes

### Layer 0: Data Persistence (missing infrastructure)

- **GraviScan DB persistence module** `src/main/graviscan/scan-persistence.ts` — creates GraviScan, GraviImage, and GraviScanSession records in the **main process** on coordinator events (following CylinderScan's `scanner-process.ts:saveScanToDatabase()` pattern, NOT the pilot's renderer-side writes). Fixes #195.
- **GraviScan DB CRUD handlers** in `src/main/database-handlers.ts` — IPC handlers for read operations and plate assignments: `graviscans.list`, `graviscans.getMaxWaveNumber`, `graviscans.checkBarcodeUniqueInWave`, `graviscanPlateAssignments.list/upsert/upsertMany`, `graviPlateAccessions.list`
- **Preload bridge** additions in `src/main/preload.ts` — expose DB read operations + plate assignment CRUD under `database.graviscans.*`, `database.graviscanPlateAssignments.*`, `database.graviPlateAccessions.*`
- **Type definitions** in `src/types/electron.d.ts` and `src/types/database.ts` — strongly-typed GraviScan database API interfaces
- **ESLint override** in `.eslintrc.json` — add `src/renderer/graviscan/**` and `src/components/graviscan/**` to allow imports from graviscan directories

### Layer 1: Hooks (cherry-pick from pilot, adapt + test)

- **useScannerConfig** (610 lines) — scanner detection, SANE name mapping, config persistence
- **useScanSession** (1,048 lines) — scan lifecycle, IPC event subscriptions, status display, auto-upload trigger
- **usePlateAssignments** (318 lines) — per-scanner plate barcode management, experiment accession lookup
- **useContinuousMode** (180 lines) — interval timing, countdown/overtime UI timers
- **useTestScan** (225 lines) — single-plate test scan workflow for scanner alignment verification
- **useWaveNumber** (113 lines) — wave tracking across continuous sessions, barcode uniqueness per wave
- **graviMetadataValidation** (70 lines) — metadata CSV schema validation utility

### Layer 2: UI Pages + Components

- **ScannerConfig page** (`src/renderer/graviscan/ScannerConfig.tsx`)
- **Metadata page** (`src/renderer/graviscan/Metadata.tsx`) — plate-grid editor
- **GraviScan scanning page** (`src/renderer/graviscan/GraviScan.tsx`) — **fixes #159** with readiness gate
- **BrowseGraviScans page** (`src/renderer/graviscan/BrowseGraviScans.tsx`)

### Layer 3: Integration

- **Routes and navigation** — GraviScan-conditional routes in App.tsx, nav links in Layout.tsx, workflow step routes in WorkflowSteps.tsx
- **Bug fix #154** — resolved by main-process persistence: records are created with post-rename (`_et_`) paths from `grid-complete` event data (no separate fix needed)
- **Bug fix #159** — Start Scan button gated on scanner validation + config validation + metadata filled + no scan in progress

### Testing

- **Test fixtures** — `tests/fixtures/graviscan.ts` factory functions, IPC mock helpers, sample TIFF images
- **Unit tests** — each hook tested with mocked `window.electron.gravi` and `window.electron.database` namespaces
- **E2E tests** — Playwright tests for each page using `GRAVISCAN_MOCK=true` + `SCANNER_MODE=graviscan`

## Impact

- Affected specs: `scanning` (GraviScan renderer requirements)
- Affected code:
  - NEW: `src/renderer/graviscan/` (4 pages), `src/renderer/hooks/` (7 hooks), `src/renderer/utils/` (1 utility), `src/components/graviscan/` (reusable components)
  - NEW: `src/main/graviscan/scan-persistence.ts` (main-process DB record creation on coordinator events)
  - MODIFIED: `src/main/database-handlers.ts` (GraviScan DB read ops + plate assignment CRUD), `src/main/preload.ts` (database namespace additions), `src/types/electron.d.ts` (typed GraviScan DB API), `src/types/database.ts` (GraviScan create/filter types)
  - MODIFIED: `src/renderer/App.tsx` (routes), `src/renderer/Layout.tsx` (nav), `src/renderer/components/WorkflowSteps.tsx` (step routing), `src/renderer/Home.tsx` (workflow step routes)
  - MODIFIED: `.eslintrc.json` (renderer graviscan override)
  - MODIFIED: `src/main/graviscan/scan-coordinator.ts` (accept metadata context for metadata.json writer — task 8b.5), `src/main/graviscan/wiring.ts` (wire `setupCoordinatorPersistence` alongside event forwarding in `getOrCreateCoordinator`), `src/main/graviscan/session-handlers.ts` (fix null transplantDate/customNote), `src/main/graviscan-path-utils.ts` (fallback warning log)
  - NEW: `tests/fixtures/graviscan.ts`, `tests/unit/hooks/*.test.ts`, `tests/unit/graviMetadataValidation.test.ts`, `tests/e2e/graviscan-*.e2e.ts`
  - MODIFIED: `tests/unit/setup.ts` (add `gravi` + GraviScan DB mock namespace)
- Related issues: #132 (fully addressed — all 7 hooks), #133 (partially addressed — 4 pages + routing; remaining ~9 components, file deletions, BrowseScans refactor, ExperimentDetail page deferred to subsequent increment), #159 (fully addressed), #154 (fully addressed), #194 (metadata.json writer — fully addressed in Section 8b), #195 (main-process DB persistence — fully addressed in Section 1)
- Related (referenced, not fixed): #158 (folder organization), #162 (QR scoping — may cause false warnings in multi-experiment usage until fixed), #164 (per-wave metadata uploads), #167 (stale scanners), #168 (per-scanner reconnect), #177 (1200 DPI failure), #185 (parallel init), #187 (async fs), #188 (subprocess state edge cases), #192 (post-shutdown coordinator guard), #193 (duplicate events)
- Depends on: Increment 3c (PR #191, merged)
