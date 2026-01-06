## ADDED Requirements

### Requirement: Plant Barcode Autocomplete

The PlantBarcodeInput component SHALL provide autocomplete suggestions from the experiment's accession mappings as the user types.

#### Scenario: Display autocomplete suggestions

- **GIVEN** an experiment with an attached accession containing plant barcodes ["PLANT_001", "PLANT_002", "PLANT_003", "OTHER_001"]
- **WHEN** the user types "PLANT" in the plant barcode field
- **THEN** a dropdown SHALL appear showing up to 5 matching barcodes
- **AND** the matches SHALL be case-insensitive
- **AND** the dropdown SHALL show ["PLANT_001", "PLANT_002", "PLANT_003"]

#### Scenario: Select autocomplete suggestion

- **GIVEN** the autocomplete dropdown is visible with suggestions
- **WHEN** the user clicks on a suggestion or presses Enter while highlighted
- **THEN** the input SHALL be populated with the selected barcode
- **AND** the dropdown SHALL close
- **AND** the genotype ID SHALL be auto-populated

#### Scenario: Keyboard navigation

- **GIVEN** the autocomplete dropdown is visible with suggestions
- **WHEN** the user presses Arrow Down/Up
- **THEN** the highlight SHALL move between suggestions
- **AND** pressing Escape SHALL close the dropdown without selection

#### Scenario: No suggestions when experiment has no accession

- **GIVEN** an experiment without an attached accession
- **WHEN** the user types in the plant barcode field
- **THEN** no autocomplete dropdown SHALL appear
- **AND** the user MAY enter any barcode manually

### Requirement: Plant Barcode Validation

The PlantBarcodeInput component SHALL validate plant barcodes against the experiment's accession mappings and block scanning for invalid barcodes.

#### Scenario: Valid barcode entered

- **GIVEN** an experiment with an accession containing barcode "PLANT_001"
- **WHEN** the user enters "PLANT_001" in the plant barcode field
- **THEN** no validation error SHALL be displayed
- **AND** the scan button SHALL remain enabled (if other requirements met)

#### Scenario: Invalid barcode entered

- **GIVEN** an experiment with an accession containing only ["PLANT_001", "PLANT_002"]
- **WHEN** the user enters "INVALID_BARCODE" in the plant barcode field
- **THEN** a validation error SHALL be displayed: "Barcode not found in accession file"
- **AND** the scan button SHALL be disabled

#### Scenario: Validation skipped when no accession attached

- **GIVEN** an experiment without an attached accession
- **WHEN** the user enters any barcode
- **THEN** no validation error SHALL be displayed
- **AND** the user MAY proceed with the scan

### Requirement: Plant Barcode Sanitization

The PlantBarcodeInput component SHALL sanitize user input to normalize barcode formats.

#### Scenario: Replace plus signs with underscores

- **GIVEN** the user is entering a plant barcode
- **WHEN** the user types "PLANT+001"
- **THEN** the input SHALL display "PLANT_001"

#### Scenario: Replace spaces with underscores

- **GIVEN** the user is entering a plant barcode
- **WHEN** the user types "PLANT 001 TEST"
- **THEN** the input SHALL display "PLANT_001_TEST"

#### Scenario: Preserve allowed characters

- **GIVEN** the user is entering a plant barcode
- **WHEN** the user types "Plant_001-A"
- **THEN** the input SHALL display "Plant_001-A" (unchanged)
- **AND** alphanumerics, underscores, and dashes SHALL be preserved

#### Scenario: Strip other special characters

- **GIVEN** the user is entering a plant barcode
- **WHEN** the user types "PLANT@001#TEST!"
- **THEN** the input SHALL display "PLANT001TEST"

### Requirement: Genotype ID Auto-Population

The MetadataForm SHALL automatically populate the genotype ID field when a valid plant barcode is entered.

#### Scenario: Auto-populate genotype ID on valid barcode

- **GIVEN** an experiment with an accession mapping: barcode "PLANT_001" -> genotype_id "GT_ABC123"
- **WHEN** the user enters or selects "PLANT_001"
- **THEN** the genotype ID field SHALL be automatically populated with "GT_ABC123"

#### Scenario: Clear genotype ID when barcode changes to invalid

- **GIVEN** the genotype ID field is populated with "GT_ABC123"
- **WHEN** the user changes the plant barcode to an invalid value
- **THEN** the genotype ID field SHALL be cleared

#### Scenario: No auto-population when experiment has no accession

- **GIVEN** an experiment without an attached accession
- **WHEN** the user enters a plant barcode
- **THEN** the genotype ID field SHALL NOT be auto-populated
- **AND** the user MAY enter a genotype ID manually

### Requirement: Duplicate Scan Prevention

The CaptureScan page SHALL prevent re-scanning the same plant on the same day for the same experiment.

#### Scenario: Plant already scanned today

- **GIVEN** plant "PLANT_001" was scanned today for experiment "EXP_001"
- **WHEN** the user selects experiment "EXP_001" and enters barcode "PLANT_001"
- **THEN** a warning SHALL be displayed: "This plant was already scanned today"
- **AND** the scan button SHALL be disabled

#### Scenario: Plant scanned on a different day

- **GIVEN** plant "PLANT_001" was scanned yesterday for experiment "EXP_001"
- **WHEN** the user selects experiment "EXP_001" and enters barcode "PLANT_001"
- **THEN** no warning SHALL be displayed
- **AND** the scan button SHALL remain enabled

#### Scenario: Same plant scanned for different experiment

- **GIVEN** plant "PLANT_001" was scanned today for experiment "EXP_001"
- **WHEN** the user selects experiment "EXP_002" and enters barcode "PLANT_001"
- **THEN** no warning SHALL be displayed
- **AND** the scan button SHALL remain enabled

#### Scenario: Periodic duplicate check

- **GIVEN** the user has entered a plant barcode and experiment
- **WHEN** the component is mounted
- **THEN** the duplicate check SHALL run every 2 seconds
- **AND** the check SHALL stop when the component unmounts

### Requirement: Plant Barcode IPC Handlers

The main process SHALL provide IPC handlers for plant barcode operations.

#### Scenario: Get plant barcodes for accession

- **GIVEN** an accession with plant mappings exists
- **WHEN** the renderer calls `db:accessions:getPlantBarcodes(accessionId)`
- **THEN** the handler SHALL return an array of plant barcodes

#### Scenario: Get genotype ID by barcode

- **GIVEN** a plant barcode mapping exists for an experiment's accession
- **WHEN** the renderer calls `db:accessions:getGenotypeByBarcode(plantBarcode, experimentId)`
- **THEN** the handler SHALL return the genotype_id or null if not found

#### Scenario: Get most recent scan date

- **GIVEN** scans exist for a plant and experiment
- **WHEN** the renderer calls `db:scans:getMostRecentScanDate(plantId, experimentId)`
- **THEN** the handler SHALL return the most recent capture_date or null if no scans exist
