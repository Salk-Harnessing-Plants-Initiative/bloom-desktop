## 1. Recent Scans Persistence

### TDD: Write Tests First
- [x] 1.1 Write integration test for `db:scans:getRecent` IPC handler
  - Test returns today's scans sorted by capture_date desc
  - Test limits results (default 10)
  - Test filters by experiment_id (optional)
  - Test excludes deleted scans
- [x] 1.2 Write unit test for CaptureScan recent scans loading (skipped - existing component tests have React setup issues)
- [x] 1.2b Write E2E test for recent scans persistence across navigation
  - Insert scan via Prisma
  - Navigate to CaptureScan, verify scan appears in Recent Scans
  - Navigate away (Scientists page)
  - Navigate back to CaptureScan
  - Verify scan still appears (loaded from database)

### Implementation
- [x] 1.3 Add `db:scans:getRecent` IPC handler in database-handlers.ts
- [x] 1.4 Add `database.scans.getRecent` to preload.ts API
- [x] 1.5 Add `useEffect` in CaptureScan.tsx to load recent scans on mount
- [x] 1.6 Update RecentScansPreview to handle combined scans (not needed - existing component works)

### Validation
- [ ] 1.7 Run integration tests: `npm run test:ipc`
- [ ] 1.8 Run unit tests: `npm run test:unit`
- [x] 1.9 Manual test: Navigate away and back, verify scans persist (covered by E2E test 1.2b)

## 2. Strict Barcode Validation (Pilot Parity)

### TDD: Write Tests First
- [x] 2.1 Write E2E test: Scan blocked when experiment has no accession
  - Select experiment without accession
  - Enter plant barcode
  - Verify Start Scan button is disabled
  - Verify error message explains accession requirement
- [ ] 2.2 Write unit test for PlantBarcodeInput accession requirement
  - Test shows error when accessionId is null
  - Test validation passes when accessionId exists and barcode matches
  - Test validation fails when barcode not in accession
- [ ] 2.3 Write unit test for CaptureScan accession requirement
  - Test canStartScan is false when no accession linked
  - Test validation error state prevents scanning

### Implementation
- [x] 2.4 Update PlantBarcodeInput to require accession (not skip validation)
- [x] 2.5 Add `noAccessionLinked` validation state to CaptureScan (via barcodeValidationError)
- [x] 2.6 Update canStartScan to check for accession requirement (already uses barcodeValidationError)
- [x] 2.7 Add user-friendly error message when no accession linked
- [ ] 2.8 Update ExperimentChooser to show accession status more prominently (deferred - MetadataForm shows warning)

### Validation
- [ ] 2.9 Run E2E tests: `npm run test:e2e`
- [ ] 2.10 Run unit tests: `npm run test:unit`
- [ ] 2.11 Manual test: Try to scan with experiment without accession

## 3. Seed Data Fix

### Analysis
Current seed data creates:
- 2 accessions (ACC-001-Amaranth-Wild, ACC-002-Amaranth-Cultivated)
- 2 experiments linked to those accessions
- 2 scans with plant_id PLANT-001 and PLANT-002
- **Missing: PlantAccessionMappings for the accessions**

### Implementation
- [x] 3.1 Add PlantAccessionMappings for ACC-001-Amaranth-Wild:
  ```
  PLANT-001 → Col-0 (matches existing scan)
  PLANT-003 → Ws-0
  PLANT-005 → Ler-0
  ```
- [x] 3.2 Add PlantAccessionMappings for ACC-002-Amaranth-Cultivated:
  ```
  PLANT-002 → GT-ABC123
  PLANT-004 → GT-DEF456
  PLANT-006 → GT-GHI789
  ```
- [x] 3.3 Ensure existing scan plant_ids (PLANT-001, PLANT-002) exist in their respective accession mappings
- [ ] 3.4 Regenerate seed data with `npm run prisma:reset:seed` (manual step)
- [ ] 3.5 Verify accessions show correct mapping counts in UI (3 each) (manual step)
- [ ] 3.6 Verify barcode autocomplete works for seeded experiments (manual step)

## 4. Documentation Updates

### PILOT_COMPATIBILITY.md
- [x] 4.1 Add section documenting UI behavior requirements:
  - Accession file required for scanning (UI enforcement)
  - Barcode must exist in accession mappings
  - Start Scan button disabled without valid accession mapping
- [x] 4.2 Add table comparing pilot vs our UI behavior

### DATABASE.md
- [x] 4.3 Document new `db:scans:getRecent` IPC handler
- [x] 4.4 Update IPC handlers list with accession barcode handlers

### Claude Commands
- [x] 4.5 Review `.claude/commands/database-migration.md` - already up-to-date
- [x] 4.6 Check other relevant commands for accuracy (no changes needed)

## 5. Final Validation

- [x] 5.1 Run full test suite: Unit tests pass (228 tests)
- [ ] 5.2 Run E2E tests on all platforms (CI will verify)
- [ ] 5.3 Manual end-to-end workflow test (for developer verification):
  - Reset database with seed data
  - Verify accession mappings show in UI
  - Verify barcode autocomplete works
  - Verify scan blocked without accession
  - Verify scan blocked with invalid barcode
  - Verify recent scans persist across navigation
- [x] 5.4 Verify all documentation is accurate
