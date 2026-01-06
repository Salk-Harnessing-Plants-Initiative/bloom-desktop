## Why

The current CaptureScan page accepts any arbitrary text for plant barcodes with no validation against the experiment's accession file. This allows data entry errors and prevents automatic genotype ID lookup. The bloom-desktop-pilot has these features, and we need feature parity.

## What Changes

- Add `PlantBarcodeInput` component with autocomplete dropdown showing matching barcodes from experiment's accession
- Validate plant barcodes against the experiment's accession mappings (hard validation - blocks scan)
- Auto-populate genotype ID (accession_id) when a valid plant barcode is selected
- Disable scan button when plant was already scanned today for the same experiment
- Add IPC handlers for fetching plant barcodes and checking most recent scan date
- Sanitize barcode input: allow `a-zA-Z0-9_-`, replace `+` and spaces with `_`

## Impact

- Affected specs: `ui-management-pages`
- Affected code:
  - `src/components/MetadataForm.tsx` - Replace text input with PlantBarcodeInput
  - `src/renderer/components/PlantBarcodeInput.tsx` - New component
  - `src/main/database-handlers.ts` - New IPC handlers
  - `src/main/preload.ts` - Expose new IPC methods
  - `src/types/electron.d.ts` - Type definitions
  - `tests/e2e/plant-barcode-validation.e2e.ts` - E2E tests
