## MODIFIED Requirements

### Requirement: GraviScan Metadata Page

The system SHALL provide a Metadata page at `/metadata` (visible only in GraviScan mode) that allows users to assign per-plate metadata (barcode, transplant date, custom note) for each plate position defined by the current grid configuration, select experiment and phenotyper, and set wave number.

**Scanner identity SHALL be visible at every plate-entry row** so the operator can verify that the metadata they're typing applies to the correct physical scanner. The page SHALL NOT identify scanners by raw UUID. Per-scanner section headers SHALL display, at minimum: `display_name` (with `slot` as fallback) · `scanner.name` (the model string) · `usb_port`. When `firmware_serial` is populated (proposal `add-scanner-firmware-serial-identity`), a short serial fragment SHALL also be visible.

**Per-scanner test-scan thumbnails SHALL be rendered next to the plate-entry fields** so the operator sees what is physically on each scanner's glass. Thumbnails are sourced from the `scanImageUris[scannerId][plateIndex]` map populated by `useTestScan`. Click-to-zoom via `ImageLightbox` for full-size review.

**Each scanner panel SHALL be color-coded by `usb_port` hash** (`border-l-4 ${usbPortToHue(usb_port)}`) so the same physical scanner has the same color across Metadata, ScannerConfig, GraviScan, and the GxP confirmation modal. This provides at-a-glance disambiguation in peripheral vision. **The palette SHALL be colorblind-safe** (Wong's 8-color palette: `#000000` black, `#E69F00` orange, `#56B4E9` sky-blue, `#009E73` bluish-green, `#F0E442` yellow, `#0072B2` blue, `#D55E00` vermillion, `#CC79A7` reddish-purple) AND **SHALL be paired with a border-style variation** (solid / dashed / dotted / double) so that color + pattern uniquely distinguishes scanners even for users with deuteranopia/protanopia/tritanopia. Given N detected scanners, the (color, border-style) pair-tuple SHALL be unique across all panels in the same render.

**Plate-metadata editing SHALL be BLOCKED while any `scannerAssignment.scannerId === ''` or `=== null`.** A banner SHALL display: "Save scanner configuration before entering plate metadata. Unsaved scanner changes will be lost." `PlateGridEditor` inputs SHALL be `disabled` while the banner is visible. This stops the type-then-save data-loss path where typed barcodes were silently wiped at the `''` → real-UUID flip.

**Typed plate metadata SHALL be preserved through the `scannerAssignmentsKey` flip.** The forward-mapping pass in `usePlateAssignments` SHALL carry `plantBarcode`, `transplantDate`, and `customNote` from the previous slot **only when the previous slot's key was the empty-string sentinel `''`** (placeholder→UUID flip — the "we just saved this scanner" case). The forward-mapping SHALL NOT carry data between two distinct real UUIDs (e.g., `uuid-A → uuid-B`), even when the new UUID lands at the same array index, because that scenario indicates a different physical scanner has appeared at the same usb_port (replacement, RMA, or accidental swap with an identical-model unit) and inheriting the previous scanner's plate metadata would silently mis-attribute.

**Forward-mapping iteration is per-slot, not full-state-rebuild.** The pass SHALL use a partial update keyed by changed-slot, NOT replace the whole `scannerPlateAssignments` dictionary. Pre-existing `'uuid-A'` slots whose typed barcode/date/note already exist SHALL remain untouched when only one slot's id changes. Implementation: `setScannerPlateAssignments(prev => { const next = { ...prev }; for (const [oldKey, newKey] of changedKeys) { if (oldKey === '' && next[''] !== undefined) next[newKey] = next['']; } return next; })`.

**The forward-mapping pass and the experiment-load DB-reset effect MUST be coordinated per-experiment** so they do not race: if the placeholder→UUID flip writes typed values forward to the new UUID slot, those values MUST be persisted to the DB (via the existing `database.graviscanPlateAssignments.upsert`) BEFORE the experiment-load effect re-reads from the DB. **The coordination key SHALL be `(experiment_id, scanner_id)` tuples**, NOT a global flag — when the user switches experiments mid-flow, the new experiment's load SHALL NOT await promises that wrote rows for the OLD experiment_id. The `pendingUpsertsRef` SHALL store entries shaped `{ experiment_id: string, scanner_id: string, promise: Promise<void> }`; the experiment-load effect awaits ONLY the entries whose `experiment_id` matches the current `selectedExperiment`.

**Re-bind to a previously-known UUID is forward-mapping-skipped.** Edge case: scanner with `uuid-A` was unplugged (its renderer slot became `''`-keyed during the unplugged window) and is now replugged. Re-detect produces `'uuid-A'` again (matched via Proposal 2's serial layer). The flip is `''` → `'uuid-A'`, but `'uuid-A'`'s DB row may already have plate metadata from before the unplug. **In this case the forward-mapping SHALL be SKIPPED** (DB rows win) AND the experiment-load DB read SHALL populate `'uuid-A'`'s slot with the persisted historical values. The detection of "this UUID was previously bound" is via the `''`-slot-only forward-mapping rule combined with the experiment-load read order. Add a scenario for this case below.

**The `transplant_date` and `custom_note` fields SHALL be editable from the renderer.** Today these handlers are unwired in `Metadata.tsx`, creating a silent metadata gap (fields exist in DB and metadata.json but cannot be set from the UI). This SHALL be fixed.

**The empty-state message SHALL discriminate between "no experiment selected" and "no saved scanners".** When no experiment is selected, the message reads "Select an experiment to load plate assignments." When `assignedScannerIds.length === 0` AND an experiment is selected, the message reads "No saved scanners — go to Scanner Config" with a button linking to `/scanner-config`.

**For experiments where `isGraviMetadata === true` and `availableBarcodes` is non-empty, the barcode field SHALL be a `<select>` populated from the experiment's accession metadata** (with the genotype shown inline as a sidecar). Free-text `<input>` fallback for non-graviMetadata experiments.

**Per-cycle metadata refresh in continuous mode** SHALL be supported via `gravi.updateSessionMetadata` IPC. The renderer SHALL provide a "Pause and edit metadata" affordance during continuous-mode interval waits, allowing the operator to update barcode/transplant_date/custom_note for cycles that have not yet started. Already-written metadata.json files SHALL NOT be retroactively rewritten.

#### Scenario: Plate grid matches config

- **GIVEN** the user has saved a GraviConfig with a grid_mode
- **WHEN** the user navigates to the Metadata page
- **THEN** the system SHALL read the saved GraviConfig to determine grid_mode
- **AND** display plate assignment inputs for each plate position (2 for 2grid, 4 for 4grid) per enabled scanner
- **AND** each plate position SHALL have fields for barcode, transplant date, and custom note

#### Scenario: Save plate assignments

- **GIVEN** at least one plate has metadata assigned
- **WHEN** the user clicks Save on the Metadata page
- **THEN** the system SHALL call `graviscanPlateAssignments.upsertMany` to persist assignments
- **AND** the assignments SHALL be loadable when starting a scan

#### Scenario: Experiment and phenotyper selection

- **GIVEN** the user is on the Metadata page
- **WHEN** the page loads
- **THEN** the system SHALL display dropdowns for experiment and phenotyper selection populated from the database
- **AND** a wave number input field with auto-increment from the max wave for the selected experiment
- **AND** these selections SHALL be available to `startScan` metadata when scanning begins

#### Scenario: No config saved — redirect to Scanner Config

- **GIVEN** no GraviConfig exists in the database
- **WHEN** the user navigates to the Metadata page
- **THEN** the system SHALL display a message indicating scanner configuration is required
- **AND** provide a link to the Scanner Configuration page

#### Scenario: Barcode uniqueness enforcement

- **GIVEN** a plate barcode is already assigned to another plate in the same experiment and wave
- **WHEN** the user enters that barcode in a plate assignment field and the field loses focus
- **THEN** a validation warning SHALL be displayed identifying the conflicting plate
- **AND** the system SHALL call `checkBarcodeUniqueInWave` to verify

#### Scenario: Per-scanner header shows display_name, scanner name, and usb_port

- **GIVEN** detection has resolved 2 enabled scanners with `display_name: "Bench-3"` / `"Bench-4"`, `name: "Epson Perfection V850"` (both), and `usb_port: '1-1'` / `'1-2'`
- **WHEN** the user navigates to the Metadata page
- **THEN** each scanner section header SHALL render the display_name, scanner name, AND usb_port as visible text
- **AND** the section header SHALL NOT render the raw UUID as the only identifying string
- **AND** when `firmware_serial` is populated, a short serial fragment (e.g., last 6 chars) SHALL also be visible
- **AND** identical-model scanners SHALL be visually distinguishable via the differing `usb_port` text and via the color-coded left-border accent

#### Scenario: Test-scan thumbnails appear next to plate-entry fields

- **GIVEN** the user has run Test All Scanners on the GraviScan page
- **AND** thumbnails exist in `scanImageUris[scannerId][plateIndex]` for each enabled scanner
- **WHEN** the user navigates to the Metadata page
- **THEN** each scanner section SHALL render a `<ScanPreview>` card with grid-layout thumbnails matching the scanner's grid_mode
- **AND** clicking a thumbnail SHALL open the `<ImageLightbox>` for full-size review
- **AND** the thumbnails SHALL act as the operator's visual confirmation of which physical scanner each row corresponds to

#### Scenario: Color-coded panels by usb_port

- **GIVEN** two scanners at `usb_port: '1-1'` and `'1-2'`
- **WHEN** any page renders a panel/card for either scanner (Metadata, ScannerConfig, GraviScan, the GxP modal, or BrowseGraviScans)
- **THEN** the scanner at `'1-1'` SHALL have one stable border-color hue
- **AND** the scanner at `'1-2'` SHALL have a different stable border-color hue
- **AND** the same scanner SHALL have the same hue across all five surfaces in the same render
- **AND** the hue SHALL be derived from a hash of `usb_port` (with a composite-key fallback for empty-port platforms)

#### Scenario: Plate-metadata editing is blocked when any scanner has placeholder id

- **GIVEN** detection has populated `scannerAssignments` with one or more entries having `scannerId === ''` or `null` (placeholder, not yet saved)
- **WHEN** the user navigates to the Metadata page
- **THEN** a banner SHALL display "Save scanner configuration before entering plate metadata. Unsaved scanner changes will be lost."
- **AND** every `PlateGridEditor` input on the page SHALL be `disabled`
- **AND** clicking on barcode/transplant-date/note fields SHALL not accept keystrokes

#### Scenario: Typed barcodes are preserved through scannerId placeholder→UUID flip

- **GIVEN** the user types `"PLATE-001"` into a barcode field while the scanner's `scannerId` is `''` (placeholder, only possible when the banner is dismissed by the proposal-2 graceful path)
- **WHEN** the operator saves scanner configuration and `scannerId` flips from `''` to a real UUID
- **THEN** the typed `"PLATE-001"` SHALL be present in `scannerPlateAssignments[<new-UUID>][<plate>].plantBarcode`
- **AND** the typed value SHALL NOT be wiped to default by the `scannerAssignmentsKey` flip
- **AND** the value SHALL also be persisted to the DB row keyed by `(experiment_id, <new-UUID>, plate_index)`

#### Scenario: Typed barcodes do NOT leak between distinct real UUIDs (inverse-leak safety)

- **GIVEN** scanner A is saved with `scannerId: 'uuid-A'` at `usb_port: '1-1'` AND the operator has typed `"PLATE-A"` into A's plate-00 barcode field
- **WHEN** scanner A is unplugged and a different physical scanner B (different firmware_serial) is plugged into the same `'1-1'` port
- **AND** the operator confirms "New scanner (new identity)" in the replacement modal (per Proposal 2)
- **AND** `scannerAssignmentsKey` flips because `'uuid-A' → 'uuid-B'`
- **THEN** scanner B's `scannerPlateAssignments['uuid-B'][00].plantBarcode` SHALL be the DB-loaded default value (typically `null`), NOT `"PLATE-A"`
- **AND** scanner A's plate metadata SHALL remain in the DB keyed by `(experiment_id, 'uuid-A', plate_index)` (preserved for historical lookup), but SHALL NOT be visible on the Metadata page since `'uuid-A'` is no longer in `assignedScannerIds`
- **AND** the forward-mapping rule SHALL be: copy from the prior slot ONLY when the prior key was the empty-string sentinel `''`. UUID-A → UUID-B transitions SHALL NOT inherit prior plate metadata.

#### Scenario: Forward-mapping coordinates with experiment-load DB-reset

- **GIVEN** the placeholder→UUID flip carries forward typed values from `''` to `<new-UUID>` in `scannerPlateAssignments`
- **AND** the experiment-load `useEffect` in `usePlateAssignments` is also keyed on `scannerAssignmentsKey` and would re-read DB rows for the new UUID
- **WHEN** both effects fire on the key flip
- **THEN** the forward-mapping effect SHALL persist its values via `database.graviscanPlateAssignments.upsert` BEFORE the experiment-load effect's DB-read fires (or both effects SHALL share a coordination flag so the experiment-load skips the read when forward-mapping has already populated the new UUID slot)
- **AND** the final state of `scannerPlateAssignments[<new-UUID>]` SHALL contain the forward-mapped typed values, NOT the empty-DB-row defaults
- **AND** a unit test SHALL exercise this race by mocking the DB upsert to be slower than the read, asserting that the forward-mapped values survive
- **AND** the `pendingUpsertsRef` entries SHALL be tagged with `experiment_id` so cross-experiment switches do not await stale promises

#### Scenario: Cross-experiment switch during forward-mapping

- **GIVEN** the user is on experiment X; a placeholder→UUID flip is in flight, with a pending upsert tagged `(experiment_id: X, scanner_id: uuid-X)`
- **WHEN** the user switches to experiment Y BEFORE the upsert resolves
- **THEN** the experiment-load effect for Y SHALL NOT await the X-tagged upsert
- **AND** Y's experiment-load SHALL read DB rows for `(experiment_id: Y, scanner_id in [...])` — these are independent of X's pending writes
- **AND** the X-tagged upsert SHALL still complete (its promise resolves cleanly), persisting X's typed values to the DB; the user can return to X later and see them
- **AND** Y's `scannerPlateAssignments` SHALL be populated from Y's DB rows, with default empty values where none exist

#### Scenario: Re-bind to a previously-known UUID restores historical plate metadata

- **GIVEN** scanner with `firmware_serial: 'ABC'`, `usb_port: '1-1'`, DB id `uuid-A` was previously saved AND has historical `GraviScanPlateAssignment` rows under `(experiment_id, uuid-A, plate_index)` with typed barcodes
- **AND** the operator unplugs the scanner — detection updates `scannerAssignments[i].scannerId` to `''` (placeholder during the unplugged window)
- **AND** during the unplugged window, the operator does NOT type any new barcodes
- **AND** the operator replugs the scanner — detection re-matches by `firmware_serial: 'ABC'` (Proposal 2's serial layer) and produces `scannerAssignments[i].scannerId = 'uuid-A'` again
- **WHEN** `scannerAssignmentsKey` flips from `''` → `'uuid-A'`
- **THEN** the forward-mapping pass SHALL skip carrying the `''`-slot's empty values forward (since `''`'s slot has no typed values to carry)
- **AND** the experiment-load effect SHALL read the historical `(experiment_id, uuid-A, plate_index)` DB rows
- **AND** `scannerPlateAssignments['uuid-A']` SHALL be populated with the historical typed values
- **AND** the operator SHALL see their previous-session barcodes restored without re-typing

#### Scenario: Identify button is disabled during active scan session

- **GIVEN** a scan session is currently in flight (`useScanSession.isScanning === true` OR a continuous-mode interval-wait is pending)
- **WHEN** the user navigates to Scanner Configuration (e.g., via the "Pause and edit metadata" affordance)
- **AND** clicks an "Identify" button
- **THEN** the button SHALL be `disabled`
- **AND** clicking it SHALL be a no-op
- **AND** no concurrent Test Scan IPC SHALL fire that could race the next scan-session cycle's `gravi.startScan`

#### Scenario: Identify button is disabled for placeholder or unchecked scanners

- **GIVEN** a scanner row whose `scannerId` is `''` (placeholder, not yet saved) OR `null` (operator unchecked)
- **WHEN** the user views the row
- **THEN** the "Identify" button SHALL be `disabled`
- **AND** clicking it SHALL be a no-op
- **AND** no Test Scan IPC SHALL be fired — Test Scan with `scannerId: ''` would error or scan an arbitrary first-detected scanner
- **AND** the operator SHALL be guided to Save the configuration first (the existing placeholder-blocks-plate-metadata banner already covers this guidance)

#### Scenario: ScanPreview plate-grid orientation matches the physical scanner bed

- **GIVEN** the lab convention that plate index `'00'` corresponds to a specific physical position on the Epson V850 platen — to be DOCUMENTED in `python/graviscan/README.md` as the canonical lab convention (the existing scanner driver code in `scan_worker.py` defines the scan-region coordinates, which fix the convention)
- **WHEN** `<ScanPreview>` renders the 2×2 grid layout for a 4-grid scanner
- **THEN** the rendered cells SHALL appear at positions matching the physical bed: `00` at the same corner of the on-screen grid as the `00`-coordinate region of the physical glass
- **AND** the canonical convention is: `00` top-left, `01` top-right, `10` bottom-left, `11` bottom-right of the on-screen 2×2 grid (matching the row-major iteration of `PLATE_INDICES['4grid'] = ['00', '01', '10', '11']` rendered with CSS `grid-cols-2`, which lines up with `scan_worker.py`'s scan-region coordinates where the first row of plates is the `0X` set and the second row is the `1X` set, viewed from the operator's standing position)
- **AND** the USB-topology tooltip on Scanner Configuration SHALL be paired with a SHORT plate-orientation tooltip on each `<ScanPreview>` card explaining "Plate `00` is at the back-left of your scanner bed; `11` is at the front-right" (or whatever convention the lab adopts), so operators have a visual key without referencing external docs
- **AND** an E2E screenshot test SHALL capture the Metadata page with mock thumbnails populated and visually confirm the orientation matches the documented convention; if the lab adopts a different convention later, the convention SHALL be updated in BOTH `python/graviscan/README.md` AND the tooltip text in lock-step

#### Scenario: Color-coded panels are colorblind-safe and pattern-distinct

- **GIVEN** N scanners are connected (1 ≤ N ≤ 8)
- **WHEN** any page renders panels for them
- **THEN** each panel SHALL have a `(color, border-style)` pair derived from its `usb_port`
- **AND** the colors SHALL come from the Wong 8-color colorblind-safe palette (NOT raw Tailwind `border-blue-500`/`border-orange-500`/etc.)
- **AND** the border-styles SHALL be one of: `solid`, `dashed`, `dotted`, `double`
- **AND** for any 2 scanners visible at the same time, the `(color, border-style)` pairs SHALL be distinct
- **AND** a unit test SHALL assert pair-uniqueness for the 8 most-likely usb_port values (`'1-1'` through `'1-4'` and `'2-1'` through `'2-4'`)

#### Scenario: Transplant date and custom note are editable

- **GIVEN** the user is on the Metadata page with a saved experiment and saved scanners
- **WHEN** the user types into the transplant-date field for a plate
- **THEN** the value SHALL be saved to `scannerPlateAssignments` AND persisted to the DB via `graviscanPlateAssignments.upsert`
- **AND** the same SHALL hold for the custom-note field
- **AND** at scan time, those values SHALL appear in the metadata.json `transplant_date` and `custom_note` fields

#### Scenario: Barcode dropdown for graviMetadata experiments

- **GIVEN** the user has selected an experiment for which `isGraviMetadata === true`
- **AND** `availableBarcodes` is non-empty (loaded from accession metadata)
- **WHEN** the user views a plate-card's barcode field
- **THEN** the field SHALL be rendered as a `<select>` populated with the `availableBarcodes` strings
- **AND** an "(other)" option SHALL be available that falls back to a free-text `<input>`
- **AND** when a barcode is selected, the genotype/accession SHALL be shown inline as a sidecar
- **AND** for non-graviMetadata experiments, the field SHALL be a free-text `<input>` (fallback)

#### Scenario: Per-cycle metadata refresh in continuous mode

- **GIVEN** a continuous-mode scan is in flight (cycles 1-12, 5-min interval)
- **AND** the user notices a typo in plate `00`'s barcode after cycle 3 completes
- **WHEN** the user clicks "Pause and edit metadata" on GraviScan.tsx during the interval wait
- **THEN** a panel SHALL render the per-scanner plate-grid editor for the active scanners
- **AND** the user SHALL be able to update `plant_barcode`, `transplant_date`, or `custom_note` for any plate
- **AND** clicking Save SHALL dispatch `gravi.updateSessionMetadata` per changed plate
- **AND** the main process SHALL mutate `coordinator.sessionContext` accordingly
- **AND** cycle 4 onwards SHALL write the new value into metadata.json
- **AND** cycles 1-3's already-written metadata.json files SHALL NOT be retroactively rewritten
- **AND** a `GraviScannerBinding` audit row SHALL be inserted (per Proposal 2's audit table) with `reason: 'manual:user-confirmed'` and a free-form note describing the change

#### Scenario: Empty state discriminates between no-experiment and no-scanners

- **GIVEN** the user navigates to the Metadata page with no experiment selected
- **THEN** the message SHALL read "Select an experiment to load plate assignments."
- **GIVEN** the user has selected an experiment AND `assignedScannerIds.length === 0`
- **THEN** the message SHALL read "No saved scanners — go to Scanner Config"
- **AND** a button linking to `/scanner-config` SHALL be visible
- **AND** the message SHALL NOT conflate the two empty states

## ADDED Requirements

### Requirement: GraviScan Scanner Configuration Page UX Affordances

The Scanner Configuration page SHALL provide UX affordances that surface scanner identity to operators and prevent silent mis-attribution: an editable `display_name` per scanner, a soft-gate banner for identical-model disambiguation, an "Identify this scanner" button per row with a concurrency guard, a reset confirmation modal, a USB-topology tooltip, and color-coded panels.

This requirement is **ADDED** alongside the existing `GraviScan Scanner Configuration Page` (defined by `add-graviscan-renderer-pages`, modified by subsequent proposals). It captures the new UX affordances introduced by this proposal that operate on top of the existing identity-and-persistence invariants. The existing invariants (firmware_serial primary identity, self-healing backfill, auto-save block during mismatch, replacement-detection modal, GraviScannerBinding audit table, disconnected ghost rows — all defined by `add-scanner-firmware-serial-identity`) carry through unchanged.

**Display name editor.** Each scanner row SHALL have an inline editable input for `display_name`, pre-filled with the saved value (or with an auto-suggested USB-topology name on first save). Editing the input and saving SHALL send the typed value (NOT `undefined`) in the IPC payload. The main-process upsert's `?? existing.display_name` fallback continues to preserve admin-set values when the field is intentionally left at its prior value.

**Soft-gate display_name banner for identical-model scanners.** When ≥2 detected scanners share `(name, vendor_id, product_id)` AND none have a non-default custom `display_name`, the page SHALL render a banner above the Save button:

> Two identical Epson V850 scanners detected. Naming each one (e.g., "Bench-3-Left") makes plate metadata easier to verify. [Skip] [Suggest names] [Use bench labels…]

The banner SHALL be SOFT — the operator MAY skip and proceed with default display_names. The banner SHALL NOT block the Save button. "Suggest names" SHALL pre-fill display_name inputs with `"USB <port> <descriptor>"` from a USB-topology suggestion generator. "Use bench labels…" SHALL open a small dialog where the operator can paste/type bench labels per row. "Skip" SHALL dismiss the banner for the **current session only**; the banner SHALL re-appear in the next session if display_names are still default. An operator who never wants to see the banner again SHALL be able to opt out via a "Don't show this again for this experiment" checkbox in the dialog (preference stored per-experiment in `localStorage`). **A "Reset banner preferences" button SHALL be available** in a small "Preferences" sub-section of the Scanner Configuration page (positioned near the existing Reset button) that clears all `graviscan:displayNameBannerOptOut:*` keys from `localStorage`, allowing the operator to undo a previous opt-out. localStorage is per-renderer-instance — opt-outs do NOT follow the operator across machines; this is intentional (different machines may need different per-bench naming).

**"Identify this scanner" button per row.** Each scanner row SHALL have an "Identify" button that fires a single-plate Test Scan for that scanner only. The resulting test thumbnail SHALL pulse in the `ScanPreview` for ~3s so the operator can see which physical scanner whirred to life. This is the lab-equipment "blink LED to find me" pattern. The Identify button SHALL be **disabled while another concurrent operation is in flight** (Save is in progress, Test All Scanners is running, or another Identify is pulsing). This concurrency guard prevents subprocess-spawn races and the operator confusion of two scanners pulsing at once.

**Reset confirmation modal.** The Reset button SHALL trigger a confirmation modal: "This will reset scanner configuration. Plate metadata is keyed by scanner_id and will be re-loaded automatically when you re-detect. [Cancel] [Reset]". The Reset action SHALL only proceed on confirm.

**USB-topology tooltip.** Next to the `USB <port>` text on each scanner row, an info icon SHALL reveal a tooltip explaining how USB ports are numbered and recommending physical sticker labels.

**Color-coded panels by usb_port** (carried over from the Metadata Page requirement above).

#### Scenario: Display name editor saves typed values

- **GIVEN** a detected scanner with `display_name: null` and `name: "Epson Perfection V850"`
- **WHEN** the user types `"Bench-3-Left"` into the inline display_name input AND clicks Save
- **THEN** the IPC `gravi.saveScannersToDB` SHALL include `{ display_name: "Bench-3-Left" }` for that scanner (NOT `undefined`)
- **AND** the saved DB row SHALL have `display_name: "Bench-3-Left"`
- **AND** subsequent renders SHALL pre-fill the input with `"Bench-3-Left"`

#### Scenario: Soft-gate banner for identical-model scanners

- **GIVEN** detection returns two scanners both with `name: "Epson Perfection V850"`, same `vendor_id`, same `product_id`, and neither has a non-default `display_name`
- **WHEN** the user views the Scanner Configuration page
- **THEN** a banner SHALL render above the Save button with text containing "Two identical" and naming the model
- **AND** the banner SHALL provide buttons "Skip", "Suggest names", "Use bench labels…"
- **AND** clicking "Suggest names" SHALL pre-fill the display_name inputs with strings like `"USB 1-1 (back-left)"` and `"USB 1-2 (back-right)"`
- **AND** clicking "Skip" SHALL dismiss the banner without changing the inputs
- **AND** the Save button SHALL remain enabled regardless of which option is chosen — this is a SOFT gate

#### Scenario: Soft-gate banner reappears next session unless explicitly opted out

- **GIVEN** the operator clicked "Skip" in session N AND the display_names are still default
- **WHEN** session N+1 starts
- **THEN** the banner SHALL reappear (Skip dismisses for current session only)
- **GIVEN** the operator opted out via "Don't show this again for this experiment" in the dialog
- **WHEN** session N+1 starts
- **THEN** the banner SHALL NOT reappear (preference is stored per-experiment in `localStorage`)
- **AND** the operator MAY still set display_names manually via the inline editor

#### Scenario: Identify scanner button pulses the test thumbnail

- **GIVEN** the user clicks "Identify" next to the scanner row at `usb_port: '1-1'`
- **WHEN** the single-plate Test Scan completes
- **THEN** the `<ScanPreview>` card for that scanner SHALL render a pulsing ring/glow effect for approximately 3 seconds
- **AND** the resulting thumbnail SHALL be visible in the card
- **AND** other scanner cards SHALL NOT pulse
- **AND** the operator SHALL be able to visually correlate "the scanner that whirred to life" with "the row I clicked Identify on"

#### Scenario: Identify button concurrency guard

- **GIVEN** any of: a Save is in flight, a Test All Scanners is running, OR another Identify is currently pulsing
- **WHEN** the user attempts to click an Identify button
- **THEN** the button SHALL be `disabled` and ignore the click
- **AND** the operator SHALL NOT see two scanners pulsing at once
- **AND** subprocess-spawn races SHALL be prevented (only one Test Scan IPC can be in flight at a time)

#### Scenario: Reset confirmation modal blocks accidental wipes

- **GIVEN** the user clicks the Reset button on Scanner Configuration
- **WHEN** the modal renders
- **THEN** it SHALL display text explaining what reset does (clears scanner config; preserves plate metadata via scanner_id)
- **AND** provide [Cancel] and [Reset] buttons
- **AND** clicking [Cancel] SHALL leave the configuration unchanged
- **AND** clicking [Reset] SHALL execute the existing reset path (clear localStorage, wipe React state)

### Requirement: GraviScan Scanning Page Scanner-Identity Surfaces

The GraviScan scanning page SHALL render scanner-identity surfaces that prevent silent mis-attribution at scan time: a `ScannerPanel` per scanner with online/busy LED indicators and color-coded status, per-scanner `ScanPreview` thumbnails grouped under each scanner panel, a GxP-style Start Scan confirmation modal for ≥2-scanner sessions whose snapshot SHALL be persisted as audit evidence, and a mid-session "Pause and edit metadata" affordance during continuous-mode interval waits.

This requirement is **ADDED** alongside the existing `GraviScan Scanning Page` (defined by `add-graviscan-renderer-pages`, with its 8 scenarios carrying through unchanged: Start single scan, Start interval scan, Cancel active scan, Scan error handling, SANE initialization failure, Rename error, Navigate away during active scan, Cancel during continuous mode waiting phase).

**ScannerPanel (with online/busy LEDs and color-coded status background) SHALL replace the current single grey-blue state pill** for each scanner row during active scanning. The panel SHALL render: green/red Online + Busy LEDs (with `animate-pulse` on Busy), color-coded background (red error, green complete, amber waiting, white idle), progress bar with state-matched color, output filename display, and an inline "IN USE — waiting for next cycle" amber pulse during continuous-mode interval waits.

**ScanPreview thumbnails SHALL be rendered per-scanner** (replacing the current flat thumbnail grid at the bottom of the page). Each scanner's thumbnails sit grouped under that scanner's panel so attribution is visually clear.

**A Start Scan confirmation modal SHALL be triggered before any IPC `gravi.startScan` call when ≥2 scanners are enabled.** The modal SHALL render each enabled scanner as a read-only `<ScanPreview>` card showing display_name, usb_port, firmware_serial (when available), and the live test-scan thumbnail. Below each scanner, the modal SHALL list every selected plate with `plate_index`, `plant_barcode`, `transplant_date`, `custom_note`, and (when present) the genotype/accession sidecar. A required checkbox SHALL read "I have verified the physical scanners and plate positions match this list." The "Start scan" button SHALL be disabled until the checkbox is ticked. A "Cancel" button SHALL always be available.

**The confirmation snapshot SHALL be persisted as evidence**, not lost as ephemeral UI. When the operator ticks the checkbox and clicks "Start scan", the IPC payload to `gravi.startScan` SHALL include a `confirmation_snapshot: { confirmed_by: phenotyper_id, scanners: [...], plates: [...] }` field that the main process persists into `GraviScanSession.start_confirmation_snapshot` (a new JSON column on the existing session table). **The `confirmed_at` timestamp SHALL be set by the main process from `new Date().toISOString()` at IPC receipt** — the renderer's clock is untrusted (drift, suspend) and must NOT be the source. The main process injects `confirmed_at` into the snapshot before persisting. This converts the checkbox from theater into auditable evidence — an investigator post-hoc can query "what did the operator see when they confirmed wave 3?" and reconstruct the rendered list.

**Tamper-evidence for the snapshot.** SQLite has no row-level immutability — a sysadmin with `sqlite3` CLI can rewrite `GraviScanSession.start_confirmation_snapshot` post-hoc. To strengthen the evidentiary value, the main process SHALL ALSO write a `GraviScannerBinding` audit row (Proposal 2's append-only table) with `reason: 'manual:user-confirmed'`, `notes: 'session start confirmed; snapshot_sha256: <hex>'`, where the SHA-256 is computed over `JSON.stringify(confirmation_snapshot)` after `confirmed_at` is injected. The audit table's append-only enforcement means a tampered snapshot will produce a hash mismatch that an investigator can detect.

For sessions with exactly 1 enabled scanner, the modal SHALL be auto-skipped (Start Scan goes directly to IPC).

**A "Pause and edit metadata" affordance SHALL be available during continuous-mode interval waits** (per the GraviScan Metadata Page requirement above).

#### Scenario: ScannerPanel surfaces LED + colored status during scanning

- **GIVEN** an enabled scanner is currently scanning
- **WHEN** the GraviScan page renders the scanner row
- **THEN** the scanner panel SHALL render an Online LED (green when `isOnline`, gray otherwise)
- **AND** a Busy LED (red with `animate-pulse` when `isBusy`, gray otherwise)
- **AND** the panel background SHALL be color-coded by state: red-50 for error, green-50 for complete, amber-50 for waiting, white for idle
- **AND** the progress bar SHALL be filled to `progress%` with a state-matched fill color
- **AND** the output filename SHALL be visible in monospace text (or "-" when none)

#### Scenario: Start Scan confirmation modal for multi-scanner sessions

- **GIVEN** ≥2 scanners have `scannerId !== null && isDbScannerId(scannerId)` (enabled and saved)
- **WHEN** the user clicks Start Scan
- **THEN** the IPC SHALL NOT fire immediately
- **AND** a modal SHALL render with one read-only `<ScanPreview>` card per enabled scanner
- **AND** below each card, the modal SHALL list each selected plate: `plate_index`, `plant_barcode`, `transplant_date`, `custom_note`
- **AND** when present, the genotype/accession sidecar SHALL be visible per plate
- **AND** the modal SHALL render firmware_serial (when populated) and usb_port for each scanner
- **AND** the "Start scan" button SHALL be disabled until the "I have verified..." checkbox is ticked
- **AND** clicking "Cancel" SHALL close the modal without firing the IPC
- **AND** clicking "Start scan" with the checkbox ticked SHALL fire `gravi.startScan` with the same parameters that the modal displayed

#### Scenario: Start Scan modal is auto-skipped for single-scanner sessions

- **GIVEN** exactly 1 scanner is enabled
- **WHEN** the user clicks Start Scan
- **THEN** the modal SHALL NOT render
- **AND** `gravi.startScan` SHALL fire directly
- **AND** the operator's flow is the same as before this proposal

#### Scenario: Start Scan confirmation snapshot is persisted as audit evidence

- **GIVEN** the operator views the Start Scan confirmation modal for ≥2 enabled scanners
- **WHEN** the operator ticks the verification checkbox AND clicks "Start scan"
- **THEN** the IPC payload to `gravi.startScan` SHALL include a `confirmation_snapshot` field with `{ confirmed_at: ISO8601, confirmed_by: phenotyper_id, scanners: [...], plates: [...] }`
- **AND** the `scanners` array SHALL contain the rendered display_name, usb_port, firmware_serial (when populated) for each enabled scanner
- **AND** the `plates` array SHALL contain the `plate_index`, `plant_barcode`, `transplant_date`, `custom_note`, scanner UUID, and (when present) genotype/accession for every selected plate
- **AND** the main process SHALL persist this snapshot into `GraviScanSession.start_confirmation_snapshot` (a new JSON column on the session table)
- **AND** an investigator SHALL be able to SQL-query the column post-hoc and reconstruct exactly what the operator saw and confirmed at session start
- **AND** for single-scanner sessions where the modal was auto-skipped, the snapshot field SHALL be `null` (no operator confirmation occurred)

### Requirement: GraviScan Browse Page Identity Columns

The Browse page (`BrowseGraviScans.tsx`) SHALL surface scanner identity per historical scan so retroactive audits are possible.

#### Scenario: Browse page shows display_name, usb_port, and firmware_serial per scan

- **GIVEN** historical `GraviScan` rows exist with FK references to `GraviScanner` rows that have `display_name`, `usb_port`, and `firmware_serial` populated
- **WHEN** the user navigates to the Browse page
- **THEN** each scan row SHALL display the joined `display_name`, `usb_port`, and (when populated) `firmware_serial`
- **AND** these fields SHALL be visible without expanding the row (above-the-fold)
- **AND** the operator SHALL be able to audit: "wave 3's scans say Bench-3 at port 1-1 with serial ABC123 — does that match my logbook?"
