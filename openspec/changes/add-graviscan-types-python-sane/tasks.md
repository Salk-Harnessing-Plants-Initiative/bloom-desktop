## 1. Dependencies & Packaging (must precede all other sections)

- [ ] 1.1 Update `pyproject.toml`:
  - Add `pillow>=10.0.0` to core deps
  - Add `graviscan-linux` and `graviscan-windows` optional dep groups (use environment markers: `python-sane>=2.9.0; sys_platform == 'linux'` and `pytwain>=2.0.0; sys_platform == 'win32'` to prevent cross-platform install failures with `--all-extras`)
  - Add mypy overrides for `sane`/`twain`/`wmi`
  - Add `python/graviscan/scan_worker.py` to `[tool.coverage.run] omit` (SANE-only code paths untestable without hardware)
- [ ] 1.2 Update `python/main.spec` — add ONLY modules that exist in this increment:
  - `graviscan`, `graviscan.scan_regions`, `graviscan.scan_worker`
  - `python.graviscan`, `python.graviscan.scan_regions`, `python.graviscan.scan_worker`
  - `sane` (hidden import, graceful failure)
  - Do NOT include `graviscan.models.*` or `graviscan.functions.*` from Ben's branch (those modules don't exist)
- [ ] 1.3 Run `uv sync` to update lockfile
- [ ] 1.4 Verify Pillow installed: `uv run python -c "from PIL import Image; print('OK')"`
- [ ] 1.5 Fix CI: add `sudo apt-get install -y libsane-dev` to `lint-python` and `test-python` jobs in `.github/workflows/pr-checks.yml` (both use `--all-extras`)

## 2. TypeScript Types (test + implementation atomic)

- [ ] 2.1 Cherry-pick `src/types/graviscan.ts` from `origin/graviscan/3-types-python` AND write `tests/unit/graviscan-types.test.ts` in the same commit. Cherry-pick fixes:
  - Add `scan_started_at: Date | null` and `scan_ended_at: Date | null` to `GraviScan` interface
  - Fix scanner model name: use "Epson Perfection V39" consistently
  - Vitest tests to write:
    - `createPlateAssignments('2grid')` returns 2 assignments with correct defaults
    - `createPlateAssignments('4grid')` returns 4 assignments with correct defaults
    - `getPlateLabel` returns 'A(00)', 'B(01)', 'C(10)', 'D(11)'
    - `formatPlateIndex` returns same labels as `getPlateLabel`
    - `generateScannerSlots(3)` returns `['Scanner 1', 'Scanner 2', 'Scanner 3']`
    - `createEmptyScannerAssignment(0)` returns correct defaults
    - Constants: `MIN_SCAN_INTERVAL_MINUTES === 3`, `PLATE_INDICES['2grid']` length 2, `GRAVISCAN_RESOLUTIONS` length 8
- [ ] 2.2 Add GraviScan Prisma model re-exports to `src/types/database.ts`
  - Additive only: `GraviScanPlateAssignment`, `GraviPlateAccession`, `GraviPlateSectionMapping`
- [ ] 2.3 Verify: `npx tsc --noEmit` and `npm run test:unit`

## 3. Python SANE Backend (atomic cherry-picks; 3.2 depends on 3.1)

- [ ] 3.1 Cherry-pick `python/graviscan/__init__.py`, `python/graviscan/scan_regions.py`, AND `python/tests/test_scan_regions.py` together. Cherry-pick fixes:
  - Fix scanner model comment: "Epson V600" → "Epson Perfection V39"
  - Investigate 4-grid region "01": right edge at 220.0mm exceeds `SCANNER_MAX_X=215.9mm` by 4.1mm. Verify against physical hardware or clamp width to 105.9mm.
  - Verify test assertions include non-overlap check for 4-grid regions
- [ ] 3.2 Cherry-pick `python/graviscan/scan_worker.py`, `python/tests/test_scan_worker.py`, AND `python/tests/test_tiff_metadata.py` together. **Depends on 3.1** (scan_worker.py imports from scan_regions.py; both test files import from scan_regions). Cherry-pick fixes:
  - Fix scanner model name if inconsistent
  - Verify tests cover: cancel mid-scan, malformed JSON input, mock-mode fallback, ready event
- [ ] 3.3 Add graviscan import tests to `python/tests/test_imports.py` and `python/tests/test_imports_fallback.py` (depends on 3.1+3.2):
  - Test `from graviscan.scan_regions import ScanRegion, get_scan_region`
  - Test `from python.graviscan.scan_regions import ScanRegion, get_scan_region`
  - Test SANE import guard: `import graviscan.scan_worker` succeeds even without `libsane`
- [ ] 3.4 Verify: `uv run pytest python/tests/test_scan_regions.py python/tests/test_scan_worker.py python/tests/test_tiff_metadata.py python/tests/test_imports.py python/tests/test_imports_fallback.py -v`

## 4. CI & Coverage Verification

- [ ] 4.1 Verify `uv sync --all-extras --frozen` succeeds after lockfile update (with `libsane-dev` installed locally or on CI)
- [ ] 4.2 Run `npm run test:python` and check coverage stays ≥80% (scan_worker.py should be omitted from coverage)

## 5. Full Verification

- [ ] 5.1 Run TypeScript compilation: `npx tsc --noEmit`
- [ ] 5.2 Run TypeScript unit tests: `npm run test:unit`
- [ ] 5.3 Run all Python tests: `npm run test:python`
- [ ] 5.4 Run linting: `npm run lint`
- [ ] 5.5 Run Python linting: `uv run ruff check python/`
- [ ] 5.6 Run Python type checking: `uv run mypy python/`
- [ ] 5.7 Run E2E smoke test to confirm no regressions: `npm run test:e2e -- tests/e2e/app-launch.e2e.ts`
