# GraviScan Integration — Design Spec

**Date**: 2026-04-03
**Branch**: TBD (will be created per increment)
**Status**: Draft

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

- Mode is a **database-backed machine config field** (`scanner_mode: 'cylinderscan' | 'graviscan'`)
- Set during Machine Config wizard (required on first run)
- Changeable by admin via Machine Config page
- Default: none — forces explicit choice
- Mode determines: visible routes, nav items, available IPC handlers, capture workflow

### Directory Structure — One-Way Dependencies

```
src/
├── main/
│   ├── [shared files stay at root: database.ts, python-process.ts, etc.]
│   ├── cylinderscan/     # camera-process, daq-process, scanner-process
│   └── graviscan/        # graviscan-handlers, scan-coordinator, scanner-subprocess
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

**Critical rule**: Shared code NEVER imports from `cylinderscan/` or `graviscan/` directories. The dependency arrow is strictly one-way: mode-specific → shared.

### Mode-Conditional Registration

**Main process (`main.ts`):**
```typescript
import { registerSharedHandlers } from './database-handlers';
import { registerCylinderScanHandlers } from './cylinderscan/handlers';
import { registerGraviScanHandlers } from './graviscan/handlers';

const mode = await getConfiguredMode(); // reads from DB
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

  {/* CylinderScan routes — conditional */}
  {(mode === 'cylinderscan' || mode === 'full') && (
    <>
      <Route path="/capture-scan" element={<CaptureScan />} />
      <Route path="/camera-settings" element={<CameraSettings />} />
      <Route path="/browse-scans" element={<BrowseCylinderScans />} />
    </>
  )}

  {/* GraviScan routes — conditional */}
  {(mode === 'graviscan' || mode === 'full') && (
    <>
      <Route path="/graviscan" element={<GraviScan />} />
      <Route path="/scanner-config" element={<ScannerConfig />} />
      <Route path="/browse-graviscan" element={<BrowseGraviScans />} />
    </>
  )}
</Routes>
```

Phase 2 optimization: Replace conditionals with `React.lazy()` + dynamic `import()` so webpack can tree-shake unused mode code.

### Python Backend

**One executable (`bloom-hardware`)** with conditional imports:

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

Phase 2 optimization: Split into two PyInstaller `.spec` files — `bloom-hardware.spec` (camera + DAQ + scanner) and `bloom-graviscan.spec` (SANE worker). Each includes only its dependencies.

### Database Schema

- Existing CylinderScan models (`Scan`, `Image`) remain unchanged
- New GraviScan models (`GraviScan`, `GraviScanner`, `GraviConfig`, `GraviImage`, etc.) are additive
- `Experiment` gets a new optional field `experiment_type` (`'cylinderscan' | 'graviscan'`)
- Machine config table gets `scanner_mode` field
- 14 migrations from PR #135 will be squashed to 2-3 logical units

### Shared Infrastructure

These files are extended but not restructured:

| File | Extension |
|------|-----------|
| `preload.ts` | Adds `gravi` namespace to context bridge |
| `electron.d.ts` | Adds GraviScan API types |
| `database-handlers.ts` | Adds GraviScan CRUD handlers |
| `Layout.tsx` | Nav items conditional on mode |
| `Home.tsx` | Mode-aware landing page |
| `MachineConfiguration.tsx` | Scanner mode selector + mode-specific config sections |
| `config-store.ts` | `scanner_mode` field + GraviScan-specific config fields |

### Upload / Cloud Backup

- Shared upload orchestration (batch upload, retry, status tracking)
- Mode-specific metadata builders (`CylImageMetadata` vs `GraviImageMetadata`)
- GraviScan adds Box backup via rclone (new, not shared with CylinderScan)
- Supabase metadata upload is GraviScan-specific (for now)

## Integration Order

Cherry-pick from Ben's PRs, restructure into properly bounded increments:

### Increment 0: Prep — Directory Structure + Mode Config

**New PR.** No GraviScan code yet.

- Add `scanner_mode` to machine config schema + DB migration
- Add `scanner_mode` to Machine Config wizard (required choice: CylinderScan or GraviScan)
- Add `useAppMode()` hook that reads mode from main process
- Make `App.tsx` routes conditional on mode
- Make `Layout.tsx` nav conditional on mode
- Move existing CylinderScan-specific main process files into `src/main/cylinderscan/` (camera-process, daq-process, scanner-process)
- Update imports — no functional changes, just directory restructure
- All existing tests must pass
- OpenSpec proposal required

### Increment 1: Schema + Migrations

**Cherry-pick from PR #135**, modified.

- Squash 14 migrations into 2-3 logical units
- Add GraviScan Prisma models
- Add `experiment_type` field to Experiment
- Migration verification tests
- OpenSpec proposal required

### Increment 2: Types + Python SANE Backend

**Cherry-pick from PR #137**, modified.

- `src/types/graviscan.ts` — GraviScan TypeScript types
- `python/graviscan/` — SANE worker, scan regions (already well-isolated)
- Python tests (already good: 938 lines)
- PyInstaller spec updates for SANE hidden imports
- `pyproject.toml` updates for SANE dependencies
- OpenSpec proposal required

### Increment 3: Main Process Handlers

**Restructure from PR #138.** This is the riskiest increment.

- Split `graviscan-handlers.ts` (1,338 lines) into focused modules in `src/main/graviscan/`:
  - `scan-handlers.ts` — scan CRUD operations
  - `scanner-handlers.ts` — scanner detection, config
  - `session-handlers.ts` — session management
  - `image-handlers.ts` — image operations
- `scan-coordinator.ts` → `src/main/graviscan/scan-coordinator.ts`
- `scanner-subprocess.ts` → `src/main/graviscan/scanner-subprocess.ts`
- Register handlers conditionally in `main.ts`
- Add context bridge extensions to `preload.ts`
- **Add unit tests** for all handler modules (currently zero)
- **Add unit tests** for scan-coordinator
- OpenSpec proposal required

### Increment 4: Renderer Hooks + State

**Restructure from PR #140.**

- Move hooks to `src/renderer/graviscan/hooks/`
- **Split `useScanSession.ts`** (1,270 lines) into composable hooks:
  - `useScanExecution.ts` — scan start/stop/progress
  - `useScannerState.ts` — scanner detection, status
  - `useScanConfig.ts` — scan configuration state
  - `useScanResults.ts` — scan results, image management
- **Add unit tests for ALL hooks** (currently 1 of 6 has tests)
- Upload status context → `src/renderer/graviscan/contexts/`
- OpenSpec proposal required

### Increment 5: Renderer UI + E2E

**Restructure from PR #141.**

- GraviScan pages in `src/renderer/graviscan/`
- GraviScan components in `src/components/graviscan/`
- Conditional routing wired up in `App.tsx`
- Mode-aware `Layout.tsx` and `Home.tsx`
- **Add component unit tests** (currently zero)
- Update E2E tests for mode-aware navigation
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

### Coverage Requirements

| Layer | Requirement |
|-------|------------|
| Python SANE backend | 80%+ (already met in PR #137) |
| Main process handlers | Unit tests per handler module |
| Renderer hooks | Unit tests per hook |
| Renderer components | Unit tests for interactive components |
| E2E | Mode-switching workflow, GraviScan capture workflow |
| IPC coverage | 90%+ including new GraviScan handlers |

## Risks

| Risk | Mitigation |
|------|-----------|
| Increment 3 (main process) breaks CylinderScan | Conditional handler registration; full CylinderScan test suite runs on every PR |
| `useScanSession` decomposition changes behavior | Extract into smaller hooks with same external API; existing E2E tests validate |
| Schema migration conflicts | Squash 14 migrations; run migration verification script |
| Phase 2 tree-shaking breaks at boundary | One-way dependency rule enforced by lint rule or import restrictions |
| Ben's existing code has untested edge cases | Add unit tests during restructure; don't merge untested code |

## Success Criteria

1. Both CylinderScan and GraviScan modes work end-to-end
2. Mode selection via Machine Config, persisted to DB
3. Zero CylinderScan regressions (all existing tests pass)
4. All new code has unit tests
5. Clear directory boundaries — `grep -r "from.*graviscan" src/main/shared/` returns nothing
6. One build, one installer, runtime mode switching
7. Code structured so Phase 2 (build-time stripping) is a config change, not a refactor
