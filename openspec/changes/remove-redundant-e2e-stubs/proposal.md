# Remove Redundant E2E Test Stubs

## Why

The `accessions-management.e2e.ts` file contains 5 skipped test stubs that are redundant:

1. **Empty implementations** - All stubs contain only TODO comments with no actual test code
2. **Already covered** - The `accession-excel-upload.e2e.ts` file has 27 working tests that cover all these features
3. **Misleading metrics** - Skipped tests inflate "tests to fix" counts when the features are actually tested

### Stubs Removed (empty, redundant)

| Location | Stub Name | Already Covered By |
|----------|-----------|-------------------|
| Line 928 | `should upload valid Excel file` | `accession-excel-upload.e2e.ts:568` |
| Line 932 | `should reject file larger than 15MB` | `accession-excel-upload.e2e.ts:792` (also skipped - manual test) |
| Line 936 | `should allow sheet selection for multi-sheet files` | `accession-excel-upload.e2e.ts:285` |
| Line 940 | `should highlight selected columns` | `accession-excel-upload.e2e.ts:421,443` |
| Line 944 | `should process 500 rows in batches of 100` | `accession-excel-upload.e2e.ts:712` |

### Kept (has implementation)

| Location | Test Name | Reason |
|----------|-----------|--------|
| Line 352 | `should show loading state during creation` | Has real test code, skipped due to flakiness |

## What Changes

1. Remove the entire `test.describe.skip('Excel File Upload - Prerequisites Not Met')` block
2. Remove the outdated comment block above it

## Impact

- **Tests removed**: 5 empty stubs
- **Test coverage**: Unchanged (features already tested in `accession-excel-upload.e2e.ts`)
- **Skipped count**: Reduced from 7 to 2 (loading state test + 15MB file test remain skipped)
