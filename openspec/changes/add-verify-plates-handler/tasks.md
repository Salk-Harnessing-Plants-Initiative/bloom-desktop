## 1. Python QR decode module (already landed — verify only)

The Python side of this proposal was implemented ahead of the rest of the fix
wave and is green. These items are **done**; re-verify rather than re-write.

- [x] 1.1 `python/tests/test_qr_reader.py` exists and passes. Two tiers:
      synthetic QR images generated with `cv2.QRCodeEncoder` (always run, no
      cv2 mocking) plus fixture-gated tests against the real ~61MB GraviScan
      TIFF captures, which skip when absent.
- [x] 1.2 `opencv-python-headless` is in `pyproject.toml`'s core
      `dependencies`.
- [x] 1.3 `python/graviscan/qr_reader.py` implements
      `decode_qr_codes(image_path) -> list[str]` via
      `cv2.QRCodeDetector().detectAndDecodeMulti()`, full resolution, no
      resize (there is a regression test asserting `cv2.resize` is never
      called on the decode path).
- [x] 1.4 `python/main.py --decode-qr-batch` implements the stdin/stdout JSON
      wire protocol, covered by `python/tests/test_main.py`.
- [x] 1.5 `python/main.spec` declares `cv2`, `graviscan.qr_reader`, and
      `python.graviscan.qr_reader` as hidden imports.

## 2. Node-side subprocess wrapper (replaces WASM)

- [x] 2.1 Failing test for the new `src/main/qr-reader.ts` mocking
      `child_process.spawn` (matching `scanner-subprocess.test.ts`'s
      convention) — asserts it spawns `getPythonExecutablePath()` with
      `--decode-qr-batch`, writes the batch to stdin, parses stdout JSON, and
      returns empty codes for a path missing from the response, on a
      non-zero exit, or on a spawn failure. Confirm RED.
- [x] 2.2 Implement `readQrCodesBatch(paths)` + `readQrCodes(path)` spawning
      the Python subprocess instead of calling `@undecaf/zbar-wasm`. Confirm
      GREEN.
- [x] 2.3 Remove `@undecaf/zbar-wasm` from `package.json` and
      `package-lock.json` entirely; confirm no remaining references anywhere
      outside these proposal documents.
- [x] 2.4 Replace the old WASM-based fixture tests in
      `tests/unit/qr-reader.test.ts`; real-image decoding is now covered by
      the Python-side fixture tests in 1.1.

## 3. Verify-plates handler: correctness fixes

- [x] 3.1 Failing test: `experimentId` scoping applies to every write/lookup
      site, not just the read-side lookup. Confirm RED against the
      lookup-only-scoped code.
- [x] 3.2 Thread `experimentId` into all five call sites (both swap
      `updateMany`s, both `graviScan.findFirst` lookups, the status
      `updateMany`). Confirm GREEN.
- [x] 3.3 Failing test: `verifyPlates()` refuses to run when `experimentId`
      is absent, rather than silently falling back to unscoped writes.
- [x] 3.4 Make `experimentId` a **required** parameter (not `experimentId?`)
      and remove the `experimentId ? {scoped} : {}` read-side branch, so no
      unscoped code path remains for a future caller to fall into. Reject in
      `register-handlers.ts` too. Confirm GREEN.
- [x] 3.5 Failing test: a plate with a mixed-case `plate_id` (e.g.
      `"Plate_13"`) that matches its assignment classifies as `verified`, and
      a mixed-case swap pair is detected. Confirm RED.
- [x] 3.6 Lowercase `plate.assignedPlateId` at the comparison site and in the
      reciprocal swap match (leaving the stored value's casing intact, since
      that is what gets written back). Confirm GREEN.
- [x] 3.7 Failing test: a lone `incorrect` result (no swap partner) persists
      `verification_status: 'incorrect'`, not `'unreadable'`. Confirm RED
      against the existing remap — note the pre-existing test
      "classifies a lone incorrect plate (no swap partner) and persists
      unreadable" hard-codes the old behavior and must be rewritten, not just
      supplemented.
- [x] 3.8 Remove the `incorrect` -> `unreadable` remap. Confirm GREEN.
- [x] 3.9 Failing test: an `imagePath` outside the scan output directory
      (symlink escape or `..` traversal) is rejected before being handed to
      the QR decoder. Confirm RED.
- [x] 3.10 Extract the realpath-containment check out of
      `register-handlers.ts`'s `read-scan-image` closure into
      `src/main/graviscan/path-containment.ts` (a separate module —
      `register-handlers.ts` imports `verify-plates.ts`, so exporting it from
      there would be a circular import). Point `read-scan-image` at it. Give
      `verifyPlates()` an explicit `scanOutputDir` parameter rather than an
      `electron.app` import, preserving its documented Electron-independence,
      and wire the directory through from the IPC registration via
      `imageHandlers.getOutputDir()`. Confirm GREEN.

## 4. Batching, keying, and crash isolation

- [x] 4.1 Failing test: a verification batch issues exactly ONE
      `readQrCodesBatch()` call containing every plate's image path, and
      results are attributed back by path (not by array position). Confirm
      RED against the per-plate `readQrCodes()` loop.
- [x] 4.2 Replace the Step 1 loop with a single batched call. Confirm GREEN.
      This is not a performance nicety: the per-plate loop invalidates the
      one-shot-subprocess rationale the whole QR-decode design rests on.
- [x] 4.3 Failing test: duplicate-QR detection does not flag a plate whose
      own QR codes are unique merely because another scanner's plate at the
      same `plateIndex` was duplicated; and the same code on two scanners at
      the same `plateIndex` IS detected. Confirm RED.
- [x] 4.4 Key `qrToPositions`/`duplicatePositions` on
      `(scannerId, plateIndex)`. Confirm GREEN.
- [x] 4.5 Failing test: two independent swap pairs that share the same
      `assignedPlateId` values are both recorded and corrected; and one
      position is never paired into two different swaps. Confirm RED.
- [x] 4.6 Make swap pairing and dedup position-keyed via a `pairedPositions`
      set, preferring a same-scanner partner. Make the final `swapped` status
      and the completion-log `incorrect` count position-keyed too. Confirm
      GREEN.
- [x] 4.7 Failing test: when the batch subprocess exits non-zero, each image
      is retried individually and the images that are not the crash cause
      still decode. Confirm RED.
- [x] 4.8 Add per-image retry to `readQrCodesBatch()`, scoped to a non-zero
      exit on a batch of more than one image (a spawn failure or an
      exit-0-with-garbage response is not retryable and has its own test).
      Confirm GREEN.
- [x] 4.9 Failing test: verification run twice over the same
      already-corrected batch does not re-swap or double-correct. Confirm
      the behavior, then keep the test as a regression guard.

## 5. Audit trail

- [x] 5.1 Failing test: a swap correction sets `previous_plate_barcode` to
      the pre-correction `plate_barcode` in the same `updateMany` that
      rewrites it. Confirm RED.
- [x] 5.2 Add `previous_plate_barcode String?` to `GraviScanPlateAssignment`
      and generate the migration with `prisma migrate dev` (not hand-edited),
      following this repo's existing
      `<timestamp>_<snake_case_description>` migration-naming convention.
      Confirm the generated SQL is a plain additive
      `ALTER TABLE ... ADD COLUMN`.
- [x] 5.3 Set the field in the swap-correction write. Confirm GREEN.

## 6. Encoding and packaging verification

- [x] 6.1 Windows stdin/stdout/stderr encoding: Python decodes stdin and
      encodes stdout/stderr with the locale codepage unless told otherwise,
      so a non-ASCII character in a scan path is mangled in the request, in
      the echoed-back response, and in the diagnostics. Set UTF-8 explicitly
      on BOTH sides — `PYTHONIOENCODING`/`PYTHONUTF8` on the subprocess env
      in `qr-reader.ts`, and `reconfigure(encoding="utf-8")` on all three
      streams in `decode_qr_batch_mode()` (guarded with `getattr`, so a
      stream without `.reconfigure()` still works). Test BOTH sides: the
      Python side in `test_main.py`, and the Node side by asserting on the
      `env` passed to `spawn` (not just `stdio`) in `qr-reader.test.ts`.
- [x] 6.2 Run an actual PyInstaller build (`node scripts/build-python.js`,
      which invokes `uv run pyinstaller python/main.spec`) and drive the
      packaged executable's `--decode-qr-batch` mode end to end, confirming
      `cv2` and `graviscan.qr_reader` really import from the bundle. This is
      the class of verification that caught the original WASM bundling bug —
      a unit test cannot see it.
- [x] 6.3 Fix whatever 6.2 finds. (It found one: `cv2.imread` takes a
      `const char*` and on Windows uses the ANSI file API, so a non-ASCII
      image path silently fails to open and the plate is misclassified
      `unreadable`. `decode_qr_codes()` now reads the bytes with Python and
      uses `cv2.imdecode`; the test helper's `cv2.imwrite` had the same
      problem and was switched to `cv2.imencode` + `Path.write_bytes`. Test
      added.)

## 7. Minor cleanups

- [x] 7.1 Fix the stale "17 IPC channels" comment in `register-handlers.ts`
      (now 18)
- [x] 7.2 Run `npx prisma format` on `prisma/schema.prisma`
- [x] 7.3 Drop the unused `'skipped'` status variant from the `VerifyStatus`
      union (never produced, never consumed)
- [x] 7.4 Add an inline comment on the intentionally-unwrapped IPC envelope
      (`{success, results, swaps}` vs. `wrapHandler`'s `{success, data}`)
      explaining why, so a future reader doesn't "fix" it

## 8. Spec

- [x] 8.1 Update the `scanning` spec delta's ADDED requirements:
      case-insensitive comparison on both sides, `experimentId` scoping on
      writes (and its required-ness), `incorrect` persisted as its own
      status, path containment via a shared helper, batched Python-backed QR
      reading, native-crash isolation, position keying for duplicate-QR and
      swap detection, `previous_plate_barcode`, idempotency, and the UTF-8 /
      non-ASCII-path requirements.
- [x] 8.2 Add a `## MODIFIED Requirements` section reproducing the full
      existing text of the three live requirements this change invalidates,
      with the enumerated facts updated: `GraviScan IPC Handler Registration`
      (15 -> 18 channels; also corrects pre-existing drift where
      `disable-scanner` and `reset-usb` were already missing),
      `GraviScan PyInstaller Bundling` (hidden imports gain
      `graviscan.qr_reader` and `cv2`), `GraviScan Python Dependencies`
      (`opencv-python-headless` in the core list).
- [x] 8.3 Document upload-gating as an explicit **deferred** requirement —
      `verification_status` does not gate Bloom/Box uploads today, and
      choosing severity thresholds and warn-vs-block behavior is a product
      decision for a separate proposal. No gating code in this change.
- [x] 8.4 Make the "verification must complete before upload reads
      plate_barcode" scenario unambiguous that it is documented, not
      enforced, now that a second upload-related scenario sits next to it.
- [x] 8.5 Fix the Impact section: list `package.json`/`package-lock.json`
      (removal of `@undecaf/zbar-wasm`) and the new
      `path-containment.ts`/second migration; drop the now-false "no existing
      requirement changes" claim.
- [x] 8.6 Reword `design.md`'s citation of
      `docs/superpowers/specs/2026-07-29-verify-plates-qr-decode-design.md` —
      the commit it named lives on `main`, not in this branch's ancestry, so
      citing a hash implied it was part of this branch's history.
- [x] 8.7 Reference GitHub issues #149, #155, #162 (all OPEN, all describing
      this capability) as issues this proposal's implementation PR should
      close, and note that #164 (per-wave metadata uploads / wave-scoping) is
      explicitly out of scope — it needs schema-level work
      (`GraviScanPlateAssignment` has no `wave_number`) that is not done.
- [x] 8.8 `openspec validate add-verify-plates-handler --strict`

## 9. Review follow-ups (post-fix-wave review round)

- [x] 9.1 Test the cross-scanner swap fallback. Every swap test had a
      same-scanner partner available, so the cross-scanner branch of the
      pairing search was unguarded by the suite even though it worked. Add a
      genuine cross-scanner swap (no same-scanner candidate for either
      position) and assert both positions are corrected.
- [x] 9.2 Assert the Node-side UTF-8 env in `qr-reader.test.ts` — the spawn
      assertion only inspected `stdio`, so `PYTHONIOENCODING`/`PYTHONUTF8`
      were untested despite 6.1 claiming both sides were covered.
- [x] 9.3 Add a `## MODIFIED Requirements` entry for
      `GraviScan Conditional Mode Registration`, which asserts the same
      channel count as `GraviScan IPC Handler Registration`. Updating only
      the latter would have archived a spec saying 18 in one requirement and
      15 in the other.
- [x] 9.4 Document the same-scanner swap-preference tie-break in the spec
      delta and in the pairing code comment — it decides which position stays
      `incorrect` in an ambiguous multi-swap batch and was previously
      undocumented behavior.
- [x] 9.5 Never chain a rejected promise onto `qrReadQueue`. The queue tail
      is process-wide; a single rejection would have made every subsequent
      `readQrCodesBatch()` call reject forever, breaking the documented
      "never rejects" contract. Also move `getPythonExecutablePath()` inside
      the try so a throw there becomes a clean failure outcome. Test both.
- [x] 9.6 Distinguish "path could not be resolved" (capture not written yet,
      or removed — an ordinary skip) from "path resolved outside the scan
      directory" (a real containment violation) so a benign case is not
      logged as a security rejection. `resolveContainedPath` returns a
      discriminated result; the IPC handler still returns one generic error
      for both so it cannot be used to probe path existence.
- [x] 9.7 Make `isReciprocal`'s distinctness check compare position keys
      rather than object identity, so two rows sharing a
      `(scannerId, plateIndex)` cannot pair a position with itself.
- [x] 9.8 Route `test_decode_image_without_qr_codes`'s image write through
      the shared `cv2.imencode` + `write_bytes` helper instead of calling
      `cv2.imwrite` directly — harmless on today's ASCII tmp path, but
      inconsistent with the non-ASCII rationale and a trap for the next test.

## 10. Final whole-branch review follow-ups

- [x] 10.1 (C1) Enforce the "required experimentId, no unscoped write path"
      guarantee with a real type check. Both the IPC handler and
      `verifyPlates()` only tested truthiness, and Prisma drops an
      `undefined` `where` key and accepts a filter object where a scalar was
      intended — so a non-string `experimentId`, or a filter-object-shaped
      `scannerId`/`plateIndex`, widened every write to the whole experiment.
      Validate `typeof x === 'string' && x.length > 0` for `experimentId`
      (fatal) and for each plate's
      `scannerId`/`plateIndex`/`assignedPlateId`/`imagePath` (skip that plate
      with a warning). Test each invalid-input vector.
- [x] 10.2 (I1) Correct **every** `GraviScan` row for a swapped position, not
      just the newest. `findFirst({ orderBy: capture_date desc })` left every
      earlier cycle of a time-lapse session carrying the wrong
      `plate_barcode`, and `graviscan-upload.ts` reads it per row. Replaced
      with a set-based `updateMany` scoped by
      `(experiment_id, scanner_id, plate_index, pre-correction plate_barcode,
    deleted:false)` — no signature change, and idempotent because only rows
      that are actually wrong match.
- [x] 10.3 (I2) Add a `lookup_failed` status. A transient DB error in the
      plate-id lookup silently collapsed into `unreadable`, the same
      status-collapse this change already refuses to make for `incorrect`.
- [x] 10.4 (I3) Wrap each swap-pair's four writes in `db.$transaction`. The
      boundary is per swap pair, not per batch, so one bad pair still cannot
      abort the others. Test a mid-sequence failure and confirm rollback.
- [x] 10.5 (I4) Check `updateMany().count`. A swap matching zero rows was
      reported as corrected; counts are now logged and collected into an
      optional `warnings` field on the result.
- [x] 10.6 (I5) Bound `opencv-python-headless` at `<5` and regenerate the
      lockfile. The unbounded `>=4.9.0` resolved to `5.0.0.93`, newer than
      what `pyinstaller-hooks-contrib@2025.9`'s `cv2` hook targets; the
      frozen build was only verified on Windows.
- [x] 10.7 (M1/M2/M3) Result-payload consistency: add `swapped` to
      `VerifyStatus` and write it back onto `results[].status`; report
      `detectedPlateId` and `inconsistentMappings` in original casing
      (lower-case only for the comparison); declare `imagePath` on
      `VerifyPlateResult`; emit the full result object on every
      `verify-result` branch.
- [x] 10.8 (M4) Delete the dead `qr_reader.decode_qr_batch()` —
      `main.py` inlines the identical logic.
- [x] 10.9 (M5) Soften the tie-break NOTE. The same-scanner preference
      narrows but does not eliminate input-order dependence: pairing is
      greedy, so a 3-way ambiguity can still resolve differently depending on
      submission order.

## 11. Verification

- [x] 11.1 Run the full test suites (Node vitest, Python pytest) plus
      `tsc --noEmit` and `npm run format:check`. Note: `npm run lint` may
      fail in this worktree specifically due to a pre-existing duplicate
      `eslint-plugin-import` resolution conflict between this worktree's
      `node_modules` and the parent checkout's — not this change's fault;
      verify separately from the parent checkout if needed.
- [x] 11.2 Confirm no regressions against the pre-existing (already
      identified) noise: run the same suites at the branch's base commit and
      diff the failure sets, rather than assuming a failure is unrelated.
