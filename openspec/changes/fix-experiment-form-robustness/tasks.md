## TDD Plan

### Phase 1: Unit Tests (RED)

- [x] 1.1 Write unit test: whitespace-only name shows "Name is required" error
- [x] 1.2 Verify new test FAILS against current code

### Phase 2: Implementation (GREEN)

- [x] 2.1 Add `.trim()` to Zod schema for name field
- [x] 2.2 Remove redundant `.trim()` call in `onSubmit` (schema now handles it)
- [x] 2.3 Verify whitespace-only name test PASSES

### Phase 3: Test Robustness

- [x] 3.1 Add `win.electron.database` guard in test `beforeEach`
- [x] 3.2 Add null-check assertions in `getFormElements()` helper

### Phase 4: Verify

- [x] 4.1 Run full unit test suite — all pass
- [x] 4.2 Format and lint