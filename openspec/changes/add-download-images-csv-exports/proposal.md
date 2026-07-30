## Why

Production's GraviScan image download (`graviscan-handlers.ts`, `graviscan:download-images`
handler) writes three CSVs per wave subfolder — `metadata.csv`, `plates.csv`,
`sections.csv` — plus auto-resolves the user's Downloads folder so a single click
downloads everything. `main`'s equivalent (`downloadImages()` in
`src/main/graviscan/image-handlers.ts`) only writes `metadata.csv` and requires
an explicit `targetDir` from the caller. Analysts who rely on the plate/section
CSVs when working from `main`'s exports currently get nothing — the plate
accession and section (plant QR / medium) data those files carry is silently
dropped, even though `main`'s own Prisma schema already has the exact
`GraviPlateAccession.sections -> GraviPlateSectionMapping` relation production
uses.

## What Changes

- Add `plates.csv` (header: `experiment,wave_number,plate_id,accession,transplant_date,custom_note`,
  one row per `GraviPlateAccession` linked to the experiment's legacy
  accession) and `sections.csv` (header:
  `experiment,wave_number,plate_id,section_id,plant_qr,medium`, one row per
  `GraviPlateSectionMapping` under each plate) to each wave subfolder written
  by `downloadImages()`, alongside the existing `metadata.csv`. Both new files
  are written **only when there is data beyond the header row**, matching
  production's "don't hand analysts an empty file" behavior.
- Add `sections: true` to the existing `graviPlateAccessions` include in
  `downloadImages()`'s `graviScan.findMany()` query so section data is
  available without a second query.
- Reuse the existing `csvEscape(value: string)` helper for the two new
  files' cells, wrapping numeric/nullable source fields
  (`wave_number`, `transplant_date`, `custom_note`, `medium`) with
  `String(...)`/`?? ''` first, matching `metadata.csv`'s existing call-site
  pattern. Both new files get the same UTF-8 BOM prefix (`'﻿'`) that
  `metadata.csv` already uses, for consistency within `main`'s own wave-subfolder
  CSV convention (Excel compatibility with non-ASCII free-text fields like
  `custom_note`).
- **Target-directory contract**: make `downloadImages()`'s `targetDir` param
  optional, defaulting to `app.getPath('downloads')` when omitted. An
  explicitly-provided `targetDir` still wins. This does not change any
  existing caller (no renderer currently calls `downloadImages`/
  `graviscan:download-images` — confirmed via search of `src/renderer/`), and
  lets a future renderer match production's simpler one-click-download
  contract (`{experimentId, experimentName, waveNumber?}`, no directory
  picker) without a further signature change later.

## Out of scope

- **Wave-aware accession lookup** (production's
  `db.graviExperimentWaveMetadata.findMany(...)` fallback when
  `experiment.accession_id` is null). `main`'s Prisma schema has no
  `GraviExperimentWaveMetadata` model (`grep GraviExperimentWaveMetadata
  prisma/schema.prisma` returns nothing), and `main`'s `ExperimentForm.tsx`
  zod schema still requires `accession_id` at experiment creation
  (`accession_id: z.string().min(1, 'Accession is required')`), so the
  null-accession case this fallback exists for cannot occur via `main`'s
  current UI. This is the same gap already deferred during the prior plan's
  Increment 6; it stays deferred here too, tied to a separate, not-yet-started
  "add-wave-scoped-metadata-linking" initiative that needs the schema
  migration first. `plates.csv`/`sections.csv` in this proposal are populated
  from the same legacy single-accession link `metadata.csv` already uses
  (`scan.experiment.accession.graviPlateAccessions`), so they are correct for
  every experiment `main` can currently create — they just don't yet handle
  the not-currently-reachable wave-metadata-linked case.
- Any renderer UI (directory picker, download button, progress display) —
  `main` has no renderer surface for GraviScan image download yet.
- Changing `metadata.csv`'s header or row contents — it is already
  byte-identical to production's.

## Impact

- **Affected specs:** `scanning` (MODIFIED: "GraviScan Image Operations")
- **Affected code:**
  - `src/main/graviscan/image-handlers.ts` (`downloadImages()`, ~lines
    294-460)
- **Tests:** `tests/unit/graviscan/image-handlers.test.ts` — new cases for
  plates.csv/sections.csv presence, absence-when-empty, and the
  targetDir-omitted Downloads-folder default.
- **Database:** none — no schema change; `sections: true` is a query
  include addition, not a migration.
- **Renderer:** none — no `src/renderer/` caller of `downloadImages`/
  `graviscan:download-images` exists yet; `targetDir` remains accepted (now
  optional) so this is purely additive for future renderer work.
