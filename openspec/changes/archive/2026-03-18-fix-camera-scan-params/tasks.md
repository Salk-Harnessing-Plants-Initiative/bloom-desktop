## 1. Tests (TDD — write before implementation)

### 1.1 Unit Tests: Config Store (`tests/unit/config-store.test.ts`)

- [ ] 1.1.1 Test `MachineConfig` includes `num_frames` and `seconds_per_rot` fields
- [ ] 1.1.2 Test `getDefaultConfig()` returns `num_frames=72`, `seconds_per_rot=7.0`
- [ ] 1.1.3 Test `loadEnvConfig` reads `NUM_FRAMES=36` and `SECONDS_PER_ROT=5.0` from `.env` file
- [ ] 1.1.4 Test `saveEnvConfig` writes `NUM_FRAMES=72` and `SECONDS_PER_ROT=7.0` to `.env` file
- [ ] 1.1.5 Test validation rejects `num_frames` edge cases: 0 (reject), -1 (reject), 1.5 (reject), 721 (reject), 1 (accept), 720 (accept)
- [ ] 1.1.6 Test validation rejects `seconds_per_rot` edge cases: 0 (reject), -1 (reject), 1.9 (reject), 121 (reject), 2.0 (accept), 120.0 (accept)
- [ ] 1.1.7 Test loading `.env` with `SCANNER_NAME` and `CAMERA_IP_ADDRESS` but NO `NUM_FRAMES`/`SECONDS_PER_ROT` returns defaults (72, 7.0) with other fields intact

### 1.2 Unit Tests: Config IPC (`tests/unit/config-ipc.test.ts`)

- [ ] 1.2.1 Test `config:get` handler returns `num_frames` and `seconds_per_rot` from loaded config

### 1.3 Unit Tests: Camera Settings Types (`tests/unit/camera-settings.test.ts`)

- [ ] 1.3.1 Test `DEFAULT_CAMERA_SETTINGS.gain` is 100
- [ ] 1.3.2 Test `DEFAULT_CAMERA_SETTINGS.gamma` is 1.0
- [ ] 1.3.3 Test `DEFAULT_CAMERA_SETTINGS` does NOT have `brightness`, `contrast`, `width`, or `height` properties
- [ ] 1.3.4 Compile-time test: `// @ts-expect-error` assigning `{ brightness: 0.5 }` to `CameraSettings` — verify removed fields cause TS errors (validated by `tsc --noEmit` in CI)

### 1.4 Unit Tests: Python CameraSettings (`python/tests/test_camera_types.py`)

- [ ] 1.4.1 Test `CameraSettings(exposure_time=10000, gain=100)` succeeds and `gain` is `int`
- [ ] 1.4.2 Test `CameraSettings(exposure_time=10000, gain=5.5)` raises `TypeError` or `ValueError`
- [ ] 1.4.3 Test `CameraSettings(exposure_time=10000, gain=-1)` raises `ValueError`
- [ ] 1.4.4 Test `seconds_per_rot` default is 7.0 (expected to fail initially — current default is 36.0)
- [ ] 1.4.5 Test `CameraSettings(exposure_time=10000, gain=100, width=640)` raises `TypeError` (unknown kwarg)
- [ ] 1.4.6 Test `CameraSettings(exposure_time=10000, gain=100, brightness=0.5)` raises `TypeError` (removed field)

### 1.5 Unit Tests: Python camera.py (`python/tests/test_camera_configure.py`)

- [ ] 1.5.1 Test `_configure_camera()` sets `GainRaw.Value` to an `int` when `gain=100`
- [ ] 1.5.2 Test `_configure_camera()` sets `GainRaw.Value` to `int(gain)` when `gain` is passed as float (e.g., `100.0` from JSON deserialization)

### 1.6 Unit Tests: Python IPC Handler (`python/tests/test_ipc_handler_camera.py`)

- [ ] 1.6.1 Test `get_camera_instance()` filters unknown kwargs (e.g., `brightness`, `contrast`) before constructing `CameraSettings`
- [ ] 1.6.2 Test `get_camera_instance()` casts `gain` to `int` when received as float from JSON (e.g., `100.0` → `100`)

### 1.7 Unit Tests: CameraSettingsForm (`tests/unit/components/CameraSettingsForm.test.tsx`)

- [ ] 1.7.1 Test gain slider has `min="36"`, `max="512"`, `step="1"` attributes
- [ ] 1.7.2 Test gain `handleInputChange` calls `onChange` with `parseInt()` result (integer)
- [ ] 1.7.3 Test `screen.queryByLabelText('Brightness')` returns null (control removed)
- [ ] 1.7.4 Test `screen.queryByLabelText('Contrast')` returns null (control removed)
- [ ] 1.7.5 Test `screen.queryByPlaceholderText('Width')` returns null (control removed)
- [ ] 1.7.6 Test exactly 3 range inputs rendered (Exposure, Gain, Gamma)

### 1.8 Unit Tests: CaptureScan Config Integration (`tests/unit/capture-scan-config.test.ts`)

- [ ] 1.8.1 Test CaptureScan calls `config:get` on mount and stores `num_frames` and `seconds_per_rot`
- [ ] 1.8.2 Test `handleStartScan` passes `num_frames` from config into `scanner.initialize()` via DAQ settings
- [ ] 1.8.3 Test `handleStartScan` passes `seconds_per_rot` from config into `scanner.initialize()` via DAQ settings
- [ ] 1.8.4 Test fallback: when config returns no `num_frames`, scanner uses 72 via `?? 72`

### 1.9 Unit Tests: Metadata Defaults (`tests/unit/scan-metadata-json.test.ts`)

- [ ] 1.9.1 Test `buildMetadataObject` uses `brightness: 0` when camera settings has no brightness field
- [ ] 1.9.2 Test `buildMetadataObject` uses `contrast: 0` when camera settings has no contrast field

### CHECK GATE 1: Tests compile and existing suite still passes

- [ ] 1.G.1 `npx tsc --noEmit` — new test files compile (tests 1.3, 1.7 will have expected TS errors against current types; use `@ts-expect-error` or skip-compile annotations as needed)
- [ ] 1.G.2 `npm run lint` — no lint errors in new test files
- [ ] 1.G.3 `npm run test:unit` — existing tests still pass (new tests in red/pending state is OK)
- [ ] 1.G.4 `npm run test:python` — existing Python tests still pass

## 2. Implementation

**IMPORTANT: Sections 2.2 and 2.3 contain interface/type removals. Each section MUST be committed atomically (all subtasks together) to avoid breaking the build between commits.**

### 2.1 Machine Configuration: Add Scan Parameters

- [ ] 2.1.1 Add `num_frames: number` and `seconds_per_rot: number` to `MachineConfig` interface (`src/main/config-store.ts`)
- [ ] 2.1.2 Add defaults: `num_frames: 72`, `seconds_per_rot: 7.0` in `getDefaultConfig()`
- [ ] 2.1.3 Add `NUM_FRAMES` and `SECONDS_PER_ROT` cases to `loadEnvConfig()` switch
- [ ] 2.1.4 Add `NUM_FRAMES` and `SECONDS_PER_ROT` lines to `saveEnvConfig()`
- [ ] 2.1.5 Add validation in `validateConfig()`: `num_frames` integer in 1-720, `seconds_per_rot` in 2.0-120.0
- [ ] 2.1.6 Update `ValidationResult` interface with `num_frames?` and `seconds_per_rot?` error fields
- [ ] 2.1.7 Update `config:get` IPC handler in `src/main/main.ts` to include `num_frames` and `seconds_per_rot` in response object (CRITICAL: the handler hand-picks fields — add them explicitly)
- [ ] 2.1.8 Add "Scan Parameters" section in `src/renderer/MachineConfiguration.tsx` between Hardware and Actions

### CHECK GATE 2: Config store changes verified

- [ ] 2.1.G `npm run lint && npx tsc --noEmit && npm run test:unit` — config store tests (1.1, 1.2) now pass

### 2.2 Camera Settings: Fix Basler Compatibility (ATOMIC COMMIT)

**All 7 subtasks must be committed together. Committing field removal (2.2.2) without UI cleanup (2.2.5-2.2.7) will cause TypeScript errors.**

- [ ] 2.2.1 Fix `gain` default from 0 to 100 in `DEFAULT_CAMERA_SETTINGS` (`src/types/camera.ts`)
- [ ] 2.2.2 Remove `brightness?: number`, `contrast?: number`, `width?: number`, `height?: number` from `CameraSettings` interface
- [ ] 2.2.3 Remove `brightness: 0.5` from `DEFAULT_CAMERA_SETTINGS`
- [ ] 2.2.4 Fix gain slider in `src/components/CameraSettingsForm.tsx`: `min=36`, `max=512`, `step=1`, `parseInt()`
- [ ] 2.2.5 Remove Brightness slider section from `CameraSettingsForm.tsx`
- [ ] 2.2.6 Remove Contrast slider section from `CameraSettingsForm.tsx`
- [ ] 2.2.7 Remove Width/Height inputs section from `CameraSettingsForm.tsx`
- [ ] 2.2.8 Update `tests/unit/scanner-metadata-integration.test.ts` — remove `brightness` and `contrast` from `CameraSettings`-typed test objects (lines ~67-71) to fix `tsc --noEmit`

### CHECK GATE 3: TypeScript camera changes verified

- [ ] 2.2.G `npm run lint && npx tsc --noEmit && npm run test:unit` — camera settings tests (1.3, 1.7) now pass, scanner-metadata-integration test still compiles

### 2.3 Python Backend: Fix Types and Defaults (ATOMIC COMMIT)

**Subtask 2.3.6 (filter kwargs) MUST land together with 2.3.4 (remove fields). Otherwise IPC handler will crash when receiving removed field names from TypeScript.**

- [ ] 2.3.1 Change `gain: float` to `gain: int` in `python/hardware/camera_types.py`
- [ ] 2.3.2 Add integer validation for gain in `__post_init__` (reject non-integer, check >= 0)
- [ ] 2.3.3 Fix `seconds_per_rot` default from 36.0 to 7.0 in `python/hardware/camera_types.py`
- [ ] 2.3.4 Remove `brightness`, `contrast`, `width`, `height` fields from Python `CameraSettings` dataclass
- [ ] 2.3.5 Add `int()` cast in `python/hardware/camera.py` `_configure_camera()`: `self.camera.GainRaw.Value = int(self.settings.gain)`
- [ ] 2.3.6 Filter unknown keys in `python/ipc_handler.py` before constructing `CameraSettings(**kwargs)` to prevent `TypeError` on removed fields
- [ ] 2.3.7 Add `int()` cast for `gain` in `python/ipc_handler.py` `get_camera_instance()` to handle JSON float deserialization

### CHECK GATE 4: Python changes verified

- [ ] 2.3.G `npm run test:python` — Python tests (1.4, 1.5, 1.6) now pass

### 2.4 CaptureScan Integration

- [ ] 2.4.1 Load `num_frames` and `seconds_per_rot` from machine config in `loadMachineConfig` effect (`src/renderer/CaptureScan.tsx`)
- [ ] 2.4.2 Store in component state (e.g., `scanNumFrames`, `scanSecondsPerRot`)
- [ ] 2.4.3 Replace hardcoded `num_frames: 72` and `daq: DEFAULT_DAQ_SETTINGS` with: `daq: { ...DEFAULT_DAQ_SETTINGS, num_frames: scanNumFrames ?? 72, seconds_per_rot: scanSecondsPerRot ?? 7.0 }`
- [ ] 2.4.4 Add read-only scan params display near "Start Scan" button (e.g., "72 frames, ~7s rotation")

### CHECK GATE 5: CaptureScan changes verified

- [ ] 2.4.G `npm run lint && npx tsc --noEmit && npm run test:unit` — CaptureScan tests (1.8) now pass

### 2.5 Metadata Defaults

- [ ] 2.5.1 Update `src/main/scan-metadata-json.ts` brightness fallback from `?? 0.5` to `?? 0`
- [ ] 2.5.2 Update contrast fallback to `?? 0` if not already

### CHECK GATE 6: Metadata changes verified

- [ ] 2.5.G `npm run lint && npx tsc --noEmit && npm run test:unit` — metadata tests (1.9) now pass

### 2.6 PyInstaller Compatibility Fix

**Bug: Section 2.3.6 introduced a hardcoded `from python.hardware.camera_types` import at runtime in `get_camera_instance()` that breaks the PyInstaller bundle. The bundled app uses `hardware.*` import paths, not `python.hardware.*`.**

- [ ] 2.6.1 Remove `from python.hardware.camera_types import CameraSettings as _RealCameraSettings` from `get_camera_instance()` — use the module-level `CameraSettings` reference instead
- [ ] 2.6.2 Remove debug prints from camera module import block (`STATUS:sys.path=...`, `STATUS:Successfully imported from...`, etc.)
- [ ] 2.6.3 Remove redundant `import sys` at line 38 (already imported at line 20)
- [ ] 2.6.4 Remove `brightness`/`contrast`/`width`/`height` from `camera-process.ts` CameraSettings interface (missed duplicate interface)
- [ ] 2.6.5 Fix integration test `test-streaming.ts` gain value from `0.0` to `100` (valid Basler GainRaw)

### CHECK GATE 7: PyInstaller compatibility verified

- [ ] 2.6.G `npm run dev` — Python process starts successfully (no timeout)
- [ ] 2.6.G2 `npm run test:unit && npm run test:python` — all tests still pass

## 2.7 Copilot Review Fixes (TDD)

Addresses GitHub Copilot review comments on PR #122.

### 2.7.1 Tests (Red Phase)

- [x] 2.7.1.1 Test `loadEnvConfig` with `NUM_FRAMES=` (empty) keeps default 72 — not NaN (`config-store.test.ts`)
- [x] 2.7.1.2 Test `loadEnvConfig` with `NUM_FRAMES=abc` (non-numeric) keeps default 72 (`config-store.test.ts`)
- [x] 2.7.1.3 Test `loadEnvConfig` with `SECONDS_PER_ROT=` (empty) keeps default 7.0 (`config-store.test.ts`)
- [x] 2.7.1.4 Test `loadEnvConfig` with `SECONDS_PER_ROT=xyz` (non-numeric) keeps default 7.0 (`config-store.test.ts`)
- [x] 2.7.1.5 Test CameraSettingsForm gain onChange fires with integer value (`CameraSettingsForm.test.tsx`)
- [x] 2.7.1.6 Test CaptureScan `handleStartScan` passes `num_frames` from config into `scanner.initialize()` (`capture-scan-config.test.tsx`)
- [x] 2.7.1.7 Test CaptureScan `handleStartScan` passes `seconds_per_rot` from config into `scanner.initialize()` (`capture-scan-config.test.tsx`)

### 2.7.2 Implementation (Green Phase)

- [x] 2.7.2.1 Guard `parseInt`/`parseFloat` in `loadEnvConfig` — only assign when `!isNaN(parsed)` (`config-store.ts:487-491`)
- [x] 2.7.2.2 Add `num_frames?` and `seconds_per_rot?` to `FormErrors` interface (`MachineConfiguration.tsx:14-20`)
- [x] 2.7.2.3 Render `errors.num_frames` and `errors.seconds_per_rot` under scan param inputs (`MachineConfiguration.tsx:592-623`)
- [x] 2.7.2.4 Replace `@ts-expect-error` type tests with runtime `hasOwnProperty` checks (`camera-settings.test.ts`) — tsconfig excludes tests from type-checking

### CHECK GATE 8: Copilot review fixes verified

- [x] 2.7.G1 `npx tsc --noEmit` — compiles cleanly
- [x] 2.7.G2 `npm run test:unit` — all unit tests pass (400 passed)
- [x] 2.7.G3 `npm run lint && npm run format:check` — clean

## 3. Verification (full suite)

- [ ] 3.1 All unit tests pass (`npm run test:unit`)
- [ ] 3.2 TypeScript compiles cleanly (`npx tsc --noEmit`)
- [ ] 3.3 ESLint clean (`npm run lint`)
- [ ] 3.4 Prettier clean (`npm run format:check`)
- [ ] 3.5 Python tests pass (`npm run test:python`)
- [ ] 3.6 Integration tests pass (`npm run test:integration`) — catches scanner-metadata-integration breakage
- [ ] 3.7 Format code (`npm run format`) and commit any formatting changes
