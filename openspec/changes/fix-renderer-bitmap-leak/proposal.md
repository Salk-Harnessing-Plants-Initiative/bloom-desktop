## Why

After fixing the main process IPC queue leak (JPEG encoding, array buffer, frame-dropping gate), the renderer still OOMs at 2.2 GB after ~14 minutes of streaming. Root cause: **Chromium's decoded image bitmap cache does not evict data-URI-keyed entries** (Chromium issue 41067124, quru/image-defer#2). Each frame creates an 8.4 MB decoded RGBA bitmap (2048×1080×4) that lingers in Blink's MemoryCache. At 5 FPS, ~260 retained bitmaps accumulate to 2.2 GB.

This is not a reference leak — React correctly replaces state, and IPC is clean. It's a **Chromium engine bug** with no upstream fix.

## Relationship to Prior Work

This is the fourth and final fix in the streaming OOM series:
1. PR #134: canvas→img, FPS 30→5, sendCommand timeout, detectCameras (renderer-side)
2. `fix-streaming-oom`: JPEG encoding, array-based stdout buffer (pipeline throughput)
3. `fix-main-process-frame-leak`: frame-dropping gate (IPC backpressure)
4. **This proposal**: deterministic bitmap lifecycle (Chromium cache bypass)

Note: This reverses PR #134's canvas→img change, going back to canvas but with proper lifecycle (Blob URLs + single reused Image + explicit revocation). The img-based approach triggered the Chromium cache bug that canvas + Blob URL avoids.

## Related Issues

- Chromium issue 41067124: Setting img.src to data URI causes memory leak
- quru/image-defer#2: Browser bug — repeatedly changing image src causes memory leak
- Issue #35: Streamer Component — "no memory leaks" acceptance criteria
- Issue #18: IPC Optimization Options
- Issue #96: Preload listener cleanup — related IPC lifecycle concern
- Issue #47: IPC race condition — shares PythonProcess code surface (out of scope)

## What Changes

- **Replace `<img src={dataUri}>` with canvas rendering** in `Streamer.tsx` — draw frames on a `<canvas>` element using `drawImage()` with aspect-ratio-preserving letterbox scaling (replicating `objectFit: contain`)
- **Use Blob URLs with explicit revocation** — `URL.createObjectURL()` + `URL.revokeObjectURL()` immediately after `drawImage()` gives the browser a synchronous deallocation signal
- **Reuse a single Image object** for decoding — prevents per-frame Image allocation
- **Busy gate with mountedRef guard** — skip incoming frames while decoding, guard onload/onerror against firing after unmount
- **Preserve pre-frame "Connecting..." state** — show placeholder div until first frame is drawn, then show canvas

## Test Strategy

happy-dom (vitest environment) does not support canvas rendering or Blob URLs natively. Tests require mocking infrastructure:
- `HTMLCanvasElement.prototype.getContext` → mock returning `{ drawImage: vi.fn(), clearRect: vi.fn() }`
- `Image` constructor → mock with controllable `onload`/`onerror` (set src triggers onload via queueMicrotask)
- `URL.createObjectURL` / `URL.revokeObjectURL` → vi.fn() mocks returning fake URLs
- Canvas element found via `data-testid="stream-canvas"` (canvas has no implicit ARIA role)

Unit tests verify lifecycle and resource management (the leak prevention logic). Visual rendering is verified by manual/E2E testing.

## Impact

- Affected specs: `scanning` (adds deterministic bitmap lifecycle requirement)
- Affected code:
  - `src/components/Streamer.tsx` — canvas + Blob URL rendering
  - `tests/unit/components/Streamer.test.tsx` — updated for canvas with mocks
  - `tests/unit/setup.ts` — canvas/Image/URL mock infrastructure
- Does NOT affect: Python code, main process, frame-forwarder, preload, scan capture
