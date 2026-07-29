## 1. Python

- [ ] 1.1 Extend `_build_tiff_metadata()` with `exp_name`, `wave_number`, `st_timestamp`, `phenotyper_name` keyword params (defaults: `""`, `0`, `""`, `""`), embedded in the `ImageDescription` JSON
- [ ] 1.2 Thread the 4 fields from `plate` dict (via `.get(key, default)`) through `_scan_plate` → `_sane_scan`/`_mock_scan` → `_build_tiff_metadata`

## 2. TS plumbing (no renderer exists yet — plumbing only)

- [ ] 2.1 `src/types/graviscan.ts`'s `PlateConfig` gains `exp_name?: string`, `wave_number?: number`, `phenotyper_name?: string`, `st_timestamp?: string`
- [ ] 2.2 `scan-coordinator.ts` passes the real, already-computed row-start timestamp through as `st_timestamp` when forwarding plates to the Python worker

## 3. Tests

- [ ] 3.1 `_build_tiff_metadata()` unit tests for all 4 new fields, including defaults when absent
- [ ] 3.2 Round-trip test: write a TIFF, read it back, assert all 4 fields present and correct (not just that the function runs)
- [ ] 3.3 Real-hardware test (gated, rig currently offline): a real (non-mock) scan embeds the same 4 fields correctly — SANE and mock are separate code paths that could diverge
