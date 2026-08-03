## Context

Tier 2 (`add-graviscan-data-layer-and-events`, PR #274) ported four GraviScan
IPC handler groups over an already-existing schema, and explicitly descoped a
fifth — `experiments.{listGraviMetadata,linkGraviMetadata,
unlinkGraviMetadata}` — because those three are backed by a
`GraviExperimentWaveMetadata` Prisma model that doesn't exist on `main` (see
its `design.md` Decision 1 and Open Question 1). This change is that
follow-up: add the model and the three handlers. It's also the underlying gap
behind two GitHub issues: **#164** ("GraviScan: Support per-wave metadata
uploads for QR verification") describes the same scenario this proposal's
`## Why` uses as motivation, and **#162** ("GraviScan: QR verification query
not scoped to experiment and wave", `pr-ready`) is a confirmed-still-live bug
in `src/main/graviscan/verify-plates.ts`'s QR-lookup, which resolves an
experiment's accession purely via the old single-accession
`Experiment.accession_id` mechanism with no wave dimension anywhere in its
call chain. This change does not fix #162 — see Non-Goals and Open Questions
below for why, and what should happen instead. Note also: #164's own
suggested implementation was to add a `wave_number` column directly on
`Accessions` or `GraviPlateAccession`; this proposal instead adds a separate
join table (`GraviExperimentWaveMetadata`) mapping `(experiment_id,
wave_number)` to an `accession_id`. The join-table shape is deliberate, not
an oversight of #164's suggestion: it lets one metadata file serve multiple
waves (or experiments) without duplicating the file's rows, matches the
reference implementation's own schema, and keeps `Accessions`/
`GraviPlateAccession` themselves free of any experiment- or wave-specific
column — consistent with Decision 3's design (the file and the "wave this
file applies to" are independent concepts, linked, not merged).

A reference implementation exists on
`origin/fix/v600-wedge-followups-metadata_propogation_followup` and was read
directly (not assumed) while scoping this change. Its model and
`listGraviMetadata` handler are correct as-is; its `linkGraviMetadata` and
`unlinkGraviMetadata` handlers are missing existence/type validation that
this repo's other GraviScan ports have consistently added (e.g.
`graviscansExperimentDetail`'s `findUnique`-then-friendly-404 pattern) — this
change fixes that gap rather than porting it. Four unmerged, unreviewed draft
PRs by a different author (#209-212, opened 2026-04-30, zero review
comments) implement close to this same scope in increments; #209's schema +
handlers is close to byte-for-byte identical to the reference branch above
(same validation gaps), and #212 ("Capture Scan auto-fill, 4/4") is what
surfaced the Tier 4 dependency question in Open Questions below. Neither is
referenced further here beyond this pointer — there's no review feedback on
them to lose, and this change's `design.md` was written by reading the
current repo directly rather than assuming either branch's code is correct.

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
- Every existing FK from a GraviScan-family table (or plain `Scan`) to
  `Experiment` is `ON DELETE RESTRICT`, confirmed directly against the
  generated migration SQL: `GraviScan_experiment_id_fkey`,
  `GraviScanSession_experiment_id_fkey`,
  `GraviScanPlateAssignment_experiment_id_fkey`, and
  `Scan_experiment_id_fkey` (all in
  `prisma/migrations/20260408170532_add_graviscan_models/migration.sql` and
  `prisma/migrations/20251028040530_init/migration.sql`) — there is no
  existing cascade-on-`Experiment`-deletion anywhere in this schema. This
  change's model is the first to use `Cascade` on that relation — see
  Decision 8 for why that's the right call here rather than an oversight.

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
- No changes to `box-backup.ts`/`graviscan-upload.ts` — Box upload metadata
  resolution keeps reading `Experiment.accession_id`, not the new per-wave
  links.
- No `Accessions.file_type` discriminator column (tracked as issue #275).
- **Wave-scoping `verify-plates.ts`'s QR-verification lookup (issues #162,
  #164) is explicitly deferred, not fixed here.** Investigated directly:
  `verify-plates.ts`'s exported `verifyPlates()`, its IPC handler
  (`graviscan:verify-plates` in `register-handlers.ts`), and its DB lookup
  (`verify-plates.ts:454-464`, filtering via
  `plate.metadata_file.experiments.some({id: experimentId})` — the old
  single-accession back-relation) have **no `waveNumber` parameter anywhere
  in that chain today**. Wave-scoping it means adding a new parameter
  through three layers (IPC signature, `verifyPlates()` signature, the
  lookup query) — and there is currently no renderer caller anywhere in this
  repo to supply that parameter: `src/renderer/graviscan/` doesn't exist yet
  (only `ConfigureScanner.tsx`, Tier 1's merged page, exists so far). That's
  a bigger, differently-shaped change than this proposal's model+handlers
  scope, and untestable end-to-end without a caller — see Open Questions for
  what should happen next.

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

This is a deliberately safer design, not just a style preference: an
upsert-style "just overwrite" `linkGraviMetadata` would let a single
malformed or double-submitted call silently replace an existing link with no
confirmation and no distinguishable signal that a prior link existed. The
explicit reject-then-require-unlink flow forces two distinct, independently
validated IPC calls — a caller must observe the current state before
mutating it, and the "already linked" error surfaces immediately rather than
silently swapping a genotype mapping under a wave that may already have
scans. Once Tier 5 builds a UI, it can still offer a single "Relink" button
that fires `unlinkGraviMetadata` then `linkGraviMetadata` internally — the
one-click UX and the safer two-call API aren't in tension.

### Decision 5: factor a shared `countMetadataReferences()` helper

No such helper exists today — `graviPlateAccessionsDelete` has the guard
inlined as a single `db.experiment.count(...)` call. Rather than inlining a
second `db.graviExperimentWaveMetadata.count(...)` call next to it, this
change factors both into a `countMetadataReferences(db, metadataFileId):
Promise<number>` helper (matching the reference implementation's own naming
for this concept, per the pre-proposal notes) that sums both terms, and has
`graviPlateAccessionsDelete` call it. This is a small refactor of existing
code, not new-model-driven scope creep — it exists only because deletion
now has two things to check instead of one. (Independently confirmed as
load-bearing, not speculative: draft PR #209 implements the same two-term
helper under the same name for the same reason.)

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

### Decision 8: `Experiment` FK uses `onDelete: Cascade`, deviating from this schema's RESTRICT-on-Experiment pattern

Every other table with a FK to `Experiment` (`GraviScan`, `GraviScanSession`,
`GraviScanPlateAssignment`, `Scan`) uses `RESTRICT` — deleting an `Experiment`
with any of those rows still attached is blocked outright, forcing an
operator to consciously clean up real captured data first. This model
deliberately does the opposite: `onDelete: Cascade`.

**Alternative considered**: `RESTRICT`, matching every other child table of
`Experiment`. Rejected, for a reason stronger than "the pointer has no
remaining use": SQLite (via Prisma) enforces FK constraints atomically per
statement, so an `Experiment` delete that would violate *any* RESTRICT'd
child table fails as a whole — nothing in that statement cascades, including
`GraviExperimentWaveMetadata`. Concretely: if any `GraviScan`,
`GraviScanSession`, or `GraviScanPlateAssignment` row exists for the
experiment (i.e. it's ever been scanned at all), the delete is blocked by
those tables' existing `RESTRICT` FKs before the new model's `Cascade` can
ever fire — so this model's cascade is only reachable in the one case
Decision 3 designs for: an experiment with wave-metadata pre-linked but never
scanned, where there is no captured data for the cascade to put at risk. The
"pointer has no remaining use" framing is true but incomplete on its own —
by itself it would just as easily argue for cascading `GraviScan` too, which
the schema deliberately does not do; the real safety argument is that
RESTRICT elsewhere makes this model's `Cascade` unreachable in every case
that would actually lose captured data. This matches the reference
implementation's own choice (`onDelete: Cascade` on the same relation) —
confirmed independently correct here, not just copied.

One residual gap this cascade does introduce, not present in the RESTRICT'd
tables: `database.experiments.delete` (`database-handlers.ts:980-994`,
already implemented, already preload-exposed — not part of this change, but
live on `main` today, even though no renderer caller invokes it yet) has no
application-level guard at all. For an experiment with zero scan/session/
plate-assignment rows but one or more wave-metadata links pre-linked ahead of
scanning, a single call to that existing handler silently deletes *all* of
that experiment's `GraviExperimentWaveMetadata` rows in one shot — with no
Prisma error to catch (unlike the RESTRICT'd tables, which force the caller
to notice and handle a blocked delete) and no confirmation step specific to
the metadata links being lost. This is real but time-boxed to the same
narrow pre-scan window the cascade itself is limited to — no
already-captured genotype-to-image provenance is destroyed by it, unlike a
relink after scanning has started (a distinction worth keeping in mind: this
gap is easier to trigger per-call, but the relink case is reachable at any
time and is the one that can actually lose scan-time provenance). Tracked as
issue #276 (a cheap, pattern-consistent fix — a count guard mirroring
Decision 5's `countMetadataReferences()` — rather than folded into the
larger audit-trail question below, since it doesn't need one to fix).

The `Accessions` FK, by contrast, is `onDelete: Restrict` — deleting a
metadata file that's still wave-linked must be blocked (this is exactly what
Decision 5's extended `countMetadataReferences()` guard enforces at the
application layer; the schema-level `Restrict` is a second, DB-level
backstop in case that application guard is ever bypassed, e.g. by a future
direct-SQL script).

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
- **No audit trail or link-history**: `GraviExperimentWaveMetadata` records
  only `createdAt`, not who created/removed a link, and unlink hard-deletes
  the row with no history retained. If wave 3 is linked to accession A, a
  `GraviScan` is captured under that linkage, and someone later unlinks and
  relinks wave 3 to accession B, the fact that A was in effect *at scan
  time* is permanently unrecoverable — `listGraviMetadata` only ever reflects
  current state. This is a real reproducibility gap for genotype-to-plant
  provenance, but retrofitting an audit/history table is a bigger design
  decision than this proposal's scope and isn't precedented elsewhere in
  this schema either (`GraviScanPlateAssignment` tracks `updatedAt` but not
  "updated by"). Deliberately deferred — see Open Questions.
- **`experiments.delete` can silently erase an experiment's entire current
  link set**: see Decision 8's residual-gap paragraph. Unlike the relink case
  above (two deliberate, individually-validated calls, one wave at a time),
  this is one call to an already-existing, ungated handler that removes
  every current wave-metadata link for an experiment at once, with zero
  confirmation specific to that loss — though, unlike the relink case, it's
  reachable only in the pre-scan window and never destroys already-captured
  scan-time provenance. Tracked as **issue #276** rather than folded into the
  audit-trail Open Question below, since a cheap count-guard fixes it without
  needing a full audit-trail system.

## Migration Plan

1. Add the model to `prisma/schema.prisma` (see reference shape in
   `docs/superpowers/plans/2026-08-03-graviscan-wave-scoped-metadata-linking.md`),
   plus back-relation fields on `Experiment` and `Accessions`. Pin the exact
   referential actions per Decision 8: `experiment_id` FK →
   `onDelete: Cascade`; `accession_id` FK → `onDelete: Restrict`.
2. Generate the migration: `npx prisma migrate dev --name
   add_gravi_experiment_wave_metadata`.
3. Verify with `./scripts/verify-migrations.sh` (schema/migration parity) and
   `npm run test:db-upgrade` (confirms existing upgrade-path tests still pass
   unmodified, per the Risks section above).

No data backfill is needed — this is a new, empty table.

## Suggested error-message wording (for Tier 5)

The spec deltas use `<message>` placeholders — the exact strings are an
implementation detail, not a spec requirement — but since these four
validation failures will eventually surface verbatim to non-programmer
researchers via Tier 5's UI, here's suggested researcher-facing wording to
use as a starting point during implementation, rather than defaulting to
Prisma/programmer-flavored text:

- Non-graviscan experiment: *"This experiment isn't a GraviScan experiment,
  so wave metadata can't be linked here."*
- Accession has no `GraviPlateAccession` children: *"This file has no plate
  or section data, so it can't be linked as GraviScan wave metadata."*
  (describes the observed fact rather than asserting a specific cause the
  check can't actually distinguish — see the note below)
- Already-linked wave: *"Wave {waveNumber} already has metadata linked —
  unlink it first if you want to link a different file."*
- Unlink on a non-existent link: *"Nothing to unlink — wave {waveNumber} has
  no metadata file linked."* (makes the no-op outcome explicit, rather than
  reading like an error about something the researcher did wrong; this
  message is also what a caller sees for an unknown `experimentId`, since
  `unlinkGraviMetadata` has no separate "unknown experiment" scenario — both
  cases reduce to "no row for this pair," which is accurate either way)

Note on the accession-file-type message: `Accessions` has no type
discriminator (see Context, issue #275), so a zero-`GraviPlateAccession`
accession could be a CylinderScan mapping file, but could equally be a
genuinely empty/degenerate GraviScan upload — `graviPlateAccessionsCreateWithSections`
doesn't currently validate that `plates` is non-empty, so a real GraviScan
upload with zero plates is possible today. The check can only observe "no
plate data," not which of those two causes produced it, so the message
above says only what's actually verified. (It also deliberately doesn't tell
the researcher to "check the GraviScan metadata list" — `graviPlateAccessionsListFiles`
filters on the same "has ≥1 `GraviPlateAccession`" predicate, so a genuinely
empty GraviScan file wouldn't appear there either; pointing a researcher at
a list that would also hide their file would be a dead end.)

## Open Questions

1. **No audit trail / no link-history** (see Risks) — should this become a
   requirement before researchers start relying on this data for
   provenance? Not blocking this proposal; flagging so it doesn't get lost.
   Candidate trigger: revisit once Tier 5 ships and real per-wave links
   start accumulating. This covers the relink-loses-history case only — the
   related but separately-fixable `experiments.delete` gap is tracked as
   issue #276, not bundled into this question.
2. **`verify-plates.ts` wave-scoping (issues #162, #164) is deferred** (see
   Non-Goals) pending a renderer caller to supply `waveNumber` — likely
   scoped alongside Tier 3 or Tier 4, whichever builds the
   verification-triggering screen. Needs a human decision on timing once
   that tier is scoped. Note: of #162's three original complaints
   (cross-experiment leakage, no wave-scoping, case-sensitive plate-id
   comparison), PR #270 already fixed the first and third on `main` — only
   the wave-scoping piece (this deferral) remains open.
3. **Possible Tier 4 dependency** (see proposal.md Impact) — an unmerged
   draft (PR #212) suggests Tier 4's Capture Scan auto-fill may also need
   `listGraviMetadata`. Worth confirming with the roadmap owner whether Tier
   4 should list this change as a dependency, in addition to Tier 5.

All four ambiguous points identified while *initially* scoping this change
(experiment_type enforcement, accession file-type validation, wave_number
validation, re-link behavior) were resolved with the human reviewer before
writing the first draft of this proposal — see Decisions 1-4. The three
questions above surfaced later, during adversarial review, and are
deliberately left open rather than resolved unilaterally.
