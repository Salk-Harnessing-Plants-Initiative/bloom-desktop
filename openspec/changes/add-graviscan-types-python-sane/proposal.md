## Why

GraviScan integration (Increment 2) requires TypeScript type definitions and a Python SANE scanner backend before any renderer or main-process handler work can begin. Ben's PR #137 contains well-isolated, well-tested code for both. Cherry-picking these files unblocks Increments 3-5 while keeping the change small and independently testable.

## What Changes

- Add `src/types/graviscan.ts` — 315-line TypeScript module defining all GraviScan domain types (scanner, config, scan, session, image, plate assignment), constants, and helper functions. Fix during cherry-pick: add missing `scan_started_at: Date | null` and `scan_ended_at: Date | null` to `GraviScan` interface (these exist in Prisma schema from Increment 1 but are absent from Ben's TypeScript interface).
- Add `tests/unit/graviscan-types.test.ts` — Vitest unit tests for helper functions and constants
- Add `python/graviscan/` package — SANE scan worker (subprocess-per-scanner architecture) and scan region geometry for 2-grid/4-grid plate configurations. Fix during cherry-pick: correct scanner model name from "V600"/"V850" to "Epson Perfection V600" (matches USB IDs `04b8:013a`). Investigate: 4-grid region "01" right edge (220.0mm) exceeds scanner bed width (215.9mm) — verify against physical hardware or reduce width.
- Add Python tests for scan regions, scan worker, and TIFF metadata embedding (~1,318 lines)
- Add graviscan import tests to existing `test_imports.py` and `test_imports_fallback.py`
- Update `pyproject.toml` — add `pillow` as explicit core dependency (already transitive via imageio), `graviscan-linux` and `graviscan-windows` optional dependency groups, mypy overrides for `sane`/`twain`/`wmi`, and add `python/graviscan/scan_worker.py` to coverage omit list (SANE-only code paths cannot execute without physical hardware)
- Update `python/main.spec` — add GraviScan hidden imports (only modules that exist: `graviscan`, `graviscan.scan_regions`, `graviscan.scan_worker` + `python.*` mirrors). Strip non-existent references from Ben's version (`graviscan.models.*`, `graviscan.functions.*`).
- Add Prisma model re-exports to `src/types/database.ts` — `GraviScanPlateAssignment`, `GraviPlateAccession`, `GraviPlateSectionMapping`

Note on type systems: `src/types/graviscan.ts` defines IPC/UI domain objects (often with relations); Prisma-generated types represent raw database rows. Both coexist intentionally, following the same pattern as existing `ScanWithRelations` in `database.ts`.

## Impact

- Affected specs: `scanning` (new GraviScan scanning capability)
- Affected code: `src/types/graviscan.ts` (new), `src/types/database.ts` (additive re-exports), `tests/unit/graviscan-types.test.ts` (new), `python/graviscan/` (new), `python/tests/` (new + modified), `pyproject.toml`, `python/main.spec`, `uv.lock`
- No changes to existing runtime behavior — all additions are new files or additive exports
- SANE import guard (`ImportError, OSError`) ensures safe loading on macOS/Windows where `libsane` is absent
- **CI impact**: CI uses `uv sync --all-extras --frozen` in `lint-python` and `test-python` jobs. Adding `graviscan-linux` with `python-sane>=2.9.0` will cause these jobs to fail because `libsane-dev` is not installed on CI runners. Fix: add `sudo apt-get install -y libsane-dev` to CI jobs that use `--all-extras`, OR change those jobs to `--extra dev` only. This must be resolved as part of this increment.
- Scanner model: all code will reference Epson Perfection V600 (USB `04b8:013a`) after cherry-pick fixes
- Issue #125 (device busy recovery): PR #137 claims to close #125 but this increment does not include the recovery hardening. #125 remains open and needs a separate PR.
