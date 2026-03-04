# Proposal: Update Scan Directory Path Format

## Why

The scan output directory structure in bloom-desktop differs from the pilot, breaking data portability and compatibility with downstream tools. The pilot uses a date-first, UUID-identified format that is human-readable and chronologically browsable, while bloom-desktop uses an experiment-first format with millisecond timestamps.

- **Pilot format:** `<scans_dir>/YYYY-MM-DD/<plant_qr_code>/<scan_uuid>/`
- **Bloom format:** `<scans_dir>/<experiment_id>/<plant_qr_code>_<timestamp_ms>/`

Related Issues: #100, #99 (metadata.json)

## What Changes

- **Update path generation** in `CaptureScan.tsx` to produce pilot-compatible format: `YYYY-MM-DD/<plant_qr_code>/<scan_uuid>/`
- **Add date helper** function `getLocalDateYYYYMMDD()` matching pilot's `getLocalDateInYYYYMMDD()`
- **Use scan UUID** (from `uuidv4()`) as leaf directory name instead of `plantQrCode_timestamp`
- **Store relative path** in `Scan.path` (relative to `scans_dir`), matching pilot behavior
- **Preserve sanitization** — apply `sanitizePathComponent()` to `plant_qr_code` segment
- **Remove experiment_id from path** — experiment context will be stored in `metadata.json` (#99)

## Impact

- **Affected specs**: `scanning`
- **Affected code**: `src/renderer/CaptureScan.tsx` (path generation), `src/utils/path-sanitizer.ts` (reused as-is)
- **Related Issues**: #100, #99
- **Migration**: None required — no production scans exist yet in bloom-desktop
- **Dependencies**: None — `@salk-hpi/bloom-fs` upload uses flat Supabase paths (`cyl-images/cyl-image_<id>_<uuid>.png`) independent of local directory structure
- **Pilot References**: `bloom-desktop-pilot/app/src/main/scanner.ts` lines 41-58
