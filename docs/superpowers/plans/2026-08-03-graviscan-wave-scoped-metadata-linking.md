# Wave-Scoped Metadata Linking: Pre-Proposal Notes

**Not on the original 5-tier roadmap as its own line item** — this is a small
prerequisite discovered while scoping Tier 5 (Browse/Experiment Detail/Metadata
UI, see `docs/superpowers/plans/2026-07-30-graviscan-renderer-roadmap.md`).
**Depends on:** nothing merged-but-incomplete; builds on Tier 2's already-merged
`graviPlateAccessions.*` handlers (PR #274) as the metadata-file-content layer.
**Blocks:** Tier 5's proposal — do not start Tier 5 until this merges.

## Why this exists

Tier 5 was originally scoped to call `experiments.{listGraviMetadata,
linkGraviMetadata,unlinkGraviMetadata}`. Tier 2 explicitly descoped these three
(see the archived Tier 2 design doc's Decision 1 and Open Question 1,
`openspec/changes/archive/2026-07-31-add-graviscan-data-layer-and-events/design.md`)
because they're backed by a `GraviExperimentWaveMetadata` Prisma model that
doesn't exist on `main` — a genuine new-model addition, not just missing IPC
wiring like Tier 2's other four handler groups.

**Decision (2026-08-03): build this properly, not a stand-in.** The alternative
(fall back to the existing single-accession `Experiment.accession_id` field) was
rejected: confirmed with the user that real lab data has many distinct accessions
per experiment _and per wave_ — a single field can't represent that, so the
fallback would be a real functional loss (can't browse metadata files in
per-wave context), not a cosmetic UX regression.

## What already exists on `main` (do not re-build)

- `Accessions` (id, name) — a metadata-**file** record, shared with CylinderScan's
  barcode-mapping upload feature (`prisma/schema.prisma:45-52`).
- `GraviPlateAccession` — one row per **plate** within a metadata file, its own
  `accession` genotype string, `metadata_file_id` FK to `Accessions`
  (`prisma/schema.prisma:246-261`).
- `GraviPlateSectionMapping` — one row per **section/position** on a plate,
  `plant_qr`, FK to `GraviPlateAccession` (`prisma/schema.prisma:263-276`).
- `database.graviPlateAccessions.{createWithSections,list,listFiles,delete}` —
  full CRUD over the above, already merged (Tier 2, PR #274).

This proposal is **only** about linking an existing metadata file to a specific
`(experiment_id, wave_number)` — none of the plate/section/plant-QR structure
above needs to change.

## Reference implementation, read directly (not assumed)

Branch: `origin/fix/v600-wedge-followups-metadata_propogation_followup` (confirmed
fetchable — `git fetch origin fix/v600-wedge-followups-metadata_propogation_followup`).

**Model** (`prisma/schema.prisma:280-292` on that branch):

```prisma
model GraviExperimentWaveMetadata {
  id            String   @id @default(uuid())
  experiment_id String
  wave_number   Int
  accession_id  String
  createdAt     DateTime @default(now())

  experiment    Experiment @relation(fields: [experiment_id], references: [id], onDelete: Cascade)
  accession     Accessions @relation(fields: [accession_id], references: [id])

  @@unique([experiment_id, wave_number])
  @@index([experiment_id])
  @@index([accession_id])
}
```

- **One metadata file per (experiment, wave)** — the `@@unique` is on the pair,
  not many-to-many. `listGraviMetadata` returns a list because it lists across
  an experiment's _waves_, not multiple files per wave.
- `wave_number` is **not a new concept** — it already exists as a plain
  `Int @default(0)` on `GraviScan`. This model adds its own copy (no FK to
  `GraviScan`), unique per experiment.
- Deleting the `Experiment` cascades onto this table. Deleting the `Accessions`
  metadata file does **not** cascade — the reference implementation blocks that
  elsewhere via a `countMetadataReferences()` helper that sums references from
  both `Experiment.accession_id` and this new table. Worth the same guard here.
- **Coexists, does not replace**: `Experiment.accession_id`/`attachAccession`
  stays for `experiment_type === 'cylinder'`; this new model is used exclusively
  for `experiment_type === 'graviscan'`. Confirmed via the reference renderer
  branching on `experiment_type` in two places (`ExperimentForm.tsx`,
  `Experiments.tsx`).

**Handlers** (`src/main/database-handlers.ts:213-303` on that branch):

- `linkGraviMetadata(experimentId, waveNumber, accessionId)` (213-256): checks
  for an existing `(experiment_id, wave_number)` row via `findUnique` on the
  compound key, then creates. **Real gap, found via direct reading — fix, don't
  port**: no validation that `experimentId` or `accessionId` actually exist, or
  that the experiment is `graviscan`-typed, before creating the link. A bad FK
  just throws a raw, unfriendly Prisma error. This is the same missing-existence-
  validation pattern this repo's prior GraviScan ports have caught and fixed
  elsewhere (e.g. `isNonEmptyString` + existence checks in Tier 2's
  `graviscans.*` handlers) — apply the same discipline here.
- `unlinkGraviMetadata(experimentId, waveNumber)` (262-287): plain `delete` on
  the compound unique key; a missing row throws Prisma's raw P2025 rather than a
  friendly "not linked" message. Same fix-not-port treatment.
- `listGraviMetadata(experimentId)` (294-303): `findMany` scoped by
  `experiment_id`, `include: { accession: true }`, ordered by `wave_number` —
  correctly scoped, no bug found here. Fine to port as-is (re-verify against
  `main`'s actual relation/field names before assuming 1:1, per this repo's
  established audit convention).

**Renderer UX pattern** (reference only — this proposal is backend-only; Tier 5
builds the real UI later): `ExperimentDetail.tsx:460-521` on that branch has a
"Linked Metadata" section — wave→accession rows with per-row Unlink, plus a
wave-number input + metadata-file `<select>` (populated from
`graviPlateAccessions.listFiles`, already on `main`) + Link button. Worth reading
when Tier 5 starts, not needed for this proposal's own scope.

## Next step

Run `/new-feature`. This worktree is already on its own branch
(`add-wave-scoped-metadata-linking`, based on `main` @ `2d90a0c`) — a sibling
`add-graviscan-wedge-response-ui` proposal is running in parallel in a different
worktree (`../bloom-desktop-tier3-wedge-response`); they touch unrelated files
(this one is a schema migration + `database-handlers.ts`, no renderer/UI code),
so no coordination note is expected, but confirm that's still true once this
proposal's Impact section is drafted.
