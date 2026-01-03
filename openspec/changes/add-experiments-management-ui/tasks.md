## 1. Setup and Test Fixtures

- [ ] 1.1 Create test fixtures for experiments (`tests/fixtures/experiments.ts`)
- [ ] 1.2 Add helper functions for creating test experiments with relations

## 2. Write E2E Tests for Experiments Page (TDD)

- [ ] 2.1 Add test: Navigate to Experiments page via navigation link
- [ ] 2.2 Add test: Display empty state when no experiments exist
- [ ] 2.3 Add test: Display experiments list with species, name, and scientist
- [ ] 2.4 Add test: Experiments sorted alphabetically by name
- [ ] 2.5 Add test: Create experiment with valid name and species
- [ ] 2.6 Add test: Create experiment with scientist and accession linked
- [ ] 2.7 Add test: Species dropdown shows all 15 species alphabetically
- [ ] 2.8 Add test: Validation prevents empty name submission
- [ ] 2.9 Add test: Show loading state during creation
- [ ] 2.10 Add test: Attach accession to existing experiment
- [ ] 2.11 Add test: Show success message after attaching accession
- [ ] 2.12 Add test: Show error message on attach failure

## 3. Write E2E Tests for ExperimentChooser Component (TDD)

- [ ] 3.1 Add test: ExperimentChooser displays experiments in dropdown
- [ ] 3.2 Add test: ExperimentChooser shows placeholder when nothing selected
- [ ] 3.3 Add test: ExperimentChooser has amber border when unselected
- [ ] 3.4 Add test: ExperimentChooser has gray border when selected
- [ ] 3.5 Add test: ExperimentChooser calls callback on selection change

## 4. Write E2E Tests for PhenotyperChooser Component (TDD)

- [ ] 4.1 Add test: PhenotyperChooser displays phenotypers in dropdown
- [ ] 4.2 Add test: PhenotyperChooser shows placeholder when nothing selected
- [ ] 4.3 Add test: PhenotyperChooser has amber border when unselected
- [ ] 4.4 Add test: PhenotyperChooser has gray border when selected
- [ ] 4.5 Add test: PhenotyperChooser calls callback on selection change

## 5. Write E2E Tests for CaptureScan Integration (TDD)

- [ ] 5.1 Add test: CaptureScan shows ExperimentChooser instead of text input
- [ ] 5.2 Add test: CaptureScan shows PhenotyperChooser instead of text input
- [ ] 5.3 Add test: CaptureScan validates experiment selection required
- [ ] 5.4 Add test: CaptureScan validates phenotyper selection required

## 6. Write Unit Tests for ExperimentForm (TDD)

- [ ] 6.1 Add unit test: Form renders with all fields
- [ ] 6.2 Add unit test: Name field validation
- [ ] 6.3 Add unit test: Species dropdown populated
- [ ] 6.4 Add unit test: Scientist dropdown populated from props
- [ ] 6.5 Add unit test: Accession dropdown populated from props
- [ ] 6.6 Add unit test: Submit calls onSuccess callback

## 7. Add IPC Handler for Attach Accession

- [ ] 7.1 Add `db:experiments:attachAccession` IPC handler
- [ ] 7.2 Add TypeScript types for attach accession
- [ ] 7.3 Expose handler in preload.ts

## 8. Implement Experiments Page

- [ ] 8.1 Create `src/renderer/Experiments.tsx` page component
- [ ] 8.2 Implement experiments list with loading/empty/error states
- [ ] 8.3 Integrate ExperimentForm component
- [ ] 8.4 Implement "Attach Accession to Existing Experiment" section

## 9. Implement ExperimentForm Component

- [ ] 9.1 Create `src/renderer/components/ExperimentForm.tsx`
- [ ] 9.2 Add name text input with validation
- [ ] 9.3 Add species dropdown with 15 species
- [ ] 9.4 Add scientist dropdown (fetches from database)
- [ ] 9.5 Add accession dropdown (fetches from database)
- [ ] 9.6 Implement form submission with loading state

## 10. Implement ExperimentChooser Component

- [ ] 10.1 Create `src/renderer/components/ExperimentChooser.tsx`
- [ ] 10.2 Implement dropdown with placeholder
- [ ] 10.3 Add amber/gray border styling based on selection
- [ ] 10.4 Add periodic refresh (10s interval)
- [ ] 10.5 Add cleanup on unmount

## 11. Implement PhenotyperChooser Component

- [ ] 11.1 Create `src/renderer/components/PhenotyperChooser.tsx`
- [ ] 11.2 Implement dropdown with placeholder
- [ ] 11.3 Add amber/gray border styling based on selection
- [ ] 11.4 Add periodic refresh (10s interval)
- [ ] 11.5 Add cleanup on unmount

## 12. Integrate Choosers into CaptureScan

- [ ] 12.1 Update MetadataForm to accept chooser components or use directly
- [ ] 12.2 Replace experiment text input with ExperimentChooser
- [ ] 12.3 Replace phenotyper text input with PhenotyperChooser
- [ ] 12.4 Update validation to work with chooser components

## 13. Add Navigation

- [ ] 13.1 Add "Experiments" link to Layout.tsx navigation
- [ ] 13.2 Register `/experiments` route in App.tsx

## 14. Verify Tests Pass

- [ ] 14.1 Run `npm run test:e2e` and verify all new tests pass
- [ ] 14.2 Run `npm run test:unit` and verify all unit tests pass
- [ ] 14.3 Run `npm run lint` and fix any issues
- [ ] 14.4 Run `npm run typecheck` and fix any type errors
- [ ] 14.5 Verify tests pass in CI