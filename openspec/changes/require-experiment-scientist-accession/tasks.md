## 1. Tests

- [x] 1.1 Write unit test: Zod schema rejects empty `scientist_id` (empty string or missing)
- [x] 1.2 Write unit test: Zod schema rejects empty `accession_id` (empty string or missing)
- [x] 1.3 Write unit test: Zod schema accepts valid `scientist_id` and `accession_id`
- [x] 1.4 Write unit test: form renders Scientist label without "(optional)"
- [x] 1.5 Write unit test: form renders Accession File label without "(optional)"
- [x] 1.6 Write unit test: form shows validation error when scientist is not selected
- [x] 1.7 Write unit test: form shows validation error when accession is not selected
- [x] 1.8 Update E2E test "should create experiment with valid name and species" to also select a scientist and accession
- [x] 1.9 Add E2E test: submitting form without scientist selection shows validation error
- [x] 1.10 Add E2E test: submitting form without accession selection shows validation error

## 2. Implementation

- [x] 2.1 Update Zod schema in `ExperimentForm.tsx`: change `scientist_id` from `.optional()` to `.min(1, 'Scientist is required')`
- [x] 2.2 Update Zod schema in `ExperimentForm.tsx`: change `accession_id` from `.optional()` to `.min(1, 'Accession file is required')`
- [x] 2.3 Remove "(optional)" from Scientist label text
- [x] 2.4 Remove "(optional)" from Accession File label text
- [x] 2.5 Add validation error display below Scientist dropdown (same pattern as Name field)
- [x] 2.6 Add validation error display below Accession File dropdown (same pattern as Name field)
- [x] 2.7 Update default values: set `scientist_id` and `accession_id` defaults to `''` (already done, but validation now catches empty strings)
- [x] 2.8 Update `onSubmit` to always include scientist and accession connect objects (remove conditional checks)
