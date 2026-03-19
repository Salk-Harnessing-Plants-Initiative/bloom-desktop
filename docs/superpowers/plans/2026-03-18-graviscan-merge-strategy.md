# GraviScan PR #123 — Incremental Merge Strategy

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split PR #123 (feature/graviscan, ~20K LOC, 105 files) into a series of small, independently-mergeable PRs that can each pass CI, maintain scientific validity, and not break the existing CylinderScan workflow.

**Architecture:** GraviScan is a multi-scanner plant phenotyping system. It adds: 17 Prisma migrations, a Python SANE subprocess worker, 13 new IPC handlers, a scan coordinator, 6 React hooks, 8+ components, cloud backup (Box/Supabase), and multi-mode packaging (GraviScan/CylinderScan/Full). The merge order respects the dependency graph: schema → types → backend → main process → renderer.

**Tech Stack:** Electron + React + TypeScript + Prisma + Python (SANE/TWAIN) + Vitest + Playwright + PyInstaller

**Base branch:** `dev` (PR #123 targets `dev`, not `main`)

---

## Platform Strategy: SANE/TWAIN Scanner Access

### What is SANE?

SANE (Scanner Access Now Easy) is the standard scanner API on Linux/Unix. It has no Windows support — Windows uses TWAIN instead.

### Platform Support Matrix

| Platform | Scanner Backend | Status in PR | CI Testing | Lab Use |
|----------|----------------|-------------|------------|---------|
| **Linux** | SANE (python-sane + libsane-dev) | ✅ Fully implemented | ✅ Unit + integration + E2E | Primary lab machines |
| **macOS** | None (mock mode only) | ✅ Mock mode works | ✅ Mock-mode tests only | Development only |
| **Windows** | TWAIN (pytwain) | ❌ Not yet implemented | ✅ Mock-mode tests only | Future phase |

### CI Strategy for SANE Tests

1. **Python SANE unit tests** — Linux only (requires `libsane-dev` system package)
2. **Mock-mode subprocess tests** — All 3 platforms (no real scanner hardware)
3. **Integration tests** (IPC ↔ subprocess) — All 3 platforms with mock mode
4. **E2E tests** — All 3 platforms with mock mode, Linux with SANE if possible

### Recommendation

- **Phase 1 (this epic):** Linux-first. Full SANE support. Mock mode on macOS/Windows.
- **Phase 2 (future):** Windows TWAIN implementation via pytwain.
- **Phase 3 (future):** macOS ImageCapture or SANE backend exploration.

---

## Dependency Graph (Merge Order)

```
PR 1: Schema + Migrations
  ↓
PR 2: CI & Build Infrastructure
  ↓
PR 3: Types + Python SANE Backend
  ↓
PR 4: Main Process — Core IPC, Subprocess, Detection
  ↓
PR 5: Main Process — Cloud Backup & Upload
  ↓
PR 6: Renderer — Hooks & State Logic
  ↓
PR 7: Renderer — Components & Pages + E2E
```

Each PR below is independently mergeable and testable. Each includes the tests for its scope.

---

## PR 1: Database Schema & Migrations

**Why first:** Every other PR depends on the Prisma models. These are purely additive — no existing models are broken, only extended with new relations.

**Files:**
- Modify: `prisma/schema.prisma` (+167 lines — 8 new models, relation extensions on Experiment/Phenotyper/Accessions)
- Create: `prisma/migrations/20260131200258_add_graviscan_schema/migration.sql`
- Create: `prisma/migrations/20260210194821_add_graviscan_metadata/migration.sql`
- Create: `prisma/migrations/20260210200000_fix_section_mapping_unique_constraint/migration.sql`
- Create: `prisma/migrations/20260215231329_add_graviscan_session/migration.sql`
- Create: `prisma/migrations/20260220001320_add_scanner_display_name/migration.sql`
- Create: `prisma/migrations/20260224000936_add_scan_grid_timestamps/migration.sql`
- Create: `prisma/migrations/20260224014007_update_default_format_tiff/migration.sql`
- Create: `prisma/migrations/20260303234006_add_graviscan_wave_number/migration.sql`
- Create: `prisma/migrations/20260306060615_add_plate_metadata_columns/migration.sql`
- Create: `prisma/migrations/20260306063803_add_metadata_to_gravi_plate_accession/migration.sql`
- Create: `prisma/migrations/20260312000000_add_wave_number_to_gravi_plate_accession/migration.sql`
- Create: `prisma/migrations/20260313000000_add_box_status_to_gravi_image/migration.sql`
- Create: `prisma/migrations/20260313100000_schema_cleanup/migration.sql`
- Create: `prisma/migrations/20260313200000_rename_plant_barcode_to_plate_barcode/migration.sql`
- Modify: `prisma/seed.ts` (+2 lines)

### Tasks

- [ ] **Step 1: Cherry-pick schema changes from feature/graviscan**

```bash
git checkout dev
git checkout -b graviscan/01-schema
git checkout feature/graviscan -- prisma/schema.prisma prisma/seed.ts
git checkout feature/graviscan -- prisma/migrations/20260131200258_add_graviscan_schema/
git checkout feature/graviscan -- prisma/migrations/20260210194821_add_graviscan_metadata/
git checkout feature/graviscan -- prisma/migrations/20260210200000_fix_section_mapping_unique_constraint/
git checkout feature/graviscan -- prisma/migrations/20260215231329_add_graviscan_session/
git checkout feature/graviscan -- prisma/migrations/20260220001320_add_scanner_display_name/
git checkout feature/graviscan -- prisma/migrations/20260224000936_add_scan_grid_timestamps/
git checkout feature/graviscan -- prisma/migrations/20260224014007_update_default_format_tiff/
git checkout feature/graviscan -- prisma/migrations/20260303234006_add_graviscan_wave_number/
git checkout feature/graviscan -- prisma/migrations/20260306060615_add_plate_metadata_columns/
git checkout feature/graviscan -- prisma/migrations/20260306063803_add_metadata_to_gravi_plate_accession/
git checkout feature/graviscan -- prisma/migrations/20260312000000_add_wave_number_to_gravi_plate_accession/
git checkout feature/graviscan -- prisma/migrations/20260313000000_add_box_status_to_gravi_image/
git checkout feature/graviscan -- prisma/migrations/20260313100000_schema_cleanup/
git checkout feature/graviscan -- prisma/migrations/20260313200000_rename_plant_barcode_to_plate_barcode/
```

- [ ] **Step 2: Verify Prisma generates correctly**

Run: `npx prisma generate`
Expected: No errors, Prisma client regenerates with new models

- [ ] **Step 3: Run migration verification**

Run: `npm run test:db-upgrade`
Expected: PASS — all migrations apply cleanly to a fresh database

- [ ] **Step 4: Run existing unit tests to confirm no regressions**

Run: `npm run test:unit`
Expected: All existing tests PASS

- [ ] **Step 5: Consider squashing 14 migrations into fewer logical groups**

**Decision point (non-blocking — default to keeping as-is if Ben is unavailable):** Discuss with Ben (PR author) whether to squash the 14 incremental migrations into 2-3 logical ones:
1. `add_graviscan_core_schema` (models: GraviScan, GraviScanner, GraviConfig, GraviImage, GraviScanSession)
2. `add_graviscan_metadata` (models: GraviPlateAccession, GraviPlateSectionMapping, GraviScanPlateAssignment)
3. `extend_existing_models` (Experiment.experiment_type, new relations)

This reduces migration chain risk but requires regenerating migration checksums.

- [ ] **Step 6: Commit and open PR**

```bash
git add prisma/
git commit -m "feat(db): add GraviScan schema models and migrations"
```

**Scientific validity check:** New models enforce metadata completeness — every GraviScan has grid_mode, resolution, plate_index, timestamps. GraviScanSession tracks interval_seconds and total_cycles for reproducibility. GraviPlateAccession links plates to accessions with wave_number for traceability.

---

## PR 2: CI & Build Infrastructure

**Why second:** Build infra changes are needed before new code can pass CI.

**Files:**
- Modify: `.github/workflows/pr-checks.yml` (+18 lines — NPM_TOKEN env vars)
- Modify: `forge.config.ts` (+109/-4 — APP_MODE multi-build, DEB deps, sharp bundling)
- Modify: `package.json` (+11/-1 — new scripts, electron-log dep, @salk-hpi/bloom-js bump)
- Modify: `package-lock.json` (+34/-4)
- Modify: `.npmrc` (+2 lines)
- Modify: `.gitignore` (+3 lines)
- Modify: `scripts/build-python.js` (+10/-2)
- Create: `assets/BloomGraviScanIcon.png`
- Create: `assets/BloomCylinderScanIcon.png`
- Create: `assets/BloomFullIcon.png`

### Tasks

- [ ] **Step 1: Cherry-pick CI and build changes**

```bash
git checkout dev
git checkout -b graviscan/02-ci-build
git checkout feature/graviscan -- .github/workflows/pr-checks.yml .npmrc .gitignore
git checkout feature/graviscan -- forge.config.ts package.json package-lock.json
git checkout feature/graviscan -- scripts/build-python.js
git checkout feature/graviscan -- assets/BloomGraviScanIcon.png assets/BloomCylinderScanIcon.png assets/BloomFullIcon.png
```

- [ ] **Step 2: Verify package.json changes don't include premature script references**

Review `package.json` — remove any scripts that reference files not yet merged (e.g., `test:graviscan-ipc`, `start:graviscan`). These come in later PRs. Keep only: dependency additions, `.npmrc`, `.gitignore`.

- [ ] **Step 3: Verify forge.config.ts APP_MODE defaults safely**

The `APP_MODE` env var must default to `full` (or the current mode) so that existing builds are not broken. Verify:
```typescript
const appMode = process.env.APP_MODE || 'full';
```

- [ ] **Step 4: Run npm ci and existing CI checks**

```bash
npm ci
npm run lint
npm run compile
npm run test:unit
```
Expected: All PASS

- [ ] **Step 5: Test packaging still works for default mode**

```bash
npm run package
```
Expected: Builds successfully with default (non-GraviScan) mode

- [ ] **Step 6: Commit and open PR**

```bash
git add .
git commit -m "chore(ci): add NPM_TOKEN, APP_MODE packaging, GraviScan build support"
```

---

## PR 3: Types + Python SANE Backend

**Why third:** The Python worker and TypeScript types are the shared contracts. They must exist before main-process handlers or renderer code.

**Files:**
- Create: `src/types/graviscan.ts` (306 lines — all GraviScan TypeScript types)
- Modify: `src/types/electron.d.ts` (+527/-24 — GraviScanAPI interface)
- Modify: `src/types/database.ts` (+14/-12)
- Create: `python/graviscan/__init__.py` (19 lines)
- Create: `python/graviscan/scan_worker.py` (725 lines — SANE scanner subprocess)
- Create: `python/graviscan/scan_regions.py` (213 lines — plate grid geometry)
- Create: `python/tests/test_scan_worker.py` (938 lines — comprehensive worker tests)
- Create: `python/tests/test_scan_regions.py` (195 lines — grid geometry tests)
- Create: `python/tests/test_scans.py` (empty — vestigial, can be removed)
- Create: `python/tests/test_tiff_metadata.py` (93 lines)
- Modify: `python/main.py` (+28/-3 — graviscan command routing)
- Modify: `python/ipc_handler.py` (+4 lines)
- Modify: `pyproject.toml` (+6/-1 — pillow, optional SANE/TWAIN deps)
- Modify: `python/main.spec` (+41 — graviscan hidden imports)

### Tasks

- [ ] **Step 1: Cherry-pick types**

```bash
git checkout dev
git checkout -b graviscan/03-types-python
git checkout feature/graviscan -- src/types/graviscan.ts src/types/electron.d.ts src/types/database.ts
```

- [ ] **Step 2: Trim electron.d.ts to only add type declarations**

The `electron.d.ts` changes include the full `GraviScanAPI` interface. Keep the type declarations but ensure they don't reference preload functions that don't exist yet. The types should compile even without the runtime implementation.

Run: `npx tsc --noEmit`
Expected: PASS (types are declarations only)

- [ ] **Step 3: Cherry-pick Python SANE worker**

```bash
git checkout feature/graviscan -- python/graviscan/ python/tests/test_scan_worker.py python/tests/test_scan_regions.py python/tests/test_tiff_metadata.py
git checkout feature/graviscan -- python/main.py python/ipc_handler.py
git checkout feature/graviscan -- pyproject.toml python/main.spec
```

Note: `python/tests/test_scans.py` from the PR is empty (0 lines) — it's vestigial. Do NOT cherry-pick it. The real tests are in `test_scan_worker.py` (938 lines) and `test_scan_regions.py` (195 lines).

- [ ] **Step 4: Review existing test coverage and fill gaps**

The PR includes substantial tests:
- `test_scan_worker.py` (938 lines) — covers IPC protocol, mock scanning, TIFF output, cancel, quit, error handling
- `test_scan_regions.py` (195 lines) — covers 2grid/4grid geometry, DPI conversion, coordinate validation
- `test_tiff_metadata.py` (93 lines) — covers metadata round-trip in TIFF ImageDescription

Review these for completeness. Identify any gaps (e.g., USB recovery paths, edge cases in row-merge optimization) and add tests as needed.

- [ ] **Step 5: Add SANE-specific CI job (Linux only)**

Add to `.github/workflows/pr-checks.yml`:

```yaml
  test-graviscan-python:
    name: "GraviScan Python Tests"
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v5
      - run: |
          sudo apt-get update
          sudo apt-get install -y libsane-dev sane-utils
      - run: uv sync --extra dev --extra graviscan-linux
      - run: uv run pytest python/tests/test_scan_worker.py python/tests/test_scan_regions.py python/tests/test_tiff_metadata.py -v --cov=python/graviscan --cov-fail-under=80
```

- [ ] **Step 6: Run Python tests**

```bash
uv sync --extra dev
uv run pytest python/tests/test_scan_worker.py python/tests/test_scan_regions.py python/tests/test_tiff_metadata.py -v
```
Expected: All PASS

- [ ] **Step 7: Run TypeScript compilation**

```bash
npx tsc --noEmit
```
Expected: PASS

- [ ] **Step 8: Commit and open PR**

```bash
git add .
git commit -m "feat(graviscan): add types, Python SANE worker, and scan region geometry"
```

**Scientific validity check:** scan_regions.py defines plate coordinates in mm with explicit DPI conversion. TIFF metadata embeds scan provenance (scanner ID, resolution, timestamp, grid mode) in ImageDescription for reproducibility. test_tiff_metadata.py validates metadata round-trip.

---

## PR 4: Main Process — Core IPC, Subprocess, Detection

**Why fourth:** The main process is the bridge between Python worker and renderer. It depends on types and Python backend.

**Files:**
- Create: `src/main/graviscan-handlers.ts` (1,225 lines — 10 IPC handlers)
- Create: `src/main/scan-coordinator.ts` (442 lines — multi-scanner orchestration)
- Create: `src/main/scanner-subprocess.ts` (301 lines — per-scanner Python process mgmt)
- Create: `src/main/lsusb-detection.ts` (209 lines — USB scanner enumeration)
- Create: `src/main/scan-logger.ts` (86 lines — persistent scan event log)
- Create: `src/main/graviscan-path-utils.ts` (50 lines — output directory formatting)
- Modify: `src/main/main.ts` (+346/-311 — handler registration, process lifecycle)
- Modify: `src/main/preload.ts` (+270/-11 — GraviScan API bridge)
- Modify: `src/main/config-store.ts` (+10/-1)
- Modify: `src/main/database.ts` (+115/-9)
- Modify: `src/main/database-handlers.ts` (+833/-124 — GraviScan DB operations)

### Tasks

- [ ] **Step 1: Cherry-pick main process files**

```bash
git checkout dev
git checkout -b graviscan/04-main-process
git checkout feature/graviscan -- src/main/graviscan-handlers.ts src/main/scan-coordinator.ts
git checkout feature/graviscan -- src/main/scanner-subprocess.ts src/main/lsusb-detection.ts
git checkout feature/graviscan -- src/main/scan-logger.ts src/main/graviscan-path-utils.ts
git checkout feature/graviscan -- src/main/main.ts src/main/preload.ts
git checkout feature/graviscan -- src/main/config-store.ts src/main/database.ts src/main/database-handlers.ts
```

- [ ] **Step 2: Review main.ts diff carefully**

`main.ts` has +346/-311 — this is a significant restructuring. Verify:
1. Existing IPC handlers (camera, DAQ, scanner, config, session, db) are preserved
2. New GraviScan handlers are registered additively
3. Process lifecycle (app.on('before-quit')) cleans up GraviScan subprocesses
4. No existing handler behavior is changed

- [ ] **Step 3: Review database-handlers.ts additions**

+833 lines is huge. Verify:
1. Existing 28 handlers are unchanged
2. New GraviScan handlers follow the same pattern (try/catch, DatabaseResponse<T>)
3. No `any` types in new handler signatures
4. All new handlers have typed input validation

- [ ] **Step 4: Write integration tests for GraviScan IPC**

Create: `tests/integration/test-graviscan-ipc.ts`

```typescript
// Test each new IPC handler with mock scanner subprocess
// Verify: detect-scanners, get-config, validate-config, get-scan-status,
//         mark-job-recorded, cancel-scan, get-output-dir, read-scan-image,
//         upload-all-scans, platform-info
```

- [ ] **Step 5: Update IPC coverage script**

Modify `scripts/check-ipc-coverage.py` to include GraviScan handlers. The 90% threshold applies to all handlers.

- [ ] **Step 6: Run all tests**

```bash
npm run test:unit
npm run test:python
npx tsc --noEmit
npm run lint
```
Expected: All PASS

- [ ] **Step 7: Commit and open PR**

```bash
git add .
git commit -m "feat(graviscan): add main process IPC handlers, scan coordinator, and subprocess management"
```

**Scientific validity check:** scan-coordinator.ts implements staggered scanner initialization to prevent SANE contention. Row-merge optimization for 4grid mode scans bounding box once and crops per-plate (reduces scan time by ~50%). All scan events are logged via scan-logger.ts for auditability.

---

## PR 5: Main Process — Cloud Backup & Upload

**Why separate:** Box backup (rclone) and Supabase upload are independently testable and have external service dependencies. Isolating them reduces risk.

**Files:**
- Create: `src/main/box-backup.ts` (497 lines — rclone-based Box backup)
- Create: `src/main/graviscan-upload.ts` (484 lines — Supabase metadata + image upload)
- Create: `src/renderer/contexts/UploadStatusContext.tsx` (50 lines)

### Tasks

- [ ] **Step 1: Cherry-pick backup/upload files**

```bash
git checkout dev
git checkout -b graviscan/05-cloud-backup
git checkout feature/graviscan -- src/main/box-backup.ts src/main/graviscan-upload.ts
git checkout feature/graviscan -- src/renderer/contexts/UploadStatusContext.tsx
```

- [ ] **Step 2: Write unit tests for backup logic**

Create: `tests/unit/box-backup.test.ts`
- Test: rclone command construction with correct paths
- Test: retry logic on transient failures
- Test: box_status state transitions (pending → uploading → uploaded/failed)

Create: `tests/unit/graviscan-upload.test.ts`
- Test: Supabase payload construction from GraviScan + GraviImage records
- Test: upload batch ordering (metadata before images)
- Test: error handling when Supabase is unreachable

- [ ] **Step 3: Run tests**

```bash
npm run test:unit
npx tsc --noEmit
```
Expected: All PASS

- [ ] **Step 4: Commit and open PR**

```bash
git add .
git commit -m "feat(graviscan): add Box backup (rclone) and Supabase upload pipeline"
```

---

## PR 6: Renderer — Hooks & State Logic

**Why before components:** Hooks contain the core business logic. Testing them in isolation (via renderHook) catches logic bugs before they're buried in UI.

**Files:**
- Create: `src/renderer/hooks/useScanSession.ts` (1,048 lines)
- Create: `src/renderer/hooks/useScannerConfig.ts` (610 lines)
- Create: `src/renderer/hooks/usePlateAssignments.ts` (318 lines)
- Create: `src/renderer/hooks/useContinuousMode.ts` (180 lines)
- Create: `src/renderer/hooks/useTestScan.ts` (225 lines)
- Create: `src/renderer/hooks/useWaveNumber.ts` (113 lines)
- Create: `src/renderer/utils/graviMetadataValidation.ts` (70 lines)

### Tasks

- [ ] **Step 1: Cherry-pick hooks**

```bash
git checkout dev
git checkout -b graviscan/06-renderer-hooks
git checkout feature/graviscan -- src/renderer/hooks/useScanSession.ts
git checkout feature/graviscan -- src/renderer/hooks/useScannerConfig.ts
git checkout feature/graviscan -- src/renderer/hooks/usePlateAssignments.ts
git checkout feature/graviscan -- src/renderer/hooks/useContinuousMode.ts
git checkout feature/graviscan -- src/renderer/hooks/useTestScan.ts
git checkout feature/graviscan -- src/renderer/hooks/useWaveNumber.ts
git checkout feature/graviscan -- src/renderer/utils/graviMetadataValidation.ts
```

- [ ] **Step 2: Review useScanSession.ts (1,048 lines — largest hook)**

This is the most complex piece. Check:
1. Cleanup functions in useEffect returns (clearTimeout, removeListener)
2. Race conditions between IPC polling and event listeners
3. Mounted flag usage to prevent state updates after unmount
4. jobKey deduplication logic (prevents double DB writes)

- [ ] **Step 3: Write unit tests for each hook**

Create: `tests/unit/hooks/useScanSession.test.ts`
Create: `tests/unit/hooks/useScannerConfig.test.ts`
Create: `tests/unit/hooks/usePlateAssignments.test.ts`
Create: `tests/unit/hooks/useContinuousMode.test.ts`
Create: `tests/unit/hooks/useTestScan.test.ts`
Create: `tests/unit/hooks/useWaveNumber.test.ts`
Create: `tests/unit/utils/graviMetadataValidation.test.ts`

Priority tests:
- `useContinuousMode`: Timer accuracy, cycle counting, countdown display
- `useWaveNumber`: Wave increment logic, persistence across sessions
- `usePlateAssignments`: Plate slot CRUD, barcode validation
- `graviMetadataValidation`: CSV schema validation, edge cases (empty, malformed, missing columns)

- [ ] **Step 4: Run tests**

```bash
npm run test:unit
npx tsc --noEmit
```
Expected: All PASS

- [ ] **Step 5: Commit and open PR**

```bash
git add .
git commit -m "feat(graviscan): add renderer hooks for scan session, scanner config, and plate management"
```

**Scientific validity check:** usePlateAssignments enforces barcode uniqueness per experiment. useWaveNumber auto-increments wave across continuous sessions, preventing accidental data overwrite. useScanSession prevents duplicate DB writes via jobKey deduplication.

---

## PR 7: Renderer — Components, Pages & E2E Tests

**Why last:** UI depends on all hooks, types, and IPC handlers being in place.

**Files:**
- Create: `src/renderer/GraviScan.tsx` (3,464 lines — main scanning page)
- Create: `src/renderer/BrowseGraviScans.tsx` (654 lines)
- Create: `src/renderer/ExperimentDetail.tsx` (475 lines)
- Create: `src/renderer/Metadata.tsx` (241 lines)
- Create: `src/renderer/Scanning.tsx` (67 lines)
- Create: `src/renderer/CylinderScan.tsx` (551 lines)
- Create: `src/renderer/BrowseCylinderScans.tsx` (32 lines)
- Create: `src/renderer/components/graviscan/ScannerConfigSection.tsx` (534 lines)
- Create: `src/renderer/components/graviscan/ScanFormSection.tsx` (335 lines)
- Create: `src/renderer/components/graviscan/ScanControlSection.tsx` (298 lines)
- Create: `src/renderer/components/graviscan/ConfigStatusBanner.tsx` (117 lines)
- Create: `src/renderer/components/GraviMetadataUpload.tsx` (647 lines)
- Create: `src/renderer/components/GraviMetadataList.tsx` (251 lines)
- Create: `src/renderer/components/ScanPreview.tsx` (357 lines)
- Create: `src/renderer/components/ScannerPanel.tsx` (145 lines)
- Create: `src/renderer/components/ImageLightbox.tsx` (98 lines)
- Modify: `src/renderer/App.tsx` (+11/-6 — new routes)
- Modify: `src/renderer/Layout.tsx` (+155/-13 — GraviScan nav entries)
- Modify: `src/renderer/Home.tsx` (+161/-39 — mode-aware home)
- Modify: `src/renderer/BrowseScans.tsx` (+39/-600 — refactored to CylinderScan-specific)
- Modify: `src/renderer/Experiments.tsx` (+23/-6)
- Modify: `src/renderer/MachineConfiguration.tsx` (+49/-46)
- Modify: `src/renderer/components/ExperimentForm.tsx` (+41/-2)
- Modify: `src/renderer/components/ExperimentChooser.tsx` (+1/-1)
- Modify: `src/renderer/components/PhenotyperChooser.tsx` (+1/-1)
- Delete: `src/renderer/Accessions.tsx` (-101 lines)
- Delete: `src/types/camera.ts` (-8 lines)
- Delete: `src/types/scanner.ts` (-4 lines)
- Delete: `python/hardware/camera.py` (-57 lines)
- Delete: `python/hardware/camera_mock.py` (-102 lines)
- Modify: `src/types/global.d.ts` (+1 line)
- Create: `tests/integration/test-graviscan-interactive.ts` (196 lines)
- Create: `tests/check-scan-intervals.js` (151 lines)
- Create: `tests/check-scans.js` (66 lines)
- Create: `scripts/fix-metadata-filepath.py` (85 lines — metadata path repair utility)
- Delete: `src/main/util.ts` (-15 lines)
- Create: `openspec/changes/add-usb-device-reset/proposal.md` (16 lines)
- Create: `openspec/changes/add-usb-device-reset/specs/scan-pipeline/spec.md` (37 lines)
- Create: `openspec/changes/add-usb-device-reset/tasks.md` (14 lines)
- Create: `openspec/changes/update-plant-accession-mappings-fields/proposal.md` (35 lines)
- Create: `openspec/changes/update-plant-accession-mappings-fields/tasks.md` (5 lines)

### Tasks

- [ ] **Step 1: Cherry-pick all remaining files**

```bash
git checkout dev
git checkout -b graviscan/07-renderer-ui
# Renderer pages and components
git checkout feature/graviscan -- src/renderer/GraviScan.tsx src/renderer/BrowseGraviScans.tsx
git checkout feature/graviscan -- src/renderer/ExperimentDetail.tsx src/renderer/Metadata.tsx
git checkout feature/graviscan -- src/renderer/Scanning.tsx src/renderer/CylinderScan.tsx src/renderer/BrowseCylinderScans.tsx
git checkout feature/graviscan -- src/renderer/components/graviscan/
git checkout feature/graviscan -- src/renderer/components/GraviMetadataUpload.tsx src/renderer/components/GraviMetadataList.tsx
git checkout feature/graviscan -- src/renderer/components/ScanPreview.tsx src/renderer/components/ScannerPanel.tsx
git checkout feature/graviscan -- src/renderer/components/ImageLightbox.tsx
# Modified existing files
git checkout feature/graviscan -- src/renderer/App.tsx src/renderer/Layout.tsx src/renderer/Home.tsx
git checkout feature/graviscan -- src/renderer/BrowseScans.tsx src/renderer/Experiments.tsx src/renderer/MachineConfiguration.tsx
git checkout feature/graviscan -- src/renderer/components/ExperimentForm.tsx src/renderer/components/ExperimentChooser.tsx src/renderer/components/PhenotyperChooser.tsx
git checkout feature/graviscan -- src/types/global.d.ts
# Tests and scripts
git checkout feature/graviscan -- tests/integration/test-graviscan-interactive.ts tests/check-scan-intervals.js tests/check-scans.js
git checkout feature/graviscan -- scripts/fix-metadata-filepath.py
# OpenSpec proposals
git checkout feature/graviscan -- openspec/changes/add-usb-device-reset/ openspec/changes/update-plant-accession-mappings-fields/
# Deletions
git rm src/renderer/Accessions.tsx src/types/camera.ts src/types/scanner.ts python/hardware/camera.py python/hardware/camera_mock.py src/main/util.ts
```

- [ ] **Step 2: Review GraviScan.tsx (3,464 lines — needs splitting)**

**This file is too large.** It should be refactored into smaller, focused components during this PR. Recommended split:
- `GraviScan.tsx` → orchestrator (~500 lines, wires hooks to sub-components)
- Move inline logic into the existing sub-components in `components/graviscan/`
- This is a quality gate — do not merge a 3,464-line component

- [ ] **Step 3: Review file deletions carefully**

Files being deleted:
- `Accessions.tsx` — verify this page's functionality is preserved elsewhere
- `camera.ts`, `scanner.ts` (types) — verify no existing code references these
- `camera.py`, `camera_mock.py` — verify camera functionality still works

Run: `npx tsc --noEmit` to catch broken imports

- [ ] **Step 4: Write E2E tests for GraviScan workflow**

Create: `tests/e2e/graviscan-workflow.e2e.ts`

```typescript
// Mock mode E2E tests (no real scanner hardware)
test('GraviScan page loads and shows scanner detection', async () => { ... });
test('Configure scanners in 2grid mode', async () => { ... });
test('Start mock scan and see progress', async () => { ... });
test('Browse completed scans by experiment', async () => { ... });
test('Upload metadata CSV and verify plate assignments', async () => { ... });
```

- [ ] **Step 5: Run full test suite**

```bash
npm run lint
npx tsc --noEmit
npm run test:unit
npm run test:python
npm run test:e2e
npm run test:e2e:coverage  # IPC coverage must stay ≥90%
```
Expected: All PASS

- [ ] **Step 6: Commit and open PR**

```bash
git add .
git commit -m "feat(graviscan): add GraviScan UI, experiment browser, and E2E tests"
```

---

## Cross-Cutting Concerns

### Testing Coverage Requirements

| Layer | Framework | Threshold | What to Test |
|-------|-----------|-----------|-------------|
| Python SANE worker | pytest | 80% | Mock-mode scan, TIFF metadata, scan regions, IPC protocol |
| TypeScript types | tsc --noEmit | Compile | All new types compile, no `any` leaks |
| Main process handlers | Vitest integration | Per-handler | Each IPC handler: happy path + error path |
| Database handlers | Vitest integration | Per-handler | CRUD for all 8 new models |
| Renderer hooks | Vitest + RTL | Per-hook | State transitions, cleanup, edge cases |
| Metadata validation | Vitest | Per-function | CSV parsing, schema validation, error messages |
| E2E workflow | Playwright | Per-flow | Mock scan, browse, metadata upload |
| IPC coverage | check-ipc-coverage.py | 90% | All new GraviScan handlers tested in E2E |

### CI Platform Matrix for GraviScan

| CI Job | Linux | macOS | Windows | Notes |
|--------|-------|-------|---------|-------|
| Python SANE tests | ✅ Real SANE | ❌ Skip | ❌ Skip | Needs libsane-dev |
| Python mock tests | ✅ | ✅ | ✅ | No system deps |
| TIFF metadata tests | ✅ | ✅ | ✅ | Pillow only |
| Integration (IPC) | ✅ | ✅ | ✅ | Mock subprocess |
| E2E (mock mode) | ✅ | ✅ | ✅ | No real scanner |
| Packaging | ✅ DEB with libsane | ✅ DMG | ✅ Squirrel | Platform-specific |

### File Deletions Requiring Verification

| Deleted File | Lines | Verify Before Deleting |
|-------------|-------|----------------------|
| `src/renderer/Accessions.tsx` | 101 | Functionality moved to new accession management |
| `src/types/camera.ts` | 8 | Types merged into existing type files |
| `src/types/scanner.ts` | 4 | Types merged into existing type files |
| `python/hardware/camera.py` | 57 | Camera module still works without this |
| `python/hardware/camera_mock.py` | 102 | Mock camera still available elsewhere |
| `src/main/util.ts` | 15 | Verify no existing code imports from this file |

### Known Issues in PR #123 to Fix During Split

1. **`python/tests/test_scans.py` is empty** — vestigial file (0 lines). Real tests exist in `test_scan_worker.py` (938 lines) and `test_scan_regions.py` (195 lines). Remove the empty file.
2. **`GraviScan.tsx` is 3,464 lines** — needs refactoring into smaller components (PR 7).
3. **No unit tests for renderer hooks** — 2,494 LOC of hooks with 0 unit tests (PR 6).
4. **No E2E tests** — `tests/integration/test-graviscan-interactive.ts` is manual, not CI (PR 7).
5. **Windows TWAIN not implemented** — pytwain dependency declared but no code (documented, future phase).
6. **14 incremental migrations** — consider squashing for cleaner history (PR 1).
7. **`CLAUDE.md` changes in PR should not be merged** — this project uses OpenSpec; CLAUDE.md is managed by `openspec update`.

---

## Epic Issue Structure

The GitHub epic issue should be created with this sub-issue structure:

```
Epic: Merge GraviScan (#123) — Incremental Integration
├── #A: Database schema & migrations
├── #B: CI & build infrastructure (APP_MODE, NPM_TOKEN, icons)
├── #C: Types + Python SANE backend + tests
├── #D: Main process — IPC handlers, coordinator, subprocess
├── #E: Main process — Box backup & Supabase upload
├── #F: Renderer — hooks & state logic + unit tests
└── #G: Renderer — components, pages, routes + E2E tests
```

Each sub-issue should link back to the epic and reference the corresponding section of this plan.
