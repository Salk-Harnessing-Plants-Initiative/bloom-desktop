## MODIFIED Requirements

### Requirement: GraviScan Post-Scan Plate Position Verification

The system SHALL provide a `graviscan:verify-plates` capability that reads
the QR code embedded in each plate's scan image, looks up which plate that QR
code belongs to via `GraviPlateSectionMapping`, and compares it against the
plate the operator assigned to that scanner/position
(`GraviScanPlateAssignment`). Each plate SHALL be classified as one of
`verified`, `incorrect`, `swapped`, `unreadable`, `needs_review`,
`duplicate_qr`, or `lookup_failed`, and the final `verification_status` SHALL
be persisted onto `GraviScanPlateAssignment` for every plate submitted in the
batch.

The capability SHALL accept an **optional** `waveNumber` parameter, in
addition to `experimentId`. When `waveNumber` is omitted, behavior is
unchanged from before this parameter existed (see "experimentId scopes both
the plate lookup and every DB write" below). When `waveNumber` is supplied,
the plate lookup SHALL be scoped to the accession linked to that specific
`(experimentId, waveNumber)` pair via `GraviExperimentWaveMetadata`, not to
every accession ever linked to the experiment, AND every swap-correction
`GraviScan` write SHALL be additionally scoped to that same
`wave_number` — a wave-scoped lookup SHALL NOT be paired with an
experiment-wide (cross-wave) write — see "Wave-scoped plate lookup",
"Wave-scoped swap-correction writes", and "Wave-scoped lookup with no
linked metadata" below.

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

#### Scenario: The plate-id lookup itself fails for a plate

- **GIVEN** a plate's image decoded one or more QR codes successfully
- **AND** the `GraviPlateSectionMapping` lookup for those codes throws (a
  locked, unavailable, or otherwise transiently failing database)
- **WHEN** `graviscan:verify-plates` runs
- **THEN** the plate's status SHALL be `lookup_failed` — **not** collapsed
  into `unreadable`
- **AND** `GraviScanPlateAssignment.verification_status` SHALL be set to
  `lookup_failed`
- **AND** the decoded QR codes SHALL still be reported in the result
- **AND** the plate SHALL NOT be paired into any swap, since nothing is known
  about which plate it actually holds
- **AND** the rest of the batch SHALL be verified normally
- **NOTE**: this is the same status-collapse this capability already refuses
  to make for `incorrect`. `unreadable` tells an operator to go re-image the
  plate; the image was fine and the correct response is to retry the run.
  Persisting the wrong reason sends them to the wrong remedy.

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
- **AND** **every** non-deleted `GraviScan` record for each position within
  that experiment that still carries the pre-correction `plate_barcode` SHALL
  have its `plate_barcode` updated to match — not only the most recent one
- **AND** both positions' final `verification_status` SHALL be `swapped`
- **AND** both positions' `status` in the **returned results** SHALL also be
  `swapped`, not left at `incorrect` — the returned payload and the row the
  same run just wrote SHALL NOT disagree about the same plate
- **NOTE**: a swap can only be recognised once the whole batch has been
  classified, so the per-plate `verify-result` progress event for those two
  plates has already been emitted as `incorrect`. `verify-complete` carries
  the upgraded results.
- **NOTE**: a time-lapse session writes one `GraviScan` row per cycle for the
  same scanner/position, and `graviscan-upload.ts` reads `plate_barcode`
  **per row**. Correcting only the newest row left every earlier cycle
  uploading to Bloom and Box under the wrong plate. A mis-loaded plate is
  wrong for every cycle it was scanned in. Filtering on the pre-correction
  `plate_barcode` is what keeps this safe and idempotent: only rows that are
  actually wrong are touched, so a re-run cannot swap anything back.

#### Scenario: A write that matched no rows is reported, not silently ignored

- **GIVEN** a swap correction or `verification_status` write whose `where`
  clause matches no rows (for example, no `GraviScanPlateAssignment` row
  exists for the submitted `(experimentId, scannerId, plateIndex)`)
- **WHEN** that `updateMany` completes
- **THEN** its returned `count` SHALL be checked, and a count of zero where a
  match was expected SHALL be logged as a clear warning naming the
  experiment, scanner, and plate index
- **AND** the returned result SHALL carry those mismatches in a `warnings`
  field, so a swap SHALL NOT be reported in `swaps[]` alongside
  `success: true` with no indication that nothing was persisted
- **AND** `warnings` SHALL be absent when every write matched a row
- **NOTE**: Prisma does not treat an `updateMany` that matches nothing as an
  error — it returns `{ count: 0 }`. Discarding that count made "corrected
  three cycles' worth of scan records" and "wrote nothing at all"
  indistinguishable in both the return value and the logs.

#### Scenario: A swap correction is atomic per swap pair

- **GIVEN** a detected swap whose correction comprises four writes (two
  `GraviScanPlateAssignment` updates and two `GraviScan` updates)
- **WHEN** one of those writes fails part-way through
- **THEN** all four SHALL be rolled back — no partially-corrected pair SHALL
  be left in the database
- **AND** the transactional boundary SHALL be per **swap pair**, not per
  batch, so a failing pair still SHALL NOT abort the corrections for the
  other pairs in the same run
- **AND** the failure SHALL be caught and logged, and the batch SHALL
  continue
- **AND** the "swap corrected" audit log line SHALL be emitted only after the
  transaction commits
- **NOTE**: without this, a mid-sequence failure left the plate assignment
  and the scan history disagreeing about which plate sat in that position,
  with nothing in the data to indicate which one is right.

#### Scenario: experimentId scopes both the plate lookup and every DB write

- **GIVEN** an `experimentId` is passed to `graviscan:verify-plates`, and no
  `waveNumber` is passed
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

#### Scenario: Wave-scoped plate lookup

- **GIVEN** an `experimentId` and a `waveNumber` are both passed to
  `graviscan:verify-plates`
- **AND** a `GraviExperimentWaveMetadata` row links that
  `(experimentId, waveNumber)` pair to a specific `accessionId`
- **WHEN** looking up which plate a detected QR code belongs to
- **THEN** the `GraviPlateSectionMapping` lookup SHALL be scoped to plates
  whose `metadata_file_id` equals that specific `accessionId` — not to every
  accession ever linked to the experiment via the legacy single
  `Experiment.accession_id` relation
- **AND** a QR code belonging to a plate from a *different* wave's linked
  accession SHALL NOT match, even if that other accession is also linked to
  the same experiment (for a different wave)

#### Scenario: Wave-scoped swap-correction writes

- **GIVEN** an `experimentId` and a `waveNumber` are both passed to
  `graviscan:verify-plates`
- **AND** a swap is detected between two positions
- **AND** another wave of the same experiment has historical `GraviScan`
  rows sharing the same `(scanner_id, plate_index, plate_barcode)` values
  as the swap being corrected (plate labels are grid-position names, not
  globally unique across waves)
- **WHEN** the swap correction's `GraviScan` `updateMany` runs
- **THEN** its `where` clause SHALL include `wave_number: waveNumber` in
  addition to `experiment_id`/`scanner_id`/`plate_barcode`
- **AND** the other wave's historical `GraviScan` rows SHALL NOT be
  touched by this correction, even though they share every other matching
  field
- **NOTE**: without this, a wave-precise lookup paired with an
  experiment-wide write would be a regression relative to today's
  behavior, not just an incomplete improvement — before wave-scoping
  existed, lookup and write were at least both experiment-wide and
  therefore consistent with each other; making the lookup wave-precise
  while leaving the write's blast radius unchanged introduces a new way
  to silently corrupt a different wave's historical data that could not
  happen before this change.
- **NOTE**: `GraviScanPlateAssignment.verification_status` itself has no
  `wave_number` column and remains current-state-only — a second
  verification run for the same scanner/position under a different wave
  still overwrites the first run's `verification_status` with no
  wave-attributable trace of either run. This is an accepted, named
  limitation of this change (see the Tier 4 proposal's design.md), not
  something this scenario claims to fix.

#### Scenario: Wave-scoped lookup with no linked metadata

- **GIVEN** an `experimentId` and a `waveNumber` are both passed to
  `graviscan:verify-plates`
- **AND** no `GraviExperimentWaveMetadata` row exists for that
  `(experimentId, waveNumber)` pair
- **WHEN** `graviscan:verify-plates` runs
- **THEN** every plate in the batch SHALL be classified `lookup_failed` with
  a warning naming the experiment and wave
- **AND** the lookup SHALL NOT silently fall back to the unscoped,
  experiment-wide matching described in "experimentId scopes both the plate
  lookup and every DB write"

#### Scenario: Every value that reaches a query scope is validated as a string

- **GIVEN** the `graviscan:verify-plates` IPC payload is untyped at the
  boundary, so `experimentId` and each plate's `scannerId`, `plateIndex`,
  `assignedPlateId`, and `imagePath` can be any JavaScript value at runtime
- **WHEN** verification runs
- **THEN** each of those values SHALL be validated with an explicit
  `typeof value === 'string' && value.length > 0` check — a truthiness check
  SHALL NOT be treated as sufficient
- **AND** a non-string `experimentId` (a number, an array, `null`, or a
  Prisma filter object such as `{ not: 'zzz' }`) SHALL fail the whole run
  before any decode or DB access, at **both** the IPC handler and the top of
  `verifyPlates()`
- **AND** a plate whose own fields are not all non-empty strings SHALL be
  skipped with a logged warning while the rest of the batch is verified
  normally, matching this module's per-record error isolation
- **AND** a `plates` payload that is not an array at all SHALL yield an empty
  result rather than throwing
- **AND** a `waveNumber`, when supplied, SHALL be validated as
  `typeof value === 'number' && Number.isInteger(value) && value >= 0` — an
  invalid `waveNumber` SHALL fail the whole run before any decode or DB
  access, the same as an invalid `experimentId`
- **NOTE**: Prisma silently DROPS a `where` key whose value is `undefined`
  and accepts a filter _object_ where a scalar was intended. Either shape
  turns the scoped `updateMany` calls described above into an
  experiment-wide overwrite of `plate_barcode`, `previous_plate_barcode`, and
  `verification_status`. The required-`experimentId` guarantee is only real
  if the _type_ is checked, not just the truthiness.

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
- **AND** a path that merely could not be resolved (the capture has not been
  written yet, or was moved) SHALL be distinguished from a path that resolved
  outside the directory: the former is logged as an ordinary skip, only the
  latter as a containment rejection
- **AND** an IPC response SHALL nevertheless return the same generic error
  for both, so it cannot be used to probe whether an arbitrary path exists
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
- **AND** two rows claiming the same `(scannerId, plateIndex)` SHALL NOT be
  paired with each other — distinctness is by position, not object identity,
  so a position can never be "swapped" with itself

#### Scenario: An ambiguous swap prefers a same-scanner partner

- **GIVEN** an `incorrect` plate with more than one reciprocal swap candidate
  in the batch
- **AND** at least one of those candidates is on the same scanner
- **WHEN** swaps are detected
- **THEN** the same-scanner candidate SHALL be paired in preference to a
  cross-scanner one
- **AND** a cross-scanner candidate left with no other partner SHALL remain
  `incorrect` rather than be mis-paired
- **NOTE**: this tie-break decides which position stays `incorrect` in an
  ambiguous multi-swap batch. Plates are physically loaded per scanner, so a
  same-scanner mix-up is by far the likelier explanation. It narrows — but
  does not eliminate — the influence of input order: pairing is still
  greedy and first-come, so where three or more positions are mutually
  reciprocal on the same scanner, which pair forms can still depend on the
  order the caller submitted them in. The rule guarantees only that a
  same-scanner candidate is never passed over in favour of a cross-scanner
  one, not that the batch as a whole resolves order-independently.

#### Scenario: A genuine cross-scanner swap is still detected

- **GIVEN** two plates on **different** scanners that each hold the other's
  assigned plate
- **AND** neither has a reciprocal candidate on its own scanner
- **WHEN** swaps are detected
- **THEN** the swap SHALL be detected and corrected across the scanner
  boundary
- **NOTE**: the same-scanner preference above is a preference, not a
  restriction — an operator can move a plate between scanners.

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

#### Scenario: Every per-plate result has the same declared shape

- **GIVEN** any plate in a verification batch, whatever its outcome
- **WHEN** its result is returned and its `verify-result` progress event is
  emitted
- **THEN** the result SHALL declare and carry the `imagePath` it came from,
  rather than acquiring one only as an undeclared runtime spread
- **AND** `detectedPlateId` (and the `inconsistentMappings` breakdown) SHALL
  be reported in the plate id's original database casing — lower-casing SHALL
  be applied only to the internal comparison, never to the reported value
- **AND** the plate-id comparison SHALL remain case-insensitive on both sides
- **AND** the `verify-result` payload SHALL be the complete result object on
  **every** branch, not a hand-built partial on some of them, so a renderer
  can rely on the same fields being present regardless of outcome

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
  (This tier's `GraviScan.tsx` screen does invoke `verify-plates` as a
  distinct, explicit step after scan completion, but still does not block
  or sequence `upload-all-scans` against it — the gap this NOTE describes
  remains open after this tier, not just before it.)

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
  consequences (a blocked upload on a rig mid-experiment is disruptive),
  and it needs the renderer surface that does not exist on `main` yet.
  Recording it here so the gap is a known, tracked one rather than an
  oversight: today a misidentified plate's data reaches both destinations
  with no barrier. (This tier's `QRVerificationBanner` surfaces the
  outcome to the operator but still does not gate the upload button or
  flow — the renderer surface now exists, the gating decision is still
  not made.)
