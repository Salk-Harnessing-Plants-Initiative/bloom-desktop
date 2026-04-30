## 1. Python worker

- [ ] 1.1 Add helper `_with_et_timestamp(path: str) -> str` that inserts `_et_YYYYMMDDTHHMMSS` after `_st_YYYYMMDDTHHMMSS` in the filename
- [ ] 1.2 Modify `_sane_scan` to compute final path before save, save to final path, return final path
- [ ] 1.3 Modify `_mock_scan` to do the same
- [ ] 1.4 Modify `_scan_plate` to use returned path in `scan-complete` event

## 2. TS coordinator

- [ ] 2.1 Remove file rename loop in `scanOnce()`
- [ ] 2.2 Simplify `grid-complete` event payload — drop `renamedFiles` oldPath/newPath, use list of final paths
- [ ] 2.3 Update event interface in `ScannerSubprocess` if needed

## 3. Renderer

- [ ] 3.1 Update `useScanSession.ts` `grid-complete` handler to not update DB paths (paths already correct from scan-complete)

## 4. Tests

- [ ] 4.1 Python unit test: `_with_et_timestamp` correctly inserts `_et_` after `_st_`
- [ ] 4.2 Python unit test: `_mock_scan` saves to path with `_et_`
- [ ] 4.3 Python unit test: `scan-complete` event has path with `_et_`
