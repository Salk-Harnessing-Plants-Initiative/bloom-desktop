# Proposal: Update Scan Directory Path Format

## Why

The scan output directory structure in bloom-desktop differs from the pilot, breaking data portability and compatibility with downstream tools. The pilot uses a date-first, UUID-identified format that is human-readable and chronologically browsable, while bloom-desktop uses an experiment-first format with millisecond timestamps.

- **Pilot format:** `<scans_dir>/YYYY-MM-DD/<plant_qr_code>/<scan_uuid>/`
- **Bloom format:** `<scans_dir>/<experiment_id>/<plant_qr_code>_<timestamp_ms>/`

Additionally, the pilot stores **relative** paths in `Scan.path` and `Image.path` (relative to `scans_dir`), while bloom-desktop stores **absolute** paths. Relative paths are more portable across machines and environments.

Related Issues: #100, #99 (metadata.json)

## What Changes

### Path generation (renderer)

- **`src/renderer/CaptureScan.tsx:397-401`** — Replace `sanitizePath([experimentId, plantQrCode_timestamp])` with new `buildScanPath()` that produces `YYYY-MM-DD/<plant_qr_code>/<scan_uuid>`
- **New `src/utils/scan-path.ts`** — `buildScanPath(plantQrCode, scanUuid)` returns relative path
- **New `src/utils/date-helpers.ts`** — `getLocalDateYYYYMMDD()` matching pilot's `getLocalDateInYYYYMMDD()` (pilot `scanner.ts:321-327`)

### UUID generation

- Generate `crypto.randomUUID()` in CaptureScan before calling `scanner.initialize()`, matching pilot's `uuidv4()` pattern (`scanner.ts:47`)
- The pilot uses a **separate** UUID for directory name, NOT the database `Scan.id`
- Pass the UUID as part of scanner metadata so it can be used for both directory name and stored alongside scan data

### Relative path storage (main process)

- **`src/main/scanner-process.ts:235`** — Currently stores `scanResult.output_path` (absolute) as `Scan.path`. Change to store the relative portion only.
- **`src/main/scanner-process.ts:202`** — Currently stores absolute `Image.path`. Change to store relative paths (e.g., `2026-03-04/PLANT-001/abc-uuid/001.png`), matching pilot (`scanner.ts:89`).

### Consumers that need scans_dir prepended

- **`src/renderer/ScanPreview.tsx:342`** — `pathToFileUrl(currentImage.path)` must prepend `scans_dir` to resolve the file
- **`src/main/image-uploader.ts:243`** — `scan.images.map(img => img.path)` must prepend `scans_dir` for bloom-fs upload
- **`src/components/RecentScansPreview.tsx:90-93`** — Displays `outputPath` as text (relative is actually better for display, no change needed)
- **`src/renderer/CaptureScan.tsx:169`** — Maps `scan.path` to `outputPath` for display (no change needed)

## Impact

- **Affected specs**: `scanning`
- **Affected code**:
  - `src/renderer/CaptureScan.tsx` — path generation (lines 397-401)
  - `src/main/scanner-process.ts` — path storage (lines 202, 235)
  - `src/renderer/ScanPreview.tsx` — image display (line 342)
  - `src/main/image-uploader.ts` — upload paths (line 243)
  - `src/utils/path-sanitizer.ts` — reused as-is
  - New: `src/utils/scan-path.ts`, `src/utils/date-helpers.ts`
- **Related Issues**: #100, #99
- **Migration**: None required — no production scans exist yet in bloom-desktop
- **Dependencies**: None — `@salk-hpi/bloom-fs` upload uses flat Supabase paths independent of local directory structure
- **Pilot References**: `bloom-desktop-pilot/app/src/main/scanner.ts` (lines 41-58 path gen, 89 image path, 211 relative storage, 321-327 date helper)
