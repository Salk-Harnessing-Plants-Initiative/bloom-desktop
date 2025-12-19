## 1. Write E2E Tests First (TDD)

- [x] 1.1 Add E2E test: Expanding accession shows mappings table with Plant Barcode and Genotype ID columns
- [x] 1.2 Add E2E test: Mappings table displays correct data from database
- [x] 1.3 Add E2E test: Empty accession shows "No plant mappings" message
- [x] 1.4 Add E2E test: Click on genotype ID cell enters edit mode
- [x] 1.5 Add E2E test: Press Enter saves inline edit
- [x] 1.6 Add E2E test: Press Escape cancels inline edit
- [x] 1.7 Add E2E test: Mappings sorted alphabetically by plant barcode

## 2. Add IPC Handler for Mapping Update

- [x] 2.1 Add `db:accessions:updateMapping` IPC handler to update genotype_id for a specific mapping
- [x] 2.2 Add TypeScript types for the new handler in `electron.d.ts`
- [x] 2.3 Expose handler in preload.ts

## 3. Implement Mappings Table UI

- [x] 3.1 Fetch and store mappings data when accession is expanded (use existing `getMappings`)
- [x] 3.2 Add mappings table component with Plant Barcode and Genotype ID columns
- [x] 3.3 Add empty state message when no mappings exist
- [x] 3.4 Add loading indicator while fetching mappings
- [x] 3.5 Add scrollable container for large mapping lists (max-height with overflow)

## 4. Implement Inline Editing

- [x] 4.1 Add click handler on genotype ID cells to enter edit mode
- [x] 4.2 Add input field for editing with current value pre-populated
- [x] 4.3 Implement Enter key handler to save edit
- [x] 4.4 Implement Escape key handler to cancel edit
- [x] 4.5 Implement onBlur handler to save edit

## 5. Verify Tests Pass

- [x] 5.1 Run `npm run test:e2e` and verify all new tests pass (21/21 passed)
- [x] 5.2 Run `npm run lint` and fix any issues
- [x] 5.3 Run `npm run typecheck` and fix any type errors
- [x] 5.4 Verify tests pass in CI
