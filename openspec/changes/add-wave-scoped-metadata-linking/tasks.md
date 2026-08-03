## 1. Schema & Migration

- [ ] 1.1 Add `GraviExperimentWaveMetadata` model to `prisma/schema.prisma`
      (fields/relations/indexes per `design.md`; `experiment_id` FK
      `onDelete: Cascade`, `accession_id` FK `onDelete: Restrict`), plus
      back-relation fields on `Experiment` and `Accessions`.
- [ ] 1.2 Run `npx prisma migrate dev --name add_gravi_experiment_wave_metadata`
      to generate the migration and regenerate the client.
- [ ] 1.3 Run `./scripts/verify-migrations.sh` to confirm the generated
      migration matches `schema.prisma` (schema/migration parity check).
- [ ] 1.4 Run `npm run test:db-upgrade` to confirm the existing hand-written
      upgrade path (`scripts/upgrade-database.ts`) needs no changes — it
      only bootstraps `_prisma_migrations` tracking for pre-v4 databases;
      any DB already tracking migrations picks up this one via standard
      `prisma migrate deploy`. This step verifies that assumption rather
      than just asserting it (see `design.md` Risks).
- [ ] 1.5 Write and confirm a test (in
      `tests/unit/graviscan/database-handlers.test.ts`, using direct Prisma
      calls — `prisma.graviExperimentWaveMetadata.create(...)`, no handler
      function needed yet) verifying that deleting the linked `Experiment`
      cascades to delete its `GraviExperimentWaveMetadata` rows, per the
      `onDelete: Cascade` FK from Decision 8. This can only be written after
      the migration lands, so it isn't "failing-test-first" in the TDD
      sense — it's a direct verification of schema behavior, not
      application logic.
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before touching handler code in Section 2.

## 2. countMetadataReferences helper (TDD)

- [ ] 2.1 In `tests/unit/graviscan/database-handlers.test.ts`, write failing
      tests (all before any implementation, so all are genuinely red) for:
      a new `countMetadataReferences(db, metadataFileId)` helper returning
      `0` for an unreferenced file, counting a matching
      `Experiment.accession_id` row, counting a matching
      `GraviExperimentWaveMetadata.accession_id` row (create it via direct
      Prisma call), and summing both when a file is referenced by each; AND
      `graviPlateAccessionsDelete` is blocked when a file is linked only via
      `GraviExperimentWaveMetadata` (no `Experiment.accession_id`
      reference, set up via a direct Prisma call); AND
      `graviPlateAccessionsDelete` succeeds again once that single blocking
      `GraviExperimentWaveMetadata` link is removed (direct Prisma
      create-then-delete for setup).
- [ ] 2.2 Implement `countMetadataReferences` in `database-handlers.ts` and
      refactor `graviPlateAccessionsDelete` to call it in place of its
      current inline single-term count. Run all of 2.1's tests, plus the
      pre-existing `graviPlateAccessionsDelete` tests, green.
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before starting Section 3.

## 3. linkGraviMetadata handler (TDD)

- [ ] 3.1 Write failing unit tests in
      `tests/unit/graviscan/database-handlers.test.ts` for
      `linkGraviMetadata(db, experimentId, waveNumber, accessionId)`:
      rejects non-string/missing `experimentId` or `accessionId`; rejects a
      negative, non-integer (e.g. `1.5`), or non-numeric `waveNumber`;
      accepts `waveNumber = 0` as valid; rejects an unknown `experimentId`
      with a "not found" message; rejects an experiment whose
      `experiment_type !== 'graviscan'`; rejects an unknown `accessionId`
      with a "not found" message; rejects an `accessionId` with zero
      `GraviPlateAccession` children; rejects an already-linked
      `(experimentId, waveNumber)` pair — both when the new `accessionId`
      differs from and when it matches the existing link; succeeds and
      returns the created row (with `accession` included) on the happy
      path.
- [ ] 3.2 Implement `linkGraviMetadata` in `database-handlers.ts` to satisfy
      all tests from 3.1.
- [ ] 3.3 Write and confirm a round-trip test: link wave N to file A, call
      `unlinkGraviMetadata` directly against the DB (or, once Section 4 is
      implemented, via the handler — see task 4.4) to remove it, then link
      wave N to a different file B — confirm B is now linked and the row
      correctly reflects the new accession.

## 4. unlinkGraviMetadata handler (TDD)

- [ ] 4.1 Write failing unit tests for
      `unlinkGraviMetadata(db, experimentId, waveNumber)`: rejects
      non-string/missing `experimentId`; rejects a `waveNumber` that is
      negative, non-integer, or missing; returns a friendly
      `{success: false, error: <message>}` for a non-existent
      `(experimentId, waveNumber)` pair (not a raw Prisma `P2025`); succeeds
      and deletes the row, returning `{success: true}`, on the happy path.
- [ ] 4.2 Implement `unlinkGraviMetadata` to satisfy all tests from 4.1.
- [ ] 4.3 Re-run task 3.3's round-trip test using `unlinkGraviMetadata` (the
      handler, not a direct Prisma call) for the unlink step, now that it
      exists — confirms `linkGraviMetadata` and `unlinkGraviMetadata`
      correctly compose for the "correct a mistake" workflow.

## 5. listGraviMetadata handler (TDD)

- [ ] 5.1 Write failing unit tests for `listGraviMetadata(db, experimentId)`:
      rejects a non-string `experimentId`; returns `{success: true, data: []}`
      for an experiment with no links; returns links ordered by
      `wave_number` ascending, each with `accession` included; correctly
      scoped (does not include another experiment's links).
- [ ] 5.2 Implement `listGraviMetadata` to satisfy all tests from 5.1 (port
      the reference implementation's `findMany` shape as-is — no bug found
      there, per the pre-proposal notes).
- [ ] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before starting Section 6. All three handler functions
      (`linkGraviMetadata`, `unlinkGraviMetadata`, `listGraviMetadata`) exist
      and are fully unit-tested at this point, but none are registered as
      IPC handlers yet — deliberately, so Section 6 can register all three
      and add their e2e coverage in one unit (see note below).

## 6. IPC registration + E2E coverage

**Do not split this section across separate pushed commits.** The 90% IPC
coverage gate (`scripts/check-ipc-coverage.py`, run via
`npm run test:e2e:coverage`) counts total registered `db:*` handlers in its
denominator regardless of whether they're tested yet. Registering all three
new handlers (task 6.1) before the e2e test exists (task 6.2) — verified by
actually running the coverage script against the sequence — drops coverage
from the current 95.2% to 88.9%, below the 90% gate, for the span between
finishing Section 5 and finishing this section. Land 6.1-6.4 together.

- [ ] 6.1 Register `ipcMain.handle('db:experiments:{linkGraviMetadata,
      unlinkGraviMetadata,listGraviMetadata}', ...)`; add the three methods
      to the `experiments` group in `src/main/preload.ts`; add their typed
      signatures to the `experiments` group in `src/types/electron.d.ts` via
      `ReturnType<typeof ...>`. Remove the now-stale "deliberately NOT
      implemented" comment block at `database-handlers.ts:1813-1825`.
- [ ] 6.2 Add a round-trip `test.describe` block to
      `tests/e2e/renderer-database-ipc.e2e.ts` (grouped like the existing
      `graviPlateAccessions.*` block), exercising through the real
      `window.electron.database.experiments.*` surface: seed a graviscan
      experiment + a GraviScan metadata file, `linkGraviMetadata` →
      `listGraviMetadata` (confirm it appears) → `linkGraviMetadata` again
      on the same wave (confirm rejected) → `unlinkGraviMetadata` →
      `listGraviMetadata` (confirm empty) → `linkGraviMetadata` again with a
      different metadata file (confirm the relink-after-unlink workflow
      succeeds).
- [ ] 6.3 Run `npm run test:e2e -- tests/e2e/renderer-database-ipc.e2e.ts`
      (actual Playwright execution against a real Electron+SQLite instance,
      not just the static coverage checker) and confirm it passes.
- [ ] 6.4 Run `npm run test:e2e:coverage` and confirm the 90% IPC coverage
      gate passes with the three new `db:experiments:*` handlers counted as
      tested.

## 7. Verification

- [ ] 7.1 Run `npm run lint` and `npm run format:check`.
- [ ] 7.2 Run `npm run test:unit` (full unit suite, not just the new file).
- [ ] 7.3 Run `npx tsc --noEmit` (or the project's typecheck script) to
      confirm the `electron.d.ts` changes compile.
- [ ] 7.4 Re-run `./scripts/verify-migrations.sh` and `npm run test:db-upgrade`
      as a final check after all handler changes.
