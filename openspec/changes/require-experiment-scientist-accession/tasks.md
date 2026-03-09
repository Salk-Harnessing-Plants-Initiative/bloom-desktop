## TDD Plan

Tests are written first, verified to fail against current code, then implementation makes them pass.

### Phase 1: Unit Tests (RED)

- [x] 1.1 Write unit test: submitting form without scientist shows "Scientist is required" error
- [x] 1.2 Write unit test: submitting form without accession shows "Accession is required" error
- [x] 1.3 Write unit test: submitting form with all fields valid calls IPC create with scientist and accession connected
- [x] 1.4 Write unit test: form labels no longer show "(optional)" for scientist and accession
- [x] 1.5 Verify all new unit tests FAIL against current code

### Phase 2: E2E Tests (RED)

- [x] 2.1 Write E2E test: creating experiment without scientist selection shows validation error
- [x] 2.2 Write E2E test: creating experiment without accession selection shows validation error
- [x] 2.3 Write E2E test: creating experiment with all fields succeeds (scientist + accession required)
- [x] 2.4 Updated existing E2E tests to include required fields

### Phase 3: Implementation (GREEN)

- [x] 3.1 Update Zod schema: make `scientist_id` required with `.min(1, 'Scientist is required')`
- [x] 3.2 Update Zod schema: make `accession_id` required with `.min(1, 'Accession is required')`
- [x] 3.3 Update onSubmit: always include scientist and accession connect (remove conditional)
- [x] 3.4 Update label text: remove "(optional)" from Scientist and Accession labels
- [x] 3.5 Add error message display for scientist_id and accession_id validation errors
- [x] 3.6 Verify all unit tests PASS (8/8 pass)

### Phase 4: Verify No Regressions

- [x] 4.1 Run full unit test suite (368 passed, 9 skipped, 0 failed)
- [ ] 4.2 Run E2E test suite (requires dev server — run manually)
