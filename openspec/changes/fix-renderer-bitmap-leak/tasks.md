## 1. Test Infrastructure and Streamer Tests

- [ ] 1.1 Add canvas/Image/URL mocks to `tests/unit/setup.ts`:
  ```typescript
  // Mock canvas getContext — happy-dom returns null for getContext('2d')
  HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  });

  // Mock URL.createObjectURL / revokeObjectURL
  URL.createObjectURL = vi.fn().mockReturnValue('blob:mock-url');
  URL.revokeObjectURL = vi.fn();
  ```
- [ ] 1.2 Update `tests/unit/components/Streamer.test.tsx`:
  - Add `MockImage` class in test setup that triggers `onload` via `queueMicrotask` when `src` is set
  - Test 1.1: renders canvas element with `data-testid="stream-canvas"` (not img)
  - Test 1.2: registers frame listener on mount (unchanged)
  - Test 1.3: removes frame listener on unmount (unchanged)
  - Test 1.4: busy gate — send frame, before onload fires send another, verify only latest is drawn
  - Test 1.5: shows "Connecting..." before first frame (unchanged)
  - Test 1.6: stops stream on unmount (unchanged)
  - Test 1.7: shows FPS counter (unchanged)
  - Test 1.8: error state when startStream fails (unchanged)
  - Test 1.9: `URL.revokeObjectURL` called after drawImage (verify lifecycle)
  - Test 1.10: `URL.createObjectURL` and `revokeObjectURL` call counts match after multiple frames
  - Test 1.11: onerror clears busy gate and drains pending frame
  - Test 1.12: onload is no-op after unmount (mount, send frame, unmount before onload, trigger onload — no drawImage)
- [ ] 1.3 Run tests — verify RED (current Streamer uses img, not canvas)
- [ ] 1.4 Commit: `test: update Streamer tests for canvas + Blob URL pattern (red)`

## 2. Implement Canvas + Blob URL Rendering

- [ ] 2.1 Rewrite `src/components/Streamer.tsx`:
  - Add `data-testid="stream-canvas"` to canvas element
  - Replace `useState<string>` for `currentFrame` with:
    - `useRef<HTMLCanvasElement>(null)` for canvas
    - `useRef<boolean>(false)` for `hasFirstFrame` (controls placeholder vs canvas visibility)
    - `useRef<boolean>(false)` for `isDecoding` (busy gate)
    - `useRef<string | null>(null)` for `pendingFrame` (latest-frame-wins buffer)
    - `useRef<string | null>(null)` for `currentBlobUrl` (for revocation)
    - `useRef<boolean>(true)` for `mountedRef`
  - Create `Image` object once in useEffect (not per frame)
  - `handleFrame` callback:
    1. If `isDecoding` is true, store in `pendingFrame` (overwrite) and return
    2. Call `decodeAndDraw(dataUri)`
  - `decodeAndDraw(dataUri)` function:
    1. Set `isDecoding = true`
    2. Decode base64 to binary: `fetch(dataUri).then(r => r.blob())` (cleaner than manual atob)
    3. Create Blob URL, revoke previous if exists
    4. Set `imgRef.src = blobUrl`
  - `imgRef.onload` handler:
    1. Check `mountedRef` — return early if false
    2. Clear canvas to black (`clearRect`)
    3. Calculate aspect-ratio-preserving draw rect (letterbox)
    4. `drawImage(img, x, y, w, h)`
    5. Revoke Blob URL immediately
    6. Update FPS counter
    7. Set `isDecoding = false`
    8. If `pendingFrame` exists, call `decodeAndDraw(pendingFrame)` and clear it
  - `imgRef.onerror` handler:
    1. Check `mountedRef` — return early if false
    2. Revoke Blob URL
    3. Set `isDecoding = false`
    4. Drain pending frame (same as onload step 8)
  - Cleanup on unmount (ordered correctly):
    1. Set `mountedRef = false`
    2. Clear `pendingFrame`
    3. Set `imgRef.src = ''` (abort pending decode)
    4. Revoke `currentBlobUrl` if exists
    5. Remove frame listener
    6. Stop stream
  - JSX: Show placeholder div when `!hasFirstFrame`, canvas when `hasFirstFrame`
  - Canvas: `width` and `height` HTML attributes match props, CSS `display: block`, `backgroundColor: '#000'`
- [ ] 2.2 Run Streamer tests — verify GREEN
- [ ] 2.3 Run full TS test suite: `npx vitest run`
- [ ] 2.4 Run prettier: `npx prettier --write src/components/Streamer.tsx tests/unit/components/Streamer.test.tsx`
- [ ] 2.5 Commit: `fix: use canvas + Blob URL rendering to prevent Chromium bitmap cache leak`

## 3. Verification

- [ ] 3.1 Run full Python test suite: `uv run pytest python/tests/ -v`
- [ ] 3.2 Run full TypeScript test suite: `npx vitest run`
- [ ] 3.3 Run lint: `npx eslint --ext .ts,.tsx src/ tests/`
- [ ] 3.4 Run prettier: `npx prettier --check "**/*.{ts,tsx}"`
- [ ] 3.5 Manual acceptance test: start app with mock camera, stream for 30+ minutes, confirm no OOM and renderer heap stays under 500 MB
- [ ] 3.6 Commit any remaining fixes
