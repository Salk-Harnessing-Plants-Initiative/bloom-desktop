## Why

After all main-process and pipeline fixes (JPEG encoding, array buffer, frame-dropping gate), the renderer still OOMs at 2.2 GB after ~15 minutes of streaming. A diagnostic test proved:

- **IPC layer is clean**: receiving 266 KB frames at 5 FPS for 20+ minutes without rendering causes NO memory growth (JS heap flat at 26 MB)
- **Rendering pipeline leaks C++ memory**: the `fetch()` → `Blob` → `URL.createObjectURL()` → `Image.src` → `drawImage()` → `URL.revokeObjectURL()` pipeline leaks off-heap memory tracked by V8 as external allocations
- **JS heap is not the leak**: DevTools heap snapshots show ~800 KB growth over 3 minutes; the 2.2 GB is entirely Chromium C++ memory (decoded bitmaps, Blob backing stores, fetch Response bodies)

## Proposed Fix

Replace the fetch/Blob URL/Image pipeline with `createImageBitmap()` + `bitmap.close()`:

- `createImageBitmap(blob)` decodes the image into an `ImageBitmap` with explicit lifecycle
- `bitmap.close()` is specified by the web standard to "dispose of all graphical resources associated with an ImageBitmap" (MDN) and "release the bitmap's underlying pixel data" (HTML spec)
- No `Image` objects, no `fetch()`, no `URL.createObjectURL()`, no `revokeObjectURL()`
- Simpler pipeline: `atob()` → `Uint8Array` → `Blob` → `createImageBitmap()` → `drawImage()` → `bitmap.close()`

## Evidence and Uncertainty

**What we know for certain** (empirically verified):
- The IPC layer does not leak (20+ min diagnostic test)
- The previous rendering pipeline (fetch/Blob URL/Image) leaks C++ memory
- JS heap is not growing — leak is in Chromium's off-heap allocations

**What we believe but have NOT verified**:
- That `bitmap.close()` actually frees the C++ memory in Electron 28 / Chromium 120
- The web spec says it should, and it is the only API designed for explicit bitmap deallocation
- However, we have been wrong 3 times before (img tag, canvas + Blob URL, revokeObjectURL)

**Mitigation**: After implementing, we MUST run a 30+ minute streaming test to verify the OOM is actually fixed before considering this done. If `createImageBitmap().close()` does not fix it, the fallback approach is to stop sending frame data through IPC entirely and instead write frames to a temp file on the main process side, serving them via `file://` URLs or a local HTTP server (bypassing Chromium's IPC deserialization completely).

## Relationship to Prior Work

This is the fourth fix attempt in the streaming OOM series:
1. PR #134: FPS 30→5, sendCommand timeout, detectCameras
2. `fix-streaming-oom` (archived): JPEG encoding, array-based stdout buffer
3. `fix-main-process-frame-leak` (archived): frame-dropping gate, Buffer.from() safety
4. **This proposal**: deterministic bitmap lifecycle via `createImageBitmap` + `close()`

## Related Issues

- Chromium issue 41067124: data URI img src memory leak
- Issue #35: Streamer Component — "no memory leaks" acceptance criteria
- Issue #18: IPC Optimization Options

## What Changes

- **Replace rendering pipeline** in `Streamer.tsx`: `atob()` → `Uint8Array` → `Blob` → `createImageBitmap()` → `drawImage()` → `bitmap.close()`
- **Remove**: `fetch()`, `URL.createObjectURL()`, `URL.revokeObjectURL()`, `Image` object, `imgRef`, `currentBlobUrlRef`
- **Keep**: canvas element, busy gate, mountedRef guard, aspect-ratio letterboxing, FPS counter

## Test Strategy

happy-dom does not support `createImageBitmap`. Tests mock it as a global `vi.fn()` returning a resolved Promise with a mock bitmap `{ close: vi.fn(), width: 2048, height: 1080 }`. Unit tests verify lifecycle (close called, busy gate, decode failure recovery, unmount cleanup). Visual rendering and actual memory behavior verified by manual 30+ minute streaming test.

## Impact

- Affected specs: `scanning` (modifies streaming bitmap lifecycle requirement)
- Affected code:
  - `src/components/Streamer.tsx` — new rendering pipeline
  - `tests/unit/components/Streamer.test.tsx` — updated mocks and assertions
  - `tests/unit/setup.ts` — `createImageBitmap` mock added, URL mocks removed from test file
- Does NOT affect: Python code, main process, frame-forwarder, preload, scan capture
