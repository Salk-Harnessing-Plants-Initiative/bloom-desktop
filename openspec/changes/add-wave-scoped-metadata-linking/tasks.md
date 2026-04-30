## 1. Schema and Migration

- [ ] 1.1 Add `GraviExperimentWaveMetadata` model to `prisma/schema.prisma` with `@@unique([experiment_id, wave_number])`
- [ ] 1.2 Create migration: create table; for experiments where `experiment_type = 'graviscan'` AND `accession_id IS NOT NULL`, insert a row into the new table with `wave_number=1`; set those rows' `accession_id` to NULL
- [ ] 1.3 Run `npx prisma generate` to update Prisma Client

## 2. Backend Handlers

- [ ] 2.1 New handler `db:experiment:linkGraviMetadata(experiment_id, wave_number, accession_id)` — upsert via unique key, error if wave already linked
- [ ] 2.2 New handler `db:experiment:unlinkGraviMetadata(experiment_id, wave_number)` — delete row, return success
- [ ] 2.3 New handler `db:experiment:listGraviMetadata(experiment_id)` — return all wave→metadata rows
- [ ] 2.4 Modify `db:graviPlateAccessions:delete` — count references in BOTH `Experiment.accession_id` AND `GraviExperimentWaveMetadata.accession_id`; block if any
- [ ] 2.5 Modify `db:accessions:delete` — same protection

## 3. Types and Preload

- [ ] 3.1 Add `linkGraviMetadata`, `unlinkGraviMetadata`, `listGraviMetadata` to `ElectronAPI.database.experiments`
- [ ] 3.2 Expose in `preload.ts`
- [ ] 3.3 Add `WaveMetadataLink` interface in `src/types/database.ts`

## 4. UI

- [ ] 4.1 In `ExperimentDetail.tsx`, when `experiment_type === 'graviscan'`, render "Linked Metadata" section: rows of `(wave, metadata file name, Unlink)`
- [ ] 4.2 Unlink button calls `unlinkGraviMetadata`, refreshes list
- [ ] 4.3 In `GraviMetadataUpload.tsx`, add `wave_number` numeric input (default 1)
- [ ] 4.4 On upload success, call `linkGraviMetadata` with chosen wave; show error toast if wave already linked
- [ ] 4.5 In `Metadata.tsx` list, show error toast when delete is blocked

## 5. Tests

- [ ] 5.1 Unit test: `linkGraviMetadata` enforces unique (experiment, wave) — second link fails
- [ ] 5.2 Unit test: `unlinkGraviMetadata` removes the row
- [ ] 5.3 Unit test: `accessions:delete` blocks when linked via `Experiment.accession_id` (cylinderscan path)
- [ ] 5.4 Unit test: `accessions:delete` blocks when linked via `GraviExperimentWaveMetadata` (graviscan path)
- [ ] 5.5 Unit test: `accessions:delete` succeeds when fully unlinked
- [ ] 5.6 Migration test: existing graviscan experiments end up with rows in the new table
- [ ] 5.7 Migration test: cylinderscan experiments untouched (`accession_id` preserved)
