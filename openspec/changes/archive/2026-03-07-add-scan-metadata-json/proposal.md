## Why

Scan metadata is currently stored only in SQLite. If images are copied, exported, or the database is lost, metadata is unrecoverable. Writing a `metadata.json` file to each scan directory ensures metadata travels with the images, following FAIR data principles and matching pilot behavior.

## What Changes

- Write `metadata.json` to the scan output directory BEFORE image capture begins
- Use atomic write pattern (write to `.tmp` file, then rename) to prevent partial files
- Include all scan metadata fields: experiment, phenotyper, scanner, plant, camera settings, DAQ settings, timestamps
- Use ISO 8601 timestamps for `capture_date`
- Add a `writeMetadataJson` utility function in main process code

## Impact

- Affected specs: scanning
- Affected code: `src/main/scanner-process.ts` (write metadata before scan command), `src/utils/` or `src/main/` (new utility function)
- No database schema changes required
- No breaking changes to existing behavior
