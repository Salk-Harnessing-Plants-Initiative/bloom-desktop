# Design: verify-plates QR decoding + correctness fixes

## Context

This is a sub-decision inside Increment 2 of
`docs/superpowers/plans/2026-07-29-graviscan-production-parity-gaps.md`
(porting `graviscan:verify-plates` from production to `main`). A first
implementation pass (worktree `graviscan-verify-plates`, branch
`feat/verify-plates-handler`, commits `48ac5d8..b3130a7`) faithfully ported
production's handler, including production's own defects. The final
whole-branch review (opus) found 2 Critical + 5 Important issues. This doc
records the design decided in a follow-up brainstorm before the fix wave.

All findings below were confirmed by direct investigation (reading actual
code on both `main`'s worktree and `origin/fix/v600-wedge-followups-metadata_propogation_followup`,
never assumed) — see conversation history for the exact commands run.

## Decision 1: QR decoding moves from Node/WASM to Python

**Problem:** production's `qr-reader.ts` uses `@undecaf/zbar-wasm`. Two
independent issues:
- **Bundling (Critical, C1):** `main`'s webpack config never copies
  `zbar.wasm` into the build output. Confirmed via an actual webpack build
  through this project's real `tsconfig.json`/loaders: `readQrCodes()`
  throws `ENOENT` and silently returns `[]`, so every plate is misclassified
  `unreadable`. **Not a production bug** — production's own
  `webpack.plugins.ts` has a `CopyWebpackPlugin` entry for exactly this file;
  the port simply didn't carry that config change over.
- **License (Important, I7):** `@undecaf/zbar-wasm` is LGPL-2.1+, the first
  copyleft dependency in an otherwise BSD-2-Clause app distributed as
  installers. Production carries the same dependency with no
  NOTICE/third-party-licenses documentation — an existing, unaddressed gap
  there too.

**Decision:** decode QR codes in Python instead of Node, using
`cv2.QRCodeDetector().detectAndDecodeMulti()` (OpenCV, Apache-2.0). This
removes both problems at once rather than just fixing the bundling and
documenting the license.

**Why this fits the existing architecture:** `main` already has a working
pattern for this — `python/main.py`'s argparse already routes between
`--scan-worker`/`--ipc`/interactive modes for the PyInstaller-packaged
executable (PR #258), and `python/main.spec` already handles PyInstaller
bundling for `pillow`/`numpy`/etc. Adding `opencv-python-headless` and one
more mode is precedented, not novel.

**Why one-shot, not a long-lived IPC process:** traced production's actual
call site (`useScanSession.ts`): `runPostScanVerification()` fires exactly
once per completed scan session (not per-cycle, not per-image), batching
every completed plate in that session into one `verifyPlates()` call, right
before `uploadAllScans()`. A session runs for a long time (many scan
cycles); one subprocess spawn (~100-500ms) at the very end is negligible.
This is unlike the scanner/camera/DAQ subprocesses, which are legitimately
long-lived because they manage continuous device state — QR decoding has
no such state, so a persistent `PythonProcess`-style IPC process would be
unjustified complexity.

**Interface:**
- `python/graviscan/qr_reader.py` (new): `decode_qr_codes(image_path: str) -> list[str]`.
  Full resolution, no resize (see Decision 3).
- `python/main.py`: new `--decode-qr-batch` mode. Reads a JSON array of
  image paths from stdin (avoids Windows argv-length limits for large
  batches), writes `[{"path": ..., "codes": [...]}]` to stdout, exits.
- `pyproject.toml`: add `opencv-python-headless` to base `dependencies`.
- `src/main/qr-reader.ts`: rewritten to `spawn(getPythonExecutablePath(), ['--decode-qr-batch'])`,
  same public shape (`readQrCodes`-equivalent) so `verify-plates.ts`'s call
  sites barely change. `@undecaf/zbar-wasm` and `sharp`'s QR-specific usage
  removed from `package.json` entirely.
- Per-image decode failure → empty array for that image, not a thrown
  error (matches existing error-isolation convention; the whole batch
  doesn't abort for one bad image).

## Decision 2: fix `verify-plates.ts` correctness bugs, not just port them

All of these are present in production's actual code today (confirmed via
direct diff) — this plan only touches `main`, never production, per its own
Global Constraints, so these remain live on the rig until someone
separately decides to address that branch. Not this plan's scope.

1. **C2 (Critical) — cross-experiment DB write.** `GraviScanPlateAssignment`
   is unique on `(experiment_id, scanner_id, plate_index)`, but all three
   `updateMany` calls (swap correction ×2, status persistence) and both
   `graviScan.findFirst` lookups key only on `(scanner_id, plate_index)`.
   A scanner is a long-lived physical device reused across experiments —
   an unscoped write can silently overwrite a *different* experiment's
   historical `plate_barcode`/`verification_status`. Fix: thread the
   already-available `experimentId` parameter into all five call sites.
2. **I3 (Important, confirmed by user as high-priority) — case-sensitivity.**
   Line ~208 lowercases the DB-side `plate_id` before grouping; the
   comparison against `plate.assignedPlateId` (line ~244) does not lowercase
   the other side. Since this codebase's real plate IDs are mixed-case
   (confirmed via `src/types/graviscan.ts` and production's own QR test
   fixtures, e.g. `"Plate_13"`), the comparison `"plate_13" === "Plate_13"`
   is always false — every correctly-scanned plate is misclassified
   `incorrect`. Fix: lowercase both sides.
3. **I4 (Important) — status remapping.** Production remaps a lone
   `incorrect` result (no swap partner found) to `unreadable` before
   persisting, and its renderer shows the identical "QR Unreadable" label
   for both a truly-unreadable QR and a correctly-decoded-but-wrong plate.
   Confirmed deliberate in production (explanatory code comment exists),
   but **user decision: fix this properly rather than match production's
   confusing UX.** Persist `'incorrect'` as its own distinct
   `verification_status` value. Document in the OpenSpec spec delta as an
   intentional improvement over production. A future renderer will need its
   own label for this status — noted, not implemented now.
4. **I5 (Important) — no path containment check.** `plate.imagePath` is
   passed straight to the QR decoder with no validation, unlike this same
   file's sibling `read-scan-image` handler, which does realpath-based
   containment checking. Confirmed missing in production too. Fix: reuse
   the existing realpath-containment helper before decoding.
5. **Minor cleanups:** stale "17 IPC channels" comment (now 18), run
   `npx prisma format` on the schema change, position-key the swap dedup
   (currently keys off `assignedPlateId` alone), drop the unused
   `'skipped'` status variant (never produced), inline comment explaining
   the intentionally-unwrapped IPC envelope.

## Decision 3: full resolution, no image resize before decoding

The current code's docstring falsely claims a 2000px resize happens before
decoding (it doesn't). Since the QR decoder is being rewritten anyway:
**decode at full resolution, no resize.** Production's own test fixtures
show up to 4 QR codes in a single plate image — downsizing risks shrinking
a QR below its scannable pixel threshold, and the memory concern that would
motivate resizing is much smaller now than in the original design (a
one-shot Python subprocess that exits immediately after each session-end
batch, not a sustained in-process Node/WASM allocation).

## Spec delta addition

Document the verify-plates → upload-all-scans ordering dependency:
verification must complete and its results must be persisted before either
Bloom or Box upload reads `plate_barcode` for the same session (confirmed
via production's `useScanSession.ts`: `await runPostScanVerification()`
happens before `await uploadAllScans()`). `main` has `uploadAllScans()`
already (PR #263) but no renderer yet to enforce this ordering — flagged as
a requirement for whenever renderer/orchestration work happens, not
implemented now.

## Testing

TDD throughout: a failing test before each fix, matching this repo's
established convention. Specifically:
- A mixed-case plate ID test for I3 (the existing 13 tests all use
  pre-lowercased fixtures, which is exactly what hid this bug).
- A cross-experiment isolation test for C2 (two experiments sharing a
  `scanner_id`/`plate_index`, asserting the non-target experiment's row is
  untouched).
- A distinct-`incorrect`-persistence test for I4.
- A path-traversal-rejection test for I5, mirroring `read-scan-image`'s
  existing test.
- Python: `python/tests/test_qr_reader.py`, fixture-gated like the existing
  Node fixture tests (skip without real TIFF images), plus a Node-side test
  mocking `child_process.spawn` (matching `scanner-subprocess.test.ts`'s
  existing convention) instead of mocking a WASM module.
- A build-level regression test for C1 category of bug is out of reach of
  unit tests (webpack bundling isn't exercised by vitest) — mitigated by
  removing the WASM dependency entirely rather than trying to test the
  bundling step.
