## Why

The Accessions page currently shows only the count of plant mappings (e.g., "20 plant mappings") when an accession is expanded, but users cannot view the actual mapping data (plant barcodes and genotype IDs). The pilot implementation (`bloom-desktop-pilot`) displays a full table of mappings in the expanded view, allowing users to:

1. Verify uploaded data is correct
2. See which plant barcodes map to which genotypes
3. Edit individual mapping entries inline

Without this feature, users must trust that uploads worked correctly with no way to inspect or verify the data.

## What Changes

- Add plant mappings table to the expanded accession view in `AccessionList.tsx`
- Display columns: Plant Barcode, Genotype ID (matching pilot's table structure)
- Reuse existing `getMappings` IPC handler (already implemented)
- Add inline editing capability for genotype ID field (matching pilot behavior)

**Not included in this PR** (blocked by Experiments page):
- Linked experiments list (requires Experiments management UI - not yet implemented)

## Impact

- Affected specs: ui-management-pages
- Affected code:
  - `src/renderer/components/AccessionList.tsx` (add mappings table)
  - `src/main/database-handlers.ts` (may need update handler for individual mappings)
  - `tests/e2e/accessions-management.e2e.ts` (add E2E tests for mappings display)
  - `tests/e2e/accession-excel-upload.e2e.ts` (add tests verifying mappings visible after upload)