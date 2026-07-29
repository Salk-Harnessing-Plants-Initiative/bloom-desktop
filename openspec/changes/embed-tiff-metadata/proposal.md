## Why

GraviScan TIFF files already embed hardware/capture provenance (`scanner_id`, `grid_mode`, `plate_index`, `resolution_dpi`, `scan_region_mm`, `capture_timestamp`, `bloom_version`) so files are self-describing without the local DB. They don't yet embed _experiment_-level provenance — which experiment, wave, row-start timestamp, and phenotyper produced a given scan. Every parameter that affects a scan output should appear alongside the images, matching this project's existing metadata-preservation value (already applied to hardware/capture parameters; this closes the gap for experiment-level ones).

## What Changes

- `_build_tiff_metadata()` in `python/graviscan/scan_worker.py` gains four new fields in the `ImageDescription` JSON: `exp_name`, `wave_number`, `st_timestamp`, `phenotyper_name`.
- The row-start timestamp (`st_timestamp`) is wired with a real, already-computed value from `scan-coordinator.ts` (the same value already used to build each row's `_st_` filename segment) — no placeholder needed for this one field.
- `exp_name`, `wave_number`, `phenotyper_name` are plumbed as optional fields through `PlateConfig`/the Python `plate` dict, defaulting to empty/zero. No renderer exists on `main` yet to supply real values for these three (that's Phase 1b work) — this change makes the plumbing ready so Phase 1b's renderer can supply them with no further backend changes.

### Implementation constraints

- No behavior change to existing embedded fields.
- `_build_tiff_metadata()`'s existing positional-argument calling convention is preserved (new fields added as keyword arguments with defaults), not converted to a whole-dict signature — `main`'s Python call sites still pass individual fields positionally, unlike the (unmerged, draft) stranded-branch source commit this is adapted from.

## Impact

- Affected specs: `scanning`
- Affected code:
  - `python/graviscan/scan_worker.py` — `_build_tiff_metadata()` signature + `ImageDescription` JSON
  - `src/types/graviscan.ts` — `PlateConfig` gains `exp_name?`, `wave_number?`, `phenotyper_name?`, `st_timestamp?`
  - `src/main/graviscan/scan-coordinator.ts` — passes the real `st_timestamp` value through when forwarding plates to the Python worker
