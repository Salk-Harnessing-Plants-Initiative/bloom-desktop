## 1. Schema & Migration

- [x] 1.1 Add `GraviExperimentWaveMetadata` model to `prisma/schema.prisma`
      (fields/relations/indexes per `design.md`; `experiment_id` FK
      `onDelete: Cascade`, `accession_id` FK `onDelete: Restrict`), plus
      back-relation fields on `Experiment` and `Accessions`.
- [x] 1.2 Run `npx prisma migrate dev --name add_gravi_experiment_wave_metadata`
      to generate the migration and regenerate the client.
- [x] 1.3 Run `./scripts/verify-migrations.sh` to confirm the generated
      migration matches `schema.prisma` (schema/migration parity check).
      (`sqlite3` CLI unavailable locally; verified equivalently via a
      `better-sqlite3` schema diff of `migrate deploy` vs `db push` — match.)
- [x] 1.4 Run `npm run test:db-upgrade` to confirm the existing hand-written
      upgrade path (`scripts/upgrade-database.ts`) needs no changes — it
      only bootstraps `_prisma_migrations` tracking for pre-v4 databases;
      any DB already tracking migrations picks up this one via standard
      `prisma migrate deploy`. This step verifies that assumption rather
      than just asserting it (see `design.md` Risks). (34/34 passed.)
- [x] 1.5 Write and confirm a test (in
      `tests/unit/graviscan/database-handlers.test.ts`, using direct Prisma
      calls — `prisma.graviExperimentWaveMetadata.create(...)`, no handler
      function needed yet) verifying that deleting the linked `Experiment`
      cascades to delete its `GraviExperimentWaveMetadata` rows, per the
      `onDelete: Cascade` FK from Decision 8. This can only be written after
      the migration lands, so it isn't "failing-test-first" in the TDD
      sense — it's a direct verification of schema behavior, not
      application logic.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before touching handler code in Section 2. (Lint/typecheck clean;
      8 pre-existing unit-test failures unrelated to this change — in
      `config-store.test.ts`, `image-uploader.test.ts`,
      `AccessionForm.test.tsx`, `scan-coordinator.test.ts` — none reference
      GraviScan wave metadata; confirmed untouched by this change's diff.)

## 2. countMetadataReferences helper (TDD)

- [x] 2.1 In `tests/unit/graviscan/database-handlers.test.ts`, write failing
      tests (all before any implementation, so all are genuinely red — see
      2.1a for one assertion that is deliberately NOT red) for: a new
      `countMetadataReferences(db, metadataFileId)` helper returning `0` for
      an unreferenced file, counting a matching `Experiment.accession_id`
      row, counting a matching `GraviExperimentWaveMetadata.accession_id`
      row (create it via direct Prisma call), and summing both when a file
      is referenced by each; AND `graviPlateAccessionsDelete` is blocked
      when a file is linked only via `GraviExperimentWaveMetadata` (no
      `Experiment.accession_id` reference, set up via a direct Prisma
      call). **Correction found during implementation**: this last
      assertion is NOT actually red today either — the new model's
      `accession_id` FK is `onDelete: Restrict` (Decision 8), so the DB
      itself already rejects the delete with a raw constraint error before
      any application code runs, which still satisfies
      `result.success === false`. It's a real regression guard (confirming
      the eventual friendly-message path, not a raw DB error, is what
      fires), just not genuinely TDD-red — same caveat as 2.1a.
- [x] 2.1a Write a confirmatory (not TDD-red) test alongside 2.1's: that
      `graviPlateAccessionsDelete` succeeds once a `GraviExperimentWaveMetadata`
      link blocking it is removed (direct Prisma create-then-delete for
      setup). This assertion is already true before 2.2's implementation
      exists — today's `graviPlateAccessionsDelete` doesn't check the new
      table at all, so an unlinked file is already deletable regardless.
      It's included to guard against a regression once 2.2 adds the
      guard (e.g. a helper that double-counts or never decrements), not
      because it's currently failing.
- [x] 2.2 Implement `countMetadataReferences` in `database-handlers.ts` and
      refactor `graviPlateAccessionsDelete` to call it in place of its
      current inline single-term count. Run all of 2.1/2.1a's tests, plus
      the pre-existing `graviPlateAccessionsDelete` tests, green. (48/48
      in this file passed.)
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before starting Section 3. (Lint/typecheck clean.)

## 3. linkGraviMetadata handler (TDD)

- [x] 3.1 Write failing unit tests in
      `tests/unit/graviscan/database-handlers.test.ts` for
      `linkGraviMetadata(db, experimentId, waveNumber, accessionId)`:
      rejects non-string, missing, or empty-string (`""`) `experimentId` or
      `accessionId`, tested separately for each; rejects a
      negative, non-integer (e.g. `1.5`), or non-numeric `waveNumber`;
      rejects a `waveNumber` outside the safe 32-bit integer range Prisma's
      `Int` column can store (e.g. `2147483648`, one past `Int32` max) with
      a friendly error rather than a raw DB range error; accepts
      `waveNumber = 0` as valid; rejects an unknown `experimentId` with a
      "not found" message; rejects an experiment whose
      `experiment_type !== 'graviscan'`; rejects an unknown `accessionId`
      with a "not found" message; rejects an `accessionId` with zero
      `GraviPlateAccession` children; rejects an already-linked
      `(experimentId, waveNumber)` pair — both when the new `accessionId`
      differs from and when it matches the existing link; succeeds and
      returns the created row (with `accession` included) on the happy
      path.
- [x] 3.2 Implement `linkGraviMetadata` in `database-handlers.ts` to satisfy
      all tests from 3.1 (the `Int32`-range check is a plain numeric
      comparison before the value ever reaches Prisma).
- [x] 3.3 Write and confirm a round-trip test: link wave N to file A, then
      delete the `GraviExperimentWaveMetadata` row directly via Prisma
      (`prisma.graviExperimentWaveMetadata.delete(...)` — equivalent to what
      `unlinkGraviMetadata` will do once Section 4 implements it; not
      calling that function itself, since it doesn't exist until Section 4),
      then link wave N to a different file B — confirm B is now linked and
      the row correctly reflects the new accession.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before starting Section 4. (66/66 in this file passed; lint and
      typecheck clean.)

## 4. unlinkGraviMetadata handler (TDD)

- [x] 4.1 Write failing unit tests for
      `unlinkGraviMetadata(db, experimentId, waveNumber)`: rejects
      non-string, missing, or empty-string `experimentId`; rejects a
      `waveNumber` that is negative, non-integer, missing, or not a number;
      returns a friendly
      `{success: false, error: <message>}` for a non-existent
      `(experimentId, waveNumber)` pair (not a raw Prisma `P2025`); succeeds
      and deletes the row, returning `{success: true}`, on the happy path.
- [x] 4.2 Implement `unlinkGraviMetadata` to satisfy all tests from 4.1.
- [x] 4.3 Re-run task 3.3's round-trip test, this time using
      `unlinkGraviMetadata` (the handler itself, not the direct Prisma
      delete 3.3 used) for the unlink step, now that it exists — confirms
      `linkGraviMetadata` and `unlinkGraviMetadata` correctly compose for
      the "correct a mistake" workflow.
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before starting Section 5. (75/75 in this file passed; lint and
      typecheck clean.)

## 5. listGraviMetadata handler (TDD)

- [x] 5.1 Write failing unit tests for `listGraviMetadata(db, experimentId)`:
      rejects a non-string, missing, or empty-string `experimentId`; returns
      `{success: true, data: []}`
      for an experiment with no links; returns links ordered by
      `wave_number` ascending, each with `accession` included; correctly
      scoped (does not include another experiment's links).
- [x] 5.2 Implement `listGraviMetadata` to satisfy all tests from 5.1 (port
      the reference implementation's `findMany` shape as-is — no bug found
      there, per the pre-proposal notes).
- [x] Run `npm run lint && npx tsc --noEmit && npm run test:unit` — check
      gate before starting Section 6. All three handler functions
      (`linkGraviMetadata`, `unlinkGraviMetadata`, `listGraviMetadata`) exist
      and are fully unit-tested at this point, but none are registered as
      IPC handlers yet — deliberately, so Section 6 can register all three
      and add their e2e coverage in one unit (see note below). (80/80 in
      this file passed; lint and typecheck clean.)

## 6. IPC registration + E2E coverage

**Do not split this section across separate pushed commits.** The 90% IPC
coverage gate (`scripts/check-ipc-coverage.py`, run via
`npm run test:e2e:coverage`) counts total registered `db:*` handlers in its
denominator regardless of whether they're tested yet. Registering all three
new handlers (task 6.1) before the e2e test exists (task 6.2) — verified by
actually running the coverage script against the sequence — drops coverage
from the current 95.2% to 88.9%, below the 90% gate, for the span between
finishing Section 5 and finishing this section. Land 6.1-6.4 together.

- [x] 6.1 Register `ipcMain.handle('db:experiments:{linkGraviMetadata,
unlinkGraviMetadata,listGraviMetadata}', ...)`; add the three methods
      to the `experiments` group in `src/main/preload.ts`; add their typed
      signatures to the `experiments` group in `src/types/electron.d.ts` via
      `ReturnType<typeof ...>`. Remove the now-stale "deliberately NOT
      implemented" comment block at `database-handlers.ts:1813-1825`.
- [x] 6.2 Add a round-trip `test.describe` block to
      `tests/e2e/renderer-database-ipc.e2e.ts` (grouped like the existing
      `graviPlateAccessions.*` block), exercising through the real
      `window.electron.database.experiments.*` surface: seed a graviscan
      experiment + a GraviScan metadata file, `linkGraviMetadata` →
      `listGraviMetadata` (confirm it appears) → `linkGraviMetadata` again
      on the same wave (confirm rejected) → `unlinkGraviMetadata` →
      `listGraviMetadata` (confirm empty) → `linkGraviMetadata` again with a
      different metadata file (confirm the relink-after-unlink workflow
      succeeds).
- [x] 6.3 Run `npm run test:e2e -- tests/e2e/renderer-database-ipc.e2e.ts`
      (actual Playwright execution against a real Electron+SQLite instance,
      not just the static coverage checker) and confirm it passes. (New test
      passed standalone; full file re-run confirms all 66 e2e tests pass,
      10.6m.)
- [x] 6.4 Run `npm run test:e2e:coverage` and confirm the 90% IPC coverage
      gate passes with the three new `db:experiments:*` handlers counted as
      tested. (43/45 = 95.6%, exactly matching the proposal's predicted
      math; 2 untested handlers are pre-existing and unrelated —
      `db:accessions:updateMapping`, `db:images:create`.)

## 7. Verification

- [x] 7.1 Run `npm run lint` and `npm run format:check`. (Both clean —
      reformatted this change's own files with `prettier --write`; did not
      touch pre-existing unrelated files also flagged by `format:check`.)
- [x] 7.2 Run `npm run test:unit` (full unit suite, not just the new file).
      (1212/1219 passed; 7 pre-existing failures in
      `config-store.test.ts`, `image-uploader.test.ts`,
      `AccessionForm.test.tsx`, `scan-coordinator.test.ts` — all unrelated
      to this change, confirmed untouched by its diff, same set flagged
      after Section 1's check gate.)
- [x] 7.3 Run `npx tsc --noEmit` (or the project's typecheck script) to
      confirm the `electron.d.ts` changes compile. (Clean.)
- [x] 7.4 Re-run `./scripts/verify-migrations.sh` and `npm run test:db-upgrade`
      as a final check after all handler changes. (Schema-equivalence
      confirmed via `better-sqlite3` diff — `sqlite3` CLI unavailable
      locally; 34/34 upgrade tests passed.)
