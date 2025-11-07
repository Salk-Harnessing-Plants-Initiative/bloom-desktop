# Test Coverage

Check test coverage across TypeScript unit tests, Python unit tests, integration tests, and E2E tests.

## Commands

### TypeScript Unit Test Coverage

```bash
# Run TypeScript unit tests with coverage report
npm run test:unit:coverage

# View HTML coverage report (after running coverage)
open coverage/index.html  # macOS
xdg-open coverage/index.html  # Linux
start coverage/index.html  # Windows
```

### Python Unit Test Coverage

```bash
# Run Python unit tests with coverage report (80% minimum enforced)
npm run test:python

# View Python coverage report in terminal
uv run pytest --cov=python --cov-report=term

# Generate HTML coverage report for Python
uv run pytest --cov=python --cov-report=html
open htmlcov/index.html  # View in browser
```

### Integration Test Coverage

```bash
# Integration tests verify critical paths, not measured by coverage tools
npm run test:ipc              # IPC communication (TypeScript ↔ Python)
npm run test:camera           # Camera interface with mock camera
npm run test:daq              # DAQ interface with mock DAQ
npm run test:scanner          # Full scanner workflow
npm run test:scanner-database # Scanner database integration
```

### E2E Test Coverage

```bash
# E2E tests verify user workflows, not measured by coverage tools
npm run test:e2e              # All E2E tests
npm run test:e2e:ui           # Interactive mode
```

## Coverage Goals

### TypeScript Coverage (50% minimum)

- **Current threshold**: 50% overall coverage (enforced in `vitest.config.ts`)
- **Goal**: Core business logic should have higher coverage (80%+)
- **What to focus on**:
  - IPC handlers (database, camera, scanner)
  - Business logic in utils and helpers
  - React component logic (not just rendering)
- **What's okay to skip**:
  - Simple type definitions
  - Configuration files
  - Trivial getters/setters

### Python Coverage (80% minimum)

- **Current threshold**: 80% overall coverage (enforced in `pyproject.toml`)
- **CI enforcement**: Tests will FAIL if coverage drops below 80%
- **What to cover**:
  - All hardware interfaces (camera, DAQ, scanner)
  - IPC command handlers
  - Data processing and validation
  - Mock hardware implementations
- **What's okay to skip**:
  - Type stub files (`*.pyi`)
  - Test files themselves

### Integration Test Coverage

Integration tests don't have coverage metrics, but should cover:

- ✅ All IPC command types (check_hardware, start_stream, etc.)
- ✅ Camera connection and streaming
- ✅ DAQ device control
- ✅ Full scanner workflow (rotation + capture)
- ✅ Database persistence (scans, images, metadata)
- ✅ Packaged app functionality

### E2E Test Coverage

E2E tests should cover:

- ✅ App launch and initialization
- ✅ Database creation and migrations
- ✅ Basic UI navigation
- ✅ Critical user workflows

## Understanding Coverage Reports

### TypeScript Coverage (Vitest)

After running `npm run test:unit:coverage`, check:

- **Statements**: Lines of code executed
- **Branches**: Conditional branches (if/else) taken
- **Functions**: Functions called
- **Lines**: Individual lines executed

View detailed report: `coverage/index.html`

### Python Coverage (pytest-cov)

After running `npm run test:python`, check terminal output:

```
Name                              Stmts   Miss  Cover
-----------------------------------------------------
python/ipc_handler.py               150      5    97%
python/hardware/camera.py           200     15    93%
python/hardware/camera_mock.py      120      2    98%
-----------------------------------------------------
TOTAL                               470     22    95%
```

## Common Coverage Issues

### TypeScript coverage below 50%

**Cause**: New code added without tests

**Solution**:

1. Identify uncovered code: `npm run test:unit:coverage` and check report
2. Add unit tests for new functions/components
3. Focus on business logic first (not just rendering)

### Python coverage below 80%

**Cause**: New modules or functions without tests

**Solution**:

1. Run `npm run test:python` to see coverage report
2. CI will FAIL if below 80% - must fix before merging
3. Add tests to `tests/python/` matching module structure
4. Use mock objects for hardware dependencies

### Integration tests not covering new features

**Cause**: New IPC commands or workflows added without integration tests

**Solution**:

1. Add integration test in `tests/integration/`
2. Use mock hardware (tests run in CI without real devices)
3. Follow existing test patterns (e.g., `test-camera.ts`)

## CI Coverage Enforcement

Coverage checks run in CI (`.github/workflows/pr-checks.yml`):

- **Test - TypeScript Unit** job: Runs `npm run test:unit:coverage` (50% minimum)
- **Test - Python** job: Runs pytest with coverage (80% minimum, enforced - will FAIL if below)
- **Test - Integration** jobs: All integration tests must pass (Linux, macOS, Windows)

## Configuration Files

- **TypeScript**: `vitest.config.ts` - Coverage thresholds under `coverage` section
- **Python**: `pyproject.toml` - Coverage config under `[tool.coverage.run]` and `[tool.coverage.report]`

## Related Commands

- `/lint` - Run linting before checking coverage
- `/integration-testing` - Guide for integration test workflows
- `/e2e-testing` - Guide for E2E test workflows