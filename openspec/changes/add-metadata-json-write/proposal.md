# Proposal: Write metadata.json Alongside Scan Images

## Why

The pilot writes a `metadata.json` file to disk alongside scan images before capture begins. bloom-desktop does NOT write this file. This is critical for:

- **Data portability**: metadata.json allows scans to be understood outside the database (FAIR principles)
- **Pilot compatibility**: downstream tools and upload scripts expect metadata.json in the scan directory
- **Crash recovery**: if the app crashes mid-scan, metadata.json preserves what was being captured
- **Reproducibility**: the metadata file is a self-describing record of scan parameters

The pilot writes metadata.json at `scanner.ts:58` (before image capture), containing all scan metadata and camera settings. bloom-desktop currently only persists scan data to the SQLite database after scan completion (`scanner-process.ts:107`).

## What Changes

### metadata.json write (main process)
- **`src/main/scanner-process.ts:94-101`** — In the `scan()` method, write `metadata.json` to `output_path` **before** sending the scan command to Python (before line 98)
- Use atomic write pattern: write to temp file, then rename (prevents partial files on crash)
- Create output directory if it doesn't exist (matching pilot `scanner.ts:279`)

### metadata.json format (matching pilot)
- Fields from pilot `scanner.ts:202-214` and `custom.types.ts:10-28`:
  - `id` — scan UUID (from database record or pre-generated)
  - `phenotyper_id`, `experiment_id`, `scanner_name`, `plant_id`, `accession_name`
  - `path` — relative scan path
  - `capture_date` — ISO 8601 string
  - `wave_number`, `plant_age_days`
  - Camera settings: `num_frames`, `exposure_time`, `gain`, `brightness`, `contrast`, `gamma`, `seconds_per_rot`
- JSON formatted with 2-space indent (`JSON.stringify(metadata, null, 2)`) matching pilot `scanner.ts:283`

### Timing
- Written **before** image capture begins, matching pilot flow (`scanner.ts:58` writes before `spawn()` on line 67)
- This ensures metadata exists even if capture fails partway through

## Impact

- **Affected specs**: `scanning`
- **Affected code**:
  - `src/main/scanner-process.ts` — add metadata write in `scan()` method (before line 98)
- **Related Issues**: #99, #100 (scan directory format)
- **Migration**: None — no production scans exist yet in bloom-desktop
- **Pilot References**: `bloom-desktop-pilot/app/src/main/scanner.ts` (lines 58 write call, 186-216 metadata assembly, 277-292 writeMetadata function)
