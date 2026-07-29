## ADDED Requirements

### Requirement: GraviScan Post-Scan Plate Position Verification

The system SHALL provide a `graviscan:verify-plates` capability that reads
the QR code embedded in each plate's scan image, looks up which plate that QR
code belongs to via `GraviPlateSectionMapping`, and compares it against the
plate the operator assigned to that scanner/position
(`GraviScanPlateAssignment`). Each plate SHALL be classified as one of
`verified`, `incorrect`, `unreadable`, `needs_review`, or `duplicate_qr`, and
the final `verification_status` SHALL be persisted onto
`GraviScanPlateAssignment` for every plate submitted in the batch.

#### Scenario: Detected plate matches assigned plate

- **GIVEN** a plate's scan image contains a QR code that maps (via
  `GraviPlateSectionMapping`) to the same plate ID as its
  `assignedPlateId`
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the plate's status SHALL be `verified`
- **AND** `GraviScanPlateAssignment.verification_status` SHALL be set to
  `verified` for that scanner/plate-index

#### Scenario: No QR code detected on a plate's image

- **GIVEN** a plate's scan image yields zero decoded QR codes
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the plate's status SHALL be `unreadable`
- **AND** `GraviScanPlateAssignment.verification_status` SHALL be set to
  `unreadable`

#### Scenario: QR codes on one plate disagree about which plate they belong to

- **GIVEN** a plate's image yields multiple QR codes that map to more than
  one distinct plate ID via `GraviPlateSectionMapping`
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the plate's status SHALL be `needs_review`
- **AND** the result SHALL include the conflicting `plate_id -> qr codes`
  breakdown
- **AND** no automatic swap correction SHALL be attempted for that plate

#### Scenario: Same QR code detected on two different plates in one batch

- **GIVEN** two plates in the same verification batch each yield a detected
  QR code that is identical
- **WHEN** `graviscan:verify-plates` runs
- **THEN** both plates' status SHALL be `duplicate_qr`
- **AND** normal verified/incorrect classification SHALL be skipped for both

#### Scenario: Two plates were swapped during loading

- **GIVEN** plate A (assigned `Plate_13`) has a scan image whose detected QR
  code maps to `Plate_16`, and plate B (assigned `Plate_16`) has a scan image
  whose detected QR code maps to `Plate_13`
- **WHEN** `graviscan:verify-plates` runs
- **THEN** a swap SHALL be detected between plate A's position and plate B's
  position
- **AND** `GraviScanPlateAssignment.plate_barcode` SHALL be updated for both
  positions so each now holds the other's original assigned plate ID
- **AND** the most recent non-deleted `GraviScan` record for each position
  SHALL have its `plate_barcode` updated to match
- **AND** both positions' final `verification_status` SHALL be `swapped`

#### Scenario: experimentId scopes the plate lookup

- **GIVEN** an `experimentId` is passed to `graviscan:verify-plates`
- **WHEN** looking up which plate a detected QR code belongs to
- **THEN** the `GraviPlateSectionMapping` query SHALL be scoped to plates
  whose accession's metadata file is linked to that experiment, to avoid
  matching a QR code against a plate from an unrelated experiment/accession

#### Scenario: A DB write failure for one plate does not abort the batch

- **GIVEN** a batch of multiple plates being verified
- **WHEN** the DB write for one plate's swap correction or
  `verification_status` update throws
- **THEN** that failure SHALL be caught and logged without throwing
- **AND** processing SHALL continue for the remaining plates in the batch

#### Scenario: Progress events are emitted for a future renderer

- **GIVEN** a main window is available
- **WHEN** `graviscan:verify-plates` starts, produces a per-plate result, and
  completes
- **THEN** `graviscan:verify-started`, `graviscan:verify-result`, and
  `graviscan:verify-complete` events SHALL be sent to the renderer via
  `webContents.send`
- **AND** the handler SHALL function correctly even when no renderer listens
  for these events

### Requirement: QR Code Reading from Scan Images

The system SHALL provide a `readQrCodes(imagePath)` function that decodes QR
codes from a scan image using `sharp` (image decode) and `@undecaf/zbar-wasm`
(QR/barcode scanning), running entirely in the main process without a Python
dependency.

#### Scenario: Image file does not exist

- **GIVEN** `imagePath` does not exist on disk
- **WHEN** `readQrCodes(imagePath)` is called
- **THEN** it SHALL return an empty array without throwing

#### Scenario: Concurrent calls do not crash the decoder

- **GIVEN** `readQrCodes` is called multiple times concurrently
- **WHEN** the calls overlap in time
- **THEN** the underlying `sharp` decodes SHALL be serialized through a
  sequential queue so no two decodes run concurrently

#### Scenario: Decode error is handled gracefully

- **GIVEN** an image file that exists but fails to decode or scan
- **WHEN** `readQrCodes(imagePath)` is called
- **THEN** the error SHALL be caught and logged
- **AND** the function SHALL return an empty array rather than rejecting

### Requirement: GraviScanPlateAssignment Verification Status Field

The `GraviScanPlateAssignment` Prisma model SHALL include a
`verification_status` string field, defaulting to `"pending"`, to record the
outcome of the most recent `graviscan:verify-plates` run for that
scanner/plate-index assignment.

#### Scenario: New plate assignment defaults to pending

- **GIVEN** a new `GraviScanPlateAssignment` row is created without an
  explicit `verification_status`
- **WHEN** the row is read back
- **THEN** `verification_status` SHALL be `"pending"`
