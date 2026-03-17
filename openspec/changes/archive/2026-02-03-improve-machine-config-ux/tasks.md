# Tasks: Improve Machine Configuration UX

## Implementation Checklist

### Phase 1: Component Refactoring

- [x] Read current MachineConfiguration.tsx component structure
- [x] Identify the three main sections (Credentials, Machine Identity, Hardware)
- [x] Reorder JSX sections: Credentials → Machine Identity → Hardware
- [x] Verify no state logic changes required
- [x] Run TypeScript compilation check

### Phase 2: Test Updates (TDD)

- [x] Run existing MachineConfiguration tests to identify failures
- [x] Update tests to be resilient to section order (query by label/role, not position)
- [x] Add test to verify section order in DOM
- [x] Verify all 20 MachineConfiguration tests pass
- [x] Verify no regressions in other test files

### Phase 3: Validation

- [x] Run full unit test suite
- [x] Manual test: First-run experience (no credentials)
- [x] Manual test: Existing configuration (credentials present)
- [x] Manual test: Keyboard navigation (tab order)
- [x] Manual test: Form completion top-to-bottom

---

## Implementation Notes

This proposal has been fully implemented. Section order in MachineConfiguration.tsx:

1. **Bloom API Credentials** (line 224) - h2 heading at top
2. **Station Identity** (line 376) - Scanner Name section
3. **Hardware** (line 461) - Camera IP and Scans Directory

Verified by grep showing section headings in order:

- Line 225: "Bloom API Credentials"
- Line 377: "Station Identity"
- Line 461: "Hardware"

24 MachineConfiguration tests passing.
