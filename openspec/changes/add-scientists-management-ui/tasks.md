# Tasks: Add Scientists Management UI

## Phase 1: Setup and Dependencies

- [ ] Add new dependencies to package.json
  - [ ] Add `zod@^3.22.4`
  - [ ] Add `react-hook-form@^7.51.0`
  - [ ] Add `@hookform/resolvers@^3.3.4`
- [ ] Run `npm install` to install new dependencies
- [ ] Verify TypeScript types are available for new dependencies

## Phase 2: Component Implementation

- [ ] Create ScientistForm component
  - [ ] Define Zod validation schema for Scientist
  - [ ] Implement form with React Hook Form
  - [ ] Add email format validation
  - [ ] Add name required validation
  - [ ] Handle form submission with IPC call
  - [ ] Display validation errors inline
  - [ ] Add loading state during submission
  - [ ] Show success/error feedback after submission
  - [ ] Reset form after successful creation
- [ ] Create Scientists page component
  - [ ] Implement list view section
  - [ ] Integrate ScientistForm component
  - [ ] Add loading state for initial data fetch
  - [ ] Handle empty state (no scientists yet)
  - [ ] Implement on-demand refresh after create
  - [ ] Add error handling for list fetch failures
  - [ ] Style with Tailwind CSS matching pilot aesthetics

## Phase 3: Routing Integration

- [ ] Add `/scientists` route to App.tsx
- [ ] Add "Scientists" navigation link to Layout.tsx
- [ ] Verify navigation works in development mode
- [ ] Test route in packaged mode

## Phase 4: Testing

### E2E Tests
- [ ] Create `tests/e2e/scientists-management.e2e.ts`
  - [ ] Test: List scientists (empty state)
  - [ ] Test: Create scientist with valid data
  - [ ] Test: List scientists (displays created scientist)
  - [ ] Test: Validation error - empty name
  - [ ] Test: Validation error - invalid email format
  - [ ] Test: Database constraint error - duplicate email
- [ ] Verify all E2E tests pass in both dev and packaged modes

### Unit Tests
- [ ] Create `tests/unit/components/ScientistForm.test.tsx`
  - [ ] Test: Renders form fields
  - [ ] Test: Shows validation errors
  - [ ] Test: Calls IPC handler on valid submission
  - [ ] Test: Resets form after successful submission
  - [ ] Test: Shows error message on submission failure
- [ ] Verify unit tests pass
- [ ] Verify TypeScript coverage meets 50%+ threshold

## Phase 5: Documentation and PR

- [ ] Update CHANGELOG.md with new feature
- [ ] Take screenshots of Scientists page for PR description
- [ ] Create pull request
  - [ ] Reference this OpenSpec proposal
  - [ ] Include before/after comparison with pilot
  - [ ] Document code quality improvements
  - [ ] List new dependencies and rationale
- [ ] Verify all CI checks pass
  - [ ] E2E tests pass (31 → 36 tests)
  - [ ] IPC coverage meets 90% threshold
  - [ ] TypeScript coverage meets 50% threshold
  - [ ] Linting passes
  - [ ] Build succeeds

## Phase 6: Validation and Merge

- [ ] Address PR review feedback
- [ ] Squash commits if needed
- [ ] Merge PR to main
- [ ] Archive this OpenSpec proposal
- [ ] Update OpenSpec index if needed
