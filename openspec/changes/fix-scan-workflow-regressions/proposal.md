## Why

The scan capture workflow has two broken features that affect usability and data integrity:

1. **Recent scans not persisting**: When navigating away from CaptureScan page and returning, recent scans are lost (in-memory only)
2. **Barcode validation too permissive**: Currently allows scanning with any barcode when experiment has no accession linked - pilot UI enforces strict validation

**Pilot Compatibility Gap**: The pilot implementation enforces that scanning is ONLY allowed when:

- The experiment has an accession file linked AND
- The plant barcode exists in that accession file's mappings

Our current implementation skips validation when no accession is linked, allowing any barcode.

## What Changes

### Recent Scans Persistence

- Add `db:scans:getRecent` IPC handler to fetch today's scans from database
- Add `useEffect` in CaptureScan to load recent scans on mount
- Display persisted scans alongside session scans

### Strict Barcode Validation (Pilot Parity)

- **Block scanning** when experiment has no accession linked (show clear error message)
- **Block scanning** when plant barcode is not found in accession mappings
- Update `canStartScan` validation to match pilot behavior
- Show user-friendly messages explaining why scan is disabled

### Seed Data Fix

- Add PlantAccessionMappings for each seeded accession
- Ensure seed plant barcodes (PLANT-001, PLANT-002) exist in mappings
- Add realistic accession names (genotype IDs) to mappings

### Documentation Updates

- Update `docs/PILOT_COMPATIBILITY.md` to document UI enforcement of accession requirements
- Update `docs/DATABASE.md` if needed for new IPC handler
- Ensure claude commands are up-to-date

## Impact

- Affected specs: `scanning`
- Affected code:
  - `src/main/database-handlers.ts` - New IPC handler for recent scans
  - `src/renderer/CaptureScan.tsx` - Load recent scans, update validation
  - `src/components/PlantBarcodeInput.tsx` - Update validation messaging
  - `src/components/MetadataForm.tsx` - Show accession requirement message
  - `prisma/seed.ts` - Add plant mappings to seed accessions
- Affected docs:
  - `docs/PILOT_COMPATIBILITY.md` - Document UI behavior requirements
  - `docs/DATABASE.md` - Document new IPC handlers (if needed)
