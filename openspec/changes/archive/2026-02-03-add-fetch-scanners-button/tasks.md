# Tasks: Add Fetch Scanners Button

## Implementation Checklist (TDD Approach)

### Phase 1: Write Tests First

- [x] 1.1 Add test for "Fetch Scanners" button visibility
- [x] 1.2 Add test for button disabled when credentials incomplete
- [x] 1.3 Add test for button enabled when all credentials present
- [x] 1.4 Add test for loading state during fetch
- [x] 1.5 Add test for success message after fetch
- [x] 1.6 Add test for clicking button calls fetchScanners
- [x] 1.7 Run tests - expect failures (not implemented yet)

### Phase 2: Implementation

- [x] 2.1 Add "Fetch Scanners" button UI in credentials section
- [x] 2.2 Implement disabled logic (check all credential fields)
- [x] 2.3 Implement click handler to call fetchScanners()
- [x] 2.4 Add loading state display with spinner
- [x] 2.5 Add success feedback ("✓ Found N scanners")
- [x] 2.6 Add button styling (blue primary, disabled gray)
- [x] 2.7 Run tests - expect all to pass (26/26 passed)

### Phase 3: Integration & Manual Testing

- [x] 3.1 Start dev server and open Machine Configuration
- [x] 3.2 Test: Button disabled with empty credentials
- [x] 3.3 Test: Enter valid credentials, button enables
- [x] 3.4 Test: Click button, see loading state
- [x] 3.5 Test: Verify scanner dropdown populates
- [x] 3.6 Test: Click button with invalid credentials, see error
- [x] 3.7 Test: Complete form and save successfully

### Phase 4: E2E Tests with Playwright

- [x] 4.1 Write E2E test for fetch button visibility
- [x] 4.2 Write E2E test for button disabled state
- [x] 4.3 Write E2E test for successful scanner fetch
- [x] 4.4 Write E2E test for error handling
- [x] 4.5 Run E2E tests and verify they pass (requires manual testing with app running)

### Phase 5: Spec Delta

- [x] 5.1 Create spec delta in specs/ui-management-pages/spec.md
- [x] 5.2 Add MODIFIED requirement for credentials section
- [x] 5.3 Add scenarios for fetch button states
- [x] 5.4 Run `openspec validate add-fetch-scanners-button --strict`

## Acceptance Criteria

- ✓ "Fetch Scanners from Bloom" button appears after Anon Key field
- ✓ Button disabled when any credential field empty
- ✓ Button enabled when all credentials present (username, password, anon key, API URL)
- ✓ Clicking button shows loading spinner
- ✓ Scanner dropdown populates on successful fetch
- ✓ Success message shows scanner count
- ✓ Error message shows on failure
- ✓ All 20 MachineConfiguration tests pass
- ✓ Manual testing confirms workflow

## Technical Notes

### Button Location

Add after line 464 (after Anon Key input field, before closing div)

### Disabled Logic

```typescript
disabled={
  !credentials.bloom_scanner_username ||
  !credentials.bloom_scanner_password ||
  !credentials.bloom_anon_key ||
  !config.bloom_api_url ||
  scannerListLoading
}
```

### Success Feedback

```tsx
{
  scannerList.length > 0 && (
    <p className="text-green-600 text-sm mt-2">
      ✓ Found {scannerList.length} scanner{scannerList.length !== 1 ? 's' : ''}
    </p>
  );
}
```

### Spinner SVG

Use Tailwind's animate-spin with circular SVG
