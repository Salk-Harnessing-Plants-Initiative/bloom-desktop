## 1. renderer-database-ipc.e2e.ts (61 tests)

- [x] 1.1 Convert beforeEach/afterEach to beforeAll/afterAll with single app launch
- [x] 1.2 Group tests into serial phases: Scientists → Phenotypers → Accessions → Experiments → Scans → Context Isolation → Session
- [x] 1.3 Order destructive tests (delete) last within each entity phase
- [x] 1.4 Add cleanAllTables() between pagination tests to reset state
- [x] 1.5 Verify all 61 test names match base branch (diff test names before/after, 0 differences)
- [x] 1.6 Run locally: `npx playwright test tests/e2e/renderer-database-ipc.e2e.ts` — all 61 pass
- [x] 1.7 Measure before/after timing: **3.1 min → 4.4s (42x faster)**

## 2. scan-preview.e2e.ts (27 tests)

- [ ] 2.1 Convert beforeEach/afterEach to beforeAll/afterAll with single app launch
- [ ] 2.2 Seed all scan data once in beforeAll using createTestScan helper
- [ ] 2.3 Group tests into serial phases: Navigation → Metadata → Image Viewer → Keyboard Nav → Zoom → Upload → Batch → Image Loading
- [ ] 2.4 Move "deleted scan" test to end of Navigation phase
- [ ] 2.5 Verify all 27 test names match base branch (diff test names before/after, 0 differences)
- [ ] 2.6 Run locally: `npx playwright test tests/e2e/scan-preview.e2e.ts` — all 27 pass
- [ ] 2.7 Measure before/after timing and record in timings table

## 3. accession-excel-upload.e2e.ts (27 tests)

- [ ] 3.1 Convert beforeEach/afterEach to beforeAll/afterAll with single app launch
- [ ] 3.2 Order: read-only UI checks → file handling → column mapping → highlighting → preview → uploads → batch → errors → real-world
- [ ] 3.3 Add page reload between upload tests to reset form state
- [ ] 3.4 Verify all 27 test names match base branch (diff test names before/after, 0 differences)
- [ ] 3.5 Run locally: `npx playwright test tests/e2e/accession-excel-upload.e2e.ts` — all 27 pass
- [ ] 3.6 Measure before/after timing and record in timings table

## 4. plant-barcode-validation.e2e.ts (24 tests)

- [ ] 4.1 Convert beforeEach/afterEach to beforeAll/afterAll with single app launch
- [ ] 4.2 Group IPC tests first (read-only, no navigation needed), then UI tests
- [ ] 4.3 Seed base data in beforeAll; seed test-specific data via Prisma before each phase
- [ ] 4.4 Verify all 24 test names match base branch (diff test names before/after, 0 differences)
- [ ] 4.5 Run locally: `npx playwright test tests/e2e/plant-barcode-validation.e2e.ts` — all 24 pass
- [ ] 4.6 Measure before/after timing and record in timings table

## 5. Final Validation

- [ ] 5.1 Run all 4 refactored files together and confirm all 139 tests pass:
      `npx playwright test renderer-database-ipc scan-preview accession-excel-upload plant-barcode-validation`
- [ ] 5.2 Run full E2E suite (all 15 files) and confirm 0 regressions:
      `npx playwright test`
- [ ] 5.3 Diff every test name against base branch for all 4 files — 0 differences:
      ```
      for f in renderer-database-ipc scan-preview accession-excel-upload plant-barcode-validation; do
        diff <(git show origin/graviscan/7-renderer-ui:tests/e2e/${f}.e2e.ts | sed -n "s/.*test('\(.*\)', async.*/\1/p" | sort) \
             <(sed -n "s/.*test('\(.*\)', async.*/\1/p" tests/e2e/${f}.e2e.ts | sort)
      done
      ```
- [ ] 5.4 Verify test counts match base branch:
      | File | Expected |
      |------|----------|
      | renderer-database-ipc.e2e.ts | 61 |
      | scan-preview.e2e.ts | 27 |
      | accession-excel-upload.e2e.ts | 27 |
      | plant-barcode-validation.e2e.ts | 24 |
- [ ] 5.5 Compile final timings table for PR description:
      | File | Tests | Before | After | Speedup |
      |------|-------|--------|-------|---------|
      | renderer-database-ipc | 61 | 3.1 min | 4.4s | 42x |
      | scan-preview | 27 | ? | ? | ? |
      | accession-excel-upload | 27 | ? | ? | ? |
      | plant-barcode-validation | 24 | ? | ? | ? |
