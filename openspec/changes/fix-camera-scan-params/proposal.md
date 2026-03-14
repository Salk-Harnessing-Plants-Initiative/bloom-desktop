## Why

Camera settings in bloom-desktop have incorrect types, ranges, and defaults for the Basler acA2000-50gm (ace Classic GigE). The UI exposes unsupported parameters (Brightness, Contrast) and dead code (Width, Height). Scan parameters (`num_frames`, `seconds_per_rot`) are hardcoded in `CaptureScan.tsx` instead of being configurable. The Python backend has a conflicting `seconds_per_rot` default (36.0 vs 7.0).

These issues cause: potential runtime crashes on real hardware (gain type mismatch), misleading UI controls, inability to configure scan parameters without code changes, and inconsistency with the pilot implementation.

## What Changes

### Machine Configuration

- Add `num_frames` (integer, default 72, range 1-720) and `seconds_per_rot` (float, default 7.0, range 2.0-120.0) to `MachineConfig` interface
- Add UI controls in `MachineConfiguration.tsx` "Scan Parameters" section (between Hardware and Actions)
- Persist to `~/.bloom/.env` via config store load/save
- Add validation with practical hardware bounds

### Camera Settings (Basler acA2000-50gm corrections)

- **BREAKING**: Fix `gain` type from float to integer, range from 0-20 to 36-512, default from 0 to 100
- Remove Brightness slider and `brightness` field (unsupported on ace Classic, `BslBrightness` is ace 2+ only)
- Remove Contrast slider and `contrast` field (unsupported on ace Classic, `BslContrast` is ace 2+ only)
- Remove Width/Height inputs and `width`/`height` fields (never applied to hardware, dead code)
- Camera Settings form retains exactly 3 controls: Exposure, Gain, Gamma

### Python Backend

- Fix `camera_types.py` `seconds_per_rot` default from 36.0 to 7.0
- Change `gain: float` to `gain: int` with integer validation
- Remove `brightness`, `contrast`, `width`, `height` fields from `CameraSettings` dataclass
- Add `int()` cast in `camera.py` for `GainRaw` safety

### CaptureScan Integration

- Read `num_frames` and `seconds_per_rot` from machine config on mount
- Pass config values into `DAQSettings` when initializing scanner (override `DEFAULT_DAQ_SETTINGS`)
- Display configured scan params (frame count, rotation time) near "Start Scan" button
- Remove hardcoded `num_frames: 72`

### Metadata

- Update `scan-metadata-json.ts` to use `brightness: 0` and `contrast: 0` defaults (Basler identity values)
- `num_frames` and `seconds_per_rot` are already snapshotted into metadata.json via the settings object passed at scan time

## Impact

- Affected specs: `machine-configuration`, `scanning`
- Affected code:
  - `src/main/config-store.ts` (MachineConfig interface, load/save, validation)
  - `src/renderer/MachineConfiguration.tsx` (Scan Parameters section)
  - `src/types/camera.ts` (CameraSettings interface, DEFAULT_CAMERA_SETTINGS)
  - `src/components/CameraSettingsForm.tsx` (remove unsupported controls, fix gain)
  - `src/renderer/CaptureScan.tsx` (read from config, display scan params, remove hardcoded values)
  - `src/main/main.ts` (config:get handler includes new fields)
  - `python/hardware/camera_types.py` (gain type, defaults, remove dead fields)
  - `python/hardware/camera.py` (int cast for GainRaw)
  - `python/ipc_handler.py` (filter unknown kwargs before CameraSettings construction, gain int cast)
  - `src/main/scan-metadata-json.ts` (brightness/contrast defaults)
- Related issues: #101, #95

## References

- Basler acA2000-50gm docs: https://docs.baslerweb.com/aca2000-50gm
- Basler ace GigE Manual (GainRaw tables): https://www.micropticsl.com/wp-content/uploads/2013/09/basler_ace_gige_manual.pdf
- Basler Brightness/Contrast (ace 2+ only): https://docs.baslerweb.com/brightness-and-contrast
- Pilot defaults: bloom-desktop-pilot `scanner.ts:294-303`
- Pilot camera config: bloom-desktop-pilot `pylon_rot.py:99-149`
