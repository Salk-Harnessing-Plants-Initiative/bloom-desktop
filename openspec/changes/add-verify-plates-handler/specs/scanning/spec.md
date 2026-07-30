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
- **AND** the rejected plate SHALL be excluded from the decode batch entirely
  and reported as `unreadable`
- **AND** the containment check SHALL be a shared, importable helper used by
  both `read-scan-image` and `graviscan:verify-plates`, not logic duplicated
  or inlined in a handler closure
- **AND** the directory to validate against SHALL be supplied to
  `verifyPlates()` as a parameter by its caller, so the verification module
  itself acquires no Electron dependency

#### Scenario: Duplicate QR detection is keyed on scanner and plate index together

- **GIVEN** a verification batch spanning more than one scanner
- **AND** plate indices repeat across scanners (index `00` exists on every
  scanner)
- **WHEN** duplicate QR codes are detected
- **THEN** a QR code SHALL be treated as duplicated only when it appears at
  two distinct `(scannerId, plateIndex)` positions
- **AND** a plate whose own QR codes are unique SHALL NOT be flagged
  `duplicate_qr` merely because a different scanner's plate at the same
  index was
- **AND** the same code appearing on two scanners at the same plate index
  SHALL be detected as a duplicate rather than collapsing into one position

#### Scenario: Swap pairing is keyed on position, and a position joins at most one swap

- **GIVEN** two reciprocal swap pairs in one batch that happen to share the
  same `assignedPlateId` values (a duplicated assignment, or duplicated
  `plant_qr -> plate_id` metadata)
- **WHEN** swaps are detected
- **THEN** both pairs SHALL be recorded and corrected independently — swap
  deduplication SHALL be keyed on `(scannerId, plateIndex)`, not on
  `assignedPlateId`
- **AND** a position already consumed by one recorded swap SHALL NOT be
  paired into a second swap
- **AND** a plate that was not itself part of a recorded swap SHALL NOT be
  persisted as `swapped` merely because it shares an `assignedPlateId` with
  one that was

#### Scenario: A swap correction records what it corrected from

- **GIVEN** a detected swap is auto-corrected
- **WHEN** `GraviScanPlateAssignment.plate_barcode` is rewritten for a
  position
- **THEN** `previous_plate_barcode` SHALL be set to the pre-correction value
  in the same write
- **AND** the provenance of a corrected plate assignment SHALL therefore be a
  queryable database fact, not something recoverable only from application
  logs

#### Scenario: Re-running verification on an already-corrected batch is a no-op

- **GIVEN** `graviscan:verify-plates` has already detected and corrected a
  swap for a session
- **WHEN** it is invoked again for the same session, with assignments read
  back from the now-corrected `GraviScanPlateAssignment` rows
- **THEN** the affected plates SHALL classify as `verified`
- **AND** no further swap SHALL be detected
- **AND** no additional `plate_barcode` or `GraviScan` correction write SHALL
  be issued

#### Scenario: Progress events are emitted for a future renderer

- **GIVEN** a main window is available
- **WHEN** `graviscan:verify-plates` starts, produces a per-plate result, and
  completes
- **THEN** `graviscan:verify-started`, `graviscan:verify-result`, and
  `graviscan:verify-complete` events SHALL be sent to the renderer via
  `webContents.send`
- **AND** the handler SHALL function correctly even when no renderer listens
  for these events

#### Scenario: Verification must complete before upload reads plate_barcode (documented, NOT enforced by this change)

- **GIVEN** a scan session has completed and `graviscan:verify-plates` has
  been invoked for it
- **WHEN** a future renderer/orchestration layer sequences post-session work
- **THEN** `graviscan:verify-plates` results SHALL be fully persisted before
  `graviscan:upload-all-scans` reads `plate_barcode` for the same session,
  so swap corrections are reflected in both the Bloom (Supabase) and Box
  uploads
- **NOTE**: **Nothing in this change enforces this ordering, and no code in
  this change implements it.** `main` has no renderer, and
  `graviscan:upload-all-scans` neither knows nor asks whether verification
  has run. This scenario exists so the ordering constraint is not silently
  lost between now and whenever that orchestration is built; it is a
  requirement on that future work, not a claim about current behavior.

#### Scenario: verification_status does not gate uploads (documented, deferred to a separate proposal)

- **GIVEN** a plate whose persisted `verification_status` is `incorrect`,
  `unreadable`, `needs_review`, or `duplicate_qr`
- **WHEN** `graviscan:upload-all-scans` runs for that session
- **THEN** the scan SHALL currently be uploaded to Bloom (Supabase) and Box
  regardless of its verification outcome — **this change adds no gating**
- **AND** a future change SHALL decide, as an explicit product decision,
  which statuses block an upload, which merely warn, and whether an operator
  can override
- **NOTE**: deferred deliberately. Choosing severity thresholds and
  warn-vs-block behavior is a product decision with operator-workflow
  consequences (a blocked upload on a rig mid-experiment is disruptive), and
  it needs the renderer surface that does not exist on `main` yet. Recording
  it here so the gap is a known, tracked one rather than an oversight: today
  a misidentified plate's data reaches both destinations with no barrier.

### Requirement: QR Code Reading from Scan Images

The system SHALL provide a `readQrCodesBatch(imagePaths)` function that
decodes QR codes for a whole batch of scan images in a **single** Python
subprocess invocation (`python/graviscan/qr_reader.py`, using OpenCV's
`QRCodeDetector.detectAndDecodeMulti()`), rather than decoding in-process via
a Node WebAssembly dependency. A `readQrCodes(imagePath)` single-image
convenience wrapper SHALL also be provided. Both SHALL support multiple QR
codes detected within a single image.

#### Scenario: A whole verification batch costs one subprocess spawn

- **GIVEN** a verification batch of N plate images
- **WHEN** the QR codes for that batch are read
- **THEN** exactly ONE decode subprocess SHALL be spawned, not one per image
- **AND** the result SHALL contain exactly one entry per requested path, in
  the requested order
- **AND** results SHALL be attributed back to plates by path, never by array
  position
- **NOTE**: the one-shot-subprocess design is only justified because the
  spawn cost is paid once per completed scan session. Spawning per image
  would invalidate that rationale.

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

#### Scenario: A native decoder crash is isolated to the image that caused it

- **GIVEN** a batch of more than one image
- **AND** the decode subprocess exits non-zero (the signature of a native
  crash inside OpenCV's decoder on a corrupt or hostile image)
- **WHEN** `readQrCodesBatch(imagePaths)` handles that failure
- **THEN** each image SHALL be retried in its own subprocess
- **AND** images that decode successfully on retry SHALL return their codes
- **AND** only the image that keeps failing SHALL return empty codes
- **NOTE**: without this, one bad image blanks the codes for every plate in
  the session and `graviscan:verify-plates` reports them all `unreadable`,
  indistinguishable from genuinely blank QR codes.

#### Scenario: Non-ASCII image paths survive the subprocess pipe

- **GIVEN** an image path containing non-ASCII characters
- **WHEN** it is sent to the decode subprocess and echoed back in the
  response
- **THEN** UTF-8 SHALL be set explicitly on both the Node side (subprocess
  environment) and the Python side (stdin/stdout/stderr reconfiguration),
  rather than relying on the platform's locale codepage

#### Scenario: A non-ASCII image path is still decodable

- **GIVEN** a scan image whose filesystem path contains non-ASCII characters
- **WHEN** the decoder opens it
- **THEN** the file SHALL be read by Python and handed to OpenCV as an
  in-memory buffer (`cv2.imdecode`), not opened by OpenCV itself
  (`cv2.imread`)
- **AND** the QR codes SHALL be decoded normally
- **NOTE**: `cv2.imread` takes a `const char*` and on Windows passes it to
  the ANSI file API, so a non-ASCII path silently fails to open and the plate
  is misclassified `unreadable`. Found by running the actual PyInstaller
  build against a non-ASCII path, not by unit tests.

### Requirement: GraviScanPlateAssignment Verification Status Field

The `GraviScanPlateAssignment` Prisma model SHALL include a
`verification_status` string field, defaulting to `"pending"`, to record the
outcome of the most recent `graviscan:verify-plates` run for that
scanner/plate-index assignment. Valid values SHALL include `pending`,
`verified`, `incorrect`, `unreadable`, `needs_review`, `duplicate_qr`, and
`swapped`.

The model SHALL also include a nullable `previous_plate_barcode` string
field, recording the `plate_barcode` value a swap auto-correction replaced.

#### Scenario: New plate assignment defaults to pending

- **GIVEN** a new `GraviScanPlateAssignment` row is created without an
  explicit `verification_status`
- **WHEN** the row is read back
- **THEN** `verification_status` SHALL be `"pending"`

#### Scenario: previous_plate_barcode is null until a correction happens

- **GIVEN** a `GraviScanPlateAssignment` row that has never been
  swap-corrected
- **WHEN** the row is read back
- **THEN** `previous_plate_barcode` SHALL be null

## MODIFIED Requirements

### Requirement: GraviScan IPC Handler Registration

The system SHALL provide a `registerGraviScanHandlers` function in `src/main/graviscan/register-handlers.ts` that registers all GraviScan IPC channels via `ipcMain.handle()`, delegating to the pure handler functions in `scanner-handlers.ts`, `session-handlers.ts`, and `image-handlers.ts`.

#### Scenario: All GraviScan IPC channels registered

- **GIVEN** `registerGraviScanHandlers(ipcMain, db, getMainWindow, sessionFns, getCoordinator)` is called
- **WHEN** the function completes
- **THEN** the following 18 IPC channels SHALL be registered:
  - `graviscan:detect-scanners`
  - `graviscan:get-config`
  - `graviscan:save-config`
  - `graviscan:save-scanners-db`
  - `graviscan:disable-scanner`
  - `graviscan:platform-info`
  - `graviscan:validate-scanners`
  - `graviscan:validate-config`
  - `graviscan:reset-usb`
  - `graviscan:start-scan`
  - `graviscan:get-scan-status`
  - `graviscan:mark-job-recorded`
  - `graviscan:cancel-scan`
  - `graviscan:get-output-dir`
  - `graviscan:read-scan-image`
  - `graviscan:upload-all-scans`
  - `graviscan:download-images`
  - `graviscan:verify-plates`

#### Scenario: Handler delegates to correct module function

- **GIVEN** `registerGraviScanHandlers` has been called
- **WHEN** the renderer invokes any of the 18 registered `graviscan:*` IPC channels
- **THEN** the handler SHALL delegate to the corresponding handler module function (see design.md channel mapping table) with the correct arguments
- **AND** return the result to the renderer

#### Scenario: Handler returns error on exception

- **GIVEN** `registerGraviScanHandlers` has been called
- **AND** a handler function throws an error
- **WHEN** the renderer invokes the corresponding channel
- **THEN** the handler SHALL return `{ success: false, error: <message> }`
- **AND** the error SHALL be logged via `console.error`

#### Scenario: Double registration throws

- **GIVEN** `registerGraviScanHandlers` has already been called once
- **WHEN** it is called a second time (e.g., during hot-reload)
- **THEN** the function SHALL throw an error indicating handlers are already registered
- **AND** the existing handlers SHALL remain intact

#### Scenario: graviscan:verify-plates is rejected without an experimentId

- **GIVEN** `registerGraviScanHandlers` has been called
- **WHEN** the renderer invokes `graviscan:verify-plates` without an
  `experimentId`
- **THEN** the handler SHALL return a failure result naming `experimentId`
- **AND** SHALL NOT invoke `verifyPlates()`

#### Scenario: graviscan:verify-plates supplies the scan output directory

- **GIVEN** `registerGraviScanHandlers` has been called
- **WHEN** the renderer invokes `graviscan:verify-plates`
- **THEN** the handler SHALL resolve the scan output directory (the same way
  `graviscan:read-scan-image` does) and pass it to `verifyPlates()` for path
  containment validation
- **AND** SHALL return a failure result without invoking `verifyPlates()` if
  that directory cannot be resolved

### Requirement: GraviScan PyInstaller Bundling

The system SHALL bundle GraviScan Python modules into the PyInstaller executable alongside existing CylinderScan hardware modules.

#### Scenario: Hidden imports include only existing GraviScan modules

- **GIVEN** the PyInstaller spec file (`python/main.spec`) is used to build the Python executable
- **WHEN** the build completes
- **THEN** `graviscan`, `graviscan.scan_regions`, `graviscan.scan_worker`, and `graviscan.qr_reader` modules SHALL be importable at runtime
- **AND** `cv2` SHALL be importable at runtime (required by `graviscan.qr_reader`)
- **AND** the `sane` module SHALL be included as a hidden import (fails gracefully if unavailable)
- **AND** no references to non-existent modules (e.g., `graviscan.models`, `graviscan.functions`) SHALL be present

### Requirement: GraviScan Python Dependencies

The system SHALL declare GraviScan-specific Python dependencies as optional dependency groups to avoid forcing SANE/TWAIN installation on all platforms.

#### Scenario: Pillow available as core dependency

- **GIVEN** the Python environment is set up via `uv sync`
- **WHEN** the scan worker imports `PIL`
- **THEN** Pillow SHALL be available (declared as core dependency `pillow>=10.0.0`; already a transitive dep via `imageio`, this makes it explicit)

#### Scenario: OpenCV available as core dependency

- **GIVEN** the Python environment is set up via `uv sync`
- **WHEN** `graviscan.qr_reader` imports `cv2`
- **THEN** OpenCV SHALL be available (declared as core dependency `opencv-python-headless>=4.9.0`)
- **AND** the headless build SHALL be used, so no GUI/Qt or X11 dependency is introduced on the rig or in the PyInstaller bundle

#### Scenario: SANE dependencies optional on Linux

- **GIVEN** the Python environment is on Linux
- **WHEN** GraviScan dependencies are installed via `uv sync --extra graviscan-linux`
- **THEN** `python-sane>=2.9.0` SHALL be installed
- **AND** default `uv sync --extra dev` SHALL NOT attempt to install `python-sane`

#### Scenario: TWAIN dependencies optional on Windows

- **GIVEN** the Python environment is on Windows
- **WHEN** GraviScan dependencies are installed via `uv sync --extra graviscan-windows`
- **THEN** `pytwain>=2.0.0` SHALL be installed
- **AND** default `uv sync --extra dev` SHALL NOT attempt to install `pytwain`

#### Scenario: CI compatibility with all-extras

- **GIVEN** CI runs `uv sync --all-extras --frozen`
- **WHEN** the lockfile includes `python-sane` and `pytwain`
- **THEN** `python-sane` SHALL install successfully on Linux CI runners (requires `libsane-dev` system package)
- **AND** `pytwain` (Windows-only) SHALL be excluded from Linux CI via environment markers or CI configuration to prevent cross-platform install failures
