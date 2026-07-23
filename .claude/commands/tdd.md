# Test-Driven Development (TDD)

Structured TDD workflow for bloom-desktop: write tests first, then implement the minimum code to pass them, then refactor.

## Purpose

Writing tests before code ensures:

1. Requirements are captured as executable tests before implementation
2. Edge cases are considered upfront (hardware disconnected, empty scan session, IPC timeout)
3. Metadata and IPC contracts have known-answer fixtures that can be verified independently
4. Regressions are caught immediately

## TDD Cycle

### Phase 1: Red (Write Failing Tests)

Write tests that define the expected behavior before writing any implementation. Place them per the repo's layout (see `/test`):

- TypeScript: `tests/unit/<area>/<name>.test.ts` (Vitest + `@testing-library/react` for components)
- Python: `python/tests/test_<module>.py` (pytest)

```
TestNewFeature:
  test_basic_functionality        — normal input → expected output
  test_edge_case_empty             — empty/null input → defined behavior
  test_hardware_disconnected       — mock hardware absent → graceful error, no crash
  test_ipc_contract                — IPC payload/response matches the typed contract
```

### Phase 2: Confirm Red

```bash
# TypeScript
npm run test:unit -- <name>.test.ts

# Python
uv run pytest python/tests/test_<module>.py -v
```

New tests should fail with an import/attribute/name error or an assertion — not an unexpected crash. If they fail for the wrong reason, fix the test setup before proceeding.

### Phase 3: Green (Implement the Feature)

Write the minimum code to make all tests pass. Re-run the same command above until green.

### Phase 4: Refactor

Improve the implementation while keeping tests green:

1. Clean up structure and remove duplication
2. Add TypeScript types / Python type hints
3. Improve naming
4. Extract helpers if logic is reused across IPC handlers

Re-run tests after each refactor step.

### Phase 5: Verify Quality

```bash
# Format check
npm run format:check
uv run black --check python/

# Lint + type check
npm run lint
uv run ruff check python/
uv run mypy python/
npx prisma generate && npx tsc --noEmit

# Full test suite (not just the new module)
npm run test:unit
npm run test:python

# Coverage for the new module
npm run test:unit:coverage
```

### Phase 6: Commit

```bash
git add <impl-file> <test-file>
git commit -m "feat: add <feature description>

- Tests define expected behavior including edge cases
- Implementation satisfies all test cases
- Hardware-mock and IPC-contract fixtures verify correctness"
```

## Testing Patterns

### Known-Answer Tests

For IPC contracts or computed values, provide a hand-verified fixture:

```typescript
const input = { exposureMs: 50, gain: 1.2 };
const result = validateCameraSettings(input);
expect(result.valid).toBe(true);
expect(result.errors).toEqual([]);
```

### Boundary Condition Tests

```
test_minimum_valid_exposure   — smallest exposure that must succeed
test_below_minimum_exposure   — rejected with a specific error, not a crash
test_maximum_valid_exposure   — largest exposure the hardware promises to handle
```

### Mock Hardware Tests

Bloom Desktop tests never touch real hardware in CI — use the existing mock camera/DAQ/scanner fixtures (`GRAVISCAN_MOCK=true`, mock camera/DAQ modules under `python/hardware/`):

```
test_camera_mock_connects
test_camera_mock_disconnect_mid_scan   — disconnect during an in-flight scan is handled, not silently dropped
```

### Parametrized Tests

```python
@pytest.mark.parametrize("exposure_ms", [1, 50, 1000, 5000])
def test_exposure_within_range(exposure_ms):
    result = validate_exposure(exposure_ms)
    assert result.valid
```

### Test Fixtures / Shared Setup

```python
@pytest.fixture
def mock_camera():
    return MockCamera(exposure_ms=50, gain=1.0)
```

## Integration

- Run `/lint` during Phase 5 to check code style
- Run `/coverage` to verify the new module meets the repo's threshold (50% TS / 80% Python)
- Run `/run-ci-locally` before committing to confirm the full CI gate passes
- Run `/pre-merge` before opening a PR

## OpenSpec alignment

If this feature implements or changes a contract captured in an OpenSpec proposal, verify:

```bash
npx openspec validate <id> --strict
```

All tasks in `openspec/changes/<id>/tasks.md` that this feature closes should be checked off (`- [x]`) before the commit.

## Related Commands

- `/test` — run the test suite directly
- `/lint` — lint + typecheck
- `/coverage` — coverage report
- `/run-ci-locally` — full CI gate
- `/pre-merge` — final gate before opening a PR
