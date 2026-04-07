## 1. Config Store: Add Scanner Mode

- [x] 1.1 Add unit tests for scanner mode in config store:
  - Test: `scanner_mode` field included in loaded config with default value
  - Test: `scanner_mode` persisted to .env when saved
  - Test: validation passes when `scanner_mode` is 'cylinderscan' or 'graviscan'
  - Test: validation fails when `scanner_mode` is missing or invalid
  - Test: CylinderScan-specific fields (camera_ip, num_frames, seconds_per_rot) skipped in validation when mode is 'graviscan'
- [x] 1.2 Run tests — verify RED
- [x] 1.3 Add `scanner_mode` to `MachineConfig` type in `config-store.ts`:
  - Type: `'cylinderscan' | 'graviscan'`
  - `getDefaultConfig()`: default `''` (forces first-run selection)
  - `loadEnvConfig()`: if `SCANNER_MODE` is missing from existing `.env`, default to `'cylinderscan'` (backward compatibility — all existing installs are CylinderScan)
  - Add to `saveEnvConfig`
  - Update `validateConfig` — require non-empty scanner_mode; skip cylinder-specific field validation when mode is 'graviscan'
- [x] 1.3b Update E2E test helper `tests/e2e/helpers/bloom-config.ts`:
  - Add `SCANNER_MODE` parameter to `createTestBloomConfig()` (default: `'cylinderscan'`)
  - Pre-seed in `.env` template so existing E2E tests don't break
- [x] 1.3c Update ALL existing unit test `MachineConfig` object literals to include `scanner_mode: 'cylinderscan'`:
  - `tests/unit/config-store.test.ts` (~37 occurrences)
  - `tests/unit/config-ipc.test.ts` (mock config objects)
  - `tests/unit/components/MachineConfiguration.test.tsx` (mock config responses)
  - Any other test files constructing `MachineConfig` objects
- [x] 1.4 Add `config:get-mode` IPC handler in `main.ts` — returns `{ mode: string }` from loaded config
- [x] 1.5 Expose `config.getMode()` in `preload.ts` context bridge
- [x] 1.6 Add `getMode(): Promise<{ mode: string }>` to `ConfigAPI` type in `electron.d.ts`
- [x] 1.7 Run tests — verify GREEN
- [x] 1.8 Run full suite: `npx vitest run` + `npx tsc --noEmit`
- [x] 1.9 Commit: `feat: add scanner_mode to MachineConfig with mode-aware validation`

## 2. useAppMode Hook

- [x] 2.1 Add `config.getMode` to global test mock in `tests/unit/setup.ts`:
  - Add `config: { getMode: vi.fn().mockResolvedValue({ mode: 'cylinderscan' }) }` to `window.electron` mock
  - Keep minimal — individual test files override with their own config mocks as needed (existing pattern)
  - Do NOT add full ConfigAPI mock globally — existing tests like `MachineConfiguration.test.tsx` set up their own per-file config mocks
- [x] 2.2 Add unit tests for `useAppMode` hook (using `renderHook` from `@testing-library/react`):
  - Test: returns loading state initially
  - Test: returns mode after IPC resolves
  - Test: returns 'cylinderscan' when config has SCANNER_MODE=cylinderscan
- [x] 2.3 Run tests — verify RED
- [x] 2.4 Create `src/renderer/hooks/useAppMode.ts`:
  - Calls `window.electron.config.getMode()` on mount
  - Returns `{ mode: string | null, isLoading: boolean }`
  - `isLoading` is true until IPC resolves
- [x] 2.5 Run tests — verify GREEN
- [x] 2.6 Commit: `feat: add useAppMode hook for runtime scanner mode detection`

## 3. Conditional Routing + Layout

- [x] 3.1 Add unit tests:
  - Test: App shows loading state while mode is resolving
  - Test: CylinderScan routes rendered when mode is 'cylinderscan'
  - Test: Browse routes visible regardless of mode
  - Test: Unknown route redirects to '/'
  - Test: Empty mode (first run) redirects to '/machine-config'
  - Test: Layout subtitle shows mode name ('CylinderScan' or 'GraviScan')
- [x] 3.2 Run tests — verify RED
- [x] 3.3 Update `App.tsx`:
  - Wrap routes in `useAppMode()` loading gate
  - Conditional capture routes based on mode
  - Browse routes always visible
  - Add `<Route path="*" element={<Navigate to="/" />} />` catch-all
- [x] 3.4 Update `Layout.tsx`:
  - Replace hardcoded "Cylinder Scanner" subtitle with mode-derived label
  - Conditional nav items for capture routes
  - Browse nav items always visible
- [x] 3.5 Run tests — verify GREEN
- [x] 3.6 Run full suite: `npx vitest run` + `npx tsc --noEmit`
- [x] 3.7 Commit: `feat: add mode-conditional routing and navigation`

## 4. Mode-Aware Home Page

- [x] 4.1 Add unit tests:
  - Test: renders CylinderScan workflow steps when mode is 'cylinderscan'
  - Test: renders GraviScan workflow steps when mode is 'graviscan'
  - Test: each step navigates to correct route on click
  - Test: redirects to /machine-config when no config exists
- [x] 4.2 Run tests — verify RED
- [x] 4.3 Create `src/renderer/components/WorkflowSteps.tsx`:
  - `WorkflowStep` type: `{ step: number, title: string, description: string, route: string, icon: string }`
  - Reusable step-card component with numbered circles, icons, click navigation
- [x] 4.4 Define `cylinderScanSteps` and `graviScanSteps` arrays
- [x] 4.5 Rewrite `Home.tsx`:
  - Keep first-run config check
  - Replace "Under Construction" with mode-aware workflow steps
  - Use `useAppMode()` to determine which steps to show
- [x] 4.6 Run tests — verify GREEN
- [x] 4.7 Commit: `feat: mode-aware Home page with workflow step guides`

## 5. Machine Config: Mode Selector UI

- [x] 5.1 Add unit tests:
  - Test: scanner mode selector is the first visible field
  - Test: CylinderScan fields visible when mode is 'cylinderscan'
  - Test: CylinderScan fields hidden when mode is 'graviscan'
  - Test: save succeeds with graviscan mode and empty camera_ip
- [x] 5.2 Run tests — verify RED
- [x] 5.3 Update `MachineConfiguration.tsx`:
  - Add scanner mode radio buttons at top of form ("CylinderScan" / "GraviScan")
  - Conditionally render Hardware section (camera IP, test connection) only for cylinderscan
  - Conditionally render Scan Parameters section (num_frames, seconds_per_rot) only for cylinderscan
  - Shared sections always visible: Bloom API Credentials, Station Identity, Scans Directory
- [x] 5.4 Run tests — verify GREEN
- [x] 5.5 Commit: `feat: mode-specific Machine Config fields`

## 6. Final Verification

- [x] 6.1 Run full test suite: `npx vitest run`
- [x] 6.2 Run TypeScript check: `npx tsc --noEmit`
- [x] 6.3 Run ESLint: `npx eslint --ext .ts,.tsx src/ tests/`
- [x] 6.4 Run prettier: `npx prettier --check "**/*.{ts,tsx,json}"`
- [x] 6.5 Run Python tests: `uv run pytest python/tests/ -v`
- [x] 6.6 Commit any remaining fixes
