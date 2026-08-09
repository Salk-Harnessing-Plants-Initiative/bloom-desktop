# scan-export Specification

## Purpose

TBD - created by archiving change add-cylinderscan-export-page. Update Purpose after archive.

## Requirements

### Requirement: Export Scans Page

The system SHALL provide an "Export Scans" page (route `export`, reachable from the main navigation) that lists every non-deleted scan across all scanners, grouped by experiment and capture day.

#### Scenario: Empty state

**Given** no scans exist in the database
**When** the user navigates to `/export`
**Then** the page displays a message indicating there are no scans to export

#### Scenario: Scans grouped by experiment and day

**Given** scans exist for multiple experiments and multiple capture days
**When** the user navigates to `/export`
**Then** scans are grouped into sections labeled by experiment name and capture day
**And** each group's label shows the number of scans in that group
**And** deleted scans are excluded from every group
**And** scans are listed regardless of which scanner captured them

### Requirement: Batch Scan Selection

The Export Scans page SHALL let the user select scans individually or by whole experiment×day group, using a single unified list, and SHALL always show the current selection count.

#### Scenario: Select an individual scan

**Given** the user is on the Export Scans page
**When** the user checks an individual scan's checkbox
**Then** that scan is added to the selection
**And** its group's header checkbox becomes indeterminate if not every scan in the group is selected
**And** the displayed selected-scan count increases by one

#### Scenario: Select a whole group

**Given** the user is on the Export Scans page
**When** the user checks a group's header checkbox
**Then** every scan in that group is added to the selection
**And** the group header checkbox shows as checked
**And** the displayed selected-scan count increases by the group's scan count

#### Scenario: Deselect a whole group

**Given** every scan in a group is currently selected
**When** the user unchecks that group's header checkbox
**Then** every scan in that group is removed from the selection

#### Scenario: No scans selected

**Given** the user is on the Export Scans page
**When** no scan is currently selected
**Then** the displayed selected count reads zero
**And** the export action is disabled

### Requirement: Export to Destination Directory

The system SHALL let the user export selected scans to a directory chosen via the native directory picker, copying each scan's files without overwriting existing files at the destination, and SHALL only allow starting an export once both a destination and at least one scan are selected.

#### Scenario: Export action disabled until ready

**Given** the user has not yet selected a destination directory, or has not yet selected any scans, or both
**When** the user views the Export Scans page
**Then** the export action is disabled

#### Scenario: Choose destination and export

**Given** the user has selected one or more scans and a destination directory
**When** the user starts the export
**Then** each selected scan's files are copied to a subdirectory matching the scan's stored path under the destination
**And** a file only appears at its final filename once it has finished copying completely — never in a truncated or partial state
**And** for each scan, its metadata file is copied before that scan's image frames

#### Scenario: Skip existing files at destination

**Given** a file already exists at the computed destination path for a selected scan
**When** the export runs
**Then** that file is skipped and not overwritten
**And** the skipped file is counted separately from exported files

#### Scenario: Reject a scan whose stored path would escape the destination

**Given** a selected scan's stored path, if joined with the destination directory, would resolve outside that destination directory (for example due to a `..` segment or an absolute path)
**When** the export runs
**Then** that scan is recorded as failed with a descriptive reason
**And** no files for that scan are written to the destination
**And** the export continues processing the remaining selected scans

### Requirement: Export Progress Reporting

The system SHALL report live progress to the renderer while an export is in progress, and SHALL clean up its progress listener when the page is no longer showing that export.

#### Scenario: Progress updates during export

**Given** an export of multiple scans is running
**When** each file finishes copying, is skipped, or fails
**Then** the renderer receives a progress update reflecting completed and total file counts
**And** the Export Scans page reflects this progress visually while the export is running

#### Scenario: Warning against disconnecting the destination mid-export

**Given** an export to a destination directory (for example a USB drive or network share) is in progress
**When** the user views the Export Scans page
**Then** a persistent, clearly visible warning against disconnecting that destination is shown
**And** the warning remains visible until the export finishes

#### Scenario: Progress listener cleaned up on unmount

**Given** an export is in progress and its progress listener is subscribed
**When** the Export Scans page unmounts before the export finishes
**Then** the progress listener is removed
**And** no further progress updates are delivered to the unmounted page

### Requirement: Export Completion and Error Reporting

The system SHALL report export outcomes to the user via a transient banner, distinguishing successful completion, partial per-scan failure, and fatal failure from one another, and SHALL never leave the export action stuck in a loading state.

#### Scenario: Successful export summary

**Given** an export completes with no per-scan failures
**When** the export finishes
**Then** a transient banner reports the number of files exported and the number skipped due to existing files

#### Scenario: Partial export with per-scan failures

**Given** an export completes where some scans exported or were skipped successfully and at least one other scan failed (for example due to an unreadable source folder)
**When** the export finishes
**Then** a transient banner reports the exported and skipped counts
**And** the banner separately and visibly reports the number of failed scans, distinct from the skipped count
**And** the banner identifies which scans failed by experiment name and full capture timestamp (date and time, not day-only — two failed scans in the same experiment and day must remain distinguishable), not only a count
**And** the failed scans do not appear at the destination

#### Scenario: Fatal export failure

**Given** an export fails as a whole (for example the destination directory becomes inaccessible partway through)
**When** the failure occurs
**Then** the export handler returns a failure result with an error message
**And** the renderer shows a transient error banner instead of leaving the export button stuck in a loading state
