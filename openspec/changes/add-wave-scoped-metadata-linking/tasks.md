## 1. Schema & Migration

- [ ] 1.1 Add `GraviExperimentWaveMetadata` model to `prisma/schema.prisma`
      (fields/relations/indexes per `design.md`), plus back-relation fields
      on `Experiment` and `Accessions`.
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

## 2. countMetadataReferences helper (TDD)

- [ ] 2.1 In `tests/unit/graviscan/database-handlers.test.ts`, write failing
      tests for a new `countMetadataReferences(db, metadataFileId)` helper:
      returns `0` for an unreferenced file; counts a matching
      `Experiment.accession_id` row; counts a matching
      `GraviExperimentWaveMetadata.accession_id` row; sums both when a file
      is referenced by each.
- [ ] 2.2 Implement `countMetadataReferences` in `database-handlers.ts` and
      refactor `graviPlateAccessionsDelete` to call it in place of its
      current inline single-term count. Run the tests from 2.1 and the
      existing `graviPlateAccessionsDelete` tests green.
- [ ] 2.3 Write a failing test: `graviPlateAccessionsDelete` is blocked when
      a file is linked only via `GraviExperimentWaveMetadata` (no
      `Experiment.accession_id` reference). Confirm it passes against the
      2.2 implementation (this is the new MODIFIED-requirement scenario).

## 3. linkGraviMetadata handler (TDD)

- [ ] 3.1 Write failing unit tests in
      `tests/unit/graviscan/database-handlers.test.ts` for
      `linkGraviMetadata(db, experimentId, waveNumber, accessionId)`:
      rejects non-string/missing `experimentId` or `accessionId`; rejects a
      non-integer or negative `waveNumber`; rejects an unknown
      `experimentId` with a "not found" message; rejects an experiment whose
      `experiment_type !== 'graviscan'`; rejects an unknown `accessionId`
      with a "not found" message; rejects an `accessionId` with zero
      `GraviPlateAccession` children; rejects an already-linked
      `(experimentId, waveNumber)` pair; succeeds and returns the created
      row (with `accession` included) on the happy path.
- [ ] 3.2 Implement `linkGraviMetadata` in `database-handlers.ts` to satisfy
      all tests from 3.1.
- [ ] 3.3 Register `ipcMain.handle('db:experiments:linkGraviMetadata', ...)`;
      add the method to the `experiments` group in `src/main/preload.ts`;
      add its typed signature to the `experiments` group in
      `src/types/electron.d.ts` via `ReturnType<typeof linkGraviMetadata>`.
      Remove the now-stale "deliberately NOT implemented" comment block at
      `database-handlers.ts:1813-1825`.

## 4. unlinkGraviMetadata handler (TDD)

- [ ] 4.1 Write failing unit tests for
      `unlinkGraviMetadata(db, experimentId, waveNumber)`: rejects
      non-string/missing `experimentId`; rejects a non-integer
      `waveNumber`; returns a friendly `{success: false, error: <message>}`
      for a non-existent `(experimentId, waveNumber)` pair (not a raw
      Prisma `P2025`); succeeds and deletes the row on the happy path.
- [ ] 4.2 Implement `unlinkGraviMetadata` to satisfy all tests from 4.1.
- [ ] 4.3 Register the IPC handler, preload method, and typed signature
      (same pattern as 3.3).

## 5. listGraviMetadata handler (TDD)

- [ ] 5.1 Write failing unit tests for `listGraviMetadata(db, experimentId)`:
      rejects a non-string `experimentId`; returns `[]` for an experiment
      with no links; returns links ordered by `wave_number` ascending, each
      with `accession` included; correctly scoped (does not include another
      experiment's links).
- [ ] 5.2 Implement `listGraviMetadata` to satisfy all tests from 5.1 (port
      the reference implementation's `findMany` shape as-is — no bug found
      there, per the pre-proposal notes).
- [ ] 5.3 Register the IPC handler, preload method, and typed signature
      (same pattern as 3.3).

## 6. E2E IPC coverage

- [ ] 6.1 Add a round-trip `test.describe` block to
      `tests/e2e/renderer-database-ipc.e2e.ts` (grouped like the existing
      `graviPlateAccessions.*` block), exercising through the real
      `window.electron.database.experiments.*` surface: seed a graviscan
      experiment + a GraviScan metadata file, `linkGraviMetadata` →
      `listGraviMetadata` (confirm it appears) → `linkGraviMetadata` again
      on the same wave (confirm rejected) → `unlinkGraviMetadata` →
      `listGraviMetadata` (confirm empty).
- [ ] 6.2 Run `npm run test:e2e:coverage` locally to confirm the 90% IPC
      coverage gate still passes with the three new `db:experiments:*`
      handlers counted as tested.

## 7. Verification

- [ ] 7.1 Run `npm run lint` and `npm run format:check`.
- [ ] 7.2 Run `npm run test:unit` (full unit suite, not just the new file).
- [ ] 7.3 Run `npx tsc --noEmit` (or the project's typecheck script) to
      confirm the `electron.d.ts` changes compile.
- [ ] 7.4 Re-run `./scripts/verify-migrations.sh` and `npm run test:db-upgrade`
      as a final check after all handler changes.
