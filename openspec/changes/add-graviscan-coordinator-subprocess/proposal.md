# Proposal: Add GraviScan Coordinator + Subprocess Modules

**Change ID:** add-graviscan-coordinator-subprocess
**Status:** draft
**Created:** 2026-04-10

## Why

Increment 3b of the GraviScan integration requires the scan-coordinator and scanner-subprocess modules that orchestrate multi-scanner parallel scanning. The handler modules (Increment 3a) are merged and session-handlers defines a `ScanCoordinatorLike` interface, but no real implementation exists on main yet. These modules must be cherry-picked from Ben's feature branch, moved into `src/main/graviscan/`, type-reconciled with the existing codebase, and unit-tested before wiring into main.ts (Increment 3c).

## What Changes

- Cherry-pick `scan-coordinator.ts` and `scanner-subprocess.ts` from `origin/graviscan/4-main-process` (PR #138, issue #130) into `src/main/graviscan/`
- Cherry-pick `scan-logger.ts` (dependency of both modules) into `src/main/graviscan/`
- Move `PlateConfig` and `ScannerConfig` types from session-handlers.ts local definitions into `src/types/graviscan.ts` (they are IPC-facing types needed by coordinator, subprocess, and session-handlers)
- Update session-handlers.ts to import `PlateConfig` and `ScannerConfig` from `src/types/graviscan.ts` instead of defining them locally
- `ScanCoordinator` class explicitly `implements ScanCoordinatorLike`
- Unit tests for `ScanCoordinator` (orchestration logic: staggered init, grid sequencing, interval timing, cancellation, shutdown)
- Unit tests for `ScannerSubprocess` (spawn, command protocol, event parsing, shutdown)
- Unit tests for `scan-logger` (log writing, configurable retention, stream management)
- Tests mock `child_process.spawn` at the JS level using `vi.mock()`, consistent with CylinderScan test patterns (e.g., camera-process.test.ts, python-process.test.ts)
- **No** IPC handler registration, no changes to main.ts, no changes to graviscan/index.ts exports

**Adaptations from Ben's branch (not cherry-picked as-is):**

- Rename failures surfaced as error events instead of silently caught with `console.error`
- File existence + size check after `scan-complete` before emitting `grid-complete`
- USB stagger delay logged via `scanLog()` with scanner ID and delay duration
- Log retention configurable (default 180 days, up from hardcoded 30 days)
- Remove dead `CoordinatorEvent` type
- Extract `USB_STAGGER_DELAY_MS = 5000` as named module-level constant
- Import `PlateConfig`/`ScannerConfig` from `src/types/graviscan.ts` instead of local definitions
- `ScanWorkerEvent` stays in scanner-subprocess.ts (future migration to shared types in 3c if needed)

**Known design decisions deferred to future issues:**

- Sequential subprocess initialization kept as-is; parallel init deferred (see #144 — requires error-handling design for partial init failure)
- Database path vs filesystem divergence after `_et_` rename (needs 3c wiring to reconcile)
- Per-session cycle number disambiguation (needs session wiring in 3c)
- `scanner-stagger-wait` UI event (deferred to renderer increment)

**Related issues:** #130 (parent), #126 (epic), #144 (parallel init), #125 (subprocess recovery), #168 (per-scanner reconnect), #177 (row-merge at 1200 DPI)

## Impact

- Affected specs: `scanning` (adds requirements for coordinator, subprocess, logger, shared types)
- Affected code:
  - `src/main/graviscan/scan-coordinator.ts` (new)
  - `src/main/graviscan/scanner-subprocess.ts` (new)
  - `src/main/graviscan/scan-logger.ts` (new)
  - `src/types/graviscan.ts` (adds PlateConfig, ScannerConfig)
  - `src/main/graviscan/session-handlers.ts` (remove local type defs, import from shared types)
  - `tests/unit/graviscan/scan-coordinator.test.ts` (new)
  - `tests/unit/graviscan/scanner-subprocess.test.ts` (new)
  - `tests/unit/graviscan/scan-logger.test.ts` (new)
