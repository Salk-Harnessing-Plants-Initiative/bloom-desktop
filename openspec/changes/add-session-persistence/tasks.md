## TDD Workflow

Each phase follows the TDD cycle:
1. **Red**: Write/update tests that define expected behavior
2. **Green**: Implement minimal code to pass tests
3. **Refactor**: Clean up while keeping tests green
4. **Verify**: Run full CI (`npm run type-check && npm run lint && npm run test`)
5. **Commit**: Small, atomic commit with passing CI

---

## Phase 1: Schema Migration + Test Data

**Goal**: Update database schema and test fixtures. CI should pass after this phase.

### 1.1 Update Test Fixtures (Red)
- [ ] Update `tests/fixtures/experiments.ts`: change `genotype_id` → `accession_name`
- [ ] Update `tests/integration/database.test.ts`: change test data and assertions
- [ ] Update `prisma/seed.ts`: change seed data field names
- [ ] Run tests → expect failures (schema mismatch)

### 1.2 Schema Migration (Green)
- [ ] Update `prisma/schema.prisma`:
  - Remove `accession_id` from PlantAccessionMappings
  - Rename `genotype_id` → `accession_name` in PlantAccessionMappings
  - Rename `accession_id` → `accession_name` in Scan
- [ ] Create migration: `npx prisma migrate dev --name cleanup_accession_fields`
- [ ] Run `npx prisma generate`

### 1.3 Verify & Commit
- [ ] Run `npm run type-check` → expect failures in implementation files (expected)
- [ ] Run `npm run test:integration` → should pass with updated fixtures
- [ ] Commit: `chore(schema): rename genotype_id to accession_name, remove redundant accession_id`

---

## Phase 2: Type Definitions

**Goal**: Update TypeScript types to match new schema. Type-check will fail until implementation catches up.

### 2.1 Update Types
- [ ] Update `src/types/electron.d.ts`:
  - Change `createWithMappings` parameter: `genotype_id` → `accession_name`
  - Change `getMappings` return type: `genotype_id` → `accession_name`
  - Change `updateMapping` parameter: `genotype_id` → `accession_name`
  - Rename `getGenotypeByBarcode` → `getAccessionNameByBarcode`
  - Add `SessionAPI` interface for session persistence
- [ ] Update `src/types/scanner.ts`: rename `accession_id` → `accession_name` in ScanMetadata

### 2.2 Verify
- [ ] Run `npm run type-check` → expect failures in implementation files
- [ ] Document which files need updating (should match proposal)

---

## Phase 3: Backend Handlers (TDD)

**Goal**: Update backend to match new types. Each handler updated with its tests.

### 3.1 database-handlers.ts
- [ ] Update test assertions in `tests/integration/database.test.ts` for handler changes
- [ ] Update `src/main/database-handlers.ts`:
  - `db:accessions:createWithMappings`: remove `accession_id`, change `genotype_id` → `accession_name`
  - `db:accessions:updateMapping`: change field name
  - `db:accessions:getGenotypeByBarcode` → `db:accessions:getAccessionNameByBarcode`
- [ ] Run `npm run test:integration` → should pass

### 3.2 scanner-process.ts
- [ ] Update `src/main/scanner-process.ts`: change `accession_id` → `accession_name`

### 3.3 preload.ts
- [ ] Update `src/main/preload.ts`:
  - Update `createWithMappings` parameter
  - Update `updateMapping` parameter
  - Rename `getGenotypeByBarcode` → `getAccessionNameByBarcode`

### 3.4 Verify & Commit
- [ ] Run `npm run type-check` → should pass for backend files
- [ ] Run `npm run test:integration` → should pass
- [ ] Commit: `refactor(backend): update handlers for accession_name rename`

---

## Phase 4: Session Store Module (TDD - New Feature)

**Goal**: Add session persistence with tests first.

### 4.1 Write Tests First (Red)
- [ ] Create `tests/unit/session-store.test.ts`:
  - Test get/set for each field (phenotyperId, experimentId, waveNumber, plantAgeDays, accessionName)
  - Test null initial state
  - Test value persistence in memory
  - Test reset functionality
- [ ] Run `npm run test:unit` → tests fail (module doesn't exist)

### 4.2 Implement Session Store (Green)
- [ ] Create `src/main/session-store.ts`:
  - In-memory storage for all session fields
  - Getter/setter functions for each field
  - Reset function

### 4.3 Add IPC Handlers
- [ ] Add session IPC handlers to `src/main/main.ts`:
  - `session:get-phenotyper-id` / `session:set-phenotyper-id`
  - `session:get-experiment-id` / `session:set-experiment-id`
  - `session:get-wave-number` / `session:set-wave-number`
  - `session:get-plant-age-days` / `session:set-plant-age-days`
  - `session:get-accession-name` / `session:set-accession-name`
- [ ] Add session API to `src/main/preload.ts`
- [ ] Update `src/types/electron.d.ts` with SessionAPI (if not done in Phase 2)

### 4.4 Verify & Commit
- [ ] Run `npm run test:unit` → session store tests pass
- [ ] Run `npm run type-check` → should pass
- [ ] Commit: `feat(session): add in-memory session store for metadata persistence`

---

## Phase 5: Component Updates (TDD - Leaf First)

**Goal**: Update components with their tests. Work from leaf components up to CaptureScan.

### 5.1 PlantBarcodeInput (Leaf)
- [ ] Update `tests/unit/components/PlantBarcodeInput.test.tsx` (if exists):
  - Rename callback assertions: `onGenotypeIdFound` → `onAccessionNameFound`
- [ ] Update `src/components/PlantBarcodeInput.tsx`:
  - Rename callback: `onGenotypeIdFound` → `onAccessionNameFound`
  - Update IPC call: `getGenotypeByBarcode` → `getAccessionNameByBarcode`
- [ ] Run `npm run test:unit` → should pass
- [ ] Commit: `refactor(PlantBarcodeInput): rename genotype callback to accession`

### 5.2 AccessionFileUpload
- [ ] Update `tests/unit/components/AccessionFileUpload.test.tsx`:
  - Change mock data: `genotype_id` → `accession_name`
  - Update assertions for new field names
- [ ] Update `src/renderer/components/AccessionFileUpload.tsx`:
  - Rename state: `selectedGenotypeId` → `selectedAccessionName`
  - Update UI label: "Genotype ID Column" → "Accession Column"
  - Update mappings type: `genotype_id` → `accession_name`
- [ ] Run `npm run test:unit` → should pass
- [ ] Commit: `refactor(AccessionFileUpload): rename genotype to accession`

### 5.3 AccessionList
- [ ] Update/create `tests/unit/components/AccessionList.test.tsx`:
  - Update mapping type assertions
  - Update table header assertions
- [ ] Update `src/renderer/components/AccessionList.tsx`:
  - Update mapping type: `genotype_id` → `accession_name`
  - Rename state: `editingGenotypeId` → `editingAccessionName`
  - Update table header: "Genotype ID" → "Accession"
- [ ] Run `npm run test:unit` → should pass
- [ ] Commit: `refactor(AccessionList): rename genotype to accession`

### 5.4 MetadataForm
- [ ] Update `tests/unit/components/MetadataForm.test.tsx` (if exists):
  - Update callback assertions
  - Update label assertions
- [ ] Update `src/components/MetadataForm.tsx`:
  - Rename callback: `onGenotypeIdFound` → `onAccessionNameFound`
  - Update form label: "Genotype ID" → "Accession"
- [ ] Run `npm run test:unit` → should pass
- [ ] Commit: `refactor(MetadataForm): rename genotype to accession`

### 5.5 CaptureScan (Integration Point)
- [ ] Update `src/renderer/CaptureScan.tsx`:
  - Update metadata state: `accessionId` → `accessionName`
  - Add session persistence on mount (load from SessionStore)
  - Add session persistence on change (save to SessionStore)
  - Add recent scans loading on mount
  - Filter recent scans by today's date
- [ ] Run `npm run type-check` → should pass
- [ ] Commit: `feat(CaptureScan): add session persistence and recent scans loading`

---

## Phase 6: E2E Tests

**Goal**: Add E2E tests for new functionality and verify existing tests pass.

### 6.1 Update Existing E2E Tests
- [ ] Update `tests/e2e/accessions-management.e2e.ts`:
  - Update selectors for renamed UI elements ("Accession" instead of "Genotype ID")
  - Verify accession column selection works
- [ ] Run `npm run test:e2e` → existing tests should pass

### 6.2 Add Session Persistence E2E Test
- [ ] Add test to `tests/e2e/capture-scan.e2e.ts` (or create new file):
  - Navigate to CaptureScan, fill metadata (phenotyper, experiment, wave, age)
  - Navigate to another page
  - Return to CaptureScan
  - Verify metadata fields are restored
- [ ] Run `npm run test:e2e` → new test should pass
- [ ] Commit: `test(e2e): add session persistence test`

### 6.3 Add Recent Scans E2E Test
- [ ] Add test for recent scans loading:
  - Seed database with scans from today and yesterday
  - Navigate to CaptureScan
  - Verify only today's scans appear in list
- [ ] Run `npm run test:e2e` → should pass
- [ ] Commit: `test(e2e): add recent scans loading test`

---

## Phase 7: Final Verification

**Goal**: Full CI/CD pass and manual verification.

### 7.1 Full CI Suite
- [ ] Run `npm run type-check` → all types pass
- [ ] Run `npm run lint` → no lint errors
- [ ] Run `npm run test:unit` → all unit tests pass
- [ ] Run `npm run test:integration` → all integration tests pass
- [ ] Run `npm run test:e2e` → all E2E tests pass

### 7.2 Manual Testing
- [ ] Upload accession Excel file, verify "Accession" column selector works
- [ ] Enter plant barcode, verify accession auto-populates
- [ ] Navigate away from CaptureScan and return, confirm metadata is restored
- [ ] Verify plantQrCode is NOT restored (should be empty)
- [ ] Close and reopen app, verify session state is reset
- [ ] Capture scan, verify accession_name is stored correctly in database

### 7.3 Final Commit & PR
- [ ] Squash/rebase if needed for clean history
- [ ] Create PR with summary of all changes
- [ ] Link to Issues #83, #85, #88
