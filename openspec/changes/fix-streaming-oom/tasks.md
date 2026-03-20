## 1. JPEG Streaming Encoding (Python)

- [x] 1.1 Update Python tests: change `data:image/png` assertions to `data:image/jpeg` in `test_camera_streaming.py` (lines 55, 106, 109)
- [x] 1.2 Update Python tests: change `img.format == "PNG"` to `"JPEG"` in `test_camera_streaming.py` (line 86-88)
- [x] 1.3 Add frame size assertion: `assert len(base64_part) < 500_000` in `test_mock_camera_grab_frame_base64_returns_data_uri`
- [x] 1.4 Add `Camera._img_to_base64` unit test: create synthetic numpy array, call static method, assert JPEG format and grayscale mode "L"
- [x] 1.5 Add grayscale round-trip test: encode numpy array → JPEG → decode, assert mode "L" and matching dimensions
- [x] 1.6 Add scan capture regression test: verify `iio.imwrite()` path still produces PNG files (not affected by JPEG change)
- [x] 1.7 Add streaming FRAME content test: extract a FRAME line from streaming output and assert `data:image/jpeg;base64,` prefix
- [x] 1.8 Run Python tests — verify updated assertions FAIL (red)
- [x] 1.9 Switch `MockCamera.grab_frame_base64()` to JPEG quality=85 in `camera_mock.py` (lines 229-234)
- [x] 1.10 Switch `Camera._img_to_base64()` to JPEG quality=85 in `camera.py` (lines 212-216)
- [x] 1.11 Switch `Camera.grab_frame_base64()` data URI prefix to `image/jpeg` in `camera.py` (line 200)
- [x] 1.12 Run Python tests — verify they PASS (green)
- [x] 1.13 Update docstrings referencing PNG format in `camera.py`, `camera_mock.py`, `ipc_handler.py` (streaming worker only — capture action stays PNG)
- [x] 1.14 Commit: `fix: switch streaming frame encoding from PNG to JPEG`

**Note:** The `capture` action in `ipc_handler.py` (lines 525-533) is a single-frame grab and stays PNG. Do NOT change it. The existing `test_camera_commands.py:250` assertion (`data:image/png`) must remain green.

## 2. Array-Based Stdout Buffer (TypeScript)

This is a **behavior-preserving refactor** — all tests should pass both before and after the change.

- [x] 2.1 Add handleStdout unit tests to `tests/unit/python-process.test.ts`:
  - Test: single complete line (e.g., `STATUS:ready\n`) is parsed and emitted
  - Test: line split across two chunks is reassembled correctly
  - Test: multiple lines in one chunk are all parsed and emitted separately
  - Test: trailing incomplete line is retained in buffer for next chunk
  - Test: empty Buffer chunk does not emit any lines or corrupt state
  - Test: buffer is cleared when `stop()` is called
- [x] 2.2 Run tests — verify all PASS against current implementation (green — refactoring under green)
- [x] 2.3 Refactor `handleStdout` in `python-process.ts`:
  - Replace `stdinBuffer: string` with `stdoutChunks: Buffer[]` and `stdoutChunksLength: number`
  - Accumulate `Buffer` chunks in array instead of string concatenation
  - On newline detection (`Buffer.indexOf(0x0A)`): `Buffer.concat()` once, then `toString()` once
  - Clear buffer after extracting complete lines
  - Rename `stdinBuffer` to `stdoutChunks` to reflect actual usage
  - Clear buffer in `stop()` method
- [x] 2.4 Run tests — verify all still PASS (green)
- [x] 2.5 Commit: `fix: replace string-concat stdout buffer with array-based buffer`

## 3. Comment/Docstring Updates

- [x] 3.1 Update JSDoc in `src/types/camera.ts` (line 53): `image/png` → `image/jpeg` for streaming context
- [x] 3.2 Update comments in `src/main/camera-process.ts` (lines 36, 62, 66): PNG → JPEG for FRAME: protocol
- [x] 3.3 Update comments in `src/main/python-process.ts` (lines 13, 30): PNG → JPEG where referencing streaming
- [x] 3.4 Update `python/hardware/README.md`: streaming frame format reference
- [x] 3.5 Update `docs/CAMERA_TESTING.md`: streaming output format reference
- [x] 3.6 Update TS Streamer test data URIs for consistency (optional — mock data, not validated)
- [x] 3.7 Commit: `docs: update streaming data URI format references from PNG to JPEG`

## 4. Verification

- [x] 4.1 Run full Python test suite: `uv run pytest python/tests/ -v`
- [x] 4.2 Run full TypeScript test suite: `npx vitest run`
- [x] 4.3 Run lint: `npx eslint --ext .ts,.tsx src/ tests/` and `uv run black --check python/`
- [x] 4.4 Verify `test_camera_commands.py` still passes (capture stays PNG)
- [x] 4.5 Manual test: start app with mock camera, stream for 5+ minutes, confirm no OOM
- [x] 4.6 Commit any remaining fixes
