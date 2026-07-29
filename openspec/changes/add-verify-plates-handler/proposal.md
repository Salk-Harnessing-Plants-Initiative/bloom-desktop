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
introduces a new capability with real DB side effects, a new npm dependency
(`@undecaf/zbar-wasm`, for QR decoding), and a new Prisma migration
(`verification_status` on `GraviScanPlateAssignment`) — schema + dependency +
capability changes together, per this project's own guidance on when
`/openspec:proposal` is required.

## What Changes

- **New module** `src/main/graviscan/verify-plates.ts` exporting
  `verifyPlates(db, plates, experimentId?, onProgress?)` — a pure,
  DB-injected async function (matches this repo's handler-module convention:
  one exported function per logical concern, no direct `ipcMain` coupling).
  - Reads QR codes from each plate's scan image via `readQrCodes()`.
  - Detects duplicate QR codes read across multiple plates in the same batch
    and flags those plates `duplicate_qr` instead of attempting a normal
    compare.
  - Looks up each detected QR code's owning plate via
    `GraviPlateSectionMapping` (optionally scoped to `experimentId`'s
    accession, to avoid cross-experiment collisions), and classifies each
    plate as `verified` / `incorrect` / `unreadable` / `needs_review` (QR
    codes on one plate disagree on which plate they belong to) /
    `duplicate_qr`.
  - Detects **swaps**: pairs of `incorrect` plates whose detected plate IDs
    are each other's assigned plate ID, and auto-corrects them by updating
    `GraviScanPlateAssignment.plate_barcode` and the matching `GraviScan`
    scan record's `plate_barcode` for both positions.
  - Persists a final `verification_status` (`verified` / `swapped` /
    `unreadable` / `needs_review` / `duplicate_qr`) onto
    `GraviScanPlateAssignment` for every plate in the batch.
  - Every DB write (per-swap-pair correction, per-result status update) is
    wrapped in its own try/catch so one bad record can't abort the rest of
    the batch — matches production's defensive pattern.
- **New module** `src/main/qr-reader.ts` exporting `readQrCodes(imagePath)` —
  ports production's `sharp` + `@undecaf/zbar-wasm` QR/barcode decoder
  verbatim, including its sequential-queue guard against concurrent `sharp`
  decode crashes on Linux.
- **New dependency**: `@undecaf/zbar-wasm@^0.11.0` added to `package.json`
  (already-present `sharp@^0.34.5` is reused, no version conflict).
- **New Prisma migration**: adds `verification_status String @default("pending")`
  to `GraviScanPlateAssignment`, generated via `prisma migrate dev` (not
  hand-edited), following this repo's existing migration-naming convention.
- **New IPC registration**: `graviscan:verify-plates` wired in
  `register-handlers.ts`, forwarding `graviscan:verify-started` /
  `graviscan:verify-result` / `graviscan:verify-complete` progress events to
  the renderer via `getMainWindow()` (no renderer UI consumes these yet —
  ported anyway since a future renderer will need them; this proposal does
  not add renderer UI).

### Implementation constraints

- No renderer UI in this change — IPC handler + progress events only.
- No behavior changes beyond the verbatim-ported logic; classification rules,
  swap-detection rules, and status strings match production exactly so a
  future renderer can rely on the same contract production already ships.
- Tests are handler-level, against the real exported `verifyPlates()` and
  `readQrCodes()` functions (mocking `db` and `readQrCodes`/`sharp` at the
  boundary) — no logic-mirror reimplementation of the classification/swap
  rules in test code.

## Impact

- Affected specs: `scanning` (new requirements — this is new capability, no
  existing requirement changes)
- Affected code:
  - `src/main/graviscan/verify-plates.ts` (new)
  - `src/main/qr-reader.ts` (new)
  - `src/main/graviscan/register-handlers.ts` (add `graviscan:verify-plates`
    IPC registration)
  - `prisma/schema.prisma` + new `prisma/migrations/<timestamp>_add_verification_status_to_plate_assignment/`
  - `package.json` / `package-lock.json` (add `@undecaf/zbar-wasm`)
  - `tests/unit/graviscan/verify-plates.test.ts` (new)
  - `tests/unit/qr-reader.test.ts` (new)
