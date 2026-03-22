# Renderer Memory Leak Fix — Design Spec

**Date**: 2026-03-19
**Branch**: `fix/renderer-memory-leak`
**Status**: Draft

## Problem

The Streamer component (`src/components/Streamer.tsx`) creates a `new Image()` for every camera frame at ~30 FPS. Each Image holds a ~2.8 MB base64 data URI (2048x1080 PNG, compress_level=0). Images load asynchronously, so dozens coexist in memory simultaneously. Over ~20 minutes, this exhausts the renderer's V8 heap (3.8 GB OOM).

Secondary issues:

- `PythonProcess.sendCommand()` never clears its timeout on success, leaking closures for up to 3 minutes each.
- `CameraProcess.detectCameras()` throws on `{success: true, configured: true}` responses, indicating a response format mismatch.
- Python `grab_frame_base64()` doesn't use context managers for BytesIO/PIL Image, adding GC pressure.
- Streaming at 30 FPS is unnecessary for a settings preview of a stationary subject.

## Root Cause Analysis

The pilot application (`bloom-desktop-pilot`) avoided this by:

1. Using React `useState` + `<img>` tag — `setBase64img()` naturally implements "latest frame wins"
2. Running the mock streamer at 5 FPS (`time.sleep(0.2)`), not 30 FPS
3. Using Python context managers (`with BytesIO()`, `with Image.fromarray()`) for explicit resource cleanup

Bloom Desktop's canvas-based `new Image()` pattern creates unbounded parallel image decodes at 30 FPS.

## Design

### Fix 1: Replace canvas with `<img>` tag pattern (critical — stops OOM)

Replace the canvas-based `new Image()` per frame pattern with the pilot's proven approach: React `useState` holding the latest data URI rendered via an `<img>` tag.

**Why `<img>` over canvas + frame-gate:**

- The canvas is not used for overlays, annotations, or pixel manipulation — it provides no benefit over `<img>`
- React state naturally implements "latest frame wins" — only one data URI is ever referenced
- No manual busy/pending logic, no onerror edge cases, no unmount guards needed
- Proven stable in the pilot application

**Key changes to Streamer.tsx:**

- Remove `canvasRef`, `new Image()`, and `ctx.drawImage()` logic
- Add `useState<string>` for the current frame data URI
- Replace `<canvas>` with `<img src={currentFrame}>`
- Keep FPS counter (already a positioned `<div>` overlay, not drawn on canvas)
- Keep existing lifecycle: `startStream` on mount, `stopStream` + `removeFrameListener` on unmount
- Keep existing props API (`settings`, `width`, `height`, `showFps`, callbacks)

### Fix 2: Reduce streaming FPS from 30 to 5 (reduces IPC pressure)

The Streamer is used for live preview of camera settings on a stationary subject (CameraSettings page, CaptureScan pre-scan preview). 30 FPS is unnecessary — the pilot used 5 FPS. Reducing to 5 FPS cuts IPC throughput from ~85 MB/s to ~14 MB/s.

**Change:** In `python/ipc_handler.py`, change `target_fps = 30` to `target_fps = 5`.

**Note:** This does NOT affect scan capture. Scan capture uses `scanner.scan()` → `grab_frames()` which saves images directly to disk without streaming.

### Fix 3: Clear sendCommand timeout (correctness)

In `PythonProcess.sendCommand()`, store the timeout ID and `clearTimeout()` when the data or error handler fires.

### Fix 4: Fix detectCameras response handling (correctness)

In `CameraProcess.detectCameras()`, handle the case where Python returns a non-array success response (e.g., `{success: true, configured: true}`) by returning an empty array instead of throwing.

### Fix 5: Python context managers for frame encoding

In `camera_mock.py` and `camera.py`, use `with BytesIO() as buffer:` and `with Image.fromarray(img) as pil_img:` for explicit resource cleanup during streaming, matching the pilot's pattern.

## TDD Plan

Tests are written **before** implementation, following repo conventions (Vitest, React Testing Library, spec-numbered test names).

### Fix 1 Tests: `tests/unit/components/Streamer.test.tsx`

| Test ID | Test Name                                   | Asserts                                                           |
| ------- | ------------------------------------------- | ----------------------------------------------------------------- |
| 1.1     | renders img element when streaming          | `<img>` present in DOM after frame received                       |
| 1.2     | registers frame listener on mount           | `onFrame` called once                                             |
| 1.3     | removes frame listener on unmount           | Cleanup function called                                           |
| 1.4     | displays latest frame only                  | Fire 10 rapid frames, assert img src is the last frame's data URI |
| 1.5     | shows connecting message before first frame | "Connecting..." text visible before any frame arrives             |
| 1.6     | stops stream on unmount                     | `stopStream` called                                               |
| 1.7     | shows FPS counter when showFps is true      | FPS display element present                                       |

### Fix 2 Tests: `python/tests/test_camera_streaming.py` (update existing)

| Test ID | Test Name                 | Asserts                                        |
| ------- | ------------------------- | ---------------------------------------------- |
| 2.1     | streaming target FPS is 5 | Verify ~5 frames received in 1 second (not 30) |

**Existing tests that need assertion updates:**

- `test_start_stream_sends_frames`: Currently expects ~10 frames in 0.5s (30 FPS). At 5 FPS, 0.5s yields ~2-3 frames. Update sleep/assertion.
- `test_start_stream_stop_stream_lifecycle`: Currently expects ~30 frames in 1.0s. At 5 FPS, yields ~5 frames. Update assertion.

### Fix 3 Tests: `tests/unit/python-process.test.ts`

| Test ID | Test Name                                  | Asserts                       |
| ------- | ------------------------------------------ | ----------------------------- |
| 3.1     | clears timeout when data response arrives  | `clearTimeout` called         |
| 3.2     | clears timeout when error response arrives | `clearTimeout` called         |
| 3.3     | timeout still fires if no response         | `reject` called after timeout |

### Fix 4 Tests: `tests/unit/camera-process.test.ts`

| Test ID | Test Name                                           | Asserts                                     |
| ------- | --------------------------------------------------- | ------------------------------------------- |
| 4.1     | returns array when response is array                | Direct array passthrough                    |
| 4.2     | returns cameras when response has cameras field     | Unwraps `{cameras: [...]}`                  |
| 4.3     | returns empty array for non-camera success response | `{success: true, configured: true}` -> `[]` |

### Fix 5 Tests: `python/tests/test_camera_mock.py` (update existing)

| Test ID | Test Name                                    | Asserts                                 |
| ------- | -------------------------------------------- | --------------------------------------- |
| 5.1     | grab_frame_base64 returns valid data URI     | Starts with `data:image/png;base64,`    |
| 5.2     | grab_frame_base64 does not leak file handles | No ResourceWarning after repeated calls |

## Files Changed

| File                                      | Change                                                       |
| ----------------------------------------- | ------------------------------------------------------------ |
| `src/components/Streamer.tsx`             | Replace canvas with `<img>` tag + useState                   |
| `python/ipc_handler.py`                   | Change `target_fps` from 30 to 5                             |
| `src/main/python-process.ts`              | Clear timeout on response                                    |
| `src/main/camera-process.ts`              | Handle non-camera success response in detectCameras          |
| `python/hardware/camera_mock.py`          | Add context managers to `grab_frame_base64()`                |
| `python/hardware/camera.py`               | Add context managers to `grab_frame_base64()`                |
| `src/types/electron.d.ts`                 | Update "~30 FPS" JSDoc comments to "~5 FPS" (lines 157, 173) |
| `src/main/camera-process.ts`              | Update "~30 FPS" JSDoc to "~5 FPS" (line 165)                |
| `tests/unit/components/Streamer.test.tsx` | **New** — Streamer unit tests                                |
| `tests/unit/python-process.test.ts`       | **New** — PythonProcess unit tests                           |
| `tests/unit/camera-process.test.ts`       | **New** — CameraProcess unit tests                           |
| `python/tests/test_camera_streaming.py`   | **Updated** — Verify 5 FPS target                            |
| `python/tests/test_camera_mock.py`        | **Updated** — Context manager / resource tests               |

## OpenSpec Impact

- **scanning/spec.md**: Reviewed — no references to Streamer rendering approach. No update needed.
- **scan-preview/spec.md**: No impact — uses file:// URLs, not streaming
- **machine-configuration/spec.md**: No impact — camera settings unchanged

No OpenSpec spec updates required.

## Out of Scope

- Changing PNG to JPEG encoding (optimization, not needed for fix)
- Adding Python-side backpressure (unnecessary with 5 FPS + latest-frame-wins)

## Follow-up Items

- `preload.ts` `onTrigger` and `onImageCaptured` don't return cleanup functions (unlike `onFrame`) — pattern inconsistency, low risk but should be fixed for consistency
- `ipc_handler.py` capture action also lacks context managers — low frequency, low priority
- Main process frame forwarding (`main.ts:292-300`) reviewed and deemed safe at 5 FPS — no accumulation risk
