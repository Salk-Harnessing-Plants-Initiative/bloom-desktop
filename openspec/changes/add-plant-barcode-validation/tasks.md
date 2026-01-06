## 1. E2E Tests (TDD - Write Tests First)

- [x] 1.1 Create `tests/e2e/plant-barcode-validation.e2e.ts` with failing tests
- [x] 1.2 Test: Invalid barcode shows validation error and blocks scan
- [x] 1.3 Test: Valid barcode auto-populates genotype ID
- [x] 1.4 Test: Autocomplete dropdown shows matching barcodes
- [x] 1.5 Test: Duplicate scan (same plant, same experiment, same day) disables scan button
- [x] 1.6 Test: Barcode sanitization (+ and spaces replaced with \_)

## 2. IPC Handlers

- [x] 2.1 Add `db:accessions:getPlantBarcodes` handler - returns all plant barcodes for an accession
- [x] 2.2 Add `db:accessions:getGenotypeByBarcode` handler - returns genotype_id for plant barcode + experiment
- [x] 2.3 Add `db:scans:getMostRecentScanDate` handler - returns most recent scan date for plant + experiment
- [x] 2.4 Update preload.ts to expose new IPC methods
- [x] 2.5 Update electron.d.ts with type definitions
- [x] 2.6 Write IPC E2E tests in `renderer-database-ipc.e2e.ts`

## 3. PlantBarcodeInput Component

- [x] 3.1 Create `src/components/PlantBarcodeInput.tsx`
- [x] 3.2 Implement text input with barcode sanitization
- [x] 3.3 Implement autocomplete dropdown (top 5 matches)
- [x] 3.4 Implement keyboard navigation (arrow keys, enter to select, escape to close)
- [x] 3.5 Implement validation error display for invalid barcodes
- [x] 3.6 Implement `onGenotypeIdFound` callback for auto-population

## 4. MetadataForm Integration

- [x] 4.1 Replace plant barcode text input with PlantBarcodeInput component
- [x] 4.2 Wire up genotype ID auto-population
- [x] 4.3 Add duplicate scan check on plant barcode change
- [x] 4.4 Show warning when plant already scanned today
- [x] 4.5 Disable scan button when duplicate detected

## 5. Validation & Cleanup

- [x] 5.1 Run all E2E tests and verify passing
- [x] 5.2 Run linting and fix issues
- [x] 5.3 Run TypeScript type check
- [x] 5.4 Update CHANGELOG.md
