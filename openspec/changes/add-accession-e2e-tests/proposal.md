## Why

The accession Excel upload feature needs E2E test coverage using real-world data. The existing test fixtures use synthetic data, but testing with actual experiment data (ARV1 Media Pilot) ensures the upload workflow handles real column names, data patterns, and edge cases that users encounter in production.

## What Changes

- Add real-world Excel test fixture (`ARV1_Media_Pilot_Master_Data.xlsx`) to `tests/fixtures/excel/`
- Add E2E tests for the "add accession" Excel upload feature using real data with columns like `Barcode` (plant ID) and `Line` (genotype)
- Test column mapping with non-standard column names (Barcode instead of PlantBarcode, Line instead of GenotypeID)
- Verify the upload workflow handles real data patterns including empty cells and date formats

## Impact

- Affected specs: e2e-testing
- Affected code:
  - `tests/fixtures/excel/ARV1_Media_Pilot_Master_Data.xlsx` (new fixture file)
  - `tests/e2e/accession-excel-upload.e2e.ts` (add tests using real data fixture)
