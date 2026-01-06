## ADDED Requirements

### Requirement: Experiment Accession Indicator

The ExperimentChooser component SHALL display a visual indicator for experiments that have accessions attached.

#### Scenario: Experiment with accession shows checkmark

- **WHEN** an experiment has an associated accession
- **THEN** the dropdown displays a checkmark prefix: `✓ {experiment.name}`

#### Scenario: Experiment without accession shows no indicator

- **WHEN** an experiment has no associated accession
- **THEN** the dropdown displays only the experiment name: `{experiment.name}`

### Requirement: Accession Linked Experiments Display

The AccessionList component SHALL display which experiments are linked to each accession when expanded.

#### Scenario: Accession with linked experiments

- **WHEN** an accession is expanded AND has linked experiments
- **THEN** a "Linked Experiments:" section displays with a bulleted list of experiment names

#### Scenario: Accession with no linked experiments

- **WHEN** an accession is expanded AND has no linked experiments
- **THEN** a "Linked Experiments:" section displays with italic gray text "No experiments linked"

### Requirement: Accession List Query Includes Experiments

The database handler for listing accessions SHALL include the linked experiments relation.

#### Scenario: Fetching accessions includes experiment names

- **WHEN** the accessions list is fetched
- **THEN** each accession includes an `experiments` array with experiment names
