## Why

Scan parameters `seconds_per_rot` and `num_frames` are hardcoded in CaptureScan.tsx (`num_frames: 72`) and sourced from `DEFAULT_DAQ_SETTINGS`, preventing users from adjusting rotation speed and frame count based on plant size and experiment requirements. The pilot application already exposes these as configurable fields.

## What Changes

- Add `seconds_per_rot` slider+input control to CameraSettingsForm (range 4-10, step 0.5, default 7)
- Add `num_frames` slider+input control to CameraSettingsForm (range 12-360, step 1, default 72)
- Add defaults for `num_frames` and `seconds_per_rot` to `DEFAULT_CAMERA_SETTINGS`
- Replace hardcoded `num_frames: 72` in CaptureScan.tsx with value from `cameraSettings.num_frames`
- Pass `seconds_per_rot` from camera settings to DAQ settings when initializing scans

## Impact

- Affected specs: scanning
- Affected code: `src/components/CameraSettingsForm.tsx`, `src/renderer/CaptureScan.tsx`, `src/types/camera.ts`
