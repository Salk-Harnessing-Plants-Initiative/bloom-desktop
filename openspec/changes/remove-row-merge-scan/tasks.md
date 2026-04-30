## 1. Python scan worker

- [ ] 1.1 Remove `_scan_row` method from `scan_worker.py`
- [ ] 1.2 Remove `_sane_scan_row` method from `scan_worker.py`
- [ ] 1.3 Remove `_mock_scan_row` method from `scan_worker.py`
- [ ] 1.4 Simplify `_handle_scan` to always scan plates individually (remove `use_row_merge` branch)

## 2. Python scan regions

- [ ] 2.1 Remove `get_row_bounding_box` from `scan_regions.py`
- [ ] 2.2 Remove `get_crop_box` from `scan_regions.py`
- [ ] 2.3 Remove `GRID_4_ROW_GROUPS` and `get_row_groups` from `scan_regions.py`

## 3. TypeScript coordinator

- [ ] 3.1 Simplify `scan-coordinator.ts` row-grouping to send each plate individually (remove row-merge batching)

## 4. Tests

- [ ] 4.1 Remove `TestGetRowBoundingBox` from `test_scan_regions.py`
- [ ] 4.2 Remove `TestGetCropBox` from `test_scan_regions.py`
- [ ] 4.3 Remove any row-merge tests from scan worker tests
- [ ] 4.4 Verify existing individual plate scan tests still pass
