# GraviScan Integration — Design Spec

**Date**: 2026-04-03
**Branch**: TBD (will be created per increment)
**Status**: Draft (v3 — all review findings addressed)

## Problem

bloom-desktop is a single-mode CylinderScan application. It needs to support a second data acquisition mode — GraviScan (multi-scanner flatbed phenotyping) — while preserving all existing CylinderScan functionality. A 20K LOC feature branch exists (split across 20 PRs by Ben) but has structural issues: broken PR stacking, god-files, missing unit tests, and no clear separation between shared and mode-specific code. The current PRs also propose a build-time mode selection (`APP_MODE`) that adds packaging complexity.

## Goals

1. Integrate GraviScan into bloom-desktop as a second scanner mode
2. Maintain clear code boundaries so mode-specific code can be excluded from builds in Phase 2
3. Preserve all existing CylinderScan functionality — zero regressions
4. Follow project conventions: OpenSpec proposals, TDD, full test coverage, code review
5. One build artifact (for now) with runtime mode selection via Machine Config

## Non-Goals

- Phase 2 build-time mode stripping (design for it, don't implement it yet)
- Windows TWAIN scanner support (future phase)
- macOS scanner support beyond mock mode
- Refactoring existing CylinderScan code that doesn't need to move

## Architecture

### Scanner Mode

- Mode is a **file-based machine config field** in `~/.bloom/.env` (`SCANNER_MODE=cylinderscan|graviscan`)
- Set during Machine Config wizard on first run (required — no default)
- Changeable by admin via Machine Config page
- Machine Config wizard text makes clear this is "What scanner hardware is attached to this machine?" — it's a **hardware identity**, not a user preference
- Mode determines: visible capture/config routes, nav items, available IPC handlers
- **Browse/view routes are ALWAYS visible** regardless of mode — scientists must be able to view historical scans from either mode even after switching. Nav links for browse show conditionally based on whether data exists for that mode (e.g., "Browse GraviScans" only appears after GraviScan data is created).
- **`useAppMode()` must gate rendering** — mode is fetched async via IPC. The app shows a loading state until mode resolves. `<Routes>` are NOT rendered until mode is known. This prevents flash-of-wrong-routes on startup.

### Data Integrity on Mode Switch

When an admin switches scanner mode:
- All existing scans (CylinderScan and GraviScan) remain in the database
- Browse routes for BOTH modes are always accessible (read-only)
- Only capture/config routes are mode-gated
- `experiment_type` field on Experiment prevents cross-mode scan creation:
  - Creating a scan validates that `experiment.experiment_type` matches the active mode
  - Existing experiments (pre-integration) are backfilled with `experiment_type = 'cylinderscan'` via migration

### Directory Structure — One-Way Dependencies

```
src/
├── main/
│   ├── [shared files stay at root: database.ts, python-process.ts, etc.]
│   ├── cylinderscan/     # camera-process, daq-process, scanner-process
│   └── graviscan/        # handlers (split into 4 modules), scan-coordinator, scanner-subprocess
├── renderer/
│   ├── [shared pages stay at root: Home, Scientists, Experiments, etc.]
│   ├── cylinderscan/     # CaptureScan, CameraSettings, BrowseCylinderScans
│   └── graviscan/        # GraviScan, ScannerConfig, BrowseGraviScans, Metadata
├── components/
│   ├── [shared components stay at root: Streamer, PlantBarcodeInput, etc.]
│   └── graviscan/        # ScannerPanel, ScanControlSection, ConfigStatusBanner
├── types/
│   ├── [shared types stay at root: database.ts, camera.ts, electron.d.ts]
│   └── graviscan.ts      # GraviScan-specific types
└── utils/                # All shared

python/
├── hardware/             # Shared (camera) + CylinderScan (DAQ, scanner)
├── graviscan/            # SANE worker, scan_regions (isolated)
├── ipc_handler.py        # Shared protocol + conditional command routing
└── main.py               # Entry point
```

**Critical rule**: Shared code NEVER imports from `cylinderscan/` or `graviscan/` directories. The dependency arrow is strictly one-way: mode-specific → shared. **Enforced by ESLint `no-restricted-imports` rule** added in Increment 0a:

```json
{
  "no-restricted-imports": ["error", {
    "patterns": [
      { "group": ["**/cylinderscan/**"], "message": "Shared code must not import from cylinderscan/" },
      { "group": ["**/graviscan/**"], "message": "Shared code must not import from graviscan/" }
    ]
  }]
}
```

Note: This rule applies to files OUTSIDE `cylinderscan/` and `graviscan/` directories. Files within those directories may import from shared code freely. The ESLint override structure handles this.

**Handler registration**: `registerGraviScanHandlers()` and `registerCylinderScanHandlers()` are defined in their respective mode directories (`src/main/graviscan/handlers.ts`, `src/main/cylinderscan/handlers.ts`). They are NOT added inside `database-handlers.ts`. The shared `main.ts` imports and calls them conditionally.

### Mode-Conditional Registration

**Main process (`main.ts`):**
```typescript
import { registerSharedHandlers } from './database-handlers';
import { registerCylinderScanHandlers } from './cylinderscan/handlers';
import { registerGraviScanHandlers } from './graviscan/handlers';

const mode = await getConfiguredMode(); // reads from .env config
registerSharedHandlers(ipcMain);

if (mode === 'cylinderscan' || mode === 'full') {
  registerCylinderScanHandlers(ipcMain);
}
if (mode === 'graviscan' || mode === 'full') {
  registerGraviScanHandlers(ipcMain);
}
```

**Renderer (`App.tsx`):**
```tsx
const { mode } = useAppMode(); // reads from main via IPC

<Routes>
  {/* Shared routes — always visible */}
  <Route path="/" element={<Home />} />
  <Route path="/scientists" element={<Scientists />} />
  <Route path="/experiments" element={<Experiments />} />
  ...

  {/* Browse routes — ALWAYS visible (read-only, mode-independent) */}
  <Route path="/browse-scans" element={<BrowseCylinderScans />} />
  <Route path="/scan/:scanId" element={<ScanPreview />} />
  <Route path="/browse-graviscan" element={<BrowseGraviScans />} />

  {/* CylinderScan capture routes — conditional */}
  {(mode === 'cylinderscan' || mode === 'full') && (
    <>
      <Route path="/capture-scan" element={<CaptureScan />} />
      <Route path="/camera-settings" element={<CameraSettings />} />
    </>
  )}

  {/* GraviScan capture routes — conditional */}
  {(mode === 'graviscan' || mode === 'full') && (
    <>
      <Route path="/graviscan" element={<GraviScan />} />
      <Route path="/scanner-config" element={<ScannerConfig />} />
    </>
  )}

  {/* Catch-all redirect for removed routes after mode switch */}
  <Route path="*" element={<Navigate to="/" />} />
</Routes>
```

### Phase 2 Strategy (Design for Now, Implement Later)

Phase 2 will use **`APP_MODE` via webpack `DefinePlugin`** as a build-time constant, NOT runtime tree-shaking. This is required because:

- Webpack cannot tree-shake runtime conditionals (`if (mode === 'graviscan')`)
- Main process code (handlers, preload) needs build-time exclusion, not just code splitting
- `React.lazy()` achieves renderer code splitting (separate chunks) but not elimination from the package

Phase 2 changes (NOT implemented now, but the architecture supports them):
- `webpack.main.config.ts`: Add `DefinePlugin({ 'process.env.APP_MODE': JSON.stringify(appMode) })`
- Conditional imports become dead code that webpack eliminates
- `preload.ts`: Separate entry points per mode, or build-flag-gated namespace registration
- `python/`: Two `.spec` files (`bloom-hardware.spec`, `bloom-graviscan.spec`) producing separate executables
- `forge.config.ts`: Mode-specific icons, app names, DEB dependencies, conditional `extraResource` entries per binary

### Phase 1 Packaging Notes

- **Single Python binary** (`bloom-hardware`) ships with all dependencies (pypylon, nidaqmx, python-sane). Expected size increase: ~5-15 MB for SANE bindings. Acceptable for Phase 1.
- **Linux DEB**: Phase 1 does NOT declare `libsane-dev` as a dependency. GraviScan on Linux requires manual `sudo apt install libsane-dev`. This is documented in the GraviScan setup guide. Phase 2 adds conditional DEB dependencies per mode.
- **macOS/Windows**: SANE is unavailable. The import guard (`except (ImportError, OSError)`) ensures the binary starts successfully. GraviScan runs in mock mode only on these platforms.

### Python Backend

**One executable (`bloom-hardware`)** with guarded imports:

```python
# python/ipc_handler.py
def handle_command(cmd):
    command = cmd.get("command")
    if command == "camera":
        handle_camera_command(cmd)      # shared
    elif command == "daq":
        handle_daq_command(cmd)         # cylinderscan
    elif command == "scanner":
        handle_scanner_command(cmd)     # cylinderscan
    elif command == "graviscan":
        handle_graviscan_command(cmd)   # graviscan (new)
```

**SANE import guard** must catch both `ImportError` and `OSError` (the C extension throws `OSError` on macOS/Windows where `libsane` is missing):

```python
try:
    import sane
    SANE_AVAILABLE = True
except (ImportError, OSError):
    SANE_AVAILABLE = False
```

### Database Schema

- Existing CylinderScan models (`Scan`, `Image`) remain unchanged
- New GraviScan models (`GraviScan`, `GraviScanner`, `GraviConfig`, `GraviImage`, etc.) are additive
- `Experiment` gets `experiment_type` field — **NOT optional**: existing experiments backfilled with `'cylinderscan'` via migration. The backfill migration includes a comment: "All existing experiments are CylinderScan — bloom-desktop has only supported CylinderScan prior to this migration."
- Machine config gets `SCANNER_MODE` field in `.env`
- Migrations written from scratch (NOT cherry-picked from Ben's branch) by diffing his final schema against current main. Devs who ran Ben's branch migrations must run `prisma migrate reset`.

### On-Disk Metadata

Both modes write a `metadata.json` per scan. The file includes a `scan_type` field (`'cylinderscan'` or `'graviscan'`) and `metadata_version` so analysis code can distinguish scan types from the filesystem alone without database access. Mode-specific metadata fields differ (CylinderScan: `num_frames`, `seconds_per_rot`, exposure/gain; GraviScan: `grid_mode`, `resolution_dpi`, `interval_seconds`) but common fields are shared (`experiment_id`, `scanner_name`, `plant_id`, `accession_name`, `wave_number`, `capture_date`).

### Shared Infrastructure

These files are extended but not restructured:

| File | Extension |
|------|-----------|
| `preload.ts` | Adds `gravi` namespace to context bridge |
| `electron.d.ts` | Adds GraviScan API types |
| `database-handlers.ts` | Adds GraviScan CRUD handlers |
| `Layout.tsx` | Nav items conditional on mode (capture only; browse always visible) |
| `Home.tsx` | Mode-aware landing page |
| `MachineConfiguration.tsx` | Scanner mode selector (hardware identity question) + mode-specific config sections |
| `config-store.ts` | `SCANNER_MODE` field in `.env` + GraviScan-specific config fields |

### Upload / Cloud Backup

- Shared upload orchestration (batch upload, retry, status tracking)
- Mode-specific metadata builders (`CylImageMetadata` vs `GraviImageMetadata`)
- GraviScan adds Box backup via rclone (new, not shared with CylinderScan)
- Supabase metadata upload is GraviScan-specific (for now)

## Integration Order

New PRs that cherry-pick, restructure, and properly test Ben's work.

### Increment 0a: Directory Restructure (Pure Refactor)

**New PR.** No functional changes.

- Move `camera-process.ts`, `daq-process.ts`, `scanner-process.ts` into `src/main/cylinderscan/`
- Update all 12 import statements across 7 files (including `main.ts` and 6 test files)
- Add ESLint `no-restricted-imports` rule to enforce one-way dependency boundaries
- All existing tests must pass — this is a pure rename/move
- OpenSpec proposal required

### Increment 0b: Mode Config + Conditional Routing

**New PR.** Depends on 0a.

- Add `SCANNER_MODE` to config store (`.env` based)
- Add `SCANNER_MODE` to Machine Config wizard (required choice: "What scanner hardware is attached?")
- Add `useAppMode()` hook
- Make `App.tsx` capture routes conditional on mode (browse routes always visible)
- Make `Layout.tsx` nav conditional on mode
- Add `<Navigate to="/" />` catch-all for removed routes
- Update E2E test helper (`tests/e2e/helpers/bloom-config.ts`): update `createTestBloomConfig()` signature to accept optional `SCANNER_MODE` parameter (default: `'cylinderscan'`). Pre-seed in `.env` template.
- Add unit test for `useAppMode()` loading state: verify app shows loading indicator (not redirect to `/`) while mode is being fetched
- All existing tests must pass
- OpenSpec proposal required

### Increment 1: Schema + Migrations (can run in parallel with Increment 2)

**Write from scratch** using Ben's final schema as reference (NOT cherry-picked — avoids migration conflicts).

- Write 2-3 clean migrations from current main schema to target schema
- Add GraviScan Prisma models
- Add `experiment_type` field to Experiment — **backfill existing rows with `'cylinderscan'`**
- Add handler-level validation: scan creation asserts `experiment.experiment_type` matches active mode
- Migration verification tests
- Document: devs who ran Ben's branch migrations must `prisma migrate reset`
- OpenSpec proposal required

### Increment 2: Types + Python SANE Backend (can run in parallel with Increment 1)

**Cherry-pick from PR #137**, modified.

- `src/types/graviscan.ts` — GraviScan TypeScript types
- `python/graviscan/` — SANE worker, scan regions (already well-isolated)
- SANE import guard catches `(ImportError, OSError)` — safe on macOS/Windows
- Python tests (already good: 938 lines)
- PyInstaller spec updates for SANE hidden imports
- `pyproject.toml` updates for SANE dependencies
- OpenSpec proposal required

### Increment 3a: GraviScan Handler Modules (Isolated)

**Restructure from PR #138.** No integration with main.ts yet.

- Split `graviscan-handlers.ts` (1,338 lines) into focused modules in `src/main/graviscan/`:
  - `scan-handlers.ts` — scan CRUD operations
  - `scanner-handlers.ts` — scanner detection, config
  - `session-handlers.ts` — session management
  - `image-handlers.ts` — image operations
- **Add unit tests for all 4 modules**
- Tests run in isolation — no wiring to main.ts
- OpenSpec proposal required

### Increment 3b: Coordinator + Subprocess

**Restructure from PR #138.**

- `scan-coordinator.ts` → `src/main/graviscan/scan-coordinator.ts`
- `scanner-subprocess.ts` → `src/main/graviscan/scanner-subprocess.ts`
- **Add unit tests for coordinator and subprocess**
- Still no wiring to main.ts
- OpenSpec proposal required

### Increment 3c: Wire GraviScan Handlers into Main Process

**Integration PR.** This is where CylinderScan regressions are most likely.

- Register handlers conditionally in `main.ts`
- Extend `preload.ts` context bridge with `gravi` namespace
- Extend `database-handlers.ts` with GraviScan CRUD
- **Full CylinderScan regression test suite must pass**
- Integration tests for GraviScan IPC handlers
- OpenSpec proposal required

### Increment 4: Renderer Hooks + State (can start after Increment 2, does not require 3c)

**Restructure from PR #140.** Hook unit tests mock IPC calls, so this can proceed before main process handlers are wired.

- Move hooks to `src/renderer/graviscan/hooks/`
- **Split `useScanSession.ts`** (1,270 lines) into composable hooks:
  - `useScanExecution.ts` — scan start/stop/progress
  - `useScannerState.ts` — scanner detection, status
  - `useScanConfig.ts` — scan configuration state
  - `useScanResults.ts` — scan results, image management
- **Add unit tests for ALL hooks** (currently 1 of 6 has tests → 9 hooks after decomposition)
- Upload status context → `src/renderer/graviscan/contexts/`
- OpenSpec proposal required

### Increment 5: Renderer UI + E2E

**Restructure from PR #141.**

- GraviScan pages in `src/renderer/graviscan/`
- GraviScan components in `src/components/graviscan/`
- Conditional routing already wired from Increment 0b — just add the lazy-loaded page components
- Mode-aware `Home.tsx` updates
- **Add component unit tests** (currently zero)
- E2E tests for GraviScan workflow (mock mode)
- E2E tests verify mode switching doesn't break CylinderScan
- OpenSpec proposal required

### Increment 6: Upload + Cloud Backup

**Cherry-pick from PR #139.**

- Shared upload orchestration (refactor `image-uploader.ts`)
- GraviScan-specific upload metadata builder
- Box backup via rclone (GraviScan-only)
- Supabase metadata upload
- OpenSpec proposal required

### Increment 7: Downstream Fixes

**Cherry-pick from PRs #145, #157-#169.**

- Parallelize scanner init (#145)
- Fix scan filepath mismatch (#157)
- QR verification improvements (#160, #163)
- Disable scan until ready (#165)
- Duplicate QR detection (#166)
- Reset/re-detect button (#169)
- Each fix gets its own small PR with tests

## Testing Strategy

Each increment must:

1. Pass all existing CylinderScan tests (zero regressions)
2. Include unit tests for all new modules
3. Include integration tests for new IPC handlers
4. Include E2E tests for new user workflows (Increment 5+)
5. Follow TDD — tests written before implementation
6. Pass full CI on all 3 platforms

### Mode-Aware Testing

- E2E helper (`bloom-config.ts`) pre-seeds `SCANNER_MODE=cylinderscan` for existing tests
- GraviScan E2E tests pre-seed `SCANNER_MODE=graviscan`
- Integration tests mock config store to set mode
- IPC coverage script (`check-ipc-coverage.py`) updated for GraviScan handlers
- Python SANE tests: Linux-only CI job (requires `libsane-dev`); all platforms run mock-mode tests

### Coverage Requirements

| Layer | Requirement |
|-------|------------|
| Python SANE backend | 80%+ (already met in PR #137) |
| Main process handlers | Unit tests per handler module |
| Renderer hooks | Unit tests per hook (9 hooks after decomposition) |
| Renderer components | Unit tests for interactive components |
| E2E | Mode-switching workflow, GraviScan capture workflow |
| IPC coverage | 90%+ including new GraviScan handlers |

## Risks

| Risk | Mitigation |
|------|-----------|
| Increment 0a (file moves) breaks imports | Pure refactor with TypeScript compiler catching errors; 7 files, 12 imports to update |
| Increment 3c (main process integration) breaks CylinderScan | Isolated into smallest possible PR; full regression suite |
| `useScanSession` decomposition changes behavior | Extract into smaller hooks preserving same external API; E2E validates |
| Schema migration conflicts with Ben's branch | Write migrations from scratch, don't cherry-pick; document `prisma migrate reset` requirement |
| Phase 2 tree-shaking doesn't work | Phase 2 uses `DefinePlugin` build constant, not runtime tree-shaking |
| SANE binary crashes on macOS/Windows | Import guard catches `(ImportError, OSError)`; mock mode on non-Linux |
| Ben's existing code has untested edge cases | Add unit tests during restructure; don't merge untested code |
| Existing experiments vanish after integration | Backfill `experiment_type = 'cylinderscan'` in migration |
| Mode switch hides historical scans | Browse/view routes always visible regardless of mode |

## Success Criteria

1. Both CylinderScan and GraviScan modes work end-to-end
2. Mode selection via Machine Config, persisted to `.env`
3. Zero CylinderScan regressions (all existing tests pass)
4. All new code has unit tests
5. Clear directory boundaries — ESLint rule enforces no cross-mode imports
6. One build, one installer, runtime mode switching
7. Browse/view routes work for both modes regardless of active mode
8. Existing experiments preserved and visible after integration
9. Code structured so Phase 2 (`DefinePlugin` + split binaries) is achievable without refactor
