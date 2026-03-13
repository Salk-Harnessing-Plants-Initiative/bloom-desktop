## 1. Tests (TDD — write before implementation)

### 1.1 Unit Tests: Config Store (`tests/unit/config-store.test.ts`)

- [x] 1.1.1 Test `MachineConfig` includes `num_frames` and `seconds_per_rot` fields
- [x] 1.1.2 Test `getDefaultConfig()` returns `num_frames=72`, `seconds_per_rot=7.0`
- [x] 1.1.3 Test `loadEnvConfig` reads `NUM_FRAMES=36` and `SECONDS_PER_ROT=5.0` from `.env` file
- [x] 1.1.4 Test `saveEnvConfig` writes `NUM_FRAMES=72` and `SECONDS_PER_ROT=7.0` to `.env` file
- [x] 1.1.5 Test validation rejects `num_frames` edge cases: 0 (reject), -1 (reject), 1.5 (reject), 721 (reject), 1 (accept), 720 (accept)
- [x] 1.1.6 Test validation rejects `seconds_per_rot` edge cases: 0 (reject), -1 (reject), 1.9 (reject), 121 (reject), 2.0 (accept), 120.0 (accept)
- [x] 1.1.7 Test loading `.env` with `SCANNER_NAME` and `CAMERA_IP_ADDRESS` but NO `NUM_FRAMES`/`SECONDS_PER_ROT` returns defaults (72, 7.0) with other fields intact

### 1.2 Unit Tests: Config IPC (`tests/unit/config-ipc.test.ts`)

- [x] 1.2.1 Test `config:get` handler returns `num_frames` and `seconds_per_rot` from loaded config

### 1.3 Unit Tests: Camera Settings Types (`tests/unit/camera-settings.test.ts`)

- [x] 1.3.1 Test `DEFAULT_CAMERA_SETTINGS.gain` is 100
- [x] 1.3.2 Test `DEFAULT_CAMERA_SETTINGS.gamma` is 1.0
- [x] 1.3.3 Test `DEFAULT_CAMERA_SETTINGS` does NOT have `brightness`, `contrast`, `width`, or `height` properties
- [x] 1.3.4 Compile-time test: `// @ts-expect-error` assigning `{ brightness: 0.5 }` to `CameraSettings` — verify removed fields cause TS errors (validated by `tsc --noEmit` in CI)

### 1.4 Unit Tests: Python CameraSettings (`python/tests/test_camera_types.py`)

- [x] 1.4.1 Test `CameraSettings(exposure_time=10000, gain=100)` succeeds and `gain` is `int`
- [x] 1.4.2 Test `CameraSettings(exposure_time=10000, gain=5.5)` raises `TypeError` or `ValueError`
- [x] 1.4.3 Test `CameraSettings(exposure_time=10000, gain=-1)` raises `ValueError`
- [x] 1.4.4 Test `seconds_per_rot` default is 7.0 (expected to fail initially — current default is 36.0)
- [x] 1.4.5 Test `CameraSettings(exposure_time=10000, gain=100, width=640)` raises `TypeError` (unknown kwarg)
- [x] 1.4.6 Test `CameraSettings(exposure_time=10000, gain=100, brightness=0.5)` raises `TypeError` (removed field)

### 1.5 Unit Tests: Python camera.py (`python/tests/test_camera_configure.py`)

- [x] 1.5.1 Test `_configure_camera()` sets `GainRaw.Value` to an `int` when `gain=100`
- [x] 1.5.2 Test `_configure_camera()` sets `GainRaw.Value` to `int(gain)` when `gain` is passed as float (e.g., `100.0` from JSON deserialization)

### 1.6 Unit Tests: CameraSettingsForm (`tests/unit/components/CameraSettingsForm.test.tsx`)

- [x] 1.6.1 Test gain slider has `min="36"`, `max="512"`, `step="1"` attributes
- [x] 1.6.2 Test gain `handleInputChange` calls `onChange` with `parseInt()` result (integer)
- [x] 1.6.3 Test `screen.queryByLabelText('Brightness')` returns null (control removed)
- [x] 1.6.4 Test `screen.queryByLabelText('Contrast')` returns null (control removed)
- [x] 1.6.5 Test `screen.queryByPlaceholderText('Width')` returns null (control removed)
- [x] 1.6.6 Test exactly 3 range inputs rendered (Exposure, Gain, Gamma)

### 1.7 Unit Tests: CaptureScan Config Integration (`tests/unit/capture-scan-config.test.ts`)

- [x] 1.7.1 Test CaptureScan calls `config:get` on mount and stores `num_frames` and `seconds_per_rot`
- [x] 1.7.2 Test `handleStartScan` passes `num_frames` from config into `scanner.initialize()` via DAQ settings
- [x] 1.7.3 Test `handleStartScan` passes `seconds_per_rot` from config into `scanner.initialize()` via DAQ settings
- [x] 1.7.4 Test fallback: when config returns no `num_frames`, scanner uses 72 via `?? 72`

### 1.8 Unit Tests: Metadata Defaults (`tests/unit/scan-metadata-json.test.ts`)

- [x] 1.8.1 Test `buildMetadataObject` uses `brightness: 0` when camera settings has no brightness field
- [x] 1.8.2 Test `buildMetadataObject` uses `contrast: 0` when camera settings has no contrast field

## 2. Implementation

### 2.1 Machine Configuration: Add Scan Parameters

- [x] 2.1.1 Add `num_frames: number` and `seconds_per_rot: number` to `MachineConfig` interface (`src/main/config-store.ts`)
- [x] 2.1.2 Add defaults: `num_frames: 72`, `seconds_per_rot: 7.0` in `getDefaultConfig()`
- [x] 2.1.3 Add `NUM_FRAMES` and `SECONDS_PER_ROT` cases to `loadEnvConfig()` switch
- [x] 2.1.4 Add `NUM_FRAMES` and `SECONDS_PER_ROT` lines to `saveEnvConfig()`
- [x] 2.1.5 Add validation in `validateConfig()`: `num_frames` integer in 1-720, `seconds_per_rot` in 2.0-120.0
- [x] 2.1.6 Update `ValidationResult` interface with `num_frames?` and `seconds_per_rot?` error fields
- [x] 2.1.7 Update `config:get` IPC handler in `src/main/main.ts` to include new fields in response
- [x] 2.1.8 Add "Scan Parameters" section in `src/renderer/MachineConfiguration.tsx` between Hardware and Actions

### 2.2 Camera Settings: Fix Basler Compatibility

- [x] 2.2.1 Fix `gain` default from 0 to 100 in `DEFAULT_CAMERA_SETTINGS` (`src/types/camera.ts`)
- [x] 2.2.2 Remove `brightness?: number`, `contrast?: number`, `width?: number`, `height?: number` from `CameraSettings` interface
- [x] 2.2.3 Remove `brightness: 0.5` from `DEFAULT_CAMERA_SETTINGS`
- [x] 2.2.4 Fix gain slider in `src/components/CameraSettingsForm.tsx`: `min=36`, `max=512`, `step=1`, `parseInt()`
- [x] 2.2.5 Remove Brightness slider section from `CameraSettingsForm.tsx`
- [x] 2.2.6 Remove Contrast slider section from `CameraSettingsForm.tsx`
- [x] 2.2.7 Remove Width/Height inputs section from `CameraSettingsForm.tsx`

### 2.3 Python Backend: Fix Types and Defaults

- [x] 2.3.1 Change `gain: float` to `gain: int` in `python/hardware/camera_types.py`
- [x] 2.3.2 Add integer validation for gain in `__post_init__` (reject non-integer, check >= 0)
- [x] 2.3.3 Fix `seconds_per_rot` default from 36.0 to 7.0 in `python/hardware/camera_types.py`
- [x] 2.3.4 Remove `brightness`, `contrast`, `width`, `height` fields from Python `CameraSettings` dataclass
- [x] 2.3.5 Add `int()` cast in `python/hardware/camera.py` `_configure_camera()`: `self.camera.GainRaw.Value = int(self.settings.gain)`
- [x] 2.3.6 Filter unknown keys in `python/ipc_handler.py` before constructing `CameraSettings(**kwargs)` to prevent `TypeError` on removed fields

### 2.4 CaptureScan Integration

- [x] 2.4.1 Load `num_frames` and `seconds_per_rot` from machine config in `loadMachineConfig` effect (`src/renderer/CaptureScan.tsx`)
- [x] 2.4.2 Store in component state (e.g., `scanNumFrames`, `scanSecondsPerRot`)
- [x] 2.4.3 Replace hardcoded `num_frames: 72` and `daq: DEFAULT_DAQ_SETTINGS` with: `daq: { ...DEFAULT_DAQ_SETTINGS, num_frames: scanNumFrames ?? 72, seconds_per_rot: scanSecondsPerRot ?? 7.0 }`
- [x] 2.4.4 Add read-only scan params display near "Start Scan" button (e.g., "72 frames, ~7s rotation")

### 2.5 Metadata Defaults

- [x] 2.5.1 Update `src/main/scan-metadata-json.ts` brightness fallback from `?? 0.5` to `?? 0`
- [x] 2.5.2 Update contrast fallback to `?? 0` if not already

## 3. Verification

- [x] 3.1 All unit tests pass (`npm run test:unit`)
- [x] 3.2 TypeScript compiles cleanly (`tsc --noEmit`)
- [x] 3.3 ESLint clean (`npm run lint`)
- [x] 3.4 Prettier clean (`npm run format:check`)
- [x] 3.5 Python tests pass (`npm run test:python`)
