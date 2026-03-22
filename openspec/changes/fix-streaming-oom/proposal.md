## Why

The camera streaming preview causes a V8 OOM crash (3.8 GB heap) in ~2.5 minutes. Root cause: each 2048×1080 grayscale frame is sent as an uncompressed PNG base64 data URI (~2.9 MB per frame) through a string-concatenation stdout buffer, creating ~90 MB/s of V8 string allocations that outpace GC. This affects both mock and real hardware equally.

## What Changes

- **Switch streaming frame encoding from PNG to JPEG** — reduces frame payload from ~2.9 MB to ~270 KB (90% reduction), cutting IPC throughput from ~14.5 MB/s to ~1.35 MB/s at 5 FPS. Only affects `grab_frame_base64()` (streaming path). The `capture` action (single-frame grab) remains PNG to preserve the lossless contract.
- **Replace string-concatenation stdout buffer with array-based buffer** in `PythonProcess.handleStdout` — eliminates O(n²) intermediate string allocations during frame reassembly from chunked stdout
- **Update data URI references** from `image/png` to `image/jpeg` in comments, docstrings, and type annotations where they refer to streaming (no runtime validation exists)

## Relationship to PR #134

This proposal is **complementary** to PR #134 (`fix/renderer-memory-leak`), not a replacement. PR #134 addresses the renderer-side leak (canvas→img, FPS 30→5, timeout cleanup). This proposal addresses the remaining root cause: the frame payload size and main-process buffer pattern. Both are needed — PR #134's FPS reduction is a prerequisite for the throughput calculations in this proposal.

## Related Issues

- Issue #18: [Future] IPC Optimization Options — discusses base64 overhead; this is a pragmatic near-term fix
- Issue #96: Preload listener cleanup — related memory leak surface
- Issue #35: Streamer Component — original acceptance criteria included "no memory leaks"

## Impact

- Affected specs: `scanning` (adds streaming frame format and buffer efficiency requirements)
- Affected code:
  - `python/hardware/camera_mock.py` — JPEG encoding in `grab_frame_base64`
  - `python/hardware/camera.py` — JPEG encoding in `_img_to_base64` and `grab_frame_base64`
  - `python/ipc_handler.py` — docstring updates (streaming worker), capture action stays PNG
  - `src/main/python-process.ts` — array-based stdout buffer in `handleStdout`
  - Comments/docstrings in `src/types/camera.ts`, `src/main/camera-process.ts`
  - Documentation: `python/hardware/README.md`, `docs/CAMERA_TESTING.md`
- Does NOT affect:
  - Scan capture (uses separate `grab_frames()` → `iio.imwrite()` → disk path)
  - Single-frame capture action (stays PNG)
