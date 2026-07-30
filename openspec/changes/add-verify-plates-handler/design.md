## Context

A first implementation pass of this proposal ported production's
`graviscan:verify-plates` faithfully, including production's own defects. A
final whole-branch review (opus) found 2 Critical + 5 Important issues. A
full design discussion (with the user) followed, resulting in an
architecture change for QR decoding plus targeted correctness fixes. The
complete rationale, alternatives considered, and evidence gathered is
recorded at `docs/superpowers/specs/2026-07-29-verify-plates-qr-decode-design.md`
(committed `ba1df76`) — this file summarizes the decisions that bind
implementation.

## Decision: QR decoding moves from Node/WASM to a Python subprocess

**Problem:** production's `@undecaf/zbar-wasm` approach has two independent
defects: (1) `main`'s webpack config never copies the `zbar.wasm` asset into
the build (confirmed by an actual webpack build through this project's real
config — `readQrCodes()` throws `ENOENT` and silently returns `[]`, so every
plate is misclassified `unreadable`); (2) the dependency is LGPL-2.1+, the
first copyleft dependency in an otherwise BSD-2-Clause distributed app, with
no NOTICE/third-party-licenses documentation anywhere in this project or
production's own tree.

**Alternatives considered** (see the linked doc for full detail):
- Fix the webpack bundling directly (production's own `webpack.plugins.ts`
  already has the `CopyWebpackPlugin` entry `main`'s port omitted) — would
  fix defect (1) but leaves the license question (2) unaddressed.
- Switch to `jsQR` (MIT, pure JS) — ruled out: production's own test
  fixtures prove a single plate image can contain multiple QR codes
  (`plate11_S2_10.tif` asserts `codes.length === 4`); jsQR only returns one
  match per scan.
- Switch to `zxing-wasm` (Apache-2.0) — viable, still WASM (same bundling
  discipline required, though better documented), no license concern.
- **Chosen: Python subprocess using OpenCV** (`cv2.QRCodeDetector().detectAndDecodeMulti()`,
  Apache-2.0, native multi-symbol support). Eliminates both defects at once
  and fits this codebase's existing architecture: `python/main.py` already
  routes between multiple CLI modes for the PyInstaller-packaged executable
  (`--scan-worker`, added in PR #258), and `python/main.spec` already
  bundles other Python image libraries (`pillow`, `numpy`).

**Why one-shot subprocess, not a persistent IPC process:** traced
production's actual call site (`useScanSession.ts`) — `runPostScanVerification()`
fires exactly once per completed scan session, batching every completed
plate into one `verifyPlates()` call, right before upload. A session runs
for a long time; one subprocess spawn at the very end is negligible. Unlike
the scanner/camera/DAQ subprocesses, there's no continuous device state to
justify a long-lived `PythonProcess`-style IPC channel here.

**Resolution, not resize:** decode at full resolution. The original code's
docstring claimed a 2000px resize (it didn't actually do one); since this is
a fresh implementation, resizing was considered and rejected — production's
own fixtures show multiple small QR codes per image, and downsizing risks
losing them below their scannable pixel threshold. The memory concern that
would motivate resizing is much smaller for a one-shot subprocess that exits
immediately after each session-end batch than it was for the original
in-process design.

## Decision: fix correctness defects rather than port them faithfully

All of the following are confirmed present in production's actual code today
(direct diff, not assumption) — this plan does not modify production, so
they remain there until a separate decision addresses that branch.

- **Cross-experiment DB writes**: all five write/lookup sites in
  `verify-plates.ts` now include `experimentId` in their `where` clauses,
  matching the real `@@unique([experiment_id, scanner_id, plate_index])`
  constraint (production/first pass scoped only the read-side lookup).
- **Case-sensitivity**: the plate-ID comparison now lowercases both sides
  (production/first pass only lowercased the DB-side value, making the
  match unreachable for this repo's real mixed-case plate IDs).
- **Status fidelity**: a lone `incorrect` (no swap partner) is persisted as
  `incorrect`, not remapped to `unreadable` — production's remap is
  confirmed deliberate (its own code comments explain it) but the user
  decided this proposal should not carry forward an intentionally-confusing
  UX choice into `main`.
- **Path validation**: `imagePath` is checked against the same
  realpath-containment logic `read-scan-image` already uses in this file,
  before decoding.

## Follow-up requirement (documented, not implemented here)

Production's renderer sequences `runPostScanVerification()` to complete
*before* `uploadAllScans()` reads `plate_barcode` for the same session.
`main` already has `uploadAllScans()` (PR #263) but no renderer yet to
enforce this ordering. The `scanning` spec delta documents this as a
requirement for whenever renderer/orchestration work happens — not
implemented in this proposal, which has no renderer scope.
