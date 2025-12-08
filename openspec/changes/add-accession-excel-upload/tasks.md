## 1. Test Infrastructure

- [ ] 1.1 Create E2E test file `tests/e2e/accession-excel-upload.e2e.ts`
- [ ] 1.2 Create test fixtures with sample Excel files (single sheet, multi-sheet)
- [ ] 1.3 Write E2E tests for file upload scenarios (drag-drop, validation, errors)
- [ ] 1.4 Write E2E tests for sheet selection
- [ ] 1.5 Write E2E tests for column mapping
- [ ] 1.6 Write E2E tests for upload progress and completion
- [ ] 1.7 Create unit test file `tests/unit/components/AccessionFileUpload.test.tsx`
- [ ] 1.8 Write unit tests for file validation (type, size)
- [ ] 1.9 Write unit tests for column selection state management
- [ ] 1.10 Write unit tests for upload button disabled state

## 2. Dependencies

- [ ] 2.1 Add `xlsx` package for Excel parsing
- [ ] 2.2 Add `react-drag-drop-files` package for drag-drop UI
- [ ] 2.3 Verify TypeScript types are available or add @types packages

## 3. Component Implementation

- [ ] 3.1 Implement FileUploader drag-drop zone with accepted file types (XLSX, XLS)
- [ ] 3.2 Implement file size validation (max 15MB) with error message
- [ ] 3.3 Implement Excel file parsing with xlsx library
- [ ] 3.4 Implement sheet name extraction for multi-sheet files
- [ ] 3.5 Implement sheet selector dropdown (when multiple sheets)
- [ ] 3.6 Implement column header extraction from selected sheet
- [ ] 3.7 Implement Plant ID column selector dropdown
- [ ] 3.8 Implement Genotype ID column selector dropdown
- [ ] 3.9 Implement preview table (first 20 rows)
- [ ] 3.10 Implement column highlighting (green for Plant ID, blue for Genotype ID)
- [ ] 3.11 Implement upload button with disabled state until columns selected
- [ ] 3.12 Implement upload progress indicator
- [ ] 3.13 Implement batch processing (100 rows at a time)
- [ ] 3.14 Implement success/error message display
- [ ] 3.15 Implement form reset after successful upload

## 4. Integration

- [ ] 4.1 Integrate AccessionFileUpload into Accessions page
- [ ] 4.2 Connect to existing `createWithMappings` IPC handler
- [ ] 4.3 Refresh accession list after successful upload

## 5. Verification

- [ ] 5.1 All E2E tests pass
- [ ] 5.2 All unit tests pass
- [ ] 5.3 TypeScript compiles without errors
- [ ] 5.4 ESLint passes without errors
- [ ] 5.5 Manual testing with real Excel files
