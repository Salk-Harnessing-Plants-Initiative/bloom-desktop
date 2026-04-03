## Why

After switching streaming frames to JPEG and refactoring the stdout buffer to use `Buffer[]` arrays, the app still OOMs — now in the **main process** after ~66 minutes (2.2 GB heap). Root cause:

**`webContents.send()` has no backpressure**: Electron's IPC is fire-and-forget (confirmed by electron/electron#27039, #705). At 266 KB/frame × 5 FPS, if the renderer falls behind, serialized IPC messages queue indefinitely in the main process heap.

**Note**: `Buffer.from()` wrapping was already applied during the `fix-streaming-oom` implementation (lines 205, 213, 230 of python-process.ts). This proposal retroactively adds the spec requirement for that work and implements the remaining frame-dropping gate.

## Relationship to PR #134

This proposal is applied on top of PR #134 (`fix/renderer-memory-leak`) and the sibling proposal `fix-streaming-oom`. It depends on PR #134's FPS reduction (30→5) — the "no unnecessary drops" scenario assumes 200ms frame intervals.

## Related Issues

- Issue #35: Streamer Component — original acceptance criteria included "no memory leaks" (closed; OOM discovered after)
- Issue #96: Preload listener cleanup — related IPC lifecycle concern (note: `camera.onFrame` already has cleanup)
- Issue #18: [Future] IPC Optimization Options — documents base64 overhead and fire-and-forget IPC model
- Issue #47: IPC race condition — shares `PythonProcess` code surface (IPC correlation is out of scope for this change)

## What Changes

- **Extract frame-forwarding logic** into a testable `createFrameForwarder()` function in `src/main/frame-forwarder.ts`
- **Implement latest-frame-wins drop gate** — buffers the most recent frame, drops intermediates when the event loop is blocked. Uses `setImmediate` to yield between sends.
- **Accept a getter function** for `sendFn` (not a snapshot) — re-evaluates on each frame to handle macOS window recreation
- **`try/catch` around `sendFn`** — prevents gate from jamming permanently if `webContents.send()` throws
- **Retroactive spec for Buffer.from()** — documents the existing `handleStdout` buffer safety requirement

## Impact

- Affected specs: `scanning` (adds buffer safety and frame backpressure requirements)
- Affected code:
  - `src/main/frame-forwarder.ts` — new module (extracted from main.ts)
  - `src/main/main.ts` — frame forwarding wired through `createFrameForwarder`
- Does NOT affect: Python code, renderer code, scan capture, frame encoding, `image-captured` or other low-frequency IPC events
