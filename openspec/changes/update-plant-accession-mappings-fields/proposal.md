# Proposal: Update PlantAccessionMappings Field References

## Context

The `origin/dev` branch cleaned up the `PlantAccessionMappings` schema:
- **Removed** `accession_id` (redundant — FK is `accession_file_id`)
- **Renamed** `genotype_id` → `accession_name`

The migration already exists (`20260211195433_cleanup_accession_fields/migration.sql`).
Most code already uses the new field names, but two renderer files still reference `genotype_id`.

## Changes Required

### A. `src/renderer/hooks/usePlateAssignments.ts`
- **Line ~38**: Update comment from `"genotype_id"` to `"accession_name"`
- **Line ~128, ~1210**: Update comments referencing `"plant_barcode + genotype_id"` → `"accession_name"`
- **Lines ~136-138**: Change type `{ genotype_id: string | null }` → `{ accession_name: string | null }` and `m.genotype_id` → `m.accession_name`
- **Lines ~1218-1220**: Same destructuring/assignment fix

### B. `src/renderer/GraviScan.tsx`
- **Line ~1218-1220**: Change destructuring from `genotype_id` → `accession_name` and assignment `m.genotype_id` → `m.accession_name`

## Not Affected (already migrated)
- `src/main/graviscan-upload.ts` — already uses `accession_name`
- `src/main/scan-metadata-json.ts` — already uses `accession_name`
- `src/main/image-uploader.ts` — already uses `accession_name`
- `src/main/database-handlers.ts` — already uses `accession_name`
- `src/renderer/components/AccessionFileUpload.tsx` — already uses `accession_name`
- `src/renderer/components/AccessionList.tsx` — already uses `accession_name`
- `src/types/scanner.ts`, `src/types/electron.d.ts` — already use `accession_name`
- `ExperimentForm.tsx` — its `accession_id` refers to Experiment model FK, not PlantAccessionMappings

## Verification
- `npx tsc --noEmit` passes
- Plate assignments still load correctly with accession names
