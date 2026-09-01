## MODIFIED Requirements

### Requirement: GraviScan Metadata Upload

`GraviMetadataUpload.tsx` SHALL accept an Excel (`.xlsx`/`.xls`) file up to 15MB, let the user map spreadsheet columns to required fields, reject mappings that assign two fields to the same column, validate the data, and create a metadata-file record via `database.graviPlateAccessions.createWithSections`.

#### Scenario: Column mapping

**Given** a valid spreadsheet file is selected
**When** it is parsed client-side
**Then** the user SHALL be prompted to choose a sheet (if multiple exist) and map columns to: Plate ID, Section ID, Plant QR, Accession, Medium, Transplant Date (all required) and Custom Note (optional)
**And** a live preview table (capped at 20 rows) SHALL reflect the current mapping with color-coded columns

#### Scenario: Column mapping collision blocked

**Given** two or more fields (whether required or optional) are mapped to the same spreadsheet column, with unmapped fields excluded from consideration
**When** the user submits
**Then** the submission SHALL be blocked before any row-level validation runs, even if the resulting rows would otherwise pass that validation
**And** the page SHALL show an inline error naming every field mapped to that column and disambiguating the column by position (not solely by header text, which may be blank or duplicated across columns)
**And** each independently colliding column SHALL produce its own such error, and a column claimed by three or more fields SHALL produce one error naming all of them rather than one error per pair
**And** SHALL NOT call `createWithSections`

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

`GraviMetadataList.tsx` SHALL list existing metadata files via `database.graviPlateAccessions.listFiles`, with per-file expansion to view plates/sections and a Delete action, surfacing loading, error, and empty states for the file list itself.

#### Scenario: Loading state

**Given** a `listFiles()` call is in flight, whether from initial mount or a later refresh
**When** the call has not yet resolved
**Then** the page SHALL show a loading message instead of an empty or stale list

#### Scenario: Fetch failure surfaced

**Given** `listFiles()` resolves with `success: false`
**When** the fetch completes
**Then** the page SHALL show the returned error inline, falling back to a default message if none is provided
**And** SHALL NOT render an empty-state message in its place

#### Scenario: Empty-state message

**Given** `listFiles()` resolves successfully with zero files
**When** the fetch completes
**Then** the page SHALL show an explanatory empty-state message instead of a blank list

#### Scenario: Expand fetch failure surfaced

**Given** a file entry is expanded and `graviPlateAccessions.list(fileId)` resolves with `success: false`
**When** the fetch completes
**Then** the page SHALL show the returned error inline, falling back to a default message if none is provided
**And** SHALL NOT render an empty plate/section table in its place

#### Scenario: File list

**Given** one or more metadata files exist
**When** the list renders
**Then** each entry SHALL show file name, created date, linked experiment names, and plate count, in chronological order with no filtering/sorting UI

#### Scenario: Expand to view plates and sections

**Given** a file entry
**When** the user expands it
**Then** the page SHALL lazily fetch `graviPlateAccessions.list(fileId)` and render a table with a header row (Plate ID, Accession, Transplant Date, Custom Note, Section, Plant QR, Medium) over row-spanned plate-level cells (plate ID/accession/transplant date/note) and per-section rows (section ID/plant QR/medium)

#### Scenario: Delete blocked while referenced

**Given** a metadata file still referenced by `Experiment.accession_id` or by any `GraviExperimentWaveMetadata` link
**When** the user clicks Delete
**Then** the backend SHALL reject the deletion (per `scanning/spec.md`'s `graviPlateAccessions.*` requirement) and the page SHALL surface the returned error rather than removing the entry from the list

#### Scenario: Delete succeeds when unreferenced

**Given** a metadata file with no remaining references
**When** the user clicks Delete
**Then** it SHALL be removed from the database and disappear from the list
