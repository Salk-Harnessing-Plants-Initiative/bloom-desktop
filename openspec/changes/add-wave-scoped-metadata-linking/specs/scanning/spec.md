## ADDED Requirements

### Requirement: GraviScan Database Handler — experiments.linkGraviMetadata

The system SHALL provide a `database.experiments.linkGraviMetadata(experimentId, waveNumber, accessionId)` IPC handler in `src/main/database-handlers.ts`, backed by a `GraviExperimentWaveMetadata` Prisma model with a unique `(experiment_id, wave_number)` pair, FK to `Experiment` (`onDelete: Cascade`) and FK to `Accessions` (`onDelete: Restrict`). It SHALL validate, returning `{success: false, error: <message>}` and persisting nothing on any failure:

- `experimentId` and `accessionId` are non-empty strings and `waveNumber` is a non-negative integer within the range Prisma's `Int` column can store (32-bit signed: 0 to 2147483647);
- an `Experiment` with `id === experimentId` exists and its `experiment_type` is `"graviscan"`;
- an `Accessions` row with `id === accessionId` exists and has at least one linked `GraviPlateAccession` child;
- no `GraviExperimentWaveMetadata` row already exists for `(experimentId, waveNumber)`, regardless of whether the new `accessionId` would be the same as or different from the existing link's.

#### Scenario: link succeeds for a valid graviscan experiment and metadata file

- **GIVEN** a `graviscan`-typed experiment and an `Accessions` row with at least one `GraviPlateAccession` child, neither yet linked for wave `2`
- **WHEN** `linkGraviMetadata(experimentId, 2, accessionId)` is called
- **THEN** a `GraviExperimentWaveMetadata` row SHALL be created for `(experimentId, 2, accessionId)`
- **AND** the handler SHALL return `{success: true, data: <row with accession included>}`

#### Scenario: link accepts wave 0 as a valid boundary value

- **GIVEN** a `graviscan`-typed experiment and a valid metadata file, wave `0` not yet linked
- **WHEN** `linkGraviMetadata(experimentId, 0, accessionId)` is called
- **THEN** a `GraviExperimentWaveMetadata` row SHALL be created for `(experimentId, 0, accessionId)`
- **AND** the handler SHALL return `{success: true, data: <row with accession included>}`

#### Scenario: link rejects a non-string, missing, or empty experimentId

- **GIVEN** `experimentId` is a non-string value (e.g. a number, object, or `undefined`), or an empty string `""`
- **WHEN** `linkGraviMetadata` is called with that `experimentId`
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects a non-string, missing, or empty accessionId

- **GIVEN** `accessionId` is a non-string value (e.g. a number, object, or `undefined`), or an empty string `""`
- **WHEN** `linkGraviMetadata` is called with that `accessionId`
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects a malformed waveNumber

- **GIVEN** `waveNumber` is negative, non-integer (e.g. `1.5`), not a number, or exceeds `2147483647` (one past the maximum value Prisma's `Int` column can store)
- **WHEN** `linkGraviMetadata` is called with that `waveNumber`
- **THEN** the handler SHALL return `{success: false, error: <message>}` — a friendly validation error, not a raw database range error
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects an unknown experimentId

- **GIVEN** an `experimentId` that is a non-empty string but does not correspond to any `Experiment` row
- **WHEN** `linkGraviMetadata` is called with that `experimentId`
- **THEN** the handler SHALL return `{success: false, error: <message>}` indicating the experiment was not found
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects an unknown accessionId

- **GIVEN** an `accessionId` that is a non-empty string but does not correspond to any `Accessions` row
- **WHEN** `linkGraviMetadata` is called with that `accessionId`, for an otherwise-valid `graviscan` experiment
- **THEN** the handler SHALL return `{success: false, error: <message>}` indicating the metadata file was not found
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects a non-graviscan experiment

- **GIVEN** an experiment with `experiment_type === "cylinderscan"`
- **WHEN** `linkGraviMetadata(experimentId, 0, accessionId)` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects a metadata file with no GraviPlateAccession children

- **GIVEN** an `Accessions` row created via `accessions.createWithMappings` (a CylinderScan barcode-mapping file, no `GraviPlateAccession` children)
- **WHEN** `linkGraviMetadata(experimentId, 0, thatAccessionId)` is called on a `graviscan`-typed experiment
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be created

#### Scenario: link rejects an already-linked wave, even to the same accession

- **GIVEN** wave `3` of an experiment is already linked to metadata file A
- **WHEN** `linkGraviMetadata(experimentId, 3, metadataFileB)` is called, where metadata file B is either a different file or the same file A
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** wave `3` SHALL remain linked to metadata file A, unchanged

#### Scenario: link succeeds again after the wave was unlinked, even with a different accession

- **GIVEN** wave `3` of an experiment was linked to metadata file A, then unlinked via `unlinkGraviMetadata`
- **WHEN** `linkGraviMetadata(experimentId, 3, metadataFileB)` is called with a different metadata file B
- **THEN** a new `GraviExperimentWaveMetadata` row SHALL be created linking wave `3` to metadata file B
- **AND** the handler SHALL return `{success: true, data: <row with accession B included>}`

#### Scenario: deleting the linked Experiment cascades away the link

- **GIVEN** wave `1` of an experiment is linked to a metadata file
- **WHEN** that `Experiment` row is deleted
- **THEN** the corresponding `GraviExperimentWaveMetadata` row SHALL no longer exist
- **AND** the linked `Accessions` row (the metadata file itself) SHALL be unaffected

### Requirement: GraviScan Database Handler — experiments.unlinkGraviMetadata

The system SHALL provide a `database.experiments.unlinkGraviMetadata(experimentId, waveNumber)` IPC handler in `src/main/database-handlers.ts`.

#### Scenario: unlink succeeds and removes the link

- **GIVEN** wave `3` of an experiment is linked to a metadata file
- **WHEN** `unlinkGraviMetadata(experimentId, 3)` is called
- **THEN** the `GraviExperimentWaveMetadata` row for `(experimentId, 3)` SHALL be deleted
- **AND** the handler SHALL return `{success: true}`

#### Scenario: unlink on a non-existent link returns a friendly error

- **GIVEN** an experiment with no `GraviExperimentWaveMetadata` row for wave `5`
- **WHEN** `unlinkGraviMetadata(experimentId, 5)` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}` rather than a raw Prisma `P2025` error

#### Scenario: unlink rejects a non-string, missing, or empty experimentId

- **GIVEN** `experimentId` is a non-string value (e.g. a number, object, or `undefined`), or an empty string `""`
- **WHEN** `unlinkGraviMetadata` is called with that `experimentId`
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be deleted

#### Scenario: unlink rejects a malformed waveNumber

- **GIVEN** `waveNumber` is negative, non-integer, missing, or not a number
- **WHEN** `unlinkGraviMetadata` is called with that `waveNumber`
- **THEN** the handler SHALL return `{success: false, error: <message>}`
- **AND** no `GraviExperimentWaveMetadata` row SHALL be deleted

### Requirement: GraviScan Database Handler — experiments.listGraviMetadata

The system SHALL provide a `database.experiments.listGraviMetadata(experimentId)` IPC handler in `src/main/database-handlers.ts`, returning the experiment's linked metadata files ordered by `wave_number` ascending, each including its `accession`.

#### Scenario: list returns links ordered by wave number, scoped to one experiment

- **GIVEN** experiment A has metadata linked for waves `2` and `0`, and experiment B has metadata linked for wave `1`
- **WHEN** `listGraviMetadata(experimentA.id)` is called
- **THEN** the result SHALL contain exactly experiment A's two links, ordered `[wave 0, wave 2]`, each with its `accession` included
- **AND** experiment B's link SHALL NOT be included

#### Scenario: list returns an empty array for an experiment with no links

- **GIVEN** a `graviscan`-typed experiment with zero `GraviExperimentWaveMetadata` rows
- **WHEN** `listGraviMetadata(experimentId)` is called
- **THEN** the handler SHALL return `{success: true, data: []}`

#### Scenario: list rejects a non-string, missing, or empty experimentId

- **GIVEN** `listGraviMetadata` is called with an `experimentId` that is a non-string value, missing, or an empty string `""`
- **WHEN** the handler processes the request
- **THEN** the handler SHALL return `{success: false, error: <message>}` rather than passing the malformed value to Prisma

## MODIFIED Requirements

### Requirement: GraviScan Database Handlers — graviPlateAccessions.\*

The system SHALL provide `database.graviPlateAccessions.*` IPC handlers (`createWithSections`, `list`, `listFiles`, `delete`) in `src/main/database-handlers.ts`, following the existing convention. `createWithSections` and `delete` SHALL perform all writes inside a single `db.$transaction`. `listFiles` accepts no filesystem path argument — it queries `Accessions` rows with linked `GraviPlateAccession` children, not a directory listing. `delete` SHALL block deletion of a metadata file that is still referenced either by `Experiment.accession_id` or by any `GraviExperimentWaveMetadata.accession_id`, via a shared `countMetadataReferences()` helper that sums both reference counts.

#### Scenario: createWithSections is atomic across the whole batch

- **GIVEN** a `plates` array where one plate's sections would violate the `(gravi_plate_id, plant_qr)` uniqueness constraint
- **WHEN** `createWithSections(accessionData, plates)` is called
- **THEN** no `Accessions`, `GraviPlateAccession`, or `GraviPlateSectionMapping` row from the batch SHALL be persisted
- **AND** the handler SHALL return `{success: false, error: <message>}`

#### Scenario: list returns natural-sorted plates and sections

- **GIVEN** a metadata file with plates named `"P2"` and `"P10"`
- **WHEN** `list(metadataFileId)` is called
- **THEN** `"P2"` SHALL sort before `"P10"` (natural order, not lexicographic)
- **AND** each plate's `sections` SHALL be sorted the same way by `plate_section_id`

#### Scenario: listFiles takes no path and lists linked accession files only

- **GIVEN** a mix of `Accessions` rows, some with linked `GraviPlateAccession` children and some without
- **WHEN** `listFiles()` is called with no arguments
- **THEN** only the rows with at least one linked `GraviPlateAccession` SHALL be returned, each annotated with linked experiment names and a plate count

#### Scenario: delete is blocked while linked to an experiment via accession_id

- **GIVEN** a metadata file (`Accessions` row) referenced by `Experiment.accession_id` on at least one experiment
- **WHEN** `delete(metadataFileId)` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}` and delete nothing

#### Scenario: delete is blocked while linked via GraviExperimentWaveMetadata

- **GIVEN** a metadata file (`Accessions` row) with no `Experiment.accession_id` reference, but referenced by at least one `GraviExperimentWaveMetadata.accession_id`
- **WHEN** `delete(metadataFileId)` is called
- **THEN** the handler SHALL return `{success: false, error: <message>}` and delete nothing

#### Scenario: delete is allowed again after the blocking wave-link is unlinked

- **GIVEN** a metadata file blocked from deletion only by a single `GraviExperimentWaveMetadata` link (no `Experiment.accession_id` reference)
- **WHEN** that link is removed via `unlinkGraviMetadata`, and `delete(metadataFileId)` is then called
- **THEN** the handler SHALL return `{success: true}` and the `Accessions` row SHALL be deleted

#### Scenario: delete cascades its own children when unlinked

- **GIVEN** an unlinked metadata file with `GraviPlateAccession` and `GraviPlateSectionMapping` children
- **WHEN** `delete(metadataFileId)` is called
- **THEN** the `Accessions` row and all of its `GraviPlateAccession`/`GraviPlateSectionMapping` children SHALL be deleted
- **AND** no orphaned section rows SHALL remain
