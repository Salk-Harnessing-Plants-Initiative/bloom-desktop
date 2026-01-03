# Add Experiments Management UI

## Summary

Add a dedicated Experiments management page with full CRUD functionality, plus ExperimentChooser and PhenotyperChooser components for use in CaptureScan. This brings feature parity with the bloom-desktop-pilot.

## Motivation

Currently, users must manually type experiment IDs as text strings in CaptureScan. With an Experiments management page and chooser components, users can:

1. View all existing experiments with their linked scientists and accessions
2. Create new experiments with proper validation
3. Select experiments from a dropdown in CaptureScan (instead of typing)
4. Select phenotypers from a dropdown in CaptureScan (instead of typing)
5. Attach accessions to existing experiments

## Scope

### In Scope

1. **Experiments Page** (`src/renderer/Experiments.tsx`)

   - List experiments showing: `{species} - {name} ({scientist name})`
   - Create new experiment form with:
     - Name (required, text input)
     - Species (required, dropdown with hardcoded list)
     - Scientist (optional, dropdown from scientists list)
     - Accession (optional, dropdown from accessions list)
   - Attach Accession to Existing Experiment section
   - Loading states, error handling, empty states

2. **ExperimentForm Component** (`src/renderer/components/ExperimentForm.tsx`)

   - Form validation (name required, species required)
   - Dropdowns for scientist and accession selection
   - Success/error feedback

3. **ExperimentChooser Component** (`src/renderer/components/ExperimentChooser.tsx`)

   - Dropdown to select experiment by name
   - Polls for experiments periodically (refresh on interval)
   - Visual indicator when no experiment selected (amber border)
   - Callback when selection changes

4. **PhenotyperChooser Component** (`src/renderer/components/PhenotyperChooser.tsx`)

   - Dropdown to select phenotyper by name
   - Polls for phenotypers periodically
   - Visual indicator when no phenotyper selected
   - Callback when selection changes

5. **CaptureScan Integration**

   - Replace experiment text input with ExperimentChooser
   - Replace phenotyper text input with PhenotyperChooser
   - Update MetadataForm to support chooser components

6. **Navigation**
   - Add Experiments link to Layout.tsx
   - Register /experiments route in App.tsx

### Out of Scope

- Edit/delete experiments (pilot doesn't have this)
- Expandable experiment rows (pilot shows simple list)
- Species management page (hardcoded for now)
- Syncing species from bloom server (future work)

## Species List

Hardcoded species (from pilot `fix/addnewspecies` branch, deduplicated and sorted):

- Alfalfa
- Amaranth
- Arabidopsis
- Canola
- Lotus
- Maize
- Medicago
- Pennycress
- Rice
- Sorghum
- Soybean
- Spinach
- Sugar_Beet
- Tomato
- Wheat

## Technical Approach

### TDD Workflow

1. Write E2E tests for Experiments page (following Scientists/Phenotypers pattern)
2. Write E2E tests for ExperimentChooser in CaptureScan context
3. Write E2E tests for PhenotyperChooser in CaptureScan context
4. Write unit tests for form validation
5. Implement components to make tests pass

### Backend (Already Complete)

- IPC handlers exist: `db:experiments:list`, `db:experiments:create`, `db:experiments:get`, `db:experiments:update`, `db:experiments:delete`
- Types exist: `ExperimentWithRelations`, `ExperimentCreateData`, `ExperimentUpdateData`

### New IPC Handler Needed

- `db:experiments:attachAccession` - Update experiment to link an accession

## Risks and Mitigations

| Risk                                      | Mitigation                                        |
| ----------------------------------------- | ------------------------------------------------- |
| Species list becomes outdated             | Document that it should sync from bloom in future |
| Chooser polling causes performance issues | Use reasonable interval (10s), cleanup on unmount |

## Success Criteria

- [ ] Experiments page accessible via navigation
- [ ] List displays experiments with species, name, and scientist
- [ ] Create form validates required fields (name, species)
- [ ] Form allows optional scientist and accession selection
- [ ] Attach Accession section works for existing experiments
- [ ] ExperimentChooser replaces text input in CaptureScan
- [ ] PhenotyperChooser replaces text input in CaptureScan
- [ ] All E2E tests pass
- [ ] All unit tests pass
- [ ] Linting and type checking pass