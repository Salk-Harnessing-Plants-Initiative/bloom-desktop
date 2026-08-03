## Context

Tier 2 (`add-graviscan-data-layer-and-events`, PR #274) ported four GraviScan
IPC handler groups over an already-existing schema, and explicitly descoped a
fifth — `experiments.{listGraviMetadata,linkGraviMetadata,
unlinkGraviMetadata}` — because those three are backed by a
`GraviExperimentWaveMetadata` Prisma model that doesn't exist on `main` (see
its `design.md` Decision 1 and Open Question 1). This change is that
follow-up: add the model and the three handlers.

A reference implementation exists on
`origin/fix/v600-wedge-followups-metadata_propogation_followup` and was read
directly (not assumed) while scoping this change. Its model and
`listGraviMetadata` handler are correct as-is; its `linkGraviMetadata` and
`unlinkGraviMetadata` handlers are missing existence/type validation that
this repo's other GraviScan ports have consistently added (e.g.
`graviscansExperimentDetail`'s `findUnique`-then-friendly-404 pattern) — this
change fixes that gap rather than porting it.

Current repo state relevant to this change (`prisma/schema.prisma`):
- `Experiment.id` is a scalar `String` PK; `Experiment.experiment_type` is a
  plain `String @default("cylinderscan")` (not an enum) — the two values in
  use elsewhere in the codebase are `'cylinderscan'` and `'graviscan'`.
- `Accessions` (id, name, createdAt) is a generic "one uploaded file" record
  shared by two unrelated features, distinguished only by which child
  relation is populated: CylinderScan's flat `PlantAccessionMappings[]`
  (barcode → genotype, via `accessions.createWithMappings`) and GraviScan's
  nested `GraviPlateAccession[]` → `GraviPlateSectionMapping[]` (plate →
  plant/section, via `graviPlateAccessions.createWithSections`). There is no
  type discriminator column (tracked separately as a low-priority follow-up,
  issue #275 — out of scope here since this change's validation guard
  neutralizes the concrete risk without needing a schema change).
- `graviPlateAccessionsDelete` (`database-handlers.ts:826-873`) already has an
  inline single-term reference-count guard
  (`db.experiment.count({ where: { accession_id: metadataFileId } })`)
  blocking deletion of a metadata file still linked via the old
  single-accession mechanism. It has no second term for the new table
  because that table doesn't exist yet.

## Goals / Non-Goals

**Goals**
- Add `GraviExperimentWaveMetadata` and wire up `link`/`unlink`/`list`
  handlers with the same existence-validation discipline as the rest of this
  repo's GraviScan handlers.
- Extend the metadata-file deletion guard so it accounts for the new
  reference path.

**Non-Goals**
- No renderer/UI code (Tier 5's job, once this merges).
- No changes to `Experiment.accession_id` / `experiments.attachAccession` —
  it remains the linking mechanism for `experiment_type === 'cylinderscan'`.
- No changes to `GraviPlateAccession`/`GraviPlateSectionMapping` or their
  existing CRUD handlers, beyond the reference-count guard extension.
- No `Accessions.file_type` discriminator column (tracked as issue #275).

## Decisions

### Decision 1: `linkGraviMetadata` enforces `experiment_type === 'graviscan'`

The reference implementation's `linkGraviMetadata` doesn't check
`experiment_type` at all — it would happily create a wave-metadata link for a
cylinderscan experiment, which has no wave concept. Confirmed with the human
reviewer: enforce it at the handler level (return a friendly error), rather
than trusting the caller/UI to only ever call this for graviscan experiments.

**Alternative considered**: leave it unchecked, matching the reference
implementation's literal scope. Rejected — this repo's established pattern
(`graviscansExperimentDetail` and others) is to validate existence/shape
before acting, and this is a one-line addition to the same `findUnique` call
already needed for the existence check.

### Decision 2: `linkGraviMetadata` requires the accession to be a genuine GraviScan metadata file

Because `Accessions` is shared between CylinderScan and GraviScan with no
type marker (see Context), `linkGraviMetadata` checks that the target
`Accessions` row has at least one `GraviPlateAccession` child before linking
it to a wave — mirroring the same filter `graviPlateAccessionsListFiles`
already uses (`where: { graviPlateAccessions: { some: {} } }`) to distinguish
GraviScan's files from CylinderScan's within the same table.

**Alternative considered**: accept any existing `Accessions` id, leaving
type-appropriateness to the caller (Tier 5's file picker would only ever
offer `graviPlateAccessions.listFiles` results anyway). Rejected — confirmed
with the human reviewer: without the check, a bad call (e.g. a future script,
test, or IPC caller with the wrong id) silently succeeds by linking a
CylinderScan mapping file to a GraviScan wave, with no error to catch the
mistake.

### Decision 3: `wave_number` accepts any non-negative integer, no `GraviScan` existence check

`GraviExperimentWaveMetadata.wave_number` is its own copy of the concept (no
FK to `GraviScan`), by design — see the reference model's shape. Confirmed
with the human reviewer: a scientist may reasonably want to pre-link a
metadata file for a wave before that wave has been scanned, so
`linkGraviMetadata` does not require a matching `GraviScan` row to exist for
that `(experiment_id, wave_number)` pair — only that `waveNumber` is a
non-negative integer.

### Decision 4: re-linking an already-linked wave is rejected, not upserted

If `linkGraviMetadata` is called for a pair that's already linked (to any
accession, including the same one), it returns a friendly "already linked;
unlink first" error rather than silently replacing the link. Confirmed with
the human reviewer: this matches the reference implementation's
find-then-create shape (its bug was skipping existence checks before create,
not this behavior) and keeps the API explicit — one link change is one
`unlinkGraviMetadata` + one `linkGraviMetadata` call, with no implicit
overwrite semantics to reason about later.

### Decision 5: factor a shared `countMetadataReferences()` helper

No such helper exists today — `graviPlateAccessionsDelete` has the guard
inlined as a single `db.experiment.count(...)` call. Rather than inlining a
second `db.graviExperimentWaveMetadata.count(...)` call next to it, this
change factors both into a `countMetadataReferences(db, metadataFileId):
Promise<number>` helper (matching the reference implementation's own naming
for this concept, per the pre-proposal notes) that sums both terms, and has
`graviPlateAccessionsDelete` call it. This is a small refactor of existing
code, not new-model-driven scope creep — it exists only because deletion
now has two things to check instead of one.

### Decision 6: handlers live under the existing `experiments` IPC namespace

`database-handlers.ts:1813-1825` already carries a standing comment
reserving `db:experiments:{listGraviMetadata,linkGraviMetadata,
unlinkGraviMetadata}` for exactly this future change. This change implements
those three under `database.experiments.*` (alongside the existing `list`,
`get`, `create`, `update`, `delete`, `attachAccession`) rather than inventing
a new handler-group namespace, and removes the now-stale comment.

### Decision 7: new handlers are standalone exported functions, typed via `ReturnType`

`experiments.attachAccession` is registered inline inside
`registerDatabaseHandlers()` and hand-typed in `electron.d.ts`. The newer
handler groups (`graviscans.*`, `graviPlateAccessions.*`) are standalone
exported functions taking `db: Db` as their first argument, unit-testable
without Electron, and typed in `electron.d.ts` via
`ReturnType<typeof <handlerFn>>` imported directly from
`database-handlers.ts` — an explicit design choice in that file to avoid
declared-vs-runtime-shape drift. The three new handlers follow the newer
pattern.

## Risks / Trade-offs

- **Migration + hand-written upgrade path**: this repo maintains a parallel
  hand-written upgrade script (`scripts/upgrade-database.ts` +
  `detect-schema-version.ts`) for pre-migration-tracking legacy databases.
  Investigated directly: that script's version ladder (v1→v2→v3→v4) stops at
  v4 ("has the `GraviScan` table, i.e. has proper `_prisma_migrations`
  tracking") — the two most recent real migrations
  (`20260729193042_add_verification_status_to_plate_assignment`,
  `20260730071528_add_previous_plate_barcode_to_plate_assignment`) are
  **not** represented in `upgrade-database.ts`'s `MIGRATIONS` map, because
  any database already at v4+ upgrades via standard `prisma migrate deploy`
  — the hand-written script only exists to bootstrap `_prisma_migrations`
  tracking for databases that predate it. This change's migration needs no
  changes to `upgrade-database.ts` or `detect-schema-version.ts` for the same
  reason. `tasks.md` includes a verification step (`npm run test:db-upgrade`)
  to confirm this holds rather than just asserting it.
- **Cascade behavior on `Experiment` deletion**: deleting an `Experiment` now
  cascades onto `GraviExperimentWaveMetadata` (by design, matching the
  reference model). This is consistent with `GraviScan`'s own cascade
  behavior on `Experiment` deletion elsewhere in the schema.

## Migration Plan

1. Add the model to `prisma/schema.prisma` (see reference shape in
   `docs/superpowers/plans/2026-08-03-graviscan-wave-scoped-metadata-linking.md`),
   plus back-relation fields on `Experiment` and `Accessions`.
2. Generate the migration: `npx prisma migrate dev --name
   add_gravi_experiment_wave_metadata`.
3. Verify with `./scripts/verify-migrations.sh` (schema/migration parity) and
   `npm run test:db-upgrade` (confirms existing upgrade-path tests still pass
   unmodified, per the Risks section above).

No data backfill is needed — this is a new, empty table.

## Open Questions

None outstanding. All four ambiguous points identified while scoping this
change (experiment_type enforcement, accession file-type validation,
wave_number validation, re-link behavior) were resolved with the human
reviewer before writing this proposal — see Decisions 1-4.
