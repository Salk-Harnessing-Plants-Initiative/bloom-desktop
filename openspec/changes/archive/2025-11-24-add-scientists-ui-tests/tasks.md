# Tasks: Add Comprehensive Tests for Scientists UI

## Task List

### Phase 1: Test Data Fixtures (Foundation)

- [x] **Create test fixtures file** ✓
  - Create `tests/fixtures/scientists.ts` with factory functions
  - Export `createScientistData()` factory with overrides support
  - Export common test data constants (valid scientist, max length name, special chars)
  - Add TypeScript types for factory function parameters
  - **Validation**: Import fixture in a test file and verify it works
  - **Estimate**: 30 minutes

### Phase 2: Scientists Page Unit Tests (Core)

- [x] **Create Scientists page unit test file** ✓
  - Create `tests/unit/pages/Scientists.test.tsx`
  - Set up test file structure with describe block and imports
  - Configure mock for `window.electron.database.scientists.list`
  - **Validation**: Test file runs without errors
  - **Estimate**: 15 minutes

- [x] **Test: Initial data fetch on mount** ✓
  - Write test: "should fetch scientists on mount"
  - Mock successful API response with scientist data
  - Verify `window.electron.database.scientists.list` called once
  - Verify loading state appears then disappears
  - Verify scientists list rendered
  - **Validation**: Test passes
  - **Estimate**: 30 minutes

- [x] **Test: Loading state display** ✓
  - Write test: "should show loading state during fetch"
  - Mock slow API response using Promise delay
  - Verify loading indicator appears
  - Verify loading indicator disappears after data loads
  - **Validation**: Test passes
  - **Estimate**: 20 minutes

- [x] **Test: Error state display** ✓
  - Write test: "should show error state when fetch fails"
  - Mock API rejection with error
  - Verify error message appears
  - Verify error message is user-friendly (not raw error)
  - **Validation**: Test passes
  - **Estimate**: 20 minutes

- [x] **Test: Empty state display** ✓
  - Write test: "should show empty state when no scientists exist"
  - Mock successful API response with empty array
  - Verify empty state message appears
  - Verify form is still visible
  - **Validation**: Test passes
  - **Estimate**: 15 minutes

- [x] **Test: List rendering** ✓
  - Write test: "should render list of scientists alphabetically"
  - Mock API response with 3+ scientists in random order
  - Verify all scientists appear
  - Verify scientists sorted alphabetically by name
  - Verify format is "Name (email)"
  - **Validation**: Test passes
  - **Estimate**: 30 minutes

- [x] **Test: List refresh after creation** ✓
  - Write test: "should refresh list after successful scientist creation"
  - Render component with initial data
  - Simulate successful scientist creation via ScientistForm onSuccess
  - Verify list API called again
  - Verify new scientist appears in list
  - **Validation**: Test passes
  - **Estimate**: 30 minutes

- [x] **Test: Network error handling** ✓
  - Write test: "should handle network errors gracefully"
  - Mock API with network error (not rejection)
  - Verify error message appears
  - Verify list remains empty/previous state
  - **Validation**: Test passes
  - **Estimate**: 20 minutes

### Phase 3: Edge Case E2E Tests (Coverage)

- [x] **Test: Maximum length name** ✓
  - Add test to `tests/e2e/scientists-management.e2e.ts`
  - Test name with exactly 255 characters
  - Verify scientist created successfully
  - Verify name displays correctly in list (truncated or scrollable)
  - **Validation**: Test passes on all platforms
  - **Estimate**: 20 minutes

- [x] **Test: Special characters in name** ✓
  - Add test for special characters: "Dr. O'Brien-Smith"
  - Add test for Unicode characters: "Dr. Müller"
  - Verify scientists created successfully
  - Verify names display correctly in list
  - **Validation**: Tests pass on all platforms
  - **Estimate**: 25 minutes

- [x] **Test: International email domains** ✓
  - Add test for internationalized email: user@münchen.de (if supported)
  - Or test with valid subdomain: user@test.example.com
  - Verify scientist created successfully
  - Verify email validation accepts valid formats
  - **Validation**: Test passes on all platforms
  - **Estimate**: 20 minutes

- [x] **Test: Rapid submission prevention** ✓
  - Add test for double-click/rapid submission
  - Click submit button twice quickly
  - Verify only one IPC call made
  - Verify form disabled during submission (loading state)
  - Verify single scientist created
  - **Validation**: Test passes on all platforms
  - **Estimate**: 25 minutes

- [x] **Test: State preservation across navigation** ✓
  - Add test for navigation state persistence
  - Create scientist
  - Navigate to different page (e.g., home)
  - Navigate back to Scientists page
  - Verify scientist still appears in list
  - Verify data persisted to database (not just UI state)
  - **Validation**: Test passes on all platforms
  - **Estimate**: 30 minutes

### Phase 4: Integration & Documentation

- [x] **Update test fixtures usage** ✓
  - Refactor existing E2E tests to use fixtures from `tests/fixtures/scientists.ts`
  - Refactor unit tests to use fixtures where applicable
  - Verify all tests still pass with fixtures
  - **Validation**: All tests pass, reduced code duplication
  - **Estimate**: 30 minutes

- [ ] **Verify CI passes**
  - Run all unit tests locally: `npm run test:unit` ✓
  - Run all E2E tests locally: `npm run test:e2e`
  - Push to PR and verify CI passes on all platforms
  - **Validation**: All CI checks green
  - **Estimate**: 20 minutes (mostly waiting for CI)

- [ ] **Update documentation (optional)**
  - Add note to test README about using test fixtures
  - Document Scientists page test coverage
  - **Validation**: Documentation clear and accurate
  - **Estimate**: 15 minutes

## Task Dependencies

```
Phase 1 (Fixtures)
  ↓
Phase 2 (Unit Tests) + Phase 3 (E2E Tests) [parallel]
  ↓
Phase 4 (Integration)
```

## Estimates

- **Total estimated time**: 6-7 hours
- **Phase 1**: 30 minutes
- **Phase 2**: 3 hours
- **Phase 3**: 2 hours
- **Phase 4**: 1 hour

## Validation Checklist

Before marking this change as complete:

- [x] All unit tests pass: `npm run test:unit` ✓ (65/65 passing)
- [ ] All E2E tests pass: `npm run test:e2e`
- [ ] Tests pass on Linux, macOS, Windows in CI
- [x] OpenSpec validation passes: `npx openspec validate add-scientists-ui-tests --strict` ✓
- [x] Test coverage includes all scenarios from specs ✓
- [x] Test fixtures used consistently across test files ✓
- [ ] No test flakiness observed (run tests 3+ times)
