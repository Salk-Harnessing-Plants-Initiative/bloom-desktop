# Tasks: Add Accessions Management UI

## Overview

Implementation follows Test-Driven Development (TDD):
1. Write tests first (E2E + Unit)
2. Implement to make tests pass
3. Refactor for quality

## Phase 1: Test Infrastructure (TDD - Write Tests First)

### Task 1.1: Create Test Fixtures
- [ ] Create `tests/fixtures/accessions.ts` with:
  - `AccessionTestData` interface
  - `createAccessionData()` factory function with unique names
  - `validAccession` constant for simple test cases
  - `maxLengthName`, `specialCharName`, `unicodeName` edge case data
  - `createAccessionList()` for bulk test data
  - `unsortedAccessions` and `sortedAccessions` for sorting tests
  - `mockExcelFile()` helper for file upload tests
  - `mockPlantMappings()` for testing plant-accession relationships

### Task 1.2: Add Backend IPC Handlers (Prerequisites for Tests)
- [ ] Add `db:accessions:createWithMappings` IPC handler
  - Atomic transaction: create accession + plant mappings
  - Handle batch inserts (100 rows at a time)
  - Return created accession with mapping count
- [ ] Add `db:accessions:getMappings` IPC handler
  - Fetch all plant mappings for an accession
  - Include mapping metadata (barcode, genotype ID)
- [ ] Add `db:accessions:update` IPC handler
  - Update accession name
  - Validate name not empty
- [ ] Add `db:accessions:delete` IPC handler
  - Delete accession and cascade plant mappings
  - Return success/failure status
- [ ] Add type definitions to `src/types/database.ts`
- [ ] Add IPC types to `src/types/electron.d.ts`
- [ ] Update `tests/unit/setup.ts` with accessions mock

### Task 1.3: Write E2E Tests (Before Implementation)
- [ ] Create `tests/e2e/accessions-management.e2e.ts` with tests for:
  - Navigation to Accessions page
  - Empty state display
  - Create accession with valid name
  - Alphabetical sorting of list
  - Validation error for empty name
  - Duplicate names allowed (no unique constraint)
  - Loading state during creation
  - Clear validation errors when typing
  - Expand/collapse accession details
  - Display mapping count in expanded view
  - Display linked experiments in expanded view
  - Excel file upload: valid XLSX file
  - Excel file upload: file too large (>15MB)
  - Excel file upload: invalid format (non-Excel)
  - Sheet selection for multi-sheet files
  - Column mapping: select Plant ID column
  - Column mapping: select Genotype ID column
  - Column highlighting in preview (green for Plant ID, blue for Genotype)
  - Preview table shows first 20 rows
  - Batch upload progress indicator
  - Upload 500 mappings in batches of 100
  - Inline edit accession name (Enter to save)
  - Cancel inline edit (Escape)
  - Delete accession with confirmation
  - State preservation across navigation

### Task 1.4: Write Unit Tests (Before Implementation)
- [ ] Create `tests/unit/components/AccessionForm.test.tsx` with tests for:
  - Renders name field
  - Name validation (required, max length)
  - Form submission calls IPC
  - Error display for validation failures
  - Loading state during submission
  - Form reset after successful submission
  - Button disabled during submission
- [ ] Create `tests/unit/components/AccessionFileUpload.test.tsx` with tests for:
  - File drag-and-drop interaction
  - File size validation (15MB limit)
  - File format validation (XLSX/XLS only)
  - Excel parsing with valid file
  - Sheet detection and selection
  - Column detection from headers
  - Preview table rendering (first 20 rows)
  - Column mapping dropdown functionality
  - Column highlighting visual feedback
  - Batch processing logic (100 rows per batch)
  - Progress calculation
  - Error handling for parsing failures

## Phase 2: Implementation

### Task 2.1: Install Dependencies
- [ ] Add `xlsx` library for Excel parsing
  - `npm install xlsx`
  - `npm install --save-dev @types/xlsx`
- [ ] Verify library works in Electron context

### Task 2.2: Create AccessionForm Component
- [ ] Create `src/renderer/components/AccessionForm.tsx`:
  - Zod validation schema (name required, max 255 chars)
  - React Hook Form integration
  - IPC call to `window.electron.database.accessions.create()`
  - Error handling (validation + database errors)
  - Loading state management
  - Form reset on success

### Task 2.3: Create AccessionFileUpload Component
- [ ] Create `src/renderer/components/AccessionFileUpload.tsx`:
  - Drag-and-drop zone with visual feedback
  - File validation (size <= 15MB, format XLSX/XLS)
  - Excel parsing using `xlsx` library
  - Sheet selection dropdown (for multi-sheet files)
  - File preview table (first 20 rows, scrollable)
  - Column selection dropdowns (Plant ID + Genotype ID)
  - Column highlighting in preview (green/blue)
  - Upload button with disabled state
  - Batch processing with progress indicator
  - IPC call to `window.electron.database.accessions.createWithMappings()`
  - Comprehensive error handling

### Task 2.4: Create AccessionList Component
- [ ] Create `src/renderer/components/AccessionList.tsx`:
  - Expandable list items (accordion pattern)
  - Show name + creation date for collapsed items
  - Show mapping count + linked experiments when expanded
  - Inline edit mode for accession name
  - Save with Enter, cancel with Escape
  - Delete button with confirmation dialog
  - Optimistic UI updates for edits
  - Loading states for actions

### Task 2.5: Create Accessions Page
- [ ] Create `src/renderer/Accessions.tsx`:
  - Fetch accessions from `window.electron.database.accessions.list()`
  - Display list sorted alphabetically by name
  - Empty state message
  - Loading state
  - Error state
  - Integration with AccessionForm
  - Integration with AccessionFileUpload
  - Integration with AccessionList
  - Refresh list after successful creation/upload

### Task 2.6: Add Navigation and Route
- [ ] Modify `src/renderer/App.tsx`:
  - Add route for `/accessions`
  - Import Accessions component
- [ ] Modify `src/renderer/Layout.tsx`:
  - Add "Accessions" navigation link with folder/table icon
  - Position in menu (after Scientists, Phenotypers)

## Phase 3: Verification

### Task 3.1: Run All Tests
- [ ] Run unit tests: `npm run test:unit`
  - Verify AccessionForm tests pass (7-10 tests)
  - Verify AccessionFileUpload tests pass (12-15 tests)
- [ ] Run E2E tests: `npm run test:e2e`
  - Verify Accessions tests pass (25+ tests)
- [ ] Run linting: `npm run lint`
- [ ] Run type check: `npx tsc --noEmit`

### Task 3.2: Manual Verification
- [ ] Navigate to Accessions page
- [ ] Verify empty state
- [ ] Create a simple accession
- [ ] Verify list updates
- [ ] Test validation errors
- [ ] Upload sample Excel file with plant mappings
- [ ] Test sheet selection (use multi-sheet file)
- [ ] Verify column mapping and highlighting
- [ ] Confirm batch upload progress
- [ ] Test inline editing with Enter/Escape
- [ ] Test delete with confirmation
- [ ] Verify duplicate names are allowed

### Task 3.3: Performance Testing
- [ ] Upload large Excel file (1000+ rows)
- [ ] Verify batch processing works smoothly
- [ ] Verify UI remains responsive during upload
- [ ] Check memory usage during file parsing
- [ ] Verify virtual scrolling in preview (if needed)

## Phase 4: Polish and Documentation

### Task 4.1: Accessibility
- [ ] Verify keyboard navigation works
- [ ] Add ARIA labels to drag-and-drop zone
- [ ] Ensure screen reader support for column highlighting
- [ ] Test with keyboard-only navigation
- [ ] Add focus indicators

### Task 4.2: Documentation
- [ ] Update README with Accessions page description
- [ ] Document Excel file format requirements
- [ ] Add example Excel template to docs
- [ ] Document Plant ID vs Genotype ID column purposes

## Acceptance Criteria

- [ ] All E2E tests pass (25+)
- [ ] All unit tests pass (17-25)
- [ ] Linting passes
- [ ] TypeScript compiles without errors
- [ ] Accessions page accessible via navigation
- [ ] List displays accessions alphabetically
- [ ] Form validates name (required)
- [ ] Excel upload works with valid files
- [ ] File validation rejects invalid files
- [ ] Column mapping and highlighting work
- [ ] Batch upload processes large files
- [ ] Inline editing saves/cancels correctly
- [ ] Delete confirmation prevents accidental deletion
- [ ] Loading states display correctly
- [ ] Duplicate names are permitted
- [ ] UI is accessible and keyboard-friendly