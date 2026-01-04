## 1. Setup and Test Fixtures

- [x] 1.1 Create test fixtures for experiments (`tests/fixtures/experiments.ts`)
- [x] 1.2 Add helper functions for creating test experiments with relations

## 2. Write E2E Tests for Experiments Page (TDD)

- [x] 2.1 Add test: Navigate to Experiments page via navigation link
- [x] 2.2 Add test: Display empty state when no experiments exist
- [x] 2.3 Add test: Display experiments list with species, name, and scientist
- [x] 2.4 Add test: Experiments sorted alphabetically by name
- [x] 2.5 Add test: Create experiment with valid name and species
- [x] 2.6 Add test: Create experiment with scientist and accession linked
- [x] 2.7 Add test: Species dropdown shows all 15 species alphabetically
- [x] 2.8 Add test: Validation prevents empty name submission
- [x] 2.9 Add test: Show loading state during creation
- [x] 2.10 Add test: Attach accession to existing experiment
- [x] 2.11 Add test: Show success message after attaching accession
- [x] 2.12 Add test: Disable button when no experiments/accessions exist

## 3. Write E2E Tests for ExperimentChooser Component (TDD)

- [x] 3.1 Add test: ExperimentChooser displays experiments in dropdown
- [x] 3.2 Add test: ExperimentChooser shows placeholder when nothing selected
- [x] 3.3 Add test: ExperimentChooser has amber border when unselected
- [x] 3.4 Add test: ExperimentChooser has gray border when selected
- [x] 3.5 Add test: ExperimentChooser calls callback on selection change

## 4. Write E2E Tests for PhenotyperChooser Component (TDD)

- [x] 4.1 Add test: PhenotyperChooser displays phenotypers in dropdown
- [x] 4.2 Add test: PhenotyperChooser shows placeholder when nothing selected
- [x] 4.3 Add test: PhenotyperChooser has amber border when unselected
- [x] 4.4 Add test: PhenotyperChooser has gray border when selected
- [x] 4.5 Add test: PhenotyperChooser calls callback on selection change

## 5. Write E2E Tests for CaptureScan Integration (TDD)

- [x] 5.1 Add test: CaptureScan shows ExperimentChooser instead of text input
- [x] 5.2 Add test: CaptureScan shows PhenotyperChooser instead of text input
- [x] 5.3 Add test: CaptureScan validates experiment selection required (via E2E)
- [x] 5.4 Add test: CaptureScan validates phenotyper selection required (via E2E)

## 6. Write Unit Tests for ExperimentForm (TDD)

- [ ] 6.1 Add unit test: Form renders with all fields (DEFERRED - E2E covers)
- [ ] 6.2 Add unit test: Name field validation (DEFERRED - E2E covers)
- [ ] 6.3 Add unit test: Species dropdown populated (DEFERRED - E2E covers)
- [ ] 6.4 Add unit test: Scientist dropdown populated from props (DEFERRED - E2E covers)
- [ ] 6.5 Add unit test: Accession dropdown populated from props (DEFERRED - E2E covers)
- [ ] 6.6 Add unit test: Submit calls onSuccess callback (DEFERRED - E2E covers)

## 7. Add IPC Handler for Attach Accession

- [x] 7.1 Add `db:experiments:attachAccession` IPC handler
- [x] 7.2 Add TypeScript types for attach accession
- [x] 7.3 Expose handler in preload.ts

## 8. Implement Experiments Page

- [x] 8.1 Create `src/renderer/Experiments.tsx` page component
- [x] 8.2 Implement experiments list with loading/empty/error states
- [x] 8.3 Integrate ExperimentForm component
- [x] 8.4 Implement "Attach Accession to Existing Experiment" section

## 9. Implement ExperimentForm Component

- [x] 9.1 Create `src/renderer/components/ExperimentForm.tsx`
- [x] 9.2 Add name text input with validation
- [x] 9.3 Add species dropdown with 15 species
- [x] 9.4 Add scientist dropdown (fetches from database)
- [x] 9.5 Add accession dropdown (fetches from database)
- [x] 9.6 Implement form submission with loading state

## 10. Implement ExperimentChooser Component

- [x] 10.1 Create `src/renderer/components/ExperimentChooser.tsx`
- [x] 10.2 Implement dropdown with placeholder
- [x] 10.3 Add amber/gray border styling based on selection
- [x] 10.4 Add periodic refresh (10s interval)
- [x] 10.5 Add cleanup on unmount

## 11. Implement PhenotyperChooser Component

- [x] 11.1 Create `src/renderer/components/PhenotyperChooser.tsx`
- [x] 11.2 Implement dropdown with placeholder
- [x] 11.3 Add amber/gray border styling based on selection
- [x] 11.4 Add periodic refresh (10s interval)
- [x] 11.5 Add cleanup on unmount

## 12. Integrate Choosers into CaptureScan

- [x] 12.1 Update MetadataForm to accept chooser components or use directly
- [x] 12.2 Replace experiment text input with ExperimentChooser
- [x] 12.3 Replace phenotyper text input with PhenotyperChooser
- [x] 12.4 Update validation to work with chooser components

## 13. Add Navigation

- [x] 13.1 Add "Experiments" link to Layout.tsx navigation
- [x] 13.2 Register `/experiments` route in App.tsx

## 14. Verify Tests Pass

- [x] 14.1 Run `npm run test:e2e` and verify all new tests pass
- [x] 14.2 Run `npm run test:unit` and verify all unit tests pass
- [x] 14.3 Run `npm run lint` and fix any issues
- [x] 14.4 Run `npm run typecheck` and fix any type errors
- [ ] 14.5 Verify tests pass in CI (pending PR creation)