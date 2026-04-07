## Why

bloom-desktop needs clear code boundaries between shared infrastructure and mode-specific modules before integrating GraviScan. Currently, CylinderScan-specific process files (`camera-process.ts`, `daq-process.ts`, `scanner-process.ts`, `scan-metadata-json.ts`) sit alongside shared files in `src/main/`, making it impossible to distinguish what's shared from what's CylinderScan-only. This is the first increment (0a) of the GraviScan integration plan.

## What Changes

- **Move 4 CylinderScan-specific files** from `src/main/` to `src/main/cylinderscan/`
- **Update 13 import statements** across 8 files (`main.ts` + 7 test files, including 1 dynamic `import()`)
- **Add ESLint `no-restricted-imports` rule** to prevent shared code from importing mode-specific modules
- **Pure refactor** — zero functional changes, zero new features

## Impact

- Affected specs: `scanning` (adds directory boundary requirement)
- Affected code:
  - `src/main/camera-process.ts` → `src/main/cylinderscan/camera-process.ts`
  - `src/main/daq-process.ts` → `src/main/cylinderscan/daq-process.ts`
  - `src/main/scanner-process.ts` → `src/main/cylinderscan/scanner-process.ts`
  - `src/main/scan-metadata-json.ts` → `src/main/cylinderscan/scan-metadata-json.ts`
  - `src/main/main.ts` — 4 import path updates
  - `tests/unit/camera-process.test.ts` — 1 import path update
  - `tests/unit/scanner-metadata-integration.test.ts` — 1 import path update
  - `tests/integration/test-daq.ts` — 1 import path update
  - `tests/integration/test-streaming.ts` — 1 import path update
  - `tests/integration/test-scanner-database.ts` — 1 import path update
  - `tests/integration/test-camera.ts` — 2 import path updates
  - `tests/unit/scan-metadata-json.test.ts` — 1 import path update
  - `.eslintrc.json` — add `no-restricted-imports` rule
- Part of GraviScan epic #126
- Does NOT affect: Python code, renderer code, shared infrastructure, frame-forwarder, any functional behavior
