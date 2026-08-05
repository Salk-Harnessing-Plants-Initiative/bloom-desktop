# Spec Delta: ui-management-pages

This change finishes scan-delete/metadata sync, adds a delete affordance to
ScanPreview, corrects the duplicate-scan check's key, and adds a new IPC
handler backing that check.

## ADDED Requirements

### Requirement: Scan Duplicate Check IPC Handler

The main process SHALL provide an IPC handler for checking whether a scan
matching a specific plant, experiment, wave, and age already exists.

#### Scenario: Duplicate exists

- **GIVEN** a non-deleted scan exists with `plant_id="PLANT_001"`,
  `experiment_id="EXP_001"`, `wave_number=2`, `plant_age_days=21`
- **WHEN** the renderer calls
  `db:scans:checkDuplicate("PLANT_001", "EXP_001", 2, 21)`
- **THEN** the handler SHALL return `{ success: true, data: true }`

#### Scenario: No duplicate — different wave or age

- **GIVEN** a non-deleted scan exists with `plant_id="PLANT_001"`,
  `experiment_id="EXP_001"`, `wave_number=2`, `plant_age_days=21`
- **WHEN** the renderer calls
  `db:scans:checkDuplicate("PLANT_001", "EXP_001", 3, 21)` (different wave)
  or `db:scans:checkDuplicate("PLANT_001", "EXP_001", 2, 25)` (different age)
- **THEN** the handler SHALL return `{ success: true, data: false }`

#### Scenario: No duplicate — different experiment

- **GIVEN** a non-deleted scan exists with `plant_id="PLANT_001"`,
  `experiment_id="EXP_001"`, `wave_number=2`, `plant_age_days=21`
- **WHEN** the renderer calls
  `db:scans:checkDuplicate("PLANT_001", "EXP_002", 2, 21)`
- **THEN** the handler SHALL return `{ success: true, data: false }`

#### Scenario: Soft-deleted matches are excluded

- **GIVEN** a scan matching `("PLANT_001", "EXP_001", 2, 21)` exists but has
  `deleted: true`
- **WHEN** the renderer calls
  `db:scans:checkDuplicate("PLANT_001", "EXP_001", 2, 21)`
- **THEN** the handler SHALL return `{ success: true, data: false }`

## MODIFIED Requirements

### Requirement: Duplicate Scan Prevention

The CaptureScan page SHALL prevent re-scanning the same plant for the same
experiment, wave, and plant age.

#### Scenario: Matching duplicate found

- **GIVEN** a non-deleted scan exists for plant "PLANT_001", experiment
  "EXP_001", wave 2, plant age 21 days
- **WHEN** the user selects experiment "EXP_001", enters barcode
  "PLANT_001", wave 2, and plant age 21
- **THEN** a warning SHALL be displayed indicating this plant/wave/age
  combination was already scanned for this experiment
- **AND** the scan button SHALL be disabled

#### Scenario: Different wave number

- **GIVEN** a non-deleted scan exists for plant "PLANT_001", experiment
  "EXP_001", wave 2, plant age 21 days
- **WHEN** the user enters the same plant and experiment but wave 3
- **THEN** no warning SHALL be displayed
- **AND** the scan button SHALL remain enabled

#### Scenario: Different plant age

- **GIVEN** a non-deleted scan exists for plant "PLANT_001", experiment
  "EXP_001", wave 2, plant age 21 days
- **WHEN** the user enters the same plant, experiment, and wave but plant
  age 25
- **THEN** no warning SHALL be displayed
- **AND** the scan button SHALL remain enabled

#### Scenario: Same plant scanned for different experiment

- **GIVEN** a non-deleted scan exists for plant "PLANT_001", experiment
  "EXP_001", wave 2, plant age 21 days
- **WHEN** the user selects experiment "EXP_002" with the same plant, wave,
  and age
- **THEN** no warning SHALL be displayed
- **AND** the scan button SHALL remain enabled

#### Scenario: Periodic duplicate check

- **GIVEN** the user has entered a plant barcode, experiment, wave number,
  and plant age
- **WHEN** the component is mounted
- **THEN** the duplicate check SHALL run every 2 seconds via
  `db:scans:checkDuplicate`
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

### Requirement: Delete Scan

The application SHALL allow users to soft-delete individual scans, with
confirmation, from both the BrowseScans table and the ScanPreview page.

#### Scenario: Delete Scan with Confirmation

- **GIVEN** the user is viewing the scans table or a scan's preview page
- **WHEN** the user clicks the delete button for a scan
- **THEN** a confirmation modal appears
- **AND** the modal shows the Plant ID and capture date
- **AND** the modal has Cancel and Delete buttons

**Acceptance Criteria**:

- Delete button has destructive styling (red), present in both
  `BrowseScans.tsx`'s table row actions and `ScanPreview.tsx`'s toolbar
- Confirmation modal is modal (blocks interaction), shared between both
  call sites (not a native `window.confirm()`)
- Cancel closes the modal without action
- Delete calls the `db:scans:delete` IPC handler; on success, BrowseScans
  refreshes its table and ScanPreview navigates back to `/scans`

#### Scenario: Soft Delete Preserves Data

- **GIVEN** the user confirms scan deletion
- **WHEN** the delete operation completes
- **THEN** the scan's `deleted` field is set to `true` in the database
- **AND** the scan's `metadata.json` on disk has `deleted: true` set
- **AND** the scan no longer appears in the BrowseScans table
- **AND** the scan files are NOT removed from disk
- **AND** a success message appears briefly

**Acceptance Criteria**:

- Database record preserved with `deleted: true`
- `metadata.json` updated with `deleted: true` via an atomic write
- Files remain in the scans directory
- Success message: "Scan deleted successfully"

### Requirement: Scan Delete IPC Handler

The main process SHALL provide an IPC handler for soft-deleting scans that
keeps the scan's on-disk `metadata.json` in sync.

#### Scenario: Soft Delete Scan

- **GIVEN** the renderer calls `db:scans:delete` with a scan ID
- **WHEN** the handler processes the request
- **THEN** the scan's `deleted` field is set to `true` in the database
- **AND** the handler returns success confirmation
- **AND** the scan files are NOT removed from disk

**Acceptance Criteria**:

- Sets `deleted: true` via Prisma update
- Does not delete Image records
- Does not delete files from filesystem
- Returns `{ success: true }` on completion
- Returns error if scan not found

#### Scenario: metadata.json is updated on delete

- **GIVEN** a scan with an existing `metadata.json` file on disk
- **WHEN** `db:scans:delete` successfully soft-deletes the scan
- **THEN** the scan's `metadata.json` file SHALL be rewritten with
  `deleted: true` added, via an atomic write (temp file + rename)
- **AND** all other fields in `metadata.json` SHALL remain unchanged

#### Scenario: Missing metadata.json does not fail the delete

- **GIVEN** a scan whose `metadata.json` file does not exist on disk (e.g.
  a legacy scan captured before metadata.json support existed)
- **WHEN** `db:scans:delete` is called for that scan
- **THEN** the database soft-delete SHALL still succeed
- **AND** the handler SHALL log a warning about the missing file
- **AND** the handler SHALL still return `{ success: true }`
