## Why

Row-merge scanning (scan a bounding box covering two plates, then crop each plate from the image) introduces crop alignment issues and adds complexity. Hardware testing on 2026-04-09 confirmed that scanning each plate at its exact grid ROI coordinates is reliable at 1200 DPI across all 5 scanners. Direct grid ROI eliminates the crop step entirely.

## What Changes

- Remove row-merge scan path from `scan_worker.py` — all plates scan individually at their exact grid region
- Remove bounding box + crop logic (`get_row_bounding_box`, `get_crop_box`, `_scan_row`, `_sane_scan_row`, `_mock_scan_row`)
- Simplify TypeScript coordinator row-grouping logic (no longer needs to batch same-row plates for merge)
- Remove row-merge unit tests from Python test suite

## Impact

- Affected specs: `scanning`
- Affected code:
  - `python/graviscan/scan_worker.py` — remove `_scan_row`, `_sane_scan_row`, `_mock_scan_row` methods; simplify `_handle_scan` dispatch
  - `python/graviscan/scan_regions.py` — remove `get_row_bounding_box`, `get_crop_box`, `GRID_4_ROW_GROUPS`
  - `python/tests/test_scan_regions.py` — remove `TestGetRowBoundingBox`, `TestGetCropBox` tests
  - `src/main/scan-coordinator.ts` — simplify row-grouping to send each plate individually
