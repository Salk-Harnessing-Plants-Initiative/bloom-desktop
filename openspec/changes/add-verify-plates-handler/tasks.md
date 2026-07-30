## 1. Python QR decode module

- [ ] 1.1 Write `python/tests/test_qr_reader.py` first (fixture-gated, skip
      without real TIFF images — same convention as the existing Node
      fixture tests): asserts `decode_qr_codes()` returns the expected codes
      for the known multi-QR fixture, returns `[]` for a missing file,
      returns `[]` (not an exception) on a decode error. Confirm RED (no
      `qr_reader.py` module exists yet).
- [ ] 1.2 Add `opencv-python-headless` to `pyproject.toml`
- [ ] 1.3 Implement `python/graviscan/qr_reader.py`:
      `decode_qr_codes(image_path: str) -> list[str]` using
      `cv2.QRCodeDetector().detectAndDecodeMulti()`, full resolution, no
      resize. Confirm GREEN.
- [ ] 1.4 Write a failing test for `python/main.py`'s new
      `--decode-qr-batch` mode (stdin JSON array of paths in, stdout JSON
      `[{"path":...,"codes":[...]}]` out) before adding the argparse branch.
      Confirm RED, then implement, confirm GREEN.

## 2. Node-side subprocess wrapper (replaces WASM)

- [ ] 2.1 Write a failing test for the new `src/main/qr-reader.ts` mocking
      `child_process.spawn` (matching `scanner-subprocess.test.ts`'s
      existing convention) — asserts it spawns
      `getPythonExecutablePath()` with `--decode-qr-batch`, writes the batch
      to stdin, parses stdout JSON, and returns `[]` for a path missing from
      the response or on a non-zero exit. Confirm RED.
- [ ] 2.2 Rewrite `src/main/qr-reader.ts` to spawn the Python subprocess
      instead of calling `@undecaf/zbar-wasm`. Confirm GREEN.
- [ ] 2.3 Remove `@undecaf/zbar-wasm` from `package.json`
      dependencies/lockfile entirely.
- [ ] 2.4 Delete the old WASM-based `tests/unit/qr-reader.test.ts` fixture
      tests that exercised zbar-wasm directly; the new subprocess-mocking
      test from 2.1 replaces them (real-image decoding is now covered by
      the Python-side fixture tests in 1.1).

## 3. Verify-plates handler: correctness fixes

- [ ] 3.1 Write a failing test: `experimentId` scoping applies to every
      write/lookup site, not just the read-side lookup — two experiments
      sharing the same `scanner_id`/`plate_index`, assert the
      non-target experiment's `GraviScanPlateAssignment`/`GraviScan` rows
      are untouched after a swap correction on the target experiment.
      Confirm RED against the current (lookup-only-scoped) code.
- [ ] 3.2 Thread `experimentId` into all five call sites (both swap
      `updateMany`s, both `graviScan.findFirst` lookups, the status
      `updateMany`). Confirm GREEN.
- [ ] 3.3 Write a failing test: a plate with a mixed-case `plate_id`
      (e.g. `"Plate_13"`) that matches its assignment SHALL classify as
      `verified` — confirm this fails against the current code (which only
      lowercases the DB-side value).
- [ ] 3.4 Lowercase `plate.assignedPlateId` at the comparison site. Confirm
      GREEN.
- [ ] 3.5 Write a failing test: a lone `incorrect` result (no swap partner)
      persists `verification_status: 'incorrect'`, not `'unreadable'`.
      Confirm RED against the current remap.
- [ ] 3.6 Remove the `incorrect` → `unreadable` remap; persist `incorrect`
      directly. Confirm GREEN.
- [ ] 3.7 Write a failing test: an `imagePath` outside the scan output
      directory (path traversal) is rejected before being handed to the QR
      decoder, mirroring `read-scan-image`'s existing containment test.
      Confirm RED.
- [ ] 3.8 Reuse the existing realpath-containment helper from
      `register-handlers.ts`'s `read-scan-image` handler. Confirm GREEN.

## 4. Minor cleanups

- [ ] 4.1 Fix the stale "17 IPC channels" comment in `register-handlers.ts`
      (now 18)
- [ ] 4.2 Run `npx prisma format` on `prisma/schema.prisma`
- [ ] 4.3 Make swap dedup position-keyed (`scannerId` + `plateIndex`)
      instead of `assignedPlateId`-alone-keyed
- [ ] 4.4 Drop the unused `'skipped'` status variant from the
      `VerifyStatus` union (never produced)
- [ ] 4.5 Add an inline comment on the intentionally-unwrapped IPC envelope
      (`{success, results, swaps}` vs. `wrapHandler`'s `{success, data}`)
      explaining why, so a future reader doesn't "fix" it

## 5. Spec

- [ ] 5.1 Update `scanning` spec delta: case-insensitive comparison on both
      sides, `experimentId` scoping applies to writes (not just the
      lookup), `incorrect` persisted as its own distinct status (documented
      as a deliberate improvement over production), path-containment
      requirement, Python-backed `readQrCodes` description (replacing the
      WASM description), and the verify-before-upload ordering note as a
      documented (not-yet-implemented) requirement.
- [ ] 5.2 `openspec validate add-verify-plates-handler --strict`

## 6. Verification

- [ ] 6.1 Run full affected test suites (Node vitest, Python pytest), `tsc
      --noEmit`, `prettier --check`. Note: `npm run lint` may fail in this
      worktree specifically due to a pre-existing duplicate
      `eslint-plugin-import` resolution conflict between this worktree's
      `node_modules` and the parent checkout's — not this change's fault;
      verify separately from the parent checkout if needed.
- [ ] 6.2 Confirm no regressions against the pre-existing (already
      identified) noise: same 5 unrelated test-file failures as unmodified
      `main` in this worktree.
