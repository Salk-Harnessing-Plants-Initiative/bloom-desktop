# Streaming Memory Leak Fix — Lessons Learned

## The Problem

The camera streaming preview caused a V8 OOM crash (renderer process) when streaming
for extended periods (15-66 minutes depending on which intermediate fix was applied).
The mock camera sends 2048×1080 grayscale frames at 5 FPS for live preview during
exposure/gain adjustment. Scientists stream continuously between scans in sessions
that can last hours.

## Root Cause (Final)

**Chromium's C++ layer does not reliably free decoded image bitmaps** created through
`fetch()`, `Blob URLs`, `Image` objects, or `URL.revokeObjectURL()`. These APIs create
off-heap C++ memory (decoded RGBA bitmaps) that V8 tracks via
`AdjustAmountOfExternalAllocatedMemory()` but cannot GC. The memory accumulates until
V8's combined (heap + external) limit triggers an OOM.

This is a known Chromium bug: [Chromium issue 41067124](https://issues.chromium.org/issues/41067124).

## The Fix

Use `createImageBitmap()` + `bitmap.close()` — the **only** web API that deterministically
frees decoded C++ bitmap memory.

```typescript
// Pipeline that LEAKS (all of these leak C++ memory):
// ❌ <img src={dataUri}>           — Chromium bitmap cache never evicts data URIs
// ❌ fetch(dataUri).then(r=>r.blob()) — Response/Blob backing store not freed
// ❌ URL.createObjectURL(blob)     — revokeObjectURL only removes URL mapping
// ❌ new Image(); img.src = blobUrl — decoded bitmap lingers in Blink MemoryCache

// Pipeline that WORKS:
const base64 = dataUri.split(',')[1];
const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
const blob = new Blob([bytes], { type: 'image/jpeg' });
const bitmap = await createImageBitmap(blob);
ctx.drawImage(bitmap, x, y, w, h);
bitmap.close(); // ✅ Actually frees C++ pixel data
```

## What We Tried (Chronological)

| #   | Approach                                          | Result         | Why It Failed                                                   |
| --- | ------------------------------------------------- | -------------- | --------------------------------------------------------------- |
| 1   | `<img src={dataUri}>` + React useState            | OOM in 2.5 min | Data URI bitmap cache never evicts (Chromium bug)               |
| 2   | + JPEG encoding (2.9 MB → 266 KB)                 | OOM in 16 min  | Slower leak, same mechanism                                     |
| 3   | + Frame-dropping gate + array buffer              | OOM in 66 min  | Reduced IPC queue growth, but renderer still leaked             |
| 4   | Canvas + Blob URL + `revokeObjectURL()`           | OOM in 15 min  | `revokeObjectURL` only removes URL mapping, doesn't free bitmap |
| 5   | Canvas + `createImageBitmap()` + `bitmap.close()` | **No OOM**     | `close()` deterministically frees C++ pixel data                |

## How We Diagnosed It

### 1. DevTools Heap Snapshots (JS heap)

Comparison between two snapshots showed only ~800 KB growth over 3 minutes.
**The JS heap was NOT leaking.** This ruled out React state, closures, event listeners,
and IPC deserialization as causes.

### 2. DevTools Performance Monitor

JS heap size, DOM nodes, event listeners, and documents all stayed flat during streaming.
Confirmed the leak was entirely in **off-heap C++ memory**.

### 3. No-Render Diagnostic Test

Added `if (true) { return; }` to skip all rendering while still receiving IPC frames.
Streamed for **20+ minutes with no OOM**. This proved:

- IPC layer is clean (Electron structured clone does not leak)
- The leak is 100% in the rendering pipeline

### 4. Activity Monitor

Watched the Electron Helper (Renderer) process memory in macOS Activity Monitor.
With `createImageBitmap` + `close()`, memory stayed flat at ~120 MB for 30+ minutes.
Previous approaches showed steady growth to 2.2 GB.

## Key Lessons

### 1. `revokeObjectURL()` does NOT free memory

It only removes the URL-to-Blob mapping. The underlying Blob data and any decoded
bitmaps remain in Chromium's C++ heap until the browser decides to evict them (which
for data URIs and Blob URLs in a streaming context, it never does reliably).

### 2. `Buffer.slice()` does NOT copy in Node.js

`Buffer.slice()` is an alias for `Buffer.subarray()` — both return views over the
same `ArrayBuffer`. Use `Buffer.from(buffer.subarray(...))` to create independent copies.

### 3. JS heap snapshots don't show C++ memory leaks

If your Electron app OOMs but DevTools heap snapshots show minimal growth, the leak
is in Chromium's off-heap allocations (decoded images, Blob stores, fetch Response
bodies). Use Activity Monitor or `process.memoryUsage()` to see total RSS.

### 4. `createImageBitmap().close()` is the only reliable bitmap cleanup

The HTML spec says `close()` "releases the bitmap's underlying pixel data." In
Chromium's implementation, this nulls the internal `SkImage` reference, allowing Skia
to free the GPU/CPU texture. No other web API provides this guarantee.

### 5. Diagnostic isolation tests are invaluable

The no-render test (receive frames but don't process them) took 5 minutes to set up
and definitively proved the leak was in rendering, not IPC. This saved days of
debugging in the wrong layer.

### 6. The pilot survived because of shorter streaming sessions

The pilot app used the same `<img src={dataUri}>` pattern with the same frame sizes.
It "worked" because scientists didn't continuously stream for 15+ minutes — they
streamed briefly between scans. The leak existed in the pilot too, just never reached
the OOM threshold.

## Architecture (Final)

```
Python subprocess
  → JPEG quality=85 (266 KB/frame)
  → stdout FRAME: protocol
  → PythonProcess.handleStdout (Buffer[] array, Buffer.from() copies)
  → CameraProcess.parseLine (emit 'frame' event)
  → createFrameForwarder (latest-frame-wins gate, setImmediate yield)
  → webContents.send('camera:frame', { dataUri, timestamp })
  → ipcRenderer.on (preload bridge with cleanup function)
  → Streamer.handleFrame (busy gate, latest-frame-wins pending buffer)
  → decodeAndDraw:
      atob() → Uint8Array → Blob → createImageBitmap()
      → clearRect (letterbox) → drawImage(bitmap) → bitmap.close()
```

## Files Changed

| File                             | Change                                         |
| -------------------------------- | ---------------------------------------------- |
| `src/components/Streamer.tsx`    | `createImageBitmap` + `close()` rendering      |
| `src/main/frame-forwarder.ts`    | Latest-frame-wins drop gate                    |
| `src/main/python-process.ts`     | Array-based stdout buffer with `Buffer.from()` |
| `python/hardware/camera.py`      | JPEG quality=85 encoding                       |
| `python/hardware/camera_mock.py` | JPEG quality=85 encoding                       |
| `python/ipc_handler.py`          | 5 FPS streaming target                         |

## Related Issues & References

- [Chromium issue 41067124](https://issues.chromium.org/issues/41067124): data URI img src memory leak
- [quru/image-defer#2](https://github.com/quru/image-defer/issues/2): Browser bug — repeatedly changing image src causes memory leak
- [electron/electron#27039](https://github.com/electron/electron/issues/27039): contextBridge IPC memory (not our cause, but investigated)
- [MDN: ImageBitmap.close()](https://developer.mozilla.org/en-US/docs/Web/API/ImageBitmap/close)
- Issue #35: Streamer Component — "no memory leaks" acceptance criteria
- Issue #18: IPC Optimization Options
