## ADDED Requirements

### Requirement: Scan File Saved with Final Filename

The scan worker SHALL save scan output files with both `_st_TIMESTAMP` (start) and `_et_TIMESTAMP` (end) in the filename at write time. No post-save rename SHALL occur.

#### Scenario: Plate scan completes with final filename on disk

- **GIVEN** the worker receives `output_path = "..._st_20260413T120530_cy1_S1_00.tif"`
- **WHEN** the plate scan completes
- **THEN** the file SHALL be saved as `..._st_20260413T120530_et_20260413T120545_cy1_S1_00.tif`
- **AND** no rename operation SHALL occur after save
- **AND** the `scan-complete` event SHALL contain the final path (with `_et_`)

#### Scenario: Database path matches disk path

- **GIVEN** a scan completes successfully
- **WHEN** the renderer creates a DB record from the `scan-complete` event
- **THEN** the path stored in the DB SHALL match the file on disk exactly

## REMOVED Requirements

### Requirement: Coordinator File Rename

**Reason**: Replaced by Python worker writing the file with the final name directly. After removing row-merge scanning, the worker knows both timestamps at save time so the rename step is no longer needed.

**Migration**: `scan-coordinator.ts` `scanOnce()` no longer renames files. The `grid-complete` event payload changes from `renamedFiles: { oldPath, newPath }[]` to a list of final paths only.
