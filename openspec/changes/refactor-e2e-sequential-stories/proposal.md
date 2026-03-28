## Why

E2E tests currently launch a fresh Electron app per test (`beforeEach`). With 139 tests across 4 large files, that's ~135 redundant app launches adding ~12 minutes to CI. Converting to `test.describe.serial` with `beforeAll` (single app instance per file) eliminates this overhead while preserving test isolation via Prisma seeding.

5 files (82 tests) were already refactored in PR #143. This proposal covers the remaining 4 large files.

## What Changes

### 1. `renderer-database-ipc.e2e.ts` (61 tests → 1 app launch)

**Current:** 61 app launches, each with fresh DB.

**Proposed:** Group into phases by entity. Each phase seeds data via Prisma, tests run sequentially. Destructive tests (delete) ordered last per entity.

```
beforeAll: launch app, create DB

Phase 1: Scientists (4 tests)
  1.  should list scientists from renderer (empty state)
  2.  should create scientist from renderer
  3.  should list scientists from renderer (with seeded data)
  4.  should handle error when creating scientist with missing email

Phase 2: Phenotypers (4 tests)
  5.  should list phenotypers from renderer (empty state)
  6.  should create phenotyper from renderer
  7.  should list phenotypers from renderer (with seeded data)
  8.  should handle error when creating phenotyper with missing email

Phase 3: Accessions (11 tests)
  9.  should list accessions from renderer (empty state)
  10. should create accession from renderer
  11. should list accessions from renderer (with seeded data)
  12. should handle error when creating accession with missing required field
  13. should update accession from renderer
  14. should create accession with mappings from renderer
  15. should get mappings for accession from renderer
  16. should get plant barcodes for accession from renderer
  17. should get accession name by barcode from renderer
  18. should return null when barcode not found in accession
  19. should delete accession from renderer

Phase 4: Experiments (10 tests)
  20. should list experiments with relations from renderer
  21. should get experiment by ID with relations from renderer
  22. should create experiment from renderer
  23. should update experiment from renderer
  24. should attach accession to experiment from renderer
  25. should handle error when updating experiment with invalid ID
  26. should handle error when deleting experiment with invalid ID
  27. should handle error when creating experiment with invalid foreign key
  28. should handle error when attaching accession with invalid experiment ID
  29. should delete experiment from renderer

Phase 5: Scans — Filters & Relations (10 tests)
  30. should list scans without filters from renderer
  31. should list scans with phenotyper filter from renderer
  32. should get scan by ID with all relations from renderer
  33. should get scan with images sorted by frame_number
  34. should return null for non-existent scan ID
  35. should create scan from renderer
  36. should handle error when creating scan with invalid experiment_id
  37. should get most recent scan date for plant and experiment from renderer
  38. should return null when no scans exist for plant and experiment

Phase 6: Scans — Pagination (8 tests)
  39. should return paginated results with page and pageSize
  40. should exclude soft-deleted scans (deleted: true)
  41. should filter by experimentId
  42. should filter by date range (dateFrom, dateTo)
  43. should filter same-day scans correctly (timezone handling)
  44. should include phenotyper and experiment relations
  45. should return total count for pagination
  46. should order by capture_date descending

Phase 7: Scans — Soft Delete (3 tests)
  47. should soft delete scan by setting deleted: true
  48. should NOT delete Image records when soft deleting scan
  49. should exclude deleted scans from paginated list results

Phase 8: Scans — Recent & Upload (5 tests)
  50. should get recent scans from today
  51. db:scans:upload should return error for non-existent scan
  52. db:scans:upload should return structured response
  53. db:scans:uploadBatch should return error for empty array
  54. db:scans:uploadBatch should return structured response

Phase 9: Context Isolation (3 tests — no DB needed)
  55. should not expose require() to renderer
  56. should not expose process object to renderer
  57. should only expose window.electron APIs

Phase 10: Session Zero Values (4 tests — session state only)
  58. should persist waveNumber = 0 correctly
  59. should persist plantAgeDays = 0 correctly
  60. should persist both waveNumber and plantAgeDays as 0 together
  61. should distinguish between 0 and null

afterAll: close app, cleanup
```

**Savings:** ~60 app launches → 1. Estimated ~5 minutes saved.
**Risk:** Medium — tests that delete records affect subsequent tests. Deletes ordered last per entity.

---

### 2. `scan-preview.e2e.ts` (27 tests → 1 app launch)

**Current:** 27 app launches, each seeds a scan via `createTestScan()` helper.

**Proposed:** Seed all scan data once, group by feature area.

```
beforeAll: launch app, seed scan data (multiple scans with varying images/metadata)

Phase 1: Navigation (5 tests)
  1.  should navigate to ScanPreview from BrowseScans Plant ID link
  2.  should navigate to ScanPreview from View button
  3.  should display scan Plant ID in header
  4.  should have back link to Browse Scans
  5.  should handle deleted scan gracefully when navigating back

Phase 2: Metadata Display (4 tests)
  6.  should display scan metadata
  7.  should display scientist attached to experiment
  8.  should display rotation speed
  9.  should display camera settings

Phase 3: Image Viewer (4 tests)
  10. should display first image by default
  11. should navigate to next frame with Next button
  12. should navigate to previous frame with Previous button
  13. should show "No images" message when scan has no images

Phase 4: Keyboard Navigation (4 tests)
  14. should go to next frame with Right Arrow key
  15. should go to previous frame with Left Arrow key
  16. should go to first frame with Home key
  17. should go to last frame with End key

Phase 5: Zoom Controls (3 tests)
  18. should have zoom in button
  19. should have zoom out button
  20. should have reset zoom button

Phase 6: Upload (3 tests)
  21. should display upload button in ScanPreview
  22. should display upload button in table row actions
  23. should show upload status in table

Phase 7: Batch Upload (3 tests)
  24. should display checkbox in each table row
  25. should show "Upload Selected" button when rows are selected
  26. should show selected count in "Upload Selected" button

Phase 8: Image Loading (1 test)
  27. should load images from local filesystem

afterAll: close app, cleanup
```

**Savings:** ~26 launches → 1. Estimated ~2-3 minutes saved.
**Risk:** Low — mostly read-only tests. Test 5 deletes a scan (run last in Phase 1).

---

### 3. `accession-excel-upload.e2e.ts` (27 tests → 1 app launch)

**Current:** 27 app launches, each navigates to Accessions page.

**Proposed:** Single app, tests ordered from read-only UI checks → file uploads → mutations.

```
beforeAll: launch app, navigate to Accessions

Phase 1: Upload Zone Display (2 tests — read-only)
  1.  should display upload zone on Accessions page
  2.  should show accepted file types hint

Phase 2: File Upload Basics (3 tests)
  3.  should accept Excel file via file input
  4.  should show loading indicator while parsing file
  5.  should reject non-Excel files

Phase 3: Sheet Selection (3 tests)
  6.  should show sheet selector for multi-sheet files
  7.  should not show sheet selector for single-sheet files
  8.  should update preview when sheet is changed

Phase 4: Column Mapping (3 tests)
  9.  should display column selector dropdowns
  10. should populate dropdowns with column headers
  11. should enable upload button only when both columns selected

Phase 5: Column Highlighting (3 tests)
  12. should highlight Plant ID column in green when selected
  13. should highlight Genotype column in blue when selected
  14. should show column labels in header when selected

Phase 6: Preview Table (3 tests)
  15. should display preview table with first 20 rows
  16. should limit preview to 20 rows for large files
  17. should handle empty cells gracefully

Phase 7: Upload Processing (4 tests — mutates DB)
  18. should upload mappings and create accession
  19. should show progress indicator during upload
  20. should refresh accession list after upload
  21. should reset form after successful upload

Phase 8: Batch Processing (1 test)
  22. should process large file in batches of 100

Phase 9: Error Handling & Validation (1 test)
  23. should handle upload errors gracefully

Phase 10: Real-World Data (4 tests)
  24. should upload real experiment Excel file with non-standard column names
  25. should display real data correctly in preview table
  26. should show accession in list after uploading real data
  27. should store correct plant-genotype mappings from real data

afterAll: close app, cleanup
```

**Savings:** ~26 launches → 1. Estimated ~2-3 minutes saved.
**Risk:** Medium — upload tests create DB records. Each upload test may need page reload to reset form state.

---

### 4. `plant-barcode-validation.e2e.ts` (24 tests → 1 app launch)

**Current:** 24 app launches, mixed IPC + UI tests.

**Proposed:** Group IPC tests first (just need DB), then UI tests with page navigation.

```
beforeAll: launch app, seed base data (scientist, phenotyper, accession, experiment)

Phase 1: IPC — getPlantBarcodes (3 tests — read-only)
  1.  should return plant barcodes for an accession
  2.  should return empty array for accession with no mappings
  3.  should handle invalid accession ID

Phase 2: IPC — getAccessionNameByBarcode (3 tests — read-only)
  4.  should return genotype ID for valid plant barcode and experiment
  5.  should return null for invalid plant barcode
  6.  should return null for experiment without accession

Phase 3: IPC — getMostRecentScanDate (3 tests — read-only)
  7.  should return most recent scan date for plant and experiment
  8.  should return null when no scans exist
  9.  should ignore deleted scans

Phase 4: UI — Barcode Validation (2 tests)
  10. should show validation error for invalid barcode
  11. should auto-populate genotype ID for valid barcode

Phase 5: UI — Duplicate Scan Prevention (1 test)
  12. should show warning when plant already scanned today

Phase 6: UI — Barcode Autocomplete (2 tests)
  13. should show autocomplete suggestions when typing
  14. should select suggestion and populate genotype ID

Phase 7: UI — Accession Requirement (3 tests)
  15. should disable Start Scan when experiment has no accession linked
  16. should show guidance message to link accession file
  17. should enable Start Scan when experiment has valid accession and barcode

Phase 8: UI — Barcode Sanitization (4 tests — no DB needed)
  18. should replace plus signs with underscores
  19. should replace spaces with underscores
  20. should preserve dashes
  21. should strip other special characters

Phase 9: UI — Recent Scans (2 tests)
  22. should persist recent scans across navigation
  23. should show only today scans in recent scans list

Phase 10: UI — Session Zero Values (1 test)
  24. should persist waveNumber = 0 across navigation

afterAll: close app, cleanup
```

**Savings:** ~23 launches → 1. Estimated ~2 minutes saved.
**Risk:** Low-medium — IPC tests are read-only. UI tests need Prisma seeding mid-flow + page reload.

## Impact

- Affected specs: `e2e-testing`
- Affected code: 4 E2E test files (no production code changes)
- **Not changed:** Test names, test assertions, test coverage — only the lifecycle (beforeEach → beforeAll)
- Total savings: ~135 app launches → 4, estimated ~12 minutes CI time

| File | Tests | Launches Saved | Time Saved |
|------|-------|---------------|-----------|
| renderer-database-ipc | 61 | 60 | ~5 min |
| scan-preview | 27 | 26 | ~2-3 min |
| accession-excel-upload | 27 | 26 | ~2-3 min |
| plant-barcode-validation | 24 | 23 | ~2 min |
| **Total** | **139** | **135** | **~12 min** |
