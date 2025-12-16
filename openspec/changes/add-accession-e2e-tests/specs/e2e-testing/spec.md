## ADDED Requirements

### Requirement: Real-World Data E2E Testing

The E2E test suite SHALL include tests using real-world experiment data files to validate the accession upload workflow handles production data patterns.

#### Scenario: Upload real experiment Excel file

- **GIVEN** the test fixture `ARV1_Media_Pilot_Master_Data.xlsx` exists in `tests/fixtures/excel/`
- **WHEN** the E2E test uploads this file on the Accessions page
- **AND** maps the `Barcode` column to Plant ID
- **AND** maps the `Line` column to Genotype ID
- **THEN** the upload SHALL succeed
- **AND** an accession with name containing "ARV1_Media_Pilot_Master_Data" SHALL be created
- **AND** 20 plant-to-genotype mappings SHALL be associated with the accession

#### Scenario: Preview displays real data correctly

- **GIVEN** the user has uploaded `ARV1_Media_Pilot_Master_Data.xlsx`
- **WHEN** the preview table is displayed
- **THEN** the table SHALL show actual barcode values (e.g., "981T0FPX7B")
- **AND** the table SHALL show actual line values (e.g., "ARV1")
- **AND** empty cells SHALL display as empty (not "undefined" or "null")

#### Scenario: Column mapping with non-standard names

- **GIVEN** the uploaded Excel file has columns named `Barcode` and `Line` (not `PlantBarcode` and `GenotypeID`)
- **WHEN** the column selector dropdowns are populated
- **THEN** the dropdowns SHALL contain `Barcode` and `Line` as selectable options
- **AND** the user SHALL be able to map these columns successfully