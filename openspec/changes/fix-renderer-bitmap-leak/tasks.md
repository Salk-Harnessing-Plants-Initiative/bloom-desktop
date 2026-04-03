## 0. Remove Diagnostic Block

- [x] 0.1 Remove the diagnostic `if (true) { return; }` block from `decodeAndDraw` in `src/components/Streamer.tsx` (lines 94-100). This block was added for the IPC-vs-rendering isolation test and prevents ALL rendering. It must be removed BEFORE the RED phase so that test failures are real, not masked.
- [x] 0.2 Verify existing tests still pass with the diagnostic removed (the fetch/Blob URL pipeline will execute again)
- [x] 0.3 Commit: `chore: remove diagnostic no-render block from Streamer`

## 1. Update Test Infrastructure and Streamer Tests

- [x] 1.1 Update `tests/unit/setup.ts`:
  - Add `createImageBitmap` global mock (happy-dom does not support it)
  - Mock returns `Promise.resolve({ close: vi.fn(), width: 2048, height: 1080 })`
  - Keep canvas `getContext` mock (drawImage, clearRect)
- [x] 1.2 Update `tests/unit/components/Streamer.test.tsx`:
  - Remove `Image` constructor mock (no longer used)
  - Remove `URL.createObjectURL` / `URL.revokeObjectURL` spies (no longer used)
  - Update `flushFrameDecode` helper — new pipeline is simpler: atob (sync) + Blob (sync) + createImageBitmap (one async). Likely 1-2 setTimeout flushes. Validate empirically.
  - Test 1.1: renders canvas element after frame received
  - Test 1.2: registers frame listener on mount (unchanged)
  - Test 1.3: removes frame listener on unmount (unchanged)
  - Test 1.4: busy gate — rapid frames, only latest decoded
  - Test 1.5: shows connecting state before first frame (unchanged)
  - Test 1.6: stops stream on unmount (unchanged)
  - Test 1.7: shows FPS counter (unchanged)
  - Test 1.8: error state when startStream fails (unchanged)
  - Test 1.9: `bitmap.close()` called after drawImage
  - Test 1.10: `bitmap.close()` call count matches frames drawn
  - Test 1.11: drawImage called with canvas context
  - Test 1.12: clearRect called before drawImage (letterbox)
  - Test 1.13: decode failure — mock `createImageBitmap` to reject, verify busy gate clears and pending frame drains
  - Test 1.14: unmount during decode — use a deferred promise pattern: `let resolve; createImageBitmap.mockReturnValueOnce(new Promise(r => { resolve = r; }))`. Send frame, unmount component, then call `resolve(mockBitmap)`. Verify `bitmap.close()` was called but `drawImage` was NOT called.
- [x] 1.3 Run tests — verify RED (current implementation uses fetch/Blob URL/Image)
- [x] 1.4 Commit: `test: update Streamer tests for createImageBitmap pattern (red)`

## 2. Implement createImageBitmap Rendering

- [x] 2.1 Rewrite `decodeAndDraw` in `src/components/Streamer.tsx`:
  - Remove: `fetch()`, `URL.createObjectURL()`, `URL.revokeObjectURL()`, `imgRef`, `currentBlobUrlRef`
  - Remove diagnostic `if (true) { return; }` block
  - New pipeline:
    1. `atob(dataUri.split(',')[1])` → char code loop → `Uint8Array`
    2. `new Blob([bytes], { type: 'image/jpeg' })`
    3. `createImageBitmap(blob)` (returns Promise)
  - `.then(bitmap => ...)`:
    1. Check `mountedRef` — if unmounted, call `bitmap.close()` and return
    2. `ctx.clearRect(0, 0, canvas.width, canvas.height)`
    3. Calculate letterbox using `bitmap.width` / `bitmap.height` (NOT img.naturalWidth)
    4. `ctx.drawImage(bitmap, x, y, drawWidth, drawHeight)`
    5. `bitmap.close()` — immediately free C++ memory
    6. Update FPS, set hasFirstFrame
    7. `isDecoding = false`, drain pending frame
  - `.catch(() => ...)`:
    1. Clear busy gate
    2. Drain pending frame
  - `try/catch` around `atob` (throws synchronously on invalid base64):
    1. Catch → clear busy gate, drain pending
  - Cleanup on unmount: mountedRef = false, clear pendingFrame, remove listener, stop stream
- [x] 2.2 Run Streamer tests — verify GREEN
- [x] 2.3 Run full TS test suite: `npx vitest run`
- [x] 2.4 Commit: `fix: use createImageBitmap + close() for deterministic bitmap deallocation`

## 3. Verification

- [x] 3.1 Run full Python test suite: `uv run pytest python/tests/ -v`
- [x] 3.2 Run full TypeScript test suite: `npx vitest run`
- [x] 3.3 Run lint: `npx eslint --ext .ts,.tsx src/ tests/`
- [x] 3.4 Run prettier: `npx prettier --check "**/*.{ts,tsx}"`
- [x] 3.5 **Critical**: Manual acceptance test — start app with mock camera, stream for 30+ minutes, confirm no OOM. If OOM still occurs, this approach has failed and we need the fallback (file-based frame delivery).
- [x] 3.6 Commit any remaining fixes
