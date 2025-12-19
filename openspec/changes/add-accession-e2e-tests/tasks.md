## 1. Add Test Fixture

- [x] 1.1 Copy `ARV1_Media_Pilot_Master_Data.xlsx` to `tests/fixtures/excel/`

## 2. Add E2E Tests for Real Data Upload

- [x] 2.1 Add test: Upload real Excel file and map columns (Barcode → Plant ID, Line → Genotype)
- [x] 2.2 Add test: Verify preview table displays real data correctly
- [x] 2.3 Add test: Verify successful upload creates accession with 19 plant mappings
- [x] 2.4 Add test: Verify accession list shows the uploaded file name

## 3. Verify Tests Pass

- [ ] 3.1 Run `npm run test:e2e` and verify all tests pass
- [ ] 3.2 Verify tests pass in CI (Linux, macOS, Windows)
