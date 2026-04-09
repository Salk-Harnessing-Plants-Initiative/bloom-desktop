## Why

PR #138 contains a monolithic `graviscan-handlers.ts` (1,338 lines) that mixes scanner detection, config management, scan execution, and image operations in a single file. This makes it untestable (the existing CylinderScan `database-handlers.ts` at 942 lines has zero unit tests for the same reason — business logic coupled to `ipcMain`). Splitting into focused service modules enables unit testing without Electron mocking and follows the proven CylinderScan pattern where `camera-process.ts` and `scanner-process.ts` are pure classes with full test coverage.

## What Changes

- Cherry-pick and restructure 15 IPC handlers from `origin/graviscan/4-main-process:src/main/graviscan-handlers.ts` into 3 focused service modules in `src/main/graviscan/`:
  - `scanner-handlers.ts` (~500 LOC) — scanner detection, config, validation, platform info
  - `session-handlers.ts` (~400 LOC) — scan execution lifecycle: start, status, cancel
  - `image-handlers.ts` (~400 LOC) — image read/convert, export with metadata CSV, Box upload
- Each module exports pure async functions (no `ipcMain` dependency) — dependencies injected as parameters
- Add comprehensive unit tests for all 3 modules using Vitest + mocked Prisma
- `scan-handlers.ts` (GraviScan DB CRUD) deferred to Increment 3c when `database-handlers.ts` is extended
- `register-handlers.ts` (IPC wiring) deferred to Increment 3c — no main.ts integration yet
- Add `index.ts` barrel export for clean imports

## Impact

- Affected specs: `scanning`
- Affected code: `src/main/graviscan/` (new directory, 3 new modules + tests + index)
- Source: `origin/graviscan/4-main-process:src/main/graviscan-handlers.ts` (PR #138)
- Scanner model: Epson Perfection V600 (USB `04b8:013a`)
- No changes to `main.ts`, `preload.ts`, or `database-handlers.ts` in this increment
- Reference: `docs/superpowers/specs/2026-04-03-graviscan-integration-design.md` (Increment 3a)
