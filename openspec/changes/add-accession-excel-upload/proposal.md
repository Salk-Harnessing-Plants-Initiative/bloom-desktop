## Why

Users need to bulk-import plant-to-genotype mappings from Excel files instead of manually creating mappings one at a time. The pilot app has this feature and it's essential for lab workflows where researchers have spreadsheets with hundreds or thousands of plant barcodes mapped to genotype IDs.

## What Changes

- Implement drag-and-drop Excel file upload in AccessionFileUpload component
- Add Excel parsing with xlsx library (sheet selection, column extraction)
- Add column mapping UI (select Plant ID and Genotype ID columns)
- Add visual column highlighting (green for Plant ID, blue for Genotype ID)
- Add preview table showing first 20 rows
- Implement batch processing (100 rows at a time) with progress indicator
- File size validation (max 15MB)

## Impact

- Affected specs: ui-management-pages
- Affected code:
  - `src/renderer/components/AccessionFileUpload.tsx` (main implementation)
  - `src/renderer/Accessions.tsx` (integration)
  - `package.json` (add xlsx and react-drag-drop-files dependencies)
- New dependencies: `xlsx`, `react-drag-drop-files`