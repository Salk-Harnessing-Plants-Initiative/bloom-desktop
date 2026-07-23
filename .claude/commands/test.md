# Run Tests

Run bloom-desktop's fast unit test suites (TypeScript + Python). Use watch mode during development; use a single run before pushing or in CI.

## Commands

```bash
# Watch mode — TypeScript (re-runs on file change, use during active development)
npm run test:unit:watch

# Single run — TypeScript unit tests (Vitest)
npm run test:unit

# Single run — Python unit tests (pytest, 80% coverage enforced)
npm run test:python
```

Python has no watch-mode script; re-run `uv run pytest python/tests/test_<module>.py -v` after each change during active development.

For hardware, IPC, and full-workflow coverage, see the dedicated commands below — they are not part of this fast unit loop:

- `/integration-testing` — IPC, camera, DAQ, scanner (mock hardware)
- `/hardware-testing` — real vs. mock hardware testing
- `/e2e-testing` — Playwright E2E against the packaged/dev app
- `/database-migration` — schema migration tests

## Test Layout

- **TypeScript**: `tests/unit/` (colocated by feature, e.g. `tests/unit/graviscan/`)
- **Python**: `python/tests/`, matching `python/` module structure (`test_*.py`)

When adding a new source file, follow whichever convention the affected directory already uses.

## Test Environment

- TypeScript: `vitest.config.ts` (happy-dom environment, coverage thresholds)
- Python: `pyproject.toml` `[tool.pytest.ini_options]` (testpaths, coverage fail-under)
- Tests that touch the database use fixtures/mocks — never write to `bloom.db` from a unit test.

## What to Do After Running

1. **Fix failing tests** — investigate the failure rather than skipping or weakening assertions.
2. **Add tests for new code** — new IPC handlers, utilities, and React component logic should have at least a happy-path test.
3. **Watch for flaky tests** — mock hardware timers, subprocess I/O, and wall-clock dependencies.

## Common Issues

### Tests pass but type errors exist

Vitest (via esbuild) strips TypeScript without full type checking. Passing tests do **not** guarantee type safety. Always run `npx tsc --noEmit` separately — `/lint` and `/pre-merge` already chain both.

### Test file not picked up by the runner

Check `vitest.config.ts` `include` pattern (TS) or `pyproject.toml` `python_files` (Python: `test_*.py`). Rename the file to match if it falls outside the pattern.

### Python coverage fails below 80%

`pyproject.toml` sets `--cov-fail-under=80`. Add tests for the uncovered module rather than lowering the threshold.

## Type Checker vs Test Runner

| Tool | Catches | Misses |
|---|---|---|
| `npm run test:unit` / `npm run test:python` | Runtime behavior, logic bugs, regressions | Type errors |
| `npx tsc --noEmit` / `uv run mypy python/` | Type errors | Runtime behavior |

Run both — `/pre-merge` enforces this.

## TDD Workflow

For new features and bug fixes, prefer the test-first cycle — see `/tdd` for the full red-green-refactor workflow. The `superpowers:test-driven-development` skill formalizes this for non-trivial implementation work.

## OpenSpec alignment

If this test closes a task in an active OpenSpec change, mark it `- [x]` in `openspec/changes/<id>/tasks.md` once it passes.

## Related Commands

- `/lint` — Run before tests to catch type errors quickly
- `/coverage` — Run tests with coverage reporting
- `/dev` — Manually verify UI changes after tests pass
- `/tdd` — Structured red-green-refactor loop
- `/pre-merge` — Full gate before opening a PR
