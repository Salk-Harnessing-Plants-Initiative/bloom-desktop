## 1. Buffer.from() for chunk independence (python-process.ts) — ALREADY DONE

Buffer.from() wrapping was applied during the `fix-streaming-oom` implementation (lines 205, 213, 230 of python-process.ts). This section retroactively adds the spec requirement. No further code changes needed.

- [x] 1.1 Buffer.from() applied on all three subarray sites
- [x] 1.2 Tests pass

## 2. Latest-Frame-Wins Drop Gate (frame-forwarder.ts)

- [x] 2.1 Write unit tests in `tests/unit/frame-forwarder.test.ts`:
  - Test: first frame forwarded when gate is open
  - Test: intermediate frame dropped when gate is closed
  - Test: latest frame (not intermediate) sent when gate reopens
  - Test: all frames forwarded at 5 FPS with event loop yields (no unnecessary drops)
  - Test: no error when getSendFn returns null
  - Test: gate starts fresh for each createFrameForwarder call (process recreation)
  - Test: gate does not jam when sendFn throws (try/catch recovery)
  - Test: re-evaluates getSendFn on each frame (handles window recreation)
  - Test: ignores empty dataUri
- [x] 2.2 Run tests — verify RED (frame-forwarder.ts does not exist yet)
- [x] 2.3 Create `src/main/frame-forwarder.ts` with `createFrameForwarder(getSendFn)`:
  - Accepts a getter `() => sendFn | null` (re-evaluated each frame)
  - Implements latest-frame-wins: buffers newest frame, sends on gate reopen
  - `try/catch` around sendFn to prevent gate jamming
  - `setImmediate` to yield between sends
  - Ignores empty dataUri
- [x] 2.4 Wire into `ensureCameraProcess()` in `main.ts`, replacing the current `cameraProcess.on('frame', ...)` handler
- [x] 2.5 Run tests — verify GREEN
- [x] 2.6 Run full TS test suite: `npx vitest run` — 489 passed
- [x] 2.7 Commit: `fix: add frame-dropping gate to prevent IPC queue leak`

**Note on `setImmediate` in tests**: Use `vi.useRealTimers()` in beforeEach and flush with `await new Promise(resolve => setImmediate(resolve))`. vitest does not fake `setImmediate` by default.

## 3. Verification

- [x] 3.1 Run full Python test suite: `uv run pytest python/tests/ -v` — 138 passed, 85% coverage
- [x] 3.2 Run full TypeScript test suite: `npx vitest run` — 489 passed
- [x] 3.3 Run lint: `npx eslint --ext .ts,.tsx src/ tests/` — 1 pre-existing error (prefer-const in python-process.ts from PR #134 TDZ fix, not from this change)
- [x] 3.4 Manual test: diagnostic no-render test confirmed 20+ min streaming without OOM — IPC layer and frame-dropping gate working correctly
- [x] 3.5 Commit any remaining fixes
