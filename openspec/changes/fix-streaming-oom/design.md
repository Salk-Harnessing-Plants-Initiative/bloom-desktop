## Context

The camera streaming pipeline sends live preview frames from a Python subprocess to the Electron renderer through stdout → main process IPC → renderer. Each frame traverses: Python `print()` → Node `child_process.stdout` → `handleStdout` string buffer → `parseLine` → `webContents.send()` → `ipcRenderer.on()` → React `useState` → `<img>` tag.

The current pipeline creates ~90 MB/s of V8 string allocations at 5 FPS with 2048×1080 grayscale PNG frames (~2.9 MB each), causing OOM in ~2.5 minutes. This proposal is complementary to PR #134 which addressed renderer-side issues (canvas→img, FPS 30→5). Both fixes are needed.

## Goals / Non-Goals

- **Goals**: Eliminate OOM during streaming preview; maintain visual quality adequate for exposure/gain tuning
- **Non-Goals**: Changing the IPC architecture (e.g., SharedArrayBuffer, HTTP streaming); adding backpressure/flow control; changing scan capture format; changing single-frame capture format

## Decisions

### Decision 1: JPEG quality=85 for streaming frames only

Reduces frame payload from ~2.9 MB to ~270 KB (90% reduction). For a live preview of a stationary plant at 5 FPS, JPEG quality 85 is visually indistinguishable from lossless PNG.

**Scientific justification**: JPEG quality 85 introduces ~0.8% quantization error (+/-2 intensity levels on 8-bit grayscale, 0-255). For exposure/gain tuning, scientists are looking for highlight/shadow clipping, overall brightness, and contrast — all of which remain clearly visible at this quality level. The 8×8 block structure of JPEG could theoretically mask very fine sensor noise patterns, but this is irrelevant for exposure tuning.

**Scope**: Only `grab_frame_base64()` (streaming path) switches to JPEG. The `capture` action in `handle_camera_command()` remains PNG — it's a one-shot operation with no OOM risk, and its lossless contract should be preserved for diagnostic use.

**Alternatives considered:**

- PNG with `compress_level=6` — ~60% reduction but CPU-intensive, still ~1.2 MB per frame
- Downscaling resolution — loses detail needed for exposure/gain tuning
- Binary IPC (no base64) — requires architectural changes to the stdout protocol
- JPEG quality=90 — conservative alternative if scientists express concern (~350 KB vs ~270 KB)

### Decision 2: Array-based stdout buffer

Replace `this.stdinBuffer += data.toString()` with `Buffer[]` array accumulation. When a newline is detected, `Buffer.concat()` + `.toString()` once. This eliminates O(n²) intermediate string allocations from repeated concatenation.

This is a behavior-preserving refactor — the output (parsed lines) is identical. The field is also renamed from `stdinBuffer` to `stdoutChunks` to match its actual purpose (it buffers stdout, not stdin).

**Alternatives considered:**

- Node `readline` module — adds dependency, harder to test, same result
- Custom Transform stream — over-engineered for this fix

## Risks / Trade-offs

- **JPEG is lossy** — acceptable for preview; scan capture uses separate lossless path; single-frame capture stays PNG
- **Grayscale JPEG** — PIL saves grayscale as JPEG mode "L" (single channel), which all browsers support
- **Buffer.concat still allocates** — but once per complete line, not once per chunk; with JPEG frames at ~270 KB this is negligible

## Open Questions

- Should streaming FPS be configurable per use-case? (5 FPS for CaptureScan, higher for CameraSettings exposure tuning) — deferred to separate proposal
