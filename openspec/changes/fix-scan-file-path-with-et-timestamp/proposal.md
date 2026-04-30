## Why

After removing row-merge scanning, each plate scans individually and the worker knows both `_st_` (start) and `_et_` (end) timestamps at save time. However, the TS coordinator still renames files post-save to insert `_et_TIMESTAMP`, creating a window where the disk path doesn't match the path emitted by `scan-complete` (issue #154). Since each plate scan is now independent, the worker can write the file with the final name directly — no rename needed.

## What Changes

- `scan_worker.py` `_sane_scan` and `_mock_scan` insert `_et_TIMESTAMP` into the output path before saving
- `scan_worker.py` `_scan_plate` emits `scan-complete` with the final path (with `_et_`)
- `scan-coordinator.ts` drops the file rename logic in `scanOnce()` — uses the path from `scan-complete` directly
- `grid-complete` event still fires but `renamedFiles` becomes a list of final paths (no oldPath/newPath distinction)

### Implementation constraints

- **No new env vars or config.** Hardcode the timestamp format inline.
- **No backwards compat.** Drop the rename path entirely. `renamedFiles` becomes `completedFiles`.
- **Single try/catch in coordinator.** No nested error handling around path construction.
- **Python writes to final path only.** No temp file + rename in Python.
- **Filename pattern unchanged from disk perspective:** `..._st_T1_et_T2_cy1_S1_00.tif`.
- **Log prefix:** `[ScanWorker]` for Python, `[ScanCoordinator]` for TS.

## Impact

- Affected specs: `scanning`
- Affected code:
  - `python/graviscan/scan_worker.py` — modify `_sane_scan` and `_mock_scan` to insert `_et_` and save to final path; `_scan_plate` emits final path (~15 lines)
  - `src/main/scan-coordinator.ts` — remove rename loop, simplify grid-complete payload (~30 lines removed)
  - `src/renderer/hooks/useScanSession.ts` — `grid-complete` handler no longer updates paths (paths are already correct from scan-complete)
