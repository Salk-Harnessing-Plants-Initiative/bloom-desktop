## 1. Tests

- [x] 1.1 Write unit test: `writeMetadataJson` creates valid JSON file with all required fields
- [x] 1.2 Write unit test: `writeMetadataJson` uses atomic write (writes to `.tmp`, renames to final)
- [x] 1.3 Write unit test: `writeMetadataJson` creates parent directories if they do not exist
- [x] 1.4 Write unit test: `writeMetadataJson` uses ISO 8601 timestamp for `capture_date`
- [x] 1.5 Write unit test: `writeMetadataJson` includes camera settings (exposure_time, gain, brightness, contrast, gamma)
- [x] 1.6 Write unit test: `writeMetadataJson` includes DAQ settings (seconds_per_rot)
- [x] 1.7 Write unit test: `writeMetadataJson` includes scan parameters (num_frames, scan_path)
- [x] 1.8 Write unit test: `writeMetadataJson` output is readable and round-trips through JSON.parse
- [x] 1.9 Write unit test: atomic write does not leave `.tmp` file on success
- [x] 1.10 Write unit test: `buildMetadataObject` returns correct structure from ScannerSettings
- [x] 1.11 Write integration test: metadata.json is written BEFORE scan command is sent to Python process

## 2. Implementation

- [x] 2.1 Create `writeMetadataJson(outputPath, metadata)` utility function with atomic write pattern
- [x] 2.2 Create `buildMetadataObject(settings)` function to assemble metadata from ScannerSettings
- [x] 2.3 Call `writeMetadataJson` in `ScannerProcess.scan()` BEFORE sending scan command to Python
- [x] 2.4 Ensure scan directory is created before writing metadata.json (mkdir -p equivalent)
- [x] 2.5 Handle write errors gracefully (log warning, do not abort scan)
