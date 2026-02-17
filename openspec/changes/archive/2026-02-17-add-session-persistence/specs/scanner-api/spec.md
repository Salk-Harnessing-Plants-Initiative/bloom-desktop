## ADDED Requirements

### Requirement: Session Metadata Persistence

The application SHALL maintain in-memory session state for scan metadata fields, persisting values across page navigation within a single app session, and resetting values on app restart.

#### Scenario: Session state survives page navigation

- **GIVEN** user is on CaptureScan page
- **AND** user has selected phenotyper "John", experiment "EXP-001", wave 3, plant age 14
- **AND** accession "Col-0" was auto-populated from barcode lookup
- **WHEN** user navigates to another page and returns to CaptureScan
- **THEN** the form SHALL display phenotyper "John"
- **AND** the form SHALL display experiment "EXP-001"
- **AND** the form SHALL display wave number 3
- **AND** the form SHALL display plant age 14
- **AND** the form SHALL display accession "Col-0"

#### Scenario: Session state resets on app restart

- **GIVEN** user had selected phenotyper "John" and experiment "EXP-001"
- **WHEN** the application is closed and reopened
- **THEN** the session state SHALL be empty (null for all fields)
- **AND** the CaptureScan form SHALL show empty/default values

#### Scenario: Plant barcode does not persist

- **GIVEN** user has entered plantQrCode "PLANT-123"
- **WHEN** user navigates away and returns to CaptureScan
- **THEN** plantQrCode field SHALL be empty
- **AND** accessionName field SHALL be empty (since it depends on barcode)

### Requirement: Session State IPC Handlers

The application SHALL provide IPC handlers for getting and setting each session field, following the pilot implementation pattern.

#### Scenario: Get phenotyper ID returns persisted value

- **GIVEN** session phenotyperId is set to "scientist-uuid-123"
- **WHEN** renderer invokes `window.electron.session.getPhenotyperId()`
- **THEN** the handler SHALL return "scientist-uuid-123"

#### Scenario: Set phenotyper ID persists value

- **GIVEN** session phenotyperId is null
- **WHEN** renderer invokes `window.electron.session.setPhenotyperId("scientist-uuid-456")`
- **THEN** the handler SHALL store "scientist-uuid-456" in memory
- **AND** subsequent get calls SHALL return "scientist-uuid-456"

#### Scenario: Get experiment ID returns persisted value

- **GIVEN** session experimentId is set to "exp-uuid-789"
- **WHEN** renderer invokes `window.electron.session.getExperimentId()`
- **THEN** the handler SHALL return "exp-uuid-789"

#### Scenario: Get wave number returns persisted value

- **GIVEN** session waveNumber is set to 5
- **WHEN** renderer invokes `window.electron.session.getWaveNumber()`
- **THEN** the handler SHALL return 5

#### Scenario: Get plant age days returns persisted value

- **GIVEN** session plantAgeDays is set to 21
- **WHEN** renderer invokes `window.electron.session.getPlantAgeDays()`
- **THEN** the handler SHALL return 21

#### Scenario: Get accession name returns persisted value

- **GIVEN** session accessionName is set to "Col-0"
- **WHEN** renderer invokes `window.electron.session.getAccessionName()`
- **THEN** the handler SHALL return "Col-0"

#### Scenario: Null values indicate unset state

- **GIVEN** app has just started
- **AND** no session values have been set
- **WHEN** renderer invokes any session getter
- **THEN** the handler SHALL return null
- **AND** no error SHALL be thrown

### Requirement: Accession Lookup from Barcode

When user enters a plant barcode, the system SHALL look up the accession name from PlantAccessionMappings and auto-populate the accession field.

#### Scenario: Barcode lookup returns accession name

- **GIVEN** PlantAccessionMappings contains entry: plant_barcode="PLANT-001", accession_name="Col-0"
- **AND** user has selected an experiment linked to this accession file
- **WHEN** user enters barcode "PLANT-001"
- **THEN** the accession field SHALL auto-populate with "Col-0"
- **AND** the session accessionName SHALL be set to "Col-0"

#### Scenario: Barcode not found shows empty accession

- **GIVEN** PlantAccessionMappings does not contain barcode "UNKNOWN-123"
- **WHEN** user enters barcode "UNKNOWN-123"
- **THEN** the accession field SHALL remain empty
- **AND** an appropriate message MAY be shown

#### Scenario: Accession stored with scan and uploaded to Bloom

- **GIVEN** user enters barcode "PLANT-001" which maps to accession "Col-0"
- **WHEN** user captures a scan
- **THEN** the Scan record SHALL store accession_name = "Col-0"
- **AND** the scan upload SHALL include accession_name = "Col-0"

### Requirement: Recent Scans Loading on Mount

CaptureScan page SHALL load today's scans from the database when the component mounts, displaying them in the recent scans list.

#### Scenario: Today's scans loaded on mount

- **GIVEN** database contains 3 scans from today
- **AND** database contains 5 scans from yesterday
- **WHEN** user navigates to CaptureScan page
- **THEN** the recent scans list SHALL show exactly 3 scans
- **AND** the scans SHALL be from today's date only

#### Scenario: Recent scans persist across navigation

- **GIVEN** user captured 2 scans earlier in the session
- **AND** database recorded those scans
- **WHEN** user navigates away and returns to CaptureScan
- **THEN** the recent scans list SHALL include the 2 previously captured scans
- **AND** scans captured during current session SHALL appear in the list

#### Scenario: New scans added to loaded list

- **GIVEN** CaptureScan loaded 3 existing scans on mount
- **WHEN** user captures a new scan
- **THEN** the new scan SHALL appear at the top of the recent scans list
- **AND** the 3 previously loaded scans SHALL remain in the list

#### Scenario: Empty database shows empty list

- **GIVEN** database contains no scans for today
- **WHEN** user navigates to CaptureScan page
- **THEN** the recent scans list SHALL be empty
- **AND** no error SHALL be displayed

## MODIFIED Requirements

### Requirement: PlantAccessionMappings Schema

PlantAccessionMappings SHALL store accession_name as a human-readable field, separate from the UUID references.

#### Scenario: Accession file upload stores accession name

- **GIVEN** user uploads Excel file with columns: plant_barcode, accession
- **AND** file contains row: "PLANT-001", "Col-0"
- **WHEN** the accession file is saved
- **THEN** PlantAccessionMappings SHALL store accession_name = "Col-0"
- **AND** accession_file_id SHALL reference the Accessions record (UUID)

#### Scenario: Accession lookup returns human-readable name

- **GIVEN** PlantAccessionMappings has accession_name = "Col-0" for barcode "PLANT-001"
- **WHEN** system looks up barcode "PLANT-001"
- **THEN** the lookup SHALL return "Col-0" (the accession name)
- **AND** this value SHALL be suitable for upload to Bloom as accession_name

### Requirement: UI Labels for Accession

All UI references to "Genotype ID" SHALL be renamed to "Accession" for clarity and consistency with the data model.

#### Scenario: AccessionFileUpload shows Accession column selector

- **GIVEN** user is uploading an Excel accession file
- **WHEN** the column selector is displayed
- **THEN** the label SHALL read "Select Accession Column" (not "Genotype ID")

#### Scenario: AccessionList shows Accession column

- **GIVEN** user is viewing an accession's plant mappings
- **WHEN** the table is displayed
- **THEN** the column header SHALL read "Accession" (not "Genotype ID")

#### Scenario: MetadataForm shows Accession field

- **GIVEN** user is entering scan metadata
- **WHEN** the form displays the auto-populated accession
- **THEN** the field label SHALL read "Accession" (not "Genotype ID")

## REMOVED Requirements

### Requirement: Genotype ID Field (PlantAccessionMappings)

**Reason**: The genotype_id field was incorrectly named. The value it stores IS the accession name (e.g., "Col-0"). Renaming to accession_name clarifies the data model and matches the pilot and Bloom schemas.

**Migration**: Database migration renames the column. All code references updated from genotype_id to accession_name.

### Requirement: Redundant accession_id Field (PlantAccessionMappings)

**Reason**: The accession_id field in PlantAccessionMappings was redundant - it always stored the same UUID as accession_file_id and was never read anywhere in the codebase.

**Migration**: Database migration removes the column. Code that wrote to this field is updated to remove the write.

### Requirement: accession_id Field (Scan)

**Reason**: The Scan.accession_id field actually stores the accession NAME (e.g., "Col-0"), not an ID. Renaming to accession_name clarifies the data model.

**Migration**: Database migration renames the column. All code references updated from accession_id to accession_name.
