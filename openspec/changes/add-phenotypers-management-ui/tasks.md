# Tasks: Add Phenotypers Management UI

## Overview

Implementation follows Test-Driven Development (TDD):
1. Write tests first (E2E + Unit)
2. Implement to make tests pass
3. Refactor for quality

## Phase 1: Test Infrastructure (TDD - Write Tests First)

### Task 1.1: Create Test Fixtures
- [ ] Create `tests/fixtures/phenotypers.ts` with:
  - `PhenotyperTestData` interface
  - `createPhenotyperData()` factory function with unique email generation
  - `validPhenotyper` constant for simple test cases
  - `maxLengthName`, `specialCharName`, `unicodeName` edge case data
  - `subdomainEmail` for email format testing
  - `createPhenotyperList()` for bulk test data
  - `unsortedPhenotypers` and `sortedPhenotypers` for sorting tests

### Task 1.2: Write E2E Tests (Before Implementation)
- [ ] Create `tests/e2e/phenotypers-management.e2e.ts` with tests for:
  - Navigation to Phenotypers page
  - Empty state display
  - Create phenotyper with valid data
  - Alphabetical sorting of list
  - Validation error for empty name
  - Validation error for invalid email format
  - Database error for duplicate email
  - Loading state during creation
  - Clear validation errors when typing
  - Edge cases: max length name, special characters, Unicode, subdomain email
  - Prevent rapid double submission
  - State preservation across navigation

### Task 1.3: Write Unit Tests (Before Implementation)
- [ ] Create `tests/unit/components/PhenotyperForm.test.tsx` with tests for:
  - Renders all form fields
  - Name validation (required, max length)
  - Email validation (required, format)
  - Form submission calls IPC
  - Error display for validation failures
  - Error display for API failures
  - Loading state during submission
  - Form reset after successful submission
  - Button disabled during submission

## Phase 2: Implementation

### Task 2.1: Create PhenotyperForm Component
- [ ] Create `src/renderer/components/PhenotyperForm.tsx`:
  - Zod validation schema (name required, email format)
  - React Hook Form integration
  - IPC call to `window.electron.database.phenotypers.create()`
  - Error handling (validation + database errors)
  - Loading state management
  - Form reset on success
  - Duplicate email error handling

### Task 2.2: Create Phenotypers Page
- [ ] Create `src/renderer/Phenotypers.tsx`:
  - Fetch phenotypers from `window.electron.database.phenotypers.list()`
  - Display list sorted alphabetically by name
  - Empty state message
  - Loading state
  - Error state
  - Integration with PhenotyperForm
  - Refresh list after successful creation

### Task 2.3: Add Navigation and Route
- [ ] Modify `src/renderer/App.tsx`:
  - Add route for `/phenotypers`
  - Import Phenotypers component
- [ ] Modify `src/renderer/Layout.tsx`:
  - Add "Phenotypers" navigation link

## Phase 3: Verification

### Task 3.1: Run All Tests
- [ ] Run unit tests: `npm run test`
- [ ] Run E2E tests: `npm run test:e2e`
- [ ] Run linting: `npm run lint`
- [ ] Run type check: `npx tsc --noEmit`

### Task 3.2: Manual Verification
- [ ] Start app: `npm run start`
- [ ] Navigate to Phenotypers page
- [ ] Verify empty state
- [ ] Create a phenotyper
- [ ] Verify list updates
- [ ] Test validation errors
- [ ] Test duplicate email error

## Acceptance Criteria

- [ ] All E2E tests pass
- [ ] All unit tests pass
- [ ] Linting passes
- [ ] TypeScript compiles without errors
- [ ] Phenotypers page accessible via navigation
- [ ] List displays phenotypers alphabetically
- [ ] Form validates name (required) and email (format)
- [ ] Duplicate email shows user-friendly error
- [ ] Form clears after successful creation
- [ ] Loading states display correctly
