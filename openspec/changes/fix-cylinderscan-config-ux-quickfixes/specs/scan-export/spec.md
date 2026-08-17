## MODIFIED Requirements

### Requirement: Export Completion and Error Reporting

The system SHALL report export outcomes to the user via a transient banner, distinguishing successful completion, partial per-scan failure, and fatal failure from one another, and SHALL never leave the export action stuck in a loading state. Banners reporting export/skip counts SHALL clearly label whether a count refers to scans or files, since one scan may contain many files.

#### Scenario: Successful export summary

**Given** an export completes with no per-scan failures
**When** the export finishes
**Then** a transient banner reports the number of scans exported, the number of files exported, and the number of files skipped due to existing files
**And** the scan count and file count are each labeled so a reader can tell which is which (for example "12 scans exported (73 files), 0 files skipped")

#### Scenario: Partial export with per-scan failures

**Given** an export completes where some scans exported or were skipped successfully and at least one other scan failed (for example due to an unreadable source folder)
**When** the export finishes
**Then** a transient banner reports the exported scan count, exported file count, and skipped file count, each clearly labeled
**And** the banner separately and visibly reports the number of failed scans, distinct from the skipped count
**And** the banner identifies which scans failed by experiment name and full capture timestamp (date and time, not day-only — two failed scans in the same experiment and day must remain distinguishable), not only a count
**And** the failed scans do not appear at the destination

#### Scenario: Fatal export failure

**Given** an export fails as a whole (for example the destination directory becomes inaccessible partway through)
**When** the failure occurs
**Then** the export handler returns a failure result with an error message
**And** the renderer shows a transient error banner instead of leaving the export button stuck in a loading state
