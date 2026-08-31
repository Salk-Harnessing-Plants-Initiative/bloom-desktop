## ADDED Requirements

### Requirement: GraviScan Browse Page

The application SHALL provide a `BrowseGraviScans` page at `/browse-graviscans`, visible only in `graviscan` mode, displaying one row per experiment (not per scan), server-side paginated and filterable, via `database.graviscans.browseByExperiment`.

#### Scenario: Empty state

**Given** no GraviScan experiments exist
**When** the user navigates to `/browse-graviscans`
**Then** the page displays a message indicating no GraviScan data is present

#### Scenario: Per-experiment row content

**Given** at least one GraviScan experiment with scans exists
**When** the page renders
**Then** each row shows: experiment name, "Needs Review" badge (if applicable), scientist, phenotyper(s), date range, image-count breakdown (scanners × plates × cycles), resolution/grid mode, accession name, and a per-wave Bloom/Box backup progress indicator

**Acceptance Criteria**:

- Rows are paginated (20 per page) via `browseByExperiment`'s `offset`/`limit`
- A "View Images" action navigates to `/graviscan-experiment/:experimentId`
- A per-experiment wave selector ("All Waves" or a specific wave) scopes that row's Download action

#### Scenario: Filtering

**Given** multiple GraviScan experiments with varying dates, names, accessions, and upload statuses
**When** the user sets a date-range, experiment-name, accession, or upload-status filter
**Then** the row list updates to match, debounced 300ms except the upload-status filter, which applies immediately

**Acceptance Criteria**:

- Date-range filtering is inclusive on both ends
- Experiment-name and accession filters match by substring
- Upload-status filter accepts `pending`/`uploaded`/`failed`

#### Scenario: Download images for a wave

**Given** an experiment row with at least one wave of images
**When** the user selects a wave (or "All Waves") and clicks Download
**Then** the page calls `gravi.downloadImages({experimentId, experimentName, waveNumber})` and reports the result

**Known limitation, not fixed by this requirement**: `downloadImages`'s exported `plates.csv`/`sections.csv` resolve plate/accession metadata via the experiment's legacy `Experiment.accession_id`, not this same change's new wave-scoped `GraviExperimentWaveMetadata` links — a wave linked to a different metadata file than the experiment's legacy accession will download with metadata that does not reflect that wave's actual link. See `design.md` Decision 10.

#### Scenario: Mismatch warning before downloading a single diverged wave

**Given** the selected wave's `listGraviMetadata` link points to a different accession than the experiment's `accession_id`
**When** the user selects that wave and clicks Download
**Then** the page SHALL show an inline warning naming the wave, that its linked metadata differs from the experiment's default accession, and that the downloaded CSV will reflect the default accession instead — before proceeding with the download
**And** the download SHALL still proceed (the warning informs, it does not block)

#### Scenario: Mismatch warning before an "All Waves" download with any diverged wave

**Given** the experiment has two or more linked waves, and at least one wave's linked accession differs from the experiment's `accession_id`
**When** the user selects "All Waves" and clicks Download
**Then** the page SHALL show the same inline warning, naming every diverged wave (not just the first), before proceeding
**And** the download SHALL still proceed

#### Scenario: No warning when every relevant wave matches the experiment's default accession

**Given** either a single selected wave whose linked accession is the same as the experiment's `accession_id` (e.g. wave `0`, immediately after creation, per `design.md` Decision 4), or "All Waves" selected with no wave's link differing from `accession_id`
**When** the user clicks Download
**Then** no mismatch warning SHALL appear

#### Scenario: No warning for a wave with no metadata link at all

**Given** the selected wave has no `GraviExperimentWaveMetadata` row (it falls back to the experiment's `accession_id` by design, not by divergence)
**When** the user clicks Download
**Then** no mismatch warning SHALL appear for that wave

#### Scenario: Fetch error shows a friendly message

**Given** `browseByExperiment` returns an error (e.g. a database connection failure)
**When** the page attempts to load
**Then** the page SHALL display a user-friendly error message
**And** SHALL NOT throw an unhandled error

### Requirement: GraviScan Box Backup UI

`BrowseGraviScans.tsx` SHALL provide one global "Backup to Box" action that triggers `uploadAllScans()` and surfaces its Box-backup progress and result, without polling scan status on an interval.

#### Scenario: Idle state

**Given** the page is mounted
**When** no backup is in flight and no scan session is active
**Then** the button SHALL read "Backup to Box" and be enabled

#### Scenario: Backup in-flight state

**Given** the operator has clicked "Backup to Box"
**When** the `uploadAllScans()` call has not yet resolved
**Then** the button SHALL read "Backing up…" and be disabled

#### Scenario: Scan-in-progress state

**Given** a scan session is currently active (per `getScanStatus()` or a live `onIntervalStart`/`onIntervalComplete`/`onCancelled` event)
**When** the button renders
**Then** the button SHALL read "Scan in progress…" and be disabled

#### Scenario: Scan-active detection uses push events, not polling

**Given** the page mounts while a scan session is already active (e.g. the operator navigated here mid-scan)
**When** the page determines whether to disable the backup button
**Then** it SHALL call `getScanStatus()` once on mount to establish the current state
**And** it SHALL subscribe to `onIntervalStart`/`onIntervalComplete`/`onCancelled` for subsequent live updates
**And** it SHALL NOT poll `getScanStatus()` on a fixed interval

#### Scenario: Successful backup reports counts

**Given** the operator clicks "Backup to Box" and the call resolves with `{success: true, uploaded: N, skipped: M, failed: 0}`
**When** the result is received
**Then** the page SHALL display a dismissable inline banner reporting the uploaded/skipped counts

#### Scenario: Partial failure reports the aggregate and first error

**Given** the backup call resolves with `failed > 0` and a non-empty `errors` array not including `'rclone not installed'`
**When** the result is received
**Then** the page SHALL display an inline banner showing the failed count and the first error message

#### Scenario: rclone-unavailable failure shows a friendly message

**Given** the backup call's `errors` array includes the string `'rclone not installed'`
**When** the result is received
**Then** the page SHALL display "Box backup unavailable (rclone not installed)" instead of the generic failed-count/first-error message

#### Scenario: Per-experiment Box progress indicator

**Given** a `onUploadProgress` event arrives with Box-backup progress fields (`totalImages`, `completedImages`, `failedImages`, `currentExperiment`)
**When** the event is received
**Then** the row matching `currentExperiment` SHALL show a "Box X/Y" mini progress indicator, updated live as further events arrive

### Requirement: GraviScan Experiment Detail Page

The application SHALL provide an `ExperimentDetail` page at `/graviscan-experiment/:experimentId`, visible only in `graviscan` mode, showing one experiment's metadata summary, linked wave-metadata, and a resizable file table with inline preview, via `database.graviscans.experimentDetail` and `database.experiments.listGraviMetadata`.

#### Scenario: Metadata summary

**Given** a valid `experimentId`
**When** the page loads
**Then** it displays scientist, phenotyper, date range, image count, resolution, grid mode, and single/multi-wave status

#### Scenario: Unknown experiment shows an error, not a crash

**Given** an `experimentId` that does not correspond to any experiment
**When** the page loads
**Then** it displays a user-friendly "experiment not found" message
**And** does not throw an unhandled error

#### Scenario: Fetch error shows a friendly message

**Given** `experimentDetail` returns an error other than "not found" (e.g. a database connection failure)
**When** the page attempts to load
**Then** the page SHALL display a user-friendly error message
**And** SHALL NOT throw an unhandled error

#### Scenario: Linked Metadata section — list and unlink

**Given** the experiment has one or more waves linked to metadata files (via `listGraviMetadata`)
**When** the section renders
**Then** each link is shown as "Wave N: {accession name}" with an Unlink action
**And** clicking Unlink SHALL first show a confirmation naming the wave number and accession, and stating that history is not retained
**And** for wave `0` specifically, the confirmation SHALL additionally state that the experiment's default accession was originally set to the same file and will not change when wave 0 is unlinked
**And** only on confirming SHALL the page call `unlinkGraviMetadata(experimentId, waveNumber)` and remove that entry from the list on success
**And** declining the confirmation SHALL leave the link unchanged and make no IPC call

#### Scenario: Linked Metadata section — link a new wave

**Given** the experiment is `graviscan`-typed
**When** the user enters a wave number (defaulting to `max(existing wave numbers) + 1`), selects a metadata file, and submits
**Then** the page calls `linkGraviMetadata(experimentId, waveNumber, accessionId)`
**And** on success, the new link appears in the list
**And** on failure, an inline error message appears near the form without clearing the operator's selections

#### Scenario: Resizable file table with inline preview

**Given** the experiment has one or more scan files
**When** the table renders
**Then** columns (icon/filename/plate/wave) SHALL be resizable by dragging a column edge, using a shared resize hook (not per-page duplicated drag-listener code)
**And** clicking a row expands an inline TIFF preview plus capture/transplant date, note, barcode, scanner, grid, plate, and wave

**Acceptance Criteria**:

- Column-resize drag listeners are attached only while dragging and are removed on both `mouseup` and component unmount
- Scanner and (when the experiment has more than one wave) wave filter chips narrow the visible rows with live counts

#### Scenario: Per-plate verification status badge

**Given** a scan file with a `verification_status` of `needs_review` or `verified`
**When** the row renders
**Then** it SHALL show an amber "Needs Review" or green check badge respectively
**And** any other `verification_status` value (e.g. `pending`, for scans not yet verified) SHALL render with no error styling

### Requirement: GraviScan Metadata Page

The application SHALL provide a `Metadata` page at `/metadata`, visible only in `graviscan` mode, composing a metadata upload flow and a metadata list flow, with no internal build-time mode branch (mode-gating is handled entirely by the route, per `scanning/spec.md`'s Mode-Aware Routing requirement).

#### Scenario: Page composition

**Given** the user navigates to `/metadata` in graviscan mode
**When** the page renders
**Then** it SHALL render the metadata upload component and the metadata list component together, with no tri-mode or build-time-`APP_MODE` branch inside the page component itself

### Requirement: GraviScan Metadata Upload

`GraviMetadataUpload.tsx` SHALL accept an Excel (`.xlsx`/`.xls`) file up to 15MB, let the user map spreadsheet columns to required fields, validate the data, and create a metadata-file record via `database.graviPlateAccessions.createWithSections`.

#### Scenario: Column mapping

**Given** a valid spreadsheet file is selected
**When** it is parsed client-side
**Then** the user SHALL be prompted to choose a sheet (if multiple exist) and map columns to: Plate ID, Section ID, Plant QR, Accession, Medium, Transplant Date (all required) and Custom Note (optional)
**And** a live preview table (capped at 20 rows) SHALL reflect the current mapping with color-coded columns

#### Scenario: Partial-row validation

**Given** a row has some required cells filled and others blank
**When** the file is submitted
**Then** that row SHALL be flagged as a validation error, not silently dropped
**And** the submission SHALL NOT proceed while any row has an unresolved validation error

#### Scenario: Successful upload

**Given** a fully valid, mapped spreadsheet
**When** the user submits
**Then** rows SHALL be grouped by Plate ID into a plate→sections structure and passed to `createWithSections({name: fileName}, plates)`
**And** on success, the form SHALL show a completion message, then reset and notify the parent (`onUploadComplete`)

#### Scenario: Oversized or wrong-type file rejected

**Given** a selected file is not `.xlsx`/`.xls`, or exceeds 15MB
**When** the user attempts to select it
**Then** the file SHALL be rejected with an inline error before any parsing is attempted

#### Scenario: Empty sheet rejected

**Given** a selected, valid-type spreadsheet whose chosen sheet has zero data rows
**When** the user attempts to submit
**Then** the page SHALL show an inline error indicating there is no data to import
**And** SHALL NOT call `createWithSections`

### Requirement: GraviScan Metadata List

`GraviMetadataList.tsx` SHALL list existing metadata files via `database.graviPlateAccessions.listFiles`, with per-file expansion to view plates/sections and a Delete action.

#### Scenario: File list

**Given** one or more metadata files exist
**When** the list renders
**Then** each entry SHALL show file name, created date, linked experiment names, and plate count, in chronological order with no filtering/sorting UI

#### Scenario: Expand to view plates and sections

**Given** a file entry
**When** the user expands it
**Then** the page SHALL lazily fetch `graviPlateAccessions.list(fileId)` and render a table with row-spanned plate-level cells (plate ID/accession/transplant date/note) over per-section rows (section ID/plant QR/medium)

#### Scenario: Delete blocked while referenced

**Given** a metadata file still referenced by `Experiment.accession_id` or by any `GraviExperimentWaveMetadata` link
**When** the user clicks Delete
**Then** the backend SHALL reject the deletion (per `scanning/spec.md`'s `graviPlateAccessions.*` requirement) and the page SHALL surface the returned error rather than removing the entry from the list

#### Scenario: Delete succeeds when unreferenced

**Given** a metadata file with no remaining references
**When** the user clicks Delete
**Then** it SHALL be removed from the database and disappear from the list

### Requirement: Global Upload-Progress Indicator

The application SHALL provide a persistent, app-wide indicator of in-flight or just-finished upload/backup progress (Bloom upload and Box backup), visible regardless of which page the operator is currently viewing, rendered as an inline banner in `Layout.tsx` — not a toast notification.

#### Scenario: Indicator persists across navigation

**Given** an upload/backup is triggered from `BrowseGraviScans.tsx` (via `uploadAllScans()`)
**When** the operator navigates to a different page (e.g. `ExperimentDetail` or `Metadata`) before it completes
**Then** the Layout-level indicator SHALL continue showing live progress
**And** the indicator SHALL show a final result summary once the upload completes, regardless of which page is active at that time

#### Scenario: Indicator dismissible, not a toast

**Given** the indicator is showing an in-flight or completed status
**When** the operator clicks its dismiss control
**Then** it SHALL hide until the next upload/backup event
**And** it SHALL NOT auto-dismiss on a timer (unlike this codebase's rejected toast pattern)

## MODIFIED Requirements

### Requirement: Create Experiment

The Experiments page MUST allow users to create new experiments with validation (name required, species required, scientist required, accession required). When the configured scanner mode is `graviscan`, the created experiment SHALL have `experiment_type: 'graviscan'`, and the form SHALL additionally offer a wave-number field (default `0`); the form's existing required Accession dropdown is reused as that wave's metadata-file selection — no second accession picker is added. When the configured scanner mode is `cylinderscan` (or any other mode), the created experiment SHALL have `experiment_type: 'cylinderscan'` and the form's fields are unchanged from today.

#### Scenario: Valid Submission

**Given** the user is on the `/experiments` page
**When** the user enters a valid name (e.g., "Drought Study 2025")
**And** the user selects a species from the dropdown
**And** the user selects a scientist from the dropdown
**And** the user selects an accession from the dropdown
**And** the user clicks "Create" button
**Then** the experiment is created in the database with scientist and accession linked
**And** the form fields are cleared
**And** the experiments list refreshes to show the new entry

**Acceptance Criteria**:

- Name is trimmed of leading/trailing whitespace at the validation level
- Species is required (dropdown, no empty option after selection)
- Scientist is required (dropdown from scientists list)
- Accession is required (dropdown from accessions list)
- Loading indicator appears during submission
- IPC call completes successfully
- New experiment appears in list without page refresh

#### Scenario: Validation Failure - Empty Name

**Given** the user is on the `/experiments` page
**When** the user leaves the name field empty
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** an error indication appears

**Acceptance Criteria**:

- Validation runs before submission (no network call)
- Form remains populated with selected values
- Submit button can be clicked again after fixing error

#### Scenario: Validation Failure - Whitespace-Only Name

**Given** the user is on the `/experiments` page
**When** the user enters only whitespace characters (e.g. " ")
**And** the user selects a scientist and accession
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** an error message "Name is required" appears

**Acceptance Criteria**:

- Whitespace is trimmed before min-length validation
- No IPC call is made to the database
- Other form fields retain their values

#### Scenario: Validation Failure - No Scientist Selected

**Given** the user is on the `/experiments` page
**And** scientists exist in the database
**When** the user fills in name and species
**And** the user does not select a scientist
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** an error message "Scientist is required" appears near the scientist field

#### Scenario: Validation Failure - No Accession Selected

**Given** the user is on the `/experiments` page
**And** accessions exist in the database
**When** the user fills in name, species, and scientist
**And** the user does not select an accession
**And** the user clicks "Create" button
**Then** form submission is prevented
**And** an error message "Accession is required" appears near the accession field

#### Scenario: Species Dropdown

**Given** the user is on the `/experiments` page
**When** the user views the species dropdown
**Then** all supported species are available for selection

**Acceptance Criteria**:

- Dropdown pre-selects the first species
- All 15 species are listed alphabetically

#### Scenario: GraviScan mode sets experiment_type and links the selected accession to a wave

**Given** the configured scanner mode is `graviscan`
**When** the user creates a new experiment via the standard Create flow, selecting an accession in the form's existing required Accession dropdown and a wave number (default `0`)
**Then** the created experiment SHALL have `experiment_type: 'graviscan'`
**And** the created experiment's `accession_id` SHALL be set to the selected accession, exactly as it is for a cylinderscan experiment today
**And** the page SHALL call `linkGraviMetadata(newExperimentId, waveNumber, accessionId)` immediately after the experiment is created, using that same selected accession
**And** no second accession/metadata-file dropdown SHALL appear on the form

#### Scenario: GraviScan mode filters the Accession dropdown to GraviScan-eligible files

**Given** the configured scanner mode is `graviscan`
**And** the database has a mix of CylinderScan barcode-mapping `Accessions` rows and GraviScan metadata-file `Accessions` rows
**When** the Accession dropdown renders
**Then** its options SHALL come from `graviPlateAccessions.listFiles()`, not the generic `accessions.list()`
**And** only GraviScan-eligible accessions (at least one `GraviPlateAccession` child) SHALL appear

#### Scenario: Post-create link failure does not lose the created experiment

**Given** a new graviscan experiment was just created successfully
**When** the subsequent `linkGraviMetadata` call fails
**Then** the page SHALL show "Experiment created but metadata link failed: {message}"
**And** the newly created experiment SHALL remain in the experiments list (not rolled back)

#### Scenario: CylinderScan mode is unaffected

**Given** the configured scanner mode is `cylinderscan`
**When** the user creates a new experiment
**Then** the created experiment SHALL have `experiment_type: 'cylinderscan'`
**And** no wave-number field SHALL appear
**And** the Accession dropdown behaves exactly as it does today (no wave-linking call is made)

### Requirement: Attach Accession to Existing Experiment

The Experiments page SHALL allow users to attach an accession to an existing experiment via a dedicated UI section. For `cylinderscan`-typed experiments, this uses the existing single-accession `attachAccession` call, unchanged. For `graviscan`-typed experiments, this section instead requires a wave number and calls `linkGraviMetadata`, since a single experiment may have distinct accessions per wave; existing wave→accession links are shown inline beneath each graviscan experiment, each with an Unlink action.

#### Scenario: Attach Accession (cylinderscan)

**Given** experiments and accessions exist in the database
**And** the selected experiment has `experiment_type: 'cylinderscan'`
**When** the user selects the experiment from the dropdown
**And** the user selects an accession from the dropdown
**And** the user clicks "Attach Accession" button
**Then** the experiment is updated with the accession link via `attachAccession`
**And** a success message appears

**Acceptance Criteria**:

- Experiment dropdown shows: `{species} - {name} ({scientist name})`
- Accession dropdown shows: `{name} - {id}`
- Loading indicator during attachment
- Success message: "Accession successfully attached."
- Error message if attachment fails

#### Scenario: Attach Metadata File to a Wave (graviscan)

**Given** experiments and GraviScan metadata files exist in the database
**And** the selected experiment has `experiment_type: 'graviscan'`
**When** the user selects the experiment from the dropdown
**Then** the wave-number field SHALL default to `max(existing linked wave numbers for that experiment) + 1`
**And** the metadata-file dropdown's options SHALL come from `graviPlateAccessions.listFiles()`, not the generic `accessions.list()`, so only GraviScan-eligible files appear
**And** when the user selects a metadata file and clicks the attach action, the page SHALL call `linkGraviMetadata(experimentId, waveNumber, accessionId)`
**And** on success, the new wave→accession link SHALL appear inline beneath that experiment in the list

#### Scenario: Existing wave links shown inline, with Unlink

**Given** a `graviscan`-typed experiment has one or more linked waves
**When** the experiments list renders
**Then** each experiment SHALL show its linked waves as "Wave N: {accession name}" beneath its entry, each with an Unlink action
**And** clicking Unlink SHALL first show a confirmation naming the wave number and accession, and stating that history is not retained (for wave `0`, additionally noting the experiment's default accession will not change)
**And** only on confirming SHALL the page call `unlinkGraviMetadata(experimentId, waveNumber)`
**And** declining the confirmation SHALL leave the link unchanged and make no IPC call

#### Scenario: Linking a wave that already has a link is rejected

**Given** a `graviscan`-typed experiment already has wave `2` linked to a metadata file
**When** the user attempts to link wave `2` again (to the same or a different file) without first unlinking
**Then** the page SHALL surface the backend's rejection as an inline error
**And** the existing link SHALL remain unchanged
