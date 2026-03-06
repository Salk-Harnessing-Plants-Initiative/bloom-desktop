## 1. Tests

- [x] 1.1 Write unit test: CameraSettingsForm renders seconds_per_rot slider+input with correct range (4-10) and default (7)
- [x] 1.2 Write unit test: CameraSettingsForm renders num_frames slider+input with correct range (12-360) and default (72)
- [x] 1.3 Write unit test: seconds_per_rot slider change calls onChange with updated value
- [x] 1.4 Write unit test: num_frames slider change calls onChange with updated value
- [x] 1.5 Write unit test: seconds_per_rot and num_frames inputs are disabled in readOnly mode
- [x] 1.6 Write unit test: DEFAULT_CAMERA_SETTINGS includes num_frames=72 and seconds_per_rot=7
- [x] 1.7 Write unit test: CaptureScan uses cameraSettings.num_frames (not hardcoded 72) when initializing scanner
- [x] 1.8 Write unit test: CaptureScan passes seconds_per_rot from cameraSettings to DAQ settings

## 2. Implementation

- [x] 2.1 Add `num_frames: 72` and `seconds_per_rot: 7.0` to DEFAULT_CAMERA_SETTINGS in `src/types/camera.ts`
- [x] 2.2 Add seconds_per_rot slider+input control to CameraSettingsForm (after Brightness, before Contrast) following existing pattern
- [x] 2.3 Add num_frames slider+input control to CameraSettingsForm (after seconds_per_rot) following existing pattern
- [x] 2.4 Replace hardcoded `num_frames: 72` in CaptureScan.tsx with `cameraSettings.num_frames ?? DEFAULT_DAQ_SETTINGS.num_frames`
- [x] 2.5 Override `DEFAULT_DAQ_SETTINGS.seconds_per_rot` with `cameraSettings.seconds_per_rot` when initializing scanner in CaptureScan.tsx
- [x] 2.6 Override `DEFAULT_DAQ_SETTINGS.num_frames` with `cameraSettings.num_frames` when initializing scanner in CaptureScan.tsx
