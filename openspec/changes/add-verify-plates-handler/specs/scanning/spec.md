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

#### Scenario: Detected plate matches assigned plate with different letter casing

- **GIVEN** a plate's `assignedPlateId` is `"Plate_13"` and the detected QR
  code maps to a `plate_id` of `"Plate_13"` in the DB (or any differing
  casing of the same identifier)
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the comparison SHALL be case-insensitive on **both** sides
- **AND** the plate's status SHALL be `verified`

#### Scenario: No QR code detected on a plate's image

- **GIVEN** a plate's scan image yields zero decoded QR codes
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the plate's status SHALL be `unreadable`
- **AND** `GraviScanPlateAssignment.verification_status` SHALL be set to
  `unreadable`

#### Scenario: Detected plate does not match assigned plate and no swap partner is found

- **GIVEN** a plate's detected QR code maps to a different plate ID than its
  `assignedPlateId`
- **AND** no other plate in the same batch forms a reciprocal swap with it
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the plate's status SHALL be `incorrect`
- **AND** `GraviScanPlateAssignment.verification_status` SHALL be set to
  `incorrect` — **not** remapped to `unreadable`
- **NOTE**: production's own implementation remaps this case to
  `unreadable` and its renderer shows an identical label for both cases.
  This is a deliberate departure from production: `incorrect` (QR read
  successfully, wrong plate) and `unreadable` (QR could not be read at all)
  are distinct, actionable-differently outcomes for an operator and SHALL
  remain distinguishable in persisted data. A future renderer consuming this
  status SHALL give `incorrect` its own label, not reuse "QR Unreadable".

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

#### Scenario: experimentId scopes both the plate lookup and every DB write

- **GIVEN** an `experimentId` is passed to `graviscan:verify-plates`
- **WHEN** looking up which plate a detected QR code belongs to, **and** when
  persisting swap corrections or the final `verification_status`
- **THEN** the `GraviPlateSectionMapping` lookup SHALL be scoped to plates
  whose accession's metadata file is linked to that experiment
- **AND** every `GraviScanPlateAssignment`/`GraviScan` write SHALL be scoped
  to `(experimentId, scanner_id, plate_index)` — matching the actual
  `@@unique([experiment_id, scanner_id, plate_index])` constraint — so a
  scanner reused across experiments can never have one experiment's
  verification run overwrite a different experiment's historical data
  sharing the same scanner and plate position

#### Scenario: A DB write failure for one plate does not abort the batch

- **GIVEN** a batch of multiple plates being verified
- **WHEN** the DB write for one plate's swap correction or
  `verification_status` update throws
- **THEN** that failure SHALL be caught and logged without throwing
- **AND** processing SHALL continue for the remaining plates in the batch

#### Scenario: imagePath is validated before decoding

- **GIVEN** a plate's `imagePath` resolves (via symlink or `..` traversal)
  outside the configured scan output directory
- **WHEN** `graviscan:verify-plates` processes that plate
- **THEN** the path SHALL be rejected before being passed to the QR decoder,
  using the same realpath-containment check this repo's `read-scan-image`
  handler already applies

#### Scenario: Progress events are emitted for a future renderer

- **GIVEN** a main window is available
- **WHEN** `graviscan:verify-plates` starts, produces a per-plate result, and
  completes
- **THEN** `graviscan:verify-started`, `graviscan:verify-result`, and
  `graviscan:verify-complete` events SHALL be sent to the renderer via
  `webContents.send`
- **AND** the handler SHALL function correctly even when no renderer listens
  for these events

#### Scenario: Verification must complete before upload reads plate_barcode (documented, not yet enforced)

- **GIVEN** a scan session has completed and `graviscan:verify-plates` has
  been invoked for it
- **WHEN** a future renderer/orchestration layer sequences post-session work
- **THEN** `graviscan:verify-plates` results SHALL be fully persisted before
  `graviscan:upload-all-scans` reads `plate_barcode` for the same session,
  so swap corrections are reflected in both the Bloom (Supabase) and Box
  uploads
- **NOTE**: `main` has no renderer yet, so nothing currently enforces this
  ordering. This scenario documents a requirement for whenever that
  orchestration is built, so it is not silently lost — it is not
  implemented by this change.

### Requirement: QR Code Reading from Scan Images

The system SHALL provide a `readQrCodes(imagePath)` function that decodes QR
codes from a scan image by delegating to a Python subprocess
(`python/graviscan/qr_reader.py`, using OpenCV's
`QRCodeDetector.detectAndDecodeMulti()`), rather than decoding in-process via
a Node WebAssembly dependency. This SHALL support multiple QR codes detected
within a single image.

#### Scenario: Image file does not exist

- **GIVEN** `imagePath` does not exist on disk
- **WHEN** `readQrCodes(imagePath)` is called
- **THEN** it SHALL return an empty array without throwing

#### Scenario: Multiple QR codes in one image are all detected

- **GIVEN** a single scan image contains more than one QR code (e.g. from
  adjacent plates bleeding into frame)
- **WHEN** `readQrCodes(imagePath)` is called
- **THEN** it SHALL return all detected codes, not just the first

#### Scenario: Subprocess failure is handled gracefully

- **GIVEN** the Python subprocess fails to spawn, exits non-zero, or returns
  malformed output
- **WHEN** `readQrCodes(imagePath)` is called
- **THEN** the error SHALL be caught and logged
- **AND** the function SHALL return an empty array rather than rejecting

### Requirement: GraviScanPlateAssignment Verification Status Field

The `GraviScanPlateAssignment` Prisma model SHALL include a
`verification_status` string field, defaulting to `"pending"`, to record the
outcome of the most recent `graviscan:verify-plates` run for that
scanner/plate-index assignment. Valid values SHALL include `pending`,
`verified`, `incorrect`, `unreadable`, `needs_review`, `duplicate_qr`, and
`swapped`.

#### Scenario: New plate assignment defaults to pending

- **GIVEN** a new `GraviScanPlateAssignment` row is created without an
  explicit `verification_status`
- **WHEN** the row is read back
- **THEN** `verification_status` SHALL be `"pending"`
