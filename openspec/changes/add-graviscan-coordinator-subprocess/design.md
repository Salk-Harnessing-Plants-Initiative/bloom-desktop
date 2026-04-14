# Design: GraviScan Coordinator + Subprocess

## Overview

This is Increment 3b of the GraviScan integration (see `docs/superpowers/specs/2026-04-03-graviscan-integration-design.md`). It introduces two modules that together manage the lifecycle of parallel flatbed scanning across multiple Epson scanners.

## Architecture

```
session-handlers.ts (Increment 3a — already merged)
  │  calls coordinator.initialize(), scanOnce(), scanInterval()
  ▼
scan-coordinator.ts (this increment)
  │  orchestrates multiple subprocesses
  │  manages grid sequencing and interval timing
  ▼
scanner-subprocess.ts (this increment)
  │  one instance per physical scanner
  │  spawns and communicates with Python scan_worker.py
  ▼
scan_worker.py (already exists in python/graviscan/)
  │  SANE hardware interaction
```

## Key Design Decisions

### 1. Type Placement: PlateConfig + ScannerConfig in src/types/graviscan.ts

These types are used across session-handlers (IPC boundary), scan-coordinator, and scanner-subprocess. They will become IPC-facing in Increment 3c when the renderer sends `graviscan:start-scan` params. Placing them in `src/types/graviscan.ts` follows the dominant codebase pattern (daq.ts, scanner.ts, graviscan.ts all host IPC-facing types).

Session-handlers currently has a comment `// Local interface types (will move to shared types in a later increment)` — this increment fulfills that intent.

**Re-export policy:** Consumers should import `PlateConfig`/`ScannerConfig` directly from `src/types/graviscan.ts`, not through the barrel in `index.ts`. Session-handlers.ts will import (not re-export) them. This avoids creating a dependency on the barrel for types that live in the shared types file.

### 2. ScanCoordinator implements ScanCoordinatorLike

The `ScanCoordinatorLike` interface in session-handlers.ts defines the contract. Making `ScanCoordinator` explicitly `implements ScanCoordinatorLike` catches contract drift at compile time. The interface stays in session-handlers.ts (it's the consumer's contract definition).

### 3. scan-logger.ts in src/main/graviscan/

scan-logger.ts is a GraviScan-specific utility (logs to `~/.bloom/logs/graviscan-*.log`). It doesn't exist on main yet and is a dependency of both coordinator and subprocess. Placing it in `src/main/graviscan/` keeps GraviScan modules self-contained for packaging.

**Retention:** Configurable via `LOG_RETENTION_DAYS` constant (default 180 days). 30 days is too short for scientific workflows where analysis/publication takes months.

### 4. Sequential Subprocess Initialization (kept, with tracked issue)

Ben's code initializes scanners sequentially. Issue #144 argues this is unnecessary since each subprocess has its own SANE context. We keep sequential init for now because switching to parallel requires designing error semantics for partial init failure (what if 3/4 scanners init but one fails?). A GitHub issue will be filed to track this optimization.

### 5. Grid-Based Scanning with USB Stagger

Within a scan cycle, grids are scanned sequentially (all scanners scan grid 0, then grid 1, etc.). Within a grid, scanners are triggered with a `USB_STAGGER_DELAY_MS = 5000` stagger delay due to epkowa SANE backend limitations. This is a hardware constraint, not a software choice. The stagger delay is logged via `scanLog()` for traceability.

**Note for 4-grid mode:** Grids are grouped by row (00/01 = top row, 10/11 = bottom row). Both grids in a row share the same `scan_started_at` and `scan_ended_at` timestamps. The end timestamp reflects when the LAST scanner completed that row.

### 6. Per-Grid Timestamps

Each grid scan gets its own start/end timestamps injected into filenames (`_st_YYYYMMDD_HHmmss` and `_et_YYYYMMDD_HHmmss` patterns). The coordinator renames output files after all scanners complete a grid to include the end timestamp.

### 7. Cross-Module Type Dependencies

- `PlateConfig`, `ScannerConfig` → `src/types/graviscan.ts` (shared, IPC-facing)
- `ScanCoordinatorLike` → `session-handlers.ts` (consumer contract)
- `ScanWorkerEvent` → `scanner-subprocess.ts` (internal, imported by scan-coordinator.ts — may move to shared types in 3c if needed by IPC handlers)
- `CoordinatorEvent` → removed (dead code on Ben's branch)

## Adaptations from Ben's Branch

Ben's files live at `src/main/scan-coordinator.ts` and `src/main/scanner-subprocess.ts` (top-level). We:

1. Move to `src/main/graviscan/` for module isolation
2. Update imports: `PlateConfig`/`ScannerConfig` from `../../types/graviscan`, `ScannerSubprocess`/`ScanWorkerEvent` from `./scanner-subprocess`, `scanLog` from `./scan-logger`
3. Add `implements ScanCoordinatorLike` to ScanCoordinator class
4. Surface rename failures as error events (not silent `console.error`)
5. Add file existence + non-zero size check after `scan-complete`
6. Add `scanLog()` calls during USB stagger with scanner ID and delay
7. Make log retention configurable (default 180 days)
8. Extract `USB_STAGGER_DELAY_MS` as named constant
9. Remove dead `CoordinatorEvent` type

## Test Strategy

Tests mock at the JS level using `vi.mock('child_process')`, consistent with CylinderScan test patterns. All new test files use `// @vitest-environment node` directive.

- **ScannerSubprocess tests**: Mock `child_process.spawn`, use real EventEmitter for stdout, simulate `EVENT:` protocol messages. Cover: spawn/ready, scan command, event parsing, cancel, shutdown, spawn failure (ENOENT), malformed EVENT lines, partial stdout buffering, non-zero exit code.
- **ScanCoordinator tests**: Mock `ScannerSubprocess` class entirely, test orchestration logic. Cover: staggered init, grid sequencing, interval timing, cancel (including during interval wait), shutdown, partial scanner failure, zero scanners, file verification after scan-complete, rename error surfacing.
- **Scan-logger tests**: Mock `fs` operations. Cover: write entry, configurable retention cleanup, close stream, directory creation.
- **No Python required**: All tests run without Python/SANE
