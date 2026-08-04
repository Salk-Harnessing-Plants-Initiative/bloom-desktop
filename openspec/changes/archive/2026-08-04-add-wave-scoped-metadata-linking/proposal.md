## Why

Tier 5 (Browse / Experiment Detail / Metadata UI, see
`docs/superpowers/plans/2026-07-30-graviscan-renderer-roadmap.md`) needs to
link a GraviScan metadata file to a specific experiment wave, but Tier 2
deliberately descoped `experiments.{listGraviMetadata,linkGraviMetadata,
unlinkGraviMetadata}` because they require a `GraviExperimentWaveMetadata`
Prisma model that doesn't exist on `main`
(`openspec/changes/archive/2026-07-31-add-graviscan-data-layer-and-events/design.md`,
Decision 1). Real lab data has many distinct accessions per experiment _and
per wave_ — the existing single-accession `Experiment.accession_id` field
can't represent that, so falling back to it for Tier 5 would be a genuine
functional loss (no per-wave metadata browsing), not a cosmetic regression.
This is also the underlying gap behind issues #164 ("Support per-wave
metadata uploads for QR verification") and #162 ("QR verification query not
scoped to experiment and wave") — this change builds the model and handlers
those issues need, though (see Impact) it does not itself rewire the
QR-verification consumer that #162 is about.

## What Changes

- Add a `GraviExperimentWaveMetadata` Prisma model + migration: one row per
  `(experiment_id, wave_number)`, FK to `Experiment` (`onDelete: Cascade`) and
  `Accessions` (`onDelete: Restrict`). Add the corresponding back-relation
  fields on `Experiment` and `Accessions`. See design.md Decision 8 for why
  the `Experiment` FK cascades, deviating from this schema's usual
  RESTRICT-on-Experiment pattern.
- Add `database.experiments.{linkGraviMetadata, unlinkGraviMetadata,
listGraviMetadata}` IPC handlers (main handler + preload exposure + typed
  `electron.d.ts` declarations), fixing the existence/type-validation gaps the
  reference implementation has (a bad FK there just throws a raw Prisma
  error):
  - `linkGraviMetadata(experimentId, waveNumber, accessionId)` validates the
    experiment exists and has `experiment_type === 'graviscan'`, the
    accession exists and has at least one `GraviPlateAccession` row (i.e. is
    actually a GraviScan metadata file, not a CylinderScan barcode-mapping
    file — both share the `Accessions` table), `waveNumber` is a non-negative
    integer, and the `(experiment_id, wave_number)` pair isn't already
    linked — friendly errors for each case rather than a raw Prisma error,
    and rejects re-linking an already-linked wave (caller must unlink first).
  - `unlinkGraviMetadata(experimentId, waveNumber)` returns a friendly "not
    linked" error instead of Prisma's raw `P2025` when the pair doesn't
    exist.
  - `listGraviMetadata(experimentId)` lists an experiment's wave→accession
    links ordered by `wave_number`, with the accession included (ported as
    designed — no bug found in the reference implementation here).
- Extend `graviPlateAccessionsDelete`'s existing single-term reference-count
  guard (`Experiment.accession_id`) to a second term
  (`GraviExperimentWaveMetadata.accession_id`), factored into a shared
  `countMetadataReferences()` helper, so deleting a metadata file that's
  still wave-linked is blocked the same way an `Experiment.accession_id`
  link already blocks it today.
- No renderer/UI code. **BREAKING**: none — purely additive;
  `Experiment.accession_id` / `experiments.attachAccession` is untouched and
  remains the linking mechanism for `experiment_type === 'cylinderscan'`.

## Impact

- Affected specs: `scanning` — adds new requirements for the
  `experiments.{linkGraviMetadata,unlinkGraviMetadata,listGraviMetadata}`
  handler group; modifies the existing `graviPlateAccessions.delete`
  requirement to describe the extended two-term reference-count guard.
- Affected code: `prisma/schema.prisma`, a new migration under
  `prisma/migrations/`, `src/main/database-handlers.ts`,
  `src/main/preload.ts`, `src/types/electron.d.ts`,
  `tests/unit/graviscan/database-handlers.test.ts`,
  `tests/e2e/renderer-database-ipc.e2e.ts`.
- **Not affected, left as-is on purpose**: `src/main/box-backup.ts` and
  `src/main/graviscan-upload.ts` (Box upload metadata resolution) continue to
  resolve a scan's accession/genotype via `Experiment.accession_id`, not the
  new per-wave links — this change adds the link table and its handlers but
  does not rewire any existing consumer to read from it.
- **Not fixed by this change**: `src/main/graviscan/verify-plates.ts`'s
  QR-verification lookup (issue #162, `pr-ready`) — it has no `waveNumber`
  parameter anywhere in its call chain (IPC handler → `verifyPlates()` → DB
  lookup) today, and no renderer caller yet exists to supply one (confirmed:
  no `src/renderer/graviscan/` directory exists on `main` — only
  `ConfigureScanner.tsx`, Tier 1's merged page, exists so far). Wave-scoping
  it is a separate, larger change (new parameter threaded through 3 layers)
  deserving its own proposal once a caller exists to supply the wave number
  — likely alongside Tier 3 or Tier 4. See design.md Non-Goals and Open
  Questions.
- Blocks: the Tier 5 proposal — do not start Tier 5 until this merges. Also
  possibly relevant to **Tier 4** (Core scan-operation screen): an unmerged
  draft (PR #212) suggests Tier 4's Capture Scan auto-fill may also want
  `listGraviMetadata` for per-wave plate metadata — the roadmap doesn't
  currently list this change as a Tier 4 dependency; worth confirming with
  the roadmap owner once Tier 4 is scoped.
- No coordination needed with the two other in-flight worktrees (Tier 3
  wedge-response UI: renderer + wedge-detector consumption only; CylinderScan
  finalization: scope still being determined) — this change touches only the
  file list above, disjoint from both.
