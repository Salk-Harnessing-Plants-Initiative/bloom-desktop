# Proposal: Add Comprehensive Tests for Scientists UI

## Summary

Add comprehensive test coverage for the Scientists management UI to improve quality, maintainability, and confidence in the feature. This includes unit tests for the Scientists page component, edge case E2E tests, and reusable test data fixtures.

## Context

The Scientists management UI was recently implemented with:

- Scientists page component (list + form integration)
- ScientistForm component (validated form)
- E2E tests (9 scenarios)
- Unit tests for ScientistForm (10 test cases)

**Current test coverage gaps:**

1. **No unit tests for Scientists page component** - The page has significant logic (data fetching, loading states, error handling, list refresh) that's only tested via slow E2E tests
2. **Missing edge case E2E tests** - Maximum length inputs, special characters, rapid submission prevention, state preservation across navigation
3. **Test data duplication** - No shared fixtures/factories for test data

**Why this matters:**

- Scientists page logic is currently only tested through E2E tests, which are slower (2-3s per test vs 50-100ms for unit tests) and harder to debug
- Edge cases represent real-world scenarios that could cause production bugs
- Test data factories improve maintainability and reduce duplication across test files

## Motivation

**Problem**: The Scientists page component has untested logic paths that could break without fast feedback.

**Impact**:

- Slower debugging (must run full E2E tests to validate page logic)
- Lower confidence in refactoring
- Missing coverage for edge cases that could cause production bugs

**Benefit of change**:

- **Faster feedback loop**: Unit tests run in ~50-100ms vs 2-3s for E2E tests
- **Better isolation**: Easier to debug page logic issues separate from IPC/database
- **Higher confidence**: Edge cases tested systematically
- **Better maintainability**: Shared test fixtures reduce duplication

## Proposed Changes

### 1. Add Unit Tests for Scientists Page Component

**New file**: `tests/unit/pages/Scientists.test.tsx`

**Test coverage**:

- Data fetching on component mount
- Loading state display during fetch
- Error state display when fetch fails
- Empty state display when no scientists exist
- List rendering with multiple scientists (alphabetically sorted)
- List refresh after scientist creation (via `handleScientistCreated` callback)
- Error handling for network/database failures

**Value**: Provides fast, isolated testing for page logic currently only covered by E2E tests.

### 2. Add Edge Case E2E Tests

**Extend**: `tests/e2e/scientists-management.e2e.ts`

**New test scenarios**:

- Maximum length name (255 characters) - validates database schema constraint
- Special characters in name (e.g., "Dr. O'Brien-Smith")
- International characters in email (e.g., "user@münchen.de")
- Rapid double-click prevention (loading state disables form)
- State preservation across page navigation (list remains when navigating away and back)

**Value**: Catches real-world production bugs before they occur.

### 3. Add Test Data Fixtures

**New file**: `tests/fixtures/scientists.ts`

**Exports**:

```typescript
export const createScientistData = (overrides = {}) => ({
  name: 'Dr. Test Scientist',
  email: `test-${Date.now()}@example.com`,
  ...overrides,
});

export const validScientist = createScientistData();
export const maxLengthName = 'A'.repeat(255);
export const specialCharName = "Dr. O'Brien-Smith";
```

**Value**: Reduces duplication, improves consistency, easier to maintain test data across files.

## Alternatives Considered

**Alternative 1**: Only add E2E tests for edge cases

- **Pros**: Simpler (one test file to update)
- **Cons**: Slower feedback, harder to debug page logic issues, doesn't address unit test gap

**Alternative 2**: Add integration tests instead of unit tests

- **Pros**: Tests IPC layer at same time
- **Cons**: Slower than unit tests, more complex setup, doesn't isolate page component logic

**Alternative 3**: Wait until coverage becomes a problem

- **Pros**: Less immediate work
- **Cons**: Technical debt accumulates, harder to add tests later, bugs may reach production

**Chosen approach**: Add both unit tests and edge case E2E tests

- **Rationale**: Provides comprehensive coverage at appropriate abstraction levels (unit for page logic, E2E for user workflows, fixtures for maintainability)

## Dependencies

**Prerequisites**:

- Scientists management UI feature must be implemented (✅ complete)
- Vitest and React Testing Library configured (✅ exists)
- Playwright E2E framework configured (✅ exists)

**Impacts**:

- No breaking changes
- No changes to production code (tests only)
- No changes to dependencies (uses existing test infrastructure)

**Related work**:

- Complements existing ScientistForm unit tests
- Extends existing E2E test coverage
- Follows patterns from `tests/integration/README.md`

## Open Questions

None - straightforward test additions using established patterns.

## Success Criteria

1. **Scientists page unit tests** (`tests/unit/pages/Scientists.test.tsx`):
   - ✅ 7+ test cases covering all page logic paths
   - ✅ Tests run in under 500ms total
   - ✅ All tests pass in CI

2. **Edge case E2E tests** (`tests/e2e/scientists-management.e2e.ts`):
   - ✅ 5+ new test scenarios covering edge cases
   - ✅ All tests pass across Linux, macOS, Windows in CI

3. **Test data fixtures** (`tests/fixtures/scientists.ts`):
   - ✅ Exported factory functions for scientist test data
   - ✅ Used in at least 2 test files (unit and E2E)

4. **Validation**:
   - ✅ `npm run test:unit` passes
   - ✅ `npm run test:e2e` passes
   - ✅ `npx openspec validate add-scientists-ui-tests --strict` passes
