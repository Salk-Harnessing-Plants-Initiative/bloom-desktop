## ADDED Requirements

### Requirement: Accession Mappings Preview

The Accessions page SHALL display a table of plant-to-genotype mappings when an accession is expanded, allowing users to view and verify uploaded data.

#### Scenario: View mappings table in expanded accession

- **GIVEN** an accession exists with plant mappings
- **WHEN** the user clicks on the accession to expand it
- **THEN** a table SHALL be displayed showing all plant mappings
- **AND** the table SHALL have columns for "Plant Barcode" and "Genotype ID"
- **AND** the mappings SHALL be sorted alphabetically by plant barcode

#### Scenario: Empty mappings state

- **GIVEN** an accession exists with no plant mappings
- **WHEN** the user expands the accession
- **THEN** a message SHALL indicate "No plant mappings" or similar
- **AND** the Edit and Delete buttons SHALL still be visible

#### Scenario: Loading state for mappings

- **GIVEN** the user clicks to expand an accession
- **WHEN** the mappings are being fetched from the database
- **THEN** a loading indicator SHALL be displayed
- **AND** the loading indicator SHALL be replaced by the table when data loads

#### Scenario: Mappings table scrollable for large datasets

- **GIVEN** an accession has more than 10 plant mappings
- **WHEN** the mappings table is displayed
- **THEN** the table SHALL be scrollable vertically
- **AND** the table height SHALL be constrained to prevent excessive page length

### Requirement: Inline Editing of Accession Mappings

The Accessions page SHALL allow users to edit the genotype ID of individual plant mappings inline.

#### Scenario: Edit genotype ID inline

- **GIVEN** the mappings table is displayed for an expanded accession
- **WHEN** the user clicks on a genotype ID cell
- **THEN** the cell SHALL become editable with an input field
- **AND** the input SHALL be pre-populated with the current value

#### Scenario: Save inline edit with Enter key

- **GIVEN** the user is editing a genotype ID inline
- **WHEN** the user presses Enter
- **THEN** the new value SHALL be saved to the database
- **AND** the cell SHALL return to display mode with the updated value

#### Scenario: Cancel inline edit with Escape key

- **GIVEN** the user is editing a genotype ID inline
- **WHEN** the user presses Escape
- **THEN** the edit SHALL be cancelled
- **AND** the cell SHALL return to display mode with the original value

#### Scenario: Save inline edit on blur

- **GIVEN** the user is editing a genotype ID inline
- **WHEN** the user clicks outside the input field
- **THEN** the new value SHALL be saved to the database
- **AND** the cell SHALL return to display mode with the updated value
