# Tasks: Improve Machine Configuration UX

## Implementation Checklist

### Phase 1: Component Refactoring

- [ ] Read current MachineConfiguration.tsx component structure
- [ ] Identify the three main sections (Credentials, Machine Identity, Hardware)
- [ ] Reorder JSX sections: Credentials → Machine Identity → Hardware
- [ ] Verify no state logic changes required
- [ ] Run TypeScript compilation check

### Phase 2: Test Updates (TDD)

- [ ] Run existing MachineConfiguration tests to identify failures
- [ ] Update tests to be resilient to section order (query by label/role, not position)
- [ ] Add test to verify section order in DOM
- [ ] Verify all 20 MachineConfiguration tests pass
- [ ] Verify no regressions in other test files

### Phase 3: Validation

- [ ] Run full unit test suite
- [ ] Manual test: First-run experience (no credentials)
- [ ] Manual test: Existing configuration (credentials present)
- [ ] Manual test: Keyboard navigation (tab order)
- [ ] Manual test: Form completion top-to-bottom

## Acceptance Criteria

- ✓ Bloom API Credentials section appears first
- ✓ Machine Identity section appears second
- ✓ Hardware section appears third
- ✓ All existing functionality preserved (no behavior changes)
- ✓ All tests pass (20 MachineConfiguration tests + 156 other tests)
- ✓ Form completion follows top-to-bottom flow
- ✓ Tab order follows visual order

## Non-Goals

- ❌ Changing field validation logic
- ❌ Modifying API integration
- ❌ Adding or removing form fields
- ❌ Changing visual styling (colors, spacing, fonts)
- ❌ Refactoring state management

## Testing Notes

### Expected Test Updates

Tests that may need updates:

1. Section order assertions
2. DOM traversal that depends on order
3. Accessibility tree order checks

### Test Strategy

Use stable queries:

```tsx
// ✓ Good (order-independent)
screen.getByLabelText(/Username/i);
screen.getByRole('heading', { name: /Bloom API Credentials/i });

// ✗ Avoid (order-dependent)
container.querySelector('div:nth-child(1)');
```

## Manual Testing Checklist

### First-Run Experience

1. Delete `~/.bloom/config.json` and `~/.bloom/.env`
2. Start app → navigate to Machine Configuration
3. Verify Bloom API Credentials section appears first
4. Verify scanner dropdown shows "Enter credentials first"
5. Enter credentials → Save
6. Verify scanner dropdown populates
7. Complete form → Save
8. Verify configuration persists

### Existing Configuration

1. Ensure `~/.bloom/config.json` and `~/.bloom/.env` exist
2. Start app → navigate to Machine Configuration
3. Verify login screen appears (credentials exist)
4. Authenticate
5. Verify Bloom API Credentials section appears first (with masked password)
6. Verify scanner dropdown is populated and pre-selected
7. Modify fields → Save
8. Verify changes persist

### Keyboard Navigation

1. Load Machine Configuration page
2. Tab through form fields
3. Verify order: Username → Password → Anon Key → API URL → Scanner → Camera IP → Scans Dir → Browse → Save
4. Verify no focus traps
5. Verify focus visible for all fields

## Rollback Plan

If issues arise:

1. Revert MachineConfiguration.tsx section order
2. Revert test updates
3. Run test suite to verify rollback successful

No database, API, or config file changes required.
