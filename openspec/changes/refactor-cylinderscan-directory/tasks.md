## 1. Verify Current State (Pre-Flight)

- [x] 1.1 Run full test suite to establish baseline: `npx vitest run` + `npx tsc --noEmit`
- [x] 1.2 Confirm all 4 files exist at current paths and all 8 import statements match the audit
- [x] 1.3 Commit: none (verification only)

## 2. Move Files + Update Imports

- [x] 2.1 Create `src/main/cylinderscan/` directory
- [x] 2.2 Move 4 files:
  - `src/main/camera-process.ts` → `src/main/cylinderscan/camera-process.ts`
  - `src/main/daq-process.ts` → `src/main/cylinderscan/daq-process.ts`
  - `src/main/scanner-process.ts` → `src/main/cylinderscan/scanner-process.ts`
  - `src/main/scan-metadata-json.ts` → `src/main/cylinderscan/scan-metadata-json.ts`
- [x] 2.3 Update internal import in `scanner-process.ts`: `scan-metadata-json` path (now same directory, should remain `./scan-metadata-json`)
- [x] 2.4 Update 4 imports in `src/main/main.ts`:
  - `'./camera-process'` → `'./cylinderscan/camera-process'`
  - `'./camera-process'` (type import) → `'./cylinderscan/camera-process'`
  - `'./daq-process'` → `'./cylinderscan/daq-process'`
  - `'./scanner-process'` → `'./cylinderscan/scanner-process'`
- [x] 2.5 Update 1 import in `tests/unit/camera-process.test.ts`:
  - `'../../src/main/camera-process'` → `'../../src/main/cylinderscan/camera-process'`
- [x] 2.6 Update 1 import in `tests/unit/scanner-metadata-integration.test.ts`:
  - `'../../src/main/scanner-process'` → `'../../src/main/cylinderscan/scanner-process'`
- [x] 2.6b Update 1 import in `tests/unit/scan-metadata-json.test.ts`:
  - `'../../src/main/scan-metadata-json'` → `'../../src/main/cylinderscan/scan-metadata-json'`
- [x] 2.7 Update 1 import in `tests/integration/test-daq.ts`:
  - `'../../src/main/daq-process'` → `'../../src/main/cylinderscan/daq-process'`
- [x] 2.8 Update 1 import in `tests/integration/test-streaming.ts`:
  - `'../../src/main/camera-process'` → `'../../src/main/cylinderscan/camera-process'`
- [x] 2.9 Update 1 import in `tests/integration/test-scanner-database.ts`:
  - `'../../src/main/scanner-process'` → `'../../src/main/cylinderscan/scanner-process'`
- [x] 2.10 Update 2 imports in `tests/integration/test-camera.ts`:
  - `'../../src/main/camera-process'` → `'../../src/main/cylinderscan/camera-process'` (both import and type import)
- [x] 2.11 Run `npx tsc --noEmit` — verify zero type errors
- [x] 2.12 Run `npx vitest run` — verify all tests pass
- [x] 2.13 Commit: `refactor: move CylinderScan process files to src/main/cylinderscan/`

## 3. Add ESLint Boundary Rule

- [x] 3.1 Add `no-restricted-imports` rule to `.eslintrc.json`:
  ```json
  "rules": {
    "@typescript-eslint/no-restricted-imports": ["error", {
      "patterns": [{
        "group": ["**/cylinderscan/**"],
        "message": "Shared code must not import from cylinderscan/. Only main.ts (the orchestrator) may import mode-specific modules."
      }, {
        "group": ["**/graviscan/**"],
        "message": "Shared code must not import from graviscan/. Only main.ts (the orchestrator) may import mode-specific modules."
      }]
    }]
  }
  ```
- [x] 3.2 Add ESLint override so files INSIDE `cylinderscan/` and `graviscan/`, `main.ts` (the orchestrator), and `tests/` are exempt:
  ```json
  "overrides": [{
    "files": ["src/main/cylinderscan/**", "src/main/graviscan/**", "src/main/main.ts", "tests/**"],
    "rules": {
      "@typescript-eslint/no-restricted-imports": "off"
    }
  }]
  ```
  Note: Tests are exempt because they directly test mode-specific modules and must import them. The rule prevents shared *production* code from importing mode-specific modules.
- [x] 3.3 Run `npx eslint --ext .ts,.tsx src/` — verify no new errors (existing code should pass since only main.ts imports from cylinderscan/, and it's exempted)
- [x] 3.4 Verify the rule catches violations: temporarily add `import {} from './cylinderscan/camera-process'` to `src/main/database.ts`, run eslint, confirm error, remove the test import
- [x] 3.5 Commit: `chore: add ESLint rule enforcing mode-specific directory boundaries`

## 4. Final Verification

- [x] 4.1 Run full test suite: `npx vitest run`
- [x] 4.2 Run TypeScript check: `npx tsc --noEmit`
- [x] 4.3 Run ESLint: `npx eslint --ext .ts,.tsx src/ tests/`
- [x] 4.4 Run prettier: `npx prettier --check "**/*.{ts,tsx,json}"`
- [x] 4.5 Run Python tests: `uv run pytest python/tests/ -v` (should be unaffected)
- [x] 4.6 Verify git shows only moves + import updates + eslint config (no functional changes)
