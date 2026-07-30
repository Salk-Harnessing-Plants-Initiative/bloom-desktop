## Why

GraviScan operators physically load plates onto scanner platens. Nothing on
`main` verifies that the physical plate at a given scanner/position actually
matches the plate the operator assigned to it in the DB
(`GraviScanPlateAssignment`) — if two plates get swapped during loading, the
scan data is silently attributed to the wrong plate/accession with no
detection or correction path. Production (branch
`fix/v600-wedge-followups-metadata_propogation_followup`) already has this as
`graviscan:verify-plates`: it reads the QR code baked into each plate's scan
image, looks up which plate that QR code belongs to, compares it against the
assignment, and auto-corrects the common "two plates swapped with each other"
case. This proposal ports that capability to `main`'s modular
`src/main/graviscan/` handler layout.

This lands as a formal proposal (rather than a quick patch) because it
introduces a new capability with real DB side effects, a new dependency
(OpenCV, for QR decoding — see `design.md` for why this is Python rather than
production's Node/WASM approach), and a new Prisma migration
(`verification_status` on `GraviScanPlateAssignment`) — schema + dependency +
capability changes together, per this project's own guidance on when
`/openspec:proposal` is required.

**A first implementation pass of this proposal was built, then a final
whole-branch review found 2 Critical + 5 Important defects — all confirmed,
via direct code comparison, to already exist in production's own
implementation (this port faithfully carried them over), except one
(WASM-bundling) which was introduced by an incomplete port. This proposal has
been revised to fix all of them rather than ship a faithful-but-broken port.
See `design.md` for the full rationale.** None of these fixes touch the
production branch itself — that branch is explicitly out of scope for this
plan (`docs/superpowers/plans/2026-07-29-graviscan-production-parity-gaps.md`).

## What Changes

- **New module** `src/main/graviscan/verify-plates.ts` exporting
  `verifyPlates(db, plates, experimentId?, onProgress?)` — a pure,
  DB-injected async function (matches this repo's handler-module convention:
  one exported function per logical concern, no direct `ipcMain` coupling).
  - Reads QR codes from each plate's scan image via a Python-backed
    `readQrCodes()` (see `design.md`).
  - Detects duplicate QR codes read across multiple plates in the same batch
    and flags those plates `duplicate_qr` instead of attempting a normal
    compare.
  - Looks up each detected QR code's owning plate via
    `GraviPlateSectionMapping` (optionally scoped to `experimentId`'s
    accession, to avoid cross-experiment collisions in the *lookup*), and
    classifies each plate as `verified` / `incorrect` / `unreadable` /
    `needs_review` (QR codes on one plate disagree on which plate they
    belong to) / `duplicate_qr`. The comparison is case-insensitive on
    **both** sides (production/the first pass only lowercased one side,
    making the match unreachable for this repo's real mixed-case plate IDs —
    fixed here).
  - Detects **swaps**: pairs of `incorrect` plates whose detected plate IDs
    are each other's assigned plate ID, and auto-corrects them by updating
    `GraviScanPlateAssignment.plate_barcode` and the matching `GraviScan`
    scan record's `plate_barcode` for both positions. **Every one of these
    writes — both swap-correction updates, both `GraviScan` lookups, and the
    final status-persistence update — is scoped to `experimentId` in
    addition to `(scanner_id, plate_index)`**, matching the actual DB
    uniqueness constraint (`@@unique([experiment_id, scanner_id,
    plate_index])`). Production/the first pass scoped only the read-side
    lookup, leaving every write able to silently overwrite a *different*
    experiment's historical data sharing the same scanner and plate
    position — fixed here.
  - A lone `incorrect` result with no swap partner is persisted as its own
    distinct `verification_status` (`incorrect`), not collapsed into
    `unreadable`. Production does collapse it, and its own renderer shows an
    identical "QR Unreadable" label for both a genuinely-unreadable QR and a
    correctly-decoded-but-wrong plate — an intentional but confusing choice
    documented in production's own code comments. This proposal keeps them
    distinct, a deliberate improvement over production, not a compatibility
    break (nothing on `main` consumes `verification_status` values yet).
  - `imagePath` is validated with the same realpath-containment check this
    file's sibling `read-scan-image` handler already uses, before being
    handed to the QR decoder. Missing in production and the first pass —
    added here.
  - Every DB write (per-swap-pair correction, per-result status update) is
    wrapped in its own try/catch so one bad record can't abort the rest of
    the batch — matches production's defensive pattern.
- **New module** `src/main/qr-reader.ts` exporting `readQrCodes(imagePath)` —
  spawns a Python subprocess (`python/graviscan/qr_reader.py`, OpenCV) rather
  than decoding in-process via WASM. See `design.md` for the full rationale
  (WASM bundling defect + undocumented LGPL dependency, both eliminated by
  this design instead of patched around).
- **New Python module** `python/graviscan/qr_reader.py` exporting
  `decode_qr_codes(image_path) -> list[str]`
  (`cv2.QRCodeDetector().detectAndDecodeMulti()`, full resolution, no
  resize — see `design.md`), and a new `--decode-qr-batch` mode on
  `python/main.py` (stdin JSON array of paths in, stdout JSON out), following
  the existing `--scan-worker` mode-routing convention.
- **New Python dependency**: `opencv-python-headless` added to
  `pyproject.toml` (Apache-2.0).
- **New Prisma migration**: adds `verification_status String @default("pending")`
  to `GraviScanPlateAssignment`, generated via `prisma migrate dev` (not
  hand-edited), following this repo's existing migration-naming convention.
- **New IPC registration**: `graviscan:verify-plates` wired in
  `register-handlers.ts`, forwarding `graviscan:verify-started` /
  `graviscan:verify-result` / `graviscan:verify-complete` progress events to
  the renderer via `getMainWindow()` (no renderer UI consumes these yet —
  ported anyway since a future renderer will need them; this proposal does
  not add renderer UI).

## What This Proposal Does NOT Change

- **No dependency on `@undecaf/zbar-wasm`** — the first implementation pass
  added this Node/WASM dependency; this revision removes it entirely in
  favor of the Python approach above. It never reaches `main`.
- No renderer UI in this change — IPC handler + progress events only.
- The production branch (`fix/v600-wedge-followups-metadata_propogation_followup`)
  itself is not modified by this proposal. The defects described above are
  confirmed present in its actual code today; fixing that branch, if
  desired, is a separate decision outside this plan's scope.

## Implementation constraints

- Classification rules, swap-detection rules, and status strings match
  production's contract except where explicitly called out above as a
  deliberate fix (case-insensitive comparison, distinct `incorrect` status,
  experiment-scoped writes, path validation) — a future renderer can still
  rely on the same shape, with these corrections.
- Tests are handler-level, against the real exported `verifyPlates()` and
  `readQrCodes()` functions (mocking `db` and the Python subprocess call at
  the boundary) — no logic-mirror reimplementation of the
  classification/swap rules in test code.
- TDD throughout: a failing test precedes each fix (see `tasks.md`).

## Impact

- Affected specs: `scanning` (new requirements — this is new capability, no
  existing requirement changes)
- Affected code:
  - `src/main/graviscan/verify-plates.ts` (new)
  - `src/main/qr-reader.ts` (new — subprocess-calling, not WASM)
  - `src/main/graviscan/register-handlers.ts` (add `graviscan:verify-plates`
    IPC registration)
  - `python/graviscan/qr_reader.py` (new)
  - `python/main.py` (new `--decode-qr-batch` mode)
  - `pyproject.toml` (add `opencv-python-headless`)
  - `prisma/schema.prisma` + new `prisma/migrations/<timestamp>_add_verification_status_to_plate_assignment/`
  - `tests/unit/graviscan/verify-plates.test.ts` (new)
  - `tests/unit/qr-reader.test.ts` (new — mocks subprocess, not WASM)
  - `python/tests/test_qr_reader.py` (new)
  - No `package.json` dependency change (the Node WASM dependency from the
    first pass is removed, not replaced with another Node dependency)
