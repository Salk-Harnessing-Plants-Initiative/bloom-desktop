## ADDED Requirements

### Requirement: Wave-Scoped Metadata Linking (GraviScan)

The system SHALL link metadata files (`Accessions`) to GraviScan experiments at the wave level. Each `(experiment_id, wave_number)` pair SHALL have at most one linked metadata file. CylinderScan experiments are not affected — they continue to use `Experiment.accession_id` for a single per-experiment metadata file.

#### Scenario: Link metadata to a specific wave

- **GIVEN** a GraviScan experiment with no metadata linked for wave 1
- **WHEN** the user uploads a metadata file with `wave_number = 1`
- **THEN** a `GraviExperimentWaveMetadata` row SHALL be created
- **AND** the metadata file SHALL appear on the experiment detail page under "Wave 1"

#### Scenario: Cannot link two metadata files to the same wave

- **GIVEN** wave 1 already has a linked metadata file
- **WHEN** the user attempts to link a second file to wave 1
- **THEN** the operation SHALL fail with: "Wave 1 already has linked metadata. Unlink first."

#### Scenario: Multiple waves with different metadata

- **GIVEN** wave 1 has metadata A and wave 2 has metadata B
- **WHEN** the user views the experiment detail page
- **THEN** both links SHALL be shown, each with its own Unlink button

#### Scenario: CylinderScan unaffected

- **GIVEN** a CylinderScan experiment with `accession_id` set
- **WHEN** the user views the experiment detail page
- **THEN** the metadata SHALL display via the existing `Experiment.accession` field
- **AND** no per-wave UI SHALL appear

### Requirement: Block Metadata Deletion When Linked

The system SHALL prevent deletion of a metadata file when any of the following reference it:
- `Experiment.accession_id` (CylinderScan path)
- `GraviExperimentWaveMetadata.accession_id` (GraviScan path)

#### Scenario: Delete metadata linked to a CylinderScan experiment

- **GIVEN** a metadata file is referenced by `Experiment.accession_id` of one experiment
- **WHEN** the user attempts to delete the metadata file
- **THEN** deletion SHALL fail with an error noting the linked experiment count
- **AND** the metadata file SHALL remain

#### Scenario: Delete metadata linked to a GraviScan wave

- **GIVEN** a metadata file is referenced by a `GraviExperimentWaveMetadata` row
- **WHEN** the user attempts to delete the metadata file
- **THEN** deletion SHALL fail with the same error
- **AND** the metadata file SHALL remain

#### Scenario: Delete metadata after fully unlinked

- **GIVEN** the metadata file has no references in either table
- **WHEN** the user attempts to delete the metadata file
- **THEN** deletion SHALL succeed and remove all child `GraviPlateAccession` and `GraviPlateSectionMapping` rows

### Requirement: Unlink Metadata From Wave

The system SHALL provide an "Unlink" button on the GraviScan experiment detail page next to each linked metadata file. Unlinking removes only the link, not the metadata file itself.

#### Scenario: User clicks Unlink

- **GIVEN** wave 1 has linked metadata "Wave1.csv"
- **WHEN** the user clicks "Unlink" next to it
- **THEN** the `GraviExperimentWaveMetadata` row SHALL be deleted
- **AND** the metadata file SHALL remain in the database, available for re-linking
- **AND** the experiment detail page SHALL no longer show metadata under wave 1
