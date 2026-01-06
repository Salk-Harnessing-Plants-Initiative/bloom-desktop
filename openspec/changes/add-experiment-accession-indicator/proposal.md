## Why

Users cannot tell which experiments have accessions attached when selecting from the ExperimentChooser dropdown. This makes it difficult to know if barcode validation and autocomplete will work for a given experiment. The bloom-desktop-pilot shows accession status, and we need feature parity.

## What Changes

- Update `ExperimentChooser` to fetch experiments with their accession relation
- Display accession indicator in dropdown options (e.g., checkmark icon or "(with accession)" text)
- Show visual indicator when selected experiment has an accession attached
- Update TypeScript types to include accession in experiment data

## Impact

- Affected specs: `ui-management-pages`
- Affected code:
  - `src/renderer/components/ExperimentChooser.tsx` - Add accession indicator display
  - `tests/e2e/experiment-accession-indicator.e2e.ts` - E2E tests for indicator visibility
