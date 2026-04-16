# Proposal: Extract GraviScan Wiring Logic from main.ts

**Change ID:** `refactor-extract-graviscan-wiring`
**Status:** Draft
**Issue:** #190
**Related:** #181 (increase test coverage thresholds / make main process testable), #130 (GraviScan integration epic)
**Type:** Refactor

## Why

`src/main/main.ts` contains GraviScan wiring logic — module-level state, orchestration functions, and shutdown code — that should live in a side-effect-free module. The test file `tests/unit/graviscan/main-wiring.test.ts` re-implements all this logic inline because importing from `main.ts` triggers Electron side effects that crash the Node test environment. This means tests verify hand-copied logic rather than the real production code.

## What Changes

Extract all GraviScan wiring into `src/main/graviscan/wiring.ts`:

1. Move state variables, `graviSessionFns`, `setupCoordinatorEventForwarding()`, `getOrCreateCoordinator()`, and `initGraviScan()` into the new module.
2. Add a new `shutdownGraviScan()` function that encapsulates the coordinator shutdown + log close logic currently inline in main.ts's `before-quit` handler. This is a minor API addition (not a pure move) required because the extracted module's state is private.
3. Update `main.ts` to import from `./graviscan/wiring` and call the extracted functions.
4. Update `src/main/graviscan/index.ts` barrel to add re-exports of `initGraviScan` and `shutdownGraviScan` from `./wiring`, in addition to all existing handler exports. Internal functions (`graviSessionFns`, `setupCoordinatorEventForwarding`, `getOrCreateCoordinator`) are importable directly from `wiring.ts` but not added to the barrel.
5. Rewrite `main-wiring.test.ts` to import and test the **real** extracted functions instead of inline reimplementations.
6. Fix pre-existing spec gap: add `rename-error` to the Coordinator Event Forwarding events list (the code already forwards it but the spec omitted it).

## Impact

**Affected specs:**

- `scanning` — MODIFIED requirements for session state management, coordinator instantiation, event forwarding, conditional mode registration, and barrel exports. ADDED requirements for graceful shutdown and side-effect-free module.

**Affected code files:**

- `src/main/graviscan/wiring.ts` — NEW
- `src/main/main.ts` — MODIFIED (remove ~140 lines of GraviScan wiring, add imports)
- `src/main/graviscan/index.ts` — MODIFIED (add barrel re-exports)
- `tests/unit/graviscan/main-wiring.test.ts` — REWRITTEN (import real exports)

## Constraints

- All 706 existing tests must continue passing.
- Preserve lazy dynamic imports (no heavy modules loaded in cylinderscan mode).
- Preserve promise memoization pattern for coordinator creation.
- `wiring.ts` must be side-effect-free at module load time (no top-level code that runs on import).

## Known Behavior Change

`closeScanLog()` moves from after `closeDatabase()` to before it (both are now inside `shutdownGraviScan()` which runs before database close). This is safe because `closeScanLog()` closes a filesystem write stream with no database dependency. See design.md for details.

## Risk Assessment

**Low risk.** This is a mechanical extraction with one minor ordering change (closeScanLog). The primary risk is import path errors, mitigated by running the full test suite after each step.

## Known Limitations (Out of Scope)

- `setupCoordinatorEventForwarding()` does not remove listeners if a new coordinator is created later (duplicate-listener risk). Pre-existing; tracked separately.
- `initGraviScan()` may not be awaited correctly at the call site in main.ts (race condition). Pre-existing; tracked separately.
- Copilot review comments from PR #189 (11 items) remain untracked beyond #190.
