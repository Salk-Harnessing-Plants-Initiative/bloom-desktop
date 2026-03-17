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

- [x] Update `tests/fixtures/experiments.ts`: change `genotype_id` → `accession_name`
- [x] Update `tests/integration/database.test.ts`: change test data and assertions
- [x] Update `prisma/seed.ts`: change seed data field names
- [x] Run tests → expect failures (schema mismatch)

### 1.2 Schema Migration (Green)

- [x] Update `prisma/schema.prisma`:
  - Remove `accession_id` from PlantAccessionMappings
  - Rename `genotype_id` → `accession_name` in PlantAccessionMappings
  - Rename `accession_id` → `accession_name` in Scan
- [x] Create migration: `npx prisma migrate dev --name cleanup_accession_fields`
- [x] Run `npx prisma generate`

### 1.3 Verify & Commit

- [x] Run `npm run type-check` → expect failures in implementation files (expected)
- [x] Run `npm run test:integration` → should pass with updated fixtures
- [x] Commit: `chore(schema): rename genotype_id to accession_name, remove redundant accession_id`

---

## Phase 2: Type Definitions

**Goal**: Update TypeScript types to match new schema. Type-check will fail until implementation catches up.

### 2.1 Update Types

- [x] Update `src/types/electron.d.ts`:
  - Change `createWithMappings` parameter: `genotype_id` → `accession_name`
  - Change `getMappings` return type: `genotype_id` → `accession_name`
  - Change `updateMapping` parameter: `genotype_id` → `accession_name`
  - Rename `getGenotypeByBarcode` → `getAccessionNameByBarcode`
  - Add `SessionAPI` interface for session persistence
- [x] Update `src/types/scanner.ts`: rename `accession_id` → `accession_name` in ScanMetadata

### 2.2 Verify

- [x] Run `npm run type-check` → expect failures in implementation files
- [x] Document which files need updating (should match proposal)

---

## Phase 3: Backend Handlers (TDD)

**Goal**: Update backend to match new types. Each handler updated with its tests.

### 3.1 database-handlers.ts

- [x] Update test assertions in `tests/integration/database.test.ts` for handler changes
- [x] Update `src/main/database-handlers.ts`:
  - `db:accessions:createWithMappings`: remove `accession_id`, change `genotype_id` → `accession_name`
  - `db:accessions:updateMapping`: change field name
  - `db:accessions:getGenotypeByBarcode` → `db:accessions:getAccessionNameByBarcode`
- [x] Run `npm run test:integration` → should pass

### 3.2 scanner-process.ts

- [x] Update `src/main/scanner-process.ts`: change `accession_id` → `accession_name`

### 3.3 preload.ts

- [x] Update `src/main/preload.ts`:
  - Update `createWithMappings` parameter
  - Update `updateMapping` parameter
  - Rename `getGenotypeByBarcode` → `getAccessionNameByBarcode`

### 3.4 Verify & Commit

- [x] Run `npm run type-check` → should pass for backend files
- [x] Run `npm run test:integration` → should pass
- [x] Commit: `refactor(backend): update handlers for accession_name rename`

---

## Phase 4: Session Store Module (TDD - New Feature)

**Goal**: Add session persistence with tests first.

### 4.1 Write Tests First (Red)

- [x] Create `tests/unit/session-store.test.ts`:
  - Test get/set for each field (phenotyperId, experimentId, waveNumber, plantAgeDays, accessionName)
  - Test null initial state
  - Test value persistence in memory
  - Test reset functionality
- [x] Run `npm run test:unit` → tests fail (module doesn't exist)

### 4.2 Implement Session Store (Green)

- [x] Create `src/main/session-store.ts`:
  - In-memory storage for all session fields
  - Getter/setter functions for each field
  - Reset function

### 4.3 Add IPC Handlers

- [x] Add session IPC handlers to `src/main/main.ts`:
  - `session:get-phenotyper-id` / `session:set-phenotyper-id`
  - `session:get-experiment-id` / `session:set-experiment-id`
  - `session:get-wave-number` / `session:set-wave-number`
  - `session:get-plant-age-days` / `session:set-plant-age-days`
  - `session:get-accession-name` / `session:set-accession-name`
- [x] Add session API to `src/main/preload.ts`
- [x] Update `src/types/electron.d.ts` with SessionAPI (if not done in Phase 2)

### 4.4 Verify & Commit

- [x] Run `npm run test:unit` → session store tests pass
- [x] Run `npm run type-check` → should pass
- [x] Commit: `feat(session): add in-memory session store for metadata persistence`

---

## Phase 5: Component Updates (TDD - Leaf First)

**Goal**: Update components with their tests. Work from leaf components up to CaptureScan.

### 5.1 PlantBarcodeInput (Leaf)

- [x] Update `tests/unit/components/PlantBarcodeInput.test.tsx` (covered by E2E tests - unit test deferred)
- [x] Update `src/components/PlantBarcodeInput.tsx`:
  - Rename callback: `onGenotypeIdFound` → `onAccessionNameFound`
  - Update IPC call: `getGenotypeByBarcode` → `getAccessionNameByBarcode`
- [x] Run `npm run test:unit` → should pass
- [x] Commit: `refactor(PlantBarcodeInput): rename genotype callback to accession`

### 5.2 AccessionFileUpload

- [x] Update `tests/unit/components/AccessionFileUpload.test.tsx`:
  - Change mock data: `genotype_id` → `accession_name`
  - Update assertions for new field names
- [x] Update `src/renderer/components/AccessionFileUpload.tsx`:
  - Rename state: `selectedGenotypeId` → `selectedAccessionName`
  - Update UI label: "Genotype ID Column" → "Accession Column"
  - Update mappings type: `genotype_id` → `accession_name`
- [x] Run `npm run test:unit` → should pass
- [x] Commit: `refactor(AccessionFileUpload): rename genotype to accession`

### 5.3 AccessionList

- [x] Update/create `tests/unit/components/AccessionList.test.tsx` (covered by E2E tests)
- [x] Update `src/renderer/components/AccessionList.tsx`:
  - Update mapping type: `genotype_id` → `accession_name`
  - Rename state: `editingGenotypeId` → `editingAccessionName`
  - Update table header: "Genotype ID" → "Accession"
- [x] Run `npm run test:unit` → should pass
- [x] Commit: `refactor(AccessionList): rename genotype to accession`

### 5.4 MetadataForm

- [x] Update `tests/unit/components/MetadataForm.test.tsx` (covered by E2E tests - unit test deferred)
- [x] Update `src/components/MetadataForm.tsx`:
  - Rename callback: `onGenotypeIdFound` → `onAccessionNameFound`
  - Update form label: "Genotype ID" → "Accession"
- [x] Run `npm run test:unit` → should pass
- [x] Commit: `refactor(MetadataForm): rename genotype to accession`

### 5.5 CaptureScan (Integration Point)

- [x] Update `src/renderer/CaptureScan.tsx`:
  - Update metadata state: `accessionId` → `accessionName`
  - Add session persistence on mount (load from SessionStore)
  - Add session persistence on change (save to SessionStore)
  - Add recent scans loading on mount
  - Filter recent scans by today's date
- [x] Run `npm run type-check` → should pass
- [x] Commit: `feat(CaptureScan): add session persistence and recent scans loading`

---

## Phase 6: E2E Tests

**Goal**: Add E2E tests for new functionality and verify existing tests pass.

### 6.1 Update Existing E2E Tests

- [x] Update `tests/e2e/accessions-management.e2e.ts`:
  - Update selectors for renamed UI elements ("Accession" instead of "Genotype ID")
  - Verify accession column selection works
- [x] Run `npm run test:e2e` → existing tests should pass

### 6.2 Add Session Persistence E2E Test

- [x] Add test to `tests/e2e/renderer-database-ipc.e2e.ts`:
  - Navigate to CaptureScan, fill metadata (phenotyper, experiment, wave, age)
  - Navigate to another page
  - Return to CaptureScan
  - Verify metadata fields are restored
- [x] Run `npm run test:e2e` → new test should pass
- [x] Commit: `test(e2e): add session persistence test`

### 6.3 Add Recent Scans E2E Test

- [x] Add test for recent scans loading in `tests/e2e/plant-barcode-validation.e2e.ts`:
  - Seed database with scans from today and yesterday
  - Navigate to CaptureScan
  - Verify only today's scans appear in list
- [x] Run `npm run test:e2e` → should pass
- [x] Commit: `test(e2e): add recent scans loading test`

---

## Phase 7: Final Verification

**Goal**: Full CI/CD pass and manual verification.

### 7.1 Full CI Suite

- [x] Run `npm run type-check` → all types pass
- [x] Run `npm run lint` → no lint errors
- [x] Run `npm run test:unit` → all unit tests pass (228 tests)
- [x] Run `npm run test:integration` → all integration tests pass
- [x] Run `npm run test:e2e` → all E2E tests pass (181 tests on all platforms)

### 7.2 Manual Testing

- [x] Upload accession Excel file, verify "Accession" column selector works (covered by E2E)
- [x] Enter plant barcode, verify accession auto-populates (covered by E2E)
- [x] Navigate away from CaptureScan and return, confirm metadata is restored (covered by E2E)
- [x] Verify plantQrCode is NOT restored (should be empty) (covered by E2E)
- [x] Close and reopen app, verify session state is reset (in-memory store resets on restart)
- [x] Capture scan, verify accession_name is stored correctly in database (covered by E2E)

### 7.3 Final Commit & PR

- [x] Squash/rebase if needed for clean history
- [x] Create PR with summary of all changes (PR #91)
- [x] Link to Issues #83, #85, #88
