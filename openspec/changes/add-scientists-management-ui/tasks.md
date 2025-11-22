# Tasks: Add Scientists Management UI

## Phase 1: Setup and Dependencies

- [x] Add new dependencies to package.json
  - [x] Add `zod@^3.22.4`
  - [x] Add `react-hook-form@^7.51.0`
  - [x] Add `@hookform/resolvers@^3.3.4`
- [x] Run `npm install` to install new dependencies
- [x] Verify TypeScript types are available for new dependencies

## Phase 2: Component Implementation

- [x] Create ScientistForm component
  - [x] Define Zod validation schema for Scientist
  - [x] Implement form with React Hook Form
  - [x] Add email format validation
  - [x] Add name required validation
  - [x] Handle form submission with IPC call
  - [x] Display validation errors inline
  - [x] Add loading state during submission
  - [x] Show success/error feedback after submission
  - [x] Reset form after successful creation
- [x] Create Scientists page component
  - [x] Implement list view section
  - [x] Integrate ScientistForm component
  - [x] Add loading state for initial data fetch
  - [x] Handle empty state (no scientists yet)
  - [x] Implement on-demand refresh after create
  - [x] Add error handling for list fetch failures
  - [x] Style with Tailwind CSS matching pilot aesthetics

## Phase 3: Routing Integration

- [x] Add `/scientists` route to App.tsx
- [x] Add "Scientists" navigation link to Layout.tsx
- [x] Verify navigation works in development mode
- [x] Test route in packaged mode

## Phase 4: Testing

### E2E Tests

- [x] Create `tests/e2e/scientists-management.e2e.ts`
  - [x] Test: List scientists (empty state)
  - [x] Test: Create scientist with valid data
  - [x] Test: List scientists (displays created scientist)
  - [x] Test: Validation error - empty name
  - [x] Test: Validation error - invalid email format
  - [x] Test: Database constraint error - duplicate email
- [x] Verify all E2E tests pass in both dev and packaged modes

### Unit Tests

- [x] Create `tests/unit/components/ScientistForm.test.tsx`
  - [x] Test: Renders form fields
  - [x] Test: Shows validation errors
  - [x] Test: Calls IPC handler on valid submission
  - [x] Test: Resets form after successful submission
  - [x] Test: Shows error message on submission failure
- [x] Verify unit tests pass
- [x] Verify TypeScript coverage meets 50%+ threshold

## Phase 5: Documentation and PR

- [x] Update CHANGELOG.md with new feature
- [x] Take screenshots of Scientists page for PR description
- [x] Create pull request
  - [x] Reference this OpenSpec proposal
  - [x] Include before/after comparison with pilot
  - [x] Document code quality improvements
  - [x] List new dependencies and rationale
- [x] Verify all CI checks pass
  - [x] E2E tests pass (31 → 46 tests)
  - [x] IPC coverage meets 90% threshold
  - [x] TypeScript coverage meets 50% threshold
  - [x] Linting passes
  - [x] Build succeeds

## Phase 6: Validation and Merge

- [x] Address PR review feedback
- [x] Squash commits if needed
- [ ] Merge PR to main
- [ ] Archive this OpenSpec proposal
- [ ] Update OpenSpec index if needed
