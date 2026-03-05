## Why

In the pilot, experiment creation requires a scientist and an accession file to ensure data traceability and barcode-to-accession mapping during scanning. In bloom-desktop, both fields are optional, allowing incomplete experiments that undermine FAIR data principles and pilot parity.

## What Changes

- Make the Scientist dropdown a required field in the experiment creation form
- Make the Accession File dropdown a required field in the experiment creation form
- Update Zod validation schema to require both `scientist_id` and `accession_id`
- Remove "(optional)" labels from Scientist and Accession File form fields
- Show validation errors when either field is not selected
- Update E2E tests to always provide scientist and accession when creating experiments
- Database schema remains unchanged (columns stay nullable for backwards compatibility with existing data)

## Impact

- Affected specs: ui-management-pages (Create Experiment requirement)
- Affected code:
  - `src/renderer/components/ExperimentForm.tsx` -- Zod schema, form labels, default values
  - `tests/e2e/experiments-management.e2e.ts` -- E2E test for experiment creation without optional fields
  - `tests/fixtures/experiments.ts` -- Test data factories
