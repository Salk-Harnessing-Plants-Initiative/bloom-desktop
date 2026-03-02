# Tasks: Fix Numeric Input Fields (TDD)

## Phase 1: Write Failing Tests

### 1.1 Unit Tests for Validation Logic

1. [x] **Create unit test file for metadata validation**
   - File: `tests/unit/metadata-validation.test.ts`
   - Test cases:
     - `waveNumber = 0` should be valid
     - `waveNumber = 1` should be valid
     - `waveNumber = -1` should be invalid
     - `waveNumber = null` should be invalid (required field)
     - `waveNumber = 1.5` should be invalid (must be whole number)
     - `plantAgeDays = 0` should be valid
     - `plantAgeDays = -1` should be invalid
     - `plantAgeDays = null` should be invalid (required field)
     - `plantAgeDays = 14.5` should be invalid (must be whole number)

### 1.2 E2E Tests for Numeric Input Behavior

2. [x] **Add E2E test for clearing and retyping numeric fields**
   - File: `tests/e2e/capture-scan-numeric-inputs.e2e.ts`
   - Test cases:
     - User can clear Wave Number field and type a new value
     - User can clear Plant Age field and type a new value
     - Clearing field shows validation error (required)
     - Typing new value after clearing works correctly
     - Entering decimal value shows "must be a whole number" error
     - Entering valid integer clears the error

3. [x] **Update existing E2E test for zero value handling**
   - File: `tests/e2e/plant-barcode-validation.e2e.ts`
   - The existing `UI: Session State Zero Value Persistence` test (line 1192) should pass once fix is implemented
   - Add test: Wave Number = 0 should NOT show validation error

4. [x] **Run tests to confirm they fail (Red phase)**
   - `npm run test:unit` - unit tests should fail
   - `npm run test:e2e` - E2E tests should fail on the new/updated tests

## Phase 2: Implement Fixes

### 2.1 Update Type Definitions

5. [x] **Update ScanMetadata type to support empty state**
   - File: `src/components/MetadataForm.tsx`
   - Option A: Allow `number | null` for waveNumber and plantAgeDays
   - Option B: Keep as `number` but handle empty string in UI layer
   - **Implemented**: Changed to `string` type to support validation of decimals

### 2.2 Fix onChange Handlers

6. [x] **Update Wave Number onChange handler**
   - File: `src/components/MetadataForm.tsx` (lines 185-186)
   - Current: `parseInt(e.target.value, 10) || 0` (resets to 0 on empty)
   - Fix: Allow empty value during editing, use `null` for empty state
   - Pattern from pilot: `e.target.value === "" ? null : parseInt(e.target.value, 10)`
   - **Implemented**: Changed to `type="text"` with `inputMode="numeric"`, stores as string

7. [x] **Update Plant Age onChange handler**
   - File: `src/components/MetadataForm.tsx` (lines 207-208)
   - Same fix as Wave Number
   - **Implemented**: Same approach as Wave Number

### 2.3 Fix Validation Logic

8. [x] **Fix Wave Number validation in CaptureScan**
   - File: `src/renderer/CaptureScan.tsx` (line 339)
   - Current: `if (metadata.waveNumber <= 0)`
   - Fix: Check for null, negative, and non-integer values
   - Error messages:
     - If null/empty: "Wave number is required"
     - If negative: "Wave number must be 0 or greater"
     - If decimal: "Wave number must be a whole number"
   - **Implemented**: Uses `validateWaveNumber()` from utility

9. [x] **Fix Plant Age validation**
   - File: `src/renderer/CaptureScan.tsx` (line 342)
   - Current: `if (metadata.plantAgeDays < 0)` - already allows 0
   - Fix: Check for null, negative, and non-integer values
   - Error messages:
     - If null/empty: "Plant age is required"
     - If negative: "Plant age must be 0 or greater"
     - If decimal: "Plant age must be a whole number"
   - **Implemented**: Uses `validatePlantAgeDays()` from utility

10. [x] **Store raw input value to detect decimals**
    - Need to track both the raw string input and parsed number
    - Option A: Store as string in state, parse on validation
    - Option B: Store parsed number + hasDecimal flag
    - This allows detecting "1.5" vs "1" (both parse to 1 with parseInt)
    - **Implemented**: Store as string, validation checks for decimal point

### 2.4 Update State Initialization

11. [x] **Update initial metadata state**
    - File: `src/renderer/CaptureScan.tsx` (lines 26-33)
    - Current: `waveNumber: 0, plantAgeDays: 0`
    - Fix: `waveNumber: null, plantAgeDays: null` (show empty fields initially)
    - **Implemented**: Initial state uses empty strings `waveNumber: ''`

### 2.5 Update Session Persistence

12. [x] **Update session save logic**
    - File: `src/renderer/CaptureScan.tsx` (lines 217-224)
    - Ensure null values are saved correctly (not converted to 0)
    - **Implemented**: Converts string to number with parseInt for API

13. [x] **Update session restore logic**
    - File: `src/renderer/CaptureScan.tsx` (lines 188-196)
    - Ensure null values are restored correctly
    - **Implemented**: Converts number from API to string with String()

## Phase 3: Verify Tests Pass (Green phase)

14. [x] **Run unit tests**
    - `npm run test:unit`
    - All validation tests should pass
    - **Verified**: 270 tests passed (20 metadata validation tests)

15. [x] **Run E2E tests**
    - `npm run test:e2e`
    - Numeric input tests should pass
    - Zero value persistence test should pass
    - **Verified**: All 10 numeric input E2E tests passed in CI

## Phase 4: Refactor and Clean Up

16. [x] **Extract validation logic to utility (optional)**
    - If validation logic is complex, extract to `src/utils/metadata-validation.ts`
    - This makes unit testing easier
    - **Implemented**: Created `src/utils/metadata-validation.ts`

17. [x] **Run linting and type checking**
    - `npm run lint`
    - `npm run typecheck`
    - Fix any issues
    - **Verified**: Linting and type checking pass in CI

18. [x] **Run full test suite**
    - `npm test` or `npm run test:all`
    - Ensure no regressions
    - **Verified**: Unit tests, integration tests pass. E2E numeric input tests pass.
    - **Note**: CI shows failures in Browse Scans tests (unrelated to this proposal)

## Dependencies

- Tasks 1-4 (tests) can be done in parallel
- Task 5 must be done before tasks 6-13
- Tasks 6-13 can be done in any order
- Tasks 14-15 depend on tasks 5-13
- Tasks 16-18 depend on tasks 14-15
