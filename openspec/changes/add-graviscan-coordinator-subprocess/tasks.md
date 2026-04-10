# Tasks: Add GraviScan Coordinator + Subprocess

All new test files MUST include `// @vitest-environment node` at line 1.

## Task 1: Move PlateConfig and ScannerConfig to shared types

Move `PlateConfig` and `ScannerConfig` from `session-handlers.ts` local definitions into `src/types/graviscan.ts`. Update `session-handlers.ts` to import from the shared types file. Remove local definitions. Do NOT re-export from session-handlers.ts — consumers should import types directly from `src/types/graviscan`.

**TDD:** Write a test that imports `PlateConfig` and `ScannerConfig` from `src/types/graviscan`, creates conforming objects, and asserts the expected properties. Also import `ScanCoordinatorLike` from session-handlers to verify it references the shared types.

- [x] Write type import test in existing `tests/unit/graviscan-types.test.ts`
- [x] Add `PlateConfig` and `ScannerConfig` to `src/types/graviscan.ts`
- [x] Update `session-handlers.ts` to import from `../../types/graviscan`, remove local definitions
- [x] Gate: `npx tsc --noEmit` passes AND existing session-handlers tests pass

## Task 2: Add scan-logger.ts to src/main/graviscan/

Cherry-pick `scan-logger.ts` from `origin/graviscan/4-main-process` into `src/main/graviscan/scan-logger.ts`. Adapt: make log retention configurable via `LOG_RETENTION_DAYS` constant (default 180 days, up from hardcoded 30 days).

**TDD:** Write unit tests first, then adapt the module. Mock `fs` operations.

- [x] Write `tests/unit/graviscan/scan-logger.test.ts` (tests first)
  - `scanLog()` writes timestamped entry to daily log file
  - `scanLog()` creates log directory if it does not exist
  - `cleanupOldLogs()` deletes files older than `LOG_RETENTION_DAYS`
  - `cleanupOldLogs()` preserves recent log files
  - `closeScanLog()` flushes and closes stream
  - Subsequent `scanLog()` after close opens a new stream
- [x] Cherry-pick and adapt scan-logger.ts (configurable retention, 180-day default)
- [x] Gate: tests pass, `npx tsc --noEmit` passes

## Task 3: Add scanner-subprocess.ts to src/main/graviscan/

Cherry-pick `scanner-subprocess.ts` from `origin/graviscan/4-main-process` into `src/main/graviscan/scanner-subprocess.ts`. Update imports: `PlateConfig` from `../../types/graviscan`, `scanLog` from `./scan-logger`. Keep `ScanWorkerEvent` defined and exported locally (may move to shared types in 3c).

**TDD:** Write unit tests first, then adapt the module. Tests mock `child_process.spawn` with `vi.mock()` and use real EventEmitter for stdout (Pattern B from python-process.test.ts).

- [x] Write `tests/unit/graviscan/scanner-subprocess.test.ts` (tests first)
  - `spawn()` — spawns process, waits for `EVENT:ready`, transitions to ready state
  - `spawn()` packaged mode — uses `bloom-hardware --scan-worker` args
  - `spawn()` failure — ENOENT rejects with error, state transitions to dead
  - `scan(plates)` — sends JSON command to stdin, sets state to scanning
  - `cancel()` — sends cancel command to stdin
  - Event parsing — `EVENT:{...}` lines emitted as typed events (`scan-started`, `scan-complete`, `scan-error`, `scan-cancelled`, `cycle-done`)
  - Event parsing — generic `event` emitted for coordinator forwarding
  - Malformed EVENT line — logged as warning, no crash or state change
  - Partial stdout buffering — split chunks reassembled before parsing
  - Process exit with non-zero code — emits `exit` event, state to dead
  - `shutdown()` — sends quit, force-kills after timeout
- [x] Cherry-pick and adapt scanner-subprocess.ts
- [x] Gate: tests pass, `npx tsc --noEmit` passes

## Task 4: Add scan-coordinator.ts to src/main/graviscan/

Cherry-pick `scan-coordinator.ts` from `origin/graviscan/4-main-process` into `src/main/graviscan/scan-coordinator.ts`. Adaptations:
- Import `PlateConfig`, `ScannerConfig` from `../../types/graviscan` (remove local definitions)
- Import `ScannerSubprocess`, `ScanWorkerEvent` from `./scanner-subprocess`
- Import `ScanCoordinatorLike` from `./session-handlers`, add `implements ScanCoordinatorLike`
- Remove dead `CoordinatorEvent` type
- Extract `USB_STAGGER_DELAY_MS = 5000` as named module-level constant
- Add `scanLog()` calls during USB stagger with scanner ID and delay
- Surface rename failures as `rename-error` events (not silent `console.error`)
- Add file existence + non-zero size check after `scan-complete`

**TDD:** Write unit tests first, then adapt the module. Tests mock the `ScannerSubprocess` class entirely (no real subprocesses). Use `vi.useFakeTimers()` for stagger delay and interval timing.

- [x] Write `tests/unit/graviscan/scan-coordinator.test.ts` (tests first)
  - `initialize()` — staggered init (sequential, not parallel), reuses ready subprocesses, shuts down stale ones
  - `initialize([])` — zero scanners, shuts down existing, resolves without error
  - `scanOnce()` — grid sequencing, USB stagger delay logged, grid-start/grid-complete/cycle-complete events
  - `scanOnce()` — file verification after scan-complete (exists + non-zero size)
  - `scanOnce()` — rename failure emits `rename-error` event, `grid-complete` includes `renameErrors`
  - `scanOnce()` — partial scanner failure mid-grid, waits for others, proceeds to next grid
  - `scanInterval()` — repeats at interval, stops after duration, overtime event
  - `cancelAll()` — cancels subprocesses, clears interval, emits cancelled
  - `cancelAll()` — cancel during interval wait (not active scan)
  - `shutdown()` — quit + force-kill timeout pattern
  - `isScanning` — true when state is scanning or waiting
  - Implements `ScanCoordinatorLike` — TypeScript compilation verifies contract
- [x] Cherry-pick and adapt scan-coordinator.ts with all adaptations listed above
- [x] Gate: tests pass, `npx tsc --noEmit` passes

## Task 5: Verify all tests pass and no regressions

Run full unit test suite and TypeScript compilation to confirm no regressions from type moves or new modules.

- [x] `npx tsc --noEmit` passes (full project compilation)
- [x] `npm run test:unit` passes (all unit tests including new files)
- [x] New test files discovered and run by Vitest

## Task 6: Deferred work

- [x] File issue #185: Parallel subprocess initialization (references #144) — design error semantics for partial init failure
- [x] Log retention made configurable at runtime via `GRAVISCAN_LOG_RETENTION_DAYS` env var (default 180 days)
