## Why

Today, `Experiment.accession_id` references a single `Accessions` (the metadata file). When a metadata file linked to an experiment is deleted, the FK is silently set to NULL — the experiment loses metadata with no warning. This is fine for CylinderScan (one accession per experiment) but inadequate for GraviScan, where each wave has its own plate layout and needs its own metadata file.

We need:
1. Per-wave metadata for GraviScan (multiple metadata files per experiment, one per wave)
2. Deletion protection — block deleting a metadata file that's still linked to any experiment (cylinder OR graviscan)
3. Explicit unlink action before delete

## How metadata is stored (unchanged)

`Accessions` (and its child rows `GraviPlateAccession` + `GraviPlateSectionMapping`) remain the metadata file storage for both scanner modes. We are NOT replacing or duplicating the metadata content — we're only changing how an experiment links to it.

```
Accessions                          ← metadata file (id, name, createdAt)
   ├─→ GraviPlateAccession           ← rows (plate_id, accession, transplant_date, custom_note)
   │     └─→ GraviPlateSectionMapping ← rows (section_id, plant_qr, medium)
   │
   ├─ existing link (CylinderScan):
   │     Experiment.accession_id  →  Accessions.id     (one-to-one)
   │
   └─ new link (GraviScan):
         GraviExperimentWaveMetadata.accession_id  →  Accessions.id   (one-to-many per wave)
```

Uploading a metadata CSV continues to populate `Accessions` + `GraviPlateAccession` + `GraviPlateSectionMapping`. The only thing that's new is the link table.

## What Changes

### CylinderScan: unchanged

`Experiment.accession_id` stays. CylinderScan still has one metadata file per experiment, linked the same way it does today.

### GraviScan: new wave-scoped link table

- New table `GraviExperimentWaveMetadata(experiment_id, wave_number, accession_id)` with `@@unique([experiment_id, wave_number])`
- Used ONLY by GraviScan experiments (`experiment_type = 'graviscan'`)
- `accession_id` still references the existing `Accessions` table — same metadata, just a different link
- Existing GraviScan experiments with `Experiment.accession_id` set: migrated to a `GraviExperimentWaveMetadata` row with `wave_number=1`, then `accession_id` cleared on the experiment row

### Delete protection (both flows)

`db:graviPlateAccessions:delete` and `db:accessions:delete` handlers check ALL references before allowing delete:
- `Experiment.accession_id = ?` (cylinderscan)
- `GraviExperimentWaveMetadata.accession_id = ?` (graviscan)

If any reference exists → return error with the count of linked experiments.

### New handlers

- `db:experiment:linkGraviMetadata(experiment_id, wave_number, accession_id)` — upserts wave→metadata
- `db:experiment:unlinkGraviMetadata(experiment_id, wave_number)` — removes the row
- `db:experiment:listGraviMetadata(experiment_id)` — returns wave→metadata rows for an experiment

### UI

- Experiment detail page: GraviScan experiments show per-wave linked metadata + Unlink button. CylinderScan experiments unchanged.
- GraviScan metadata upload: wave_number numeric input (default 1) before upload submits
- Metadata page: when delete fails, show error toast with linked experiment count

### Implementation constraints

- **No schema change for CylinderScan.** `Experiment.accession_id` stays.
- **GraviExperimentWaveMetadata is GraviScan-only.** Cylinder experiments do not write to it.
- **Both fields checked on delete.** Single query that does an OR — no fallback path.
- **Hardcoded `wave_number = 1` for migration.** No env var.
- **Single try/catch at IPC boundary** in delete handler.
- **Log prefix:** `[DB:Metadata]`.
- **No backwards compat shim.** Drop GraviScan's reliance on `Experiment.accession_id` cleanly — read only from `GraviExperimentWaveMetadata`.

## Impact

- Affected specs: `scanning` (metadata model), `ui-management-pages` (GraviScan experiment detail UI)
- Affected code:
  - `prisma/schema.prisma` — add `GraviExperimentWaveMetadata` model. `Experiment.accession_id` unchanged.
  - `prisma/migrations/<new>` — create table, migrate GraviScan experiments' `accession_id` into new table with `wave_number=1`, NULL out their `accession_id`
  - `src/main/database-handlers.ts` — new linkGraviMetadata/unlinkGraviMetadata/listGraviMetadata handlers; delete handlers gain reference check
  - `src/types/electron.d.ts` + `src/main/preload.ts` — new IPC methods
  - `src/types/database.ts` — add `WaveMetadataLink` interface
  - `src/renderer/ExperimentDetail.tsx` — render per-wave metadata for GraviScan experiments only
  - `src/renderer/components/GraviMetadataUpload.tsx` — wave_number input + call linkGraviMetadata after upload
  - `src/renderer/Metadata.tsx` — toast on delete error
- **Not affected**: CylinderScan upload, CylinderScan experiment form, CylinderScan-side accession behavior
