## Context

The pilot writes `metadata.json` to the scan directory before image capture. bloom-desktop needs the same behavior for data portability, FAIR compliance, and compatibility with downstream tools.

## Goals / Non-Goals

- Goals:
  - Write metadata.json matching pilot format before image capture
  - Atomic write to prevent partial/corrupt files
  - Graceful degradation if write fails (don't block scanning)
- Non-Goals:
  - Changing the database schema
  - Reading metadata.json back (that's a future concern)
  - Changing the scan directory structure (handled by #100)

## Decisions

### Metadata format — match pilot exactly

The pilot's `ScanMetadata` type (`custom.types.ts:10-28`) and `captureMetadata()` (`scanner.ts:202-214`) produce this JSON:

```json
{
  "id": "uuid-v4",
  "phenotyper_id": "uuid",
  "experiment_id": "uuid",
  "wave_number": 1,
  "plant_age_days": 14,
  "scanner_name": "PBIOBScanner",
  "plant_id": "PLANT-001",
  "accession_name": "Col-0",
  "path": "2026-03-04/PLANT-001/scan-uuid",
  "capture_date": "2026-03-04T12:00:00.000Z",
  "num_frames": 72,
  "exposure_time": 10000,
  "gain": 100,
  "brightness": 0,
  "contrast": 1,
  "gamma": 1,
  "seconds_per_rot": 7
}
```

Notes:
- Pilot uses `accession_id` but bloom-desktop uses `accession_name` — use `accession_name` to match bloom-desktop's Prisma schema field name
- `path` stores the relative scan path (relative to `scans_dir`)
- `capture_date` is ISO 8601 string from `new Date().toISOString()`
- Camera settings are spread directly into the metadata object (not nested)

### Atomic write strategy

```typescript
// Write to temp file, then rename (atomic on most filesystems)
const tempPath = path.join(outputDir, 'metadata.json.tmp');
const finalPath = path.join(outputDir, 'metadata.json');
fs.writeFileSync(tempPath, JSON.stringify(metadata, null, 2));
fs.renameSync(tempPath, finalPath);
```

This prevents partial files if the process crashes during write. The pilot uses `fs.writeFile` (async callback, non-atomic) at `scanner.ts:287` — we improve on this.

### Hook point in scanner-process.ts

Insert metadata write in `scan()` method at `scanner-process.ts:97` (after progress reset, before Python command):

```typescript
async scan(): Promise<ScanResult> {
  this.progressEvents = [];

  // >>> NEW: Write metadata.json before capture begins
  if (this.currentSettings?.metadata && this.currentSettings?.output_path) {
    await this.writeMetadataJson(this.currentSettings);
  }

  const result = await this.pythonProcess.sendCommand({
    command: 'scanner',
    action: 'scan',
  });
  // ... rest unchanged
}
```

### Fields and their sources

| Field | Source in bloom-desktop | Pilot equivalent |
|-------|----------------------|------------------|
| `id` | Pre-generated UUID or `newScan.id` | `this.scanId` (scanner.ts:47) |
| `phenotyper_id` | `settings.metadata.phenotyper_id` | `this.phenotyperId` |
| `experiment_id` | `settings.metadata.experiment_id` | `this.experimentId` |
| `scanner_name` | `settings.metadata.scanner_name` | `this.scanner_name` |
| `plant_id` | `settings.metadata.plant_id` | `this.plantId` |
| `accession_name` | `settings.metadata.accession_name` | `this.accessionId` |
| `path` | `settings.output_path` (relative portion) | `this.scanPartialPath` |
| `capture_date` | `new Date().toISOString()` | `this.captureDate.toISOString()` |
| `wave_number` | `settings.metadata.wave_number` | `this.waveNumber` |
| `plant_age_days` | `settings.metadata.plant_age_days` | `this.plantAgeDays` |
| `num_frames` | `settings.num_frames` or `settings.camera.num_frames` | `this.cameraSettings.num_frames` |
| `exposure_time` | `settings.camera.exposure_time` | `this.cameraSettings.exposure_time` |
| `gain` | `settings.camera.gain` | `this.cameraSettings.gain` |
| `brightness` | `settings.camera.brightness` | `this.cameraSettings.brightness` |
| `contrast` | `settings.camera.contrast` | `this.cameraSettings.contrast` |
| `gamma` | `settings.camera.gamma` | `this.cameraSettings.gamma` |
| `seconds_per_rot` | `settings.daq.seconds_per_rot` | `this.cameraSettings.seconds_per_rot` |

### `output_path` availability

Currently `output_path` is optional in `ScannerSettings` and the Python backend returns `scanResult.output_path` after capture. For metadata.json, we need the path BEFORE capture. The `output_path` must be set during `initialize()` — check that `CaptureScan.tsx` passes it. If not, we can use the `scanResult.output_path` from the settings or compute it in the same way.

Looking at the flow: `CaptureScan.tsx` builds the path and passes it via `scanner.initialize({ ..., output_path })`. So `this.currentSettings.output_path` is available in `scan()`.

## Risks / Trade-offs

- **metadata.json write fails**: Graceful degradation — log error, continue with scan. Images are more important than metadata file.
- **Disk full**: Same graceful handling. The Python capture will likely also fail, but that's handled separately.
- **Atomic rename not atomic on all filesystems**: On NFS or some network drives, rename may not be truly atomic. Acceptable risk for a desktop app writing to local disk.

## Open Questions

- Should `id` in metadata.json be the database `Scan.id` (generated after DB insert) or a pre-generated UUID? The pilot pre-generates it (`scanner.ts:47`). Since we write metadata BEFORE the DB insert, we'd need to pre-generate. This aligns with the pilot approach.
