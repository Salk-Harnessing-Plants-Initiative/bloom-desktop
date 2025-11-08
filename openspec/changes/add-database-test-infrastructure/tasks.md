# Implementation Tasks

## Phase 1: Shared Test Infrastructure (Foundation)

### Task 1.1: Create log-based test utilities

- [ ] Create `scripts/lib/` directory
- [ ] Create `scripts/lib/test-utils.sh` with bash functions:
  - `wait_for_log_pattern()` - Poll log file for pattern with timeout
  - `extract_database_path()` - Parse database path from logs
  - `check_log_for_errors()` - Scan for error patterns
- [ ] Add tests for utilities (smoke test the test utilities)
- [ ] Document usage in comments

**Validation**: Run utility functions manually to verify they work

### Task 1.2: Create database verification helpers

- [ ] Create `scripts/lib/verify-database.sh` with bash functions:
  - `verify_table_exists()` - Check table exists in SQLite
  - `verify_record_count()` - Count records in table
  - `verify_foreign_keys()` - Check FK constraints
  - `verify_schema()` - Introspect schema matches expected
- [ ] Test with existing dev database
- [ ] Document usage in comments

**Validation**: Run against `prisma/dev.db` to verify utilities work

### Task 1.3: Enhance database handler logging

- [ ] Update `src/main/database-handlers.ts` to add structured logs:
  - Log format: `[DB:CREATE] <model>: {id} <key-field>`
  - Log all CRUD operations (create, read, update, delete)
  - Only enable in dev mode (check `NODE_ENV !== 'production'`)
- [ ] Add log examples to code comments
- [ ] Test locally in dev mode

**Validation**: Start dev app, perform DB operations, verify logs appear

## Phase 2: Dev Mode Electron Database Test (Issue #55)

### Task 2.1: Create dev mode test script

- [ ] Create `scripts/test-dev-database.sh`:
  - Set timeout=60s (dev mode slower)
  - Clean up previous dev.db
  - Launch `npm run start` in background
  - Monitor logs for database initialization
  - Wait for `[Main] Database initialized and handlers registered`
  - Verify database created at `./prisma/dev.db`
  - Kill electron process
  - Report success/failure with clear output
- [ ] Make script executable: `chmod +x scripts/test-dev-database.sh`
- [ ] Add detailed comments explaining each step

**Validation**: Run script locally on macOS, should pass

### Task 2.2: Add npm script for dev database test

- [ ] Add to `package.json`:
  ```json
  "test:dev:database": "bash scripts/test-dev-database.sh"
  ```
- [ ] Test locally: `npm run test:dev:database`

**Validation**: Script runs via npm command

### Task 2.3: Add CI job for dev database test

- [ ] Update `.github/workflows/pr-checks.yml`:
  - Add new job `test-dev-database`
  - Platform: `ubuntu-latest` only (fastest)
  - Steps:
    1. Checkout
    2. Setup Node.js
    3. Setup uv
    4. Install dependencies (`npm ci`)
    5. Generate Prisma client
    6. Build Python executable
    7. Run test: `xvfb-run --auto-servernum npm run test:dev:database`
  - Add to `all-checks-passed` dependencies
- [ ] Push to PR branch and verify job runs

**Validation**: CI job passes on Linux

### Task 2.4: Test dev mode script on Linux locally (optional)

- [ ] If available, run script on Linux machine
- [ ] Verify xvfb setup works correctly

**Validation**: Script works on Linux

## Phase 3: Full Database Operations Test for Packaged App (Issue #56)

### Task 3.1: Enhance packaged database test script

- [ ] Rename current `scripts/test-package-database.sh` to `scripts/test-package-database-full.sh`
- [ ] Extend script to verify CRUD operations:
  - Wait for initialization (existing logic)
  - Use SQLite CLI to query database directly:
    - Verify all tables exist (Scientist, Phenotyper, Experiment, Accession, Scan, Image)
    - Verify schema matches expected (Prisma schema)
    - If app creates default records, verify they exist
  - Check for DB operation logs (from Phase 1.3)
  - Verify foreign key constraints enabled
- [ ] Add timeout for each verification step
- [ ] Add detailed error messages

**Validation**: Run script after packaging locally on macOS

### Task 3.2: Update npm script for full database test

- [ ] Update `package.json`:
  ```json
  "test:package:database": "bash scripts/test-package-database-full.sh"
  ```
- [ ] Test locally: `npm run package && npm run test:package:database`

**Validation**: Script runs successfully after packaging

### Task 3.3: Update CI job for full database test

- [ ] Verify existing `test-package-database` job in `.github/workflows/pr-checks.yml`
- [ ] Confirm it uses updated script (should automatically pick up changes)
- [ ] Update job name if needed to reflect "full" testing
- [ ] Push to PR branch and verify job runs

**Validation**: CI job passes on macOS with enhanced test

### Task 3.4: Test packaged app verification on Linux (optional)

- [ ] If script includes Linux support, test locally
- [ ] Verify xvfb and SQLite work correctly

**Validation**: Script works on Linux if platform supported

## Phase 4: Documentation & Validation

### Task 4.1: Update developer workflows spec

- [ ] Create `openspec/changes/add-database-test-infrastructure/specs/developer-workflows/spec.md`
- [ ] Add ADDED requirements for database testing
- [ ] Include scenarios for dev mode and packaged app tests

**Validation**: Run `openspec validate add-database-test-infrastructure --strict`

### Task 4.2: Document test infrastructure

- [ ] Add comments to all utility scripts
- [ ] Update README.md with new test commands (if needed)
- [ ] Add troubleshooting section to scripts

**Validation**: Read documentation and verify clarity

### Task 4.3: Validate tests fail when they should

- [ ] Inject failure in dev mode (break database path)
- [ ] Run test, verify it fails with clear message
- [ ] Inject failure in packaged app (corrupt database)
- [ ] Run test, verify it fails with clear message

**Validation**: Tests detect failures correctly

### Task 4.4: Run full validation

- [ ] Run `openspec validate add-database-test-infrastructure --strict`
- [ ] Fix any validation errors
- [ ] Verify all tasks completed

**Validation**: OpenSpec validation passes

## Phase 5: Integration & Finalization

### Task 5.1: Run all tests locally

- [ ] Run dev database test: `npm run test:dev:database`
- [ ] Package app: `npm run package`
- [ ] Run packaged database test: `npm run test:package:database`
- [ ] Verify all pass

**Validation**: All tests pass locally

### Task 5.2: Create PR and verify CI

- [ ] Create PR with all changes
- [ ] Verify new CI jobs appear
- [ ] Verify all CI checks pass
- [ ] Check CI timing (should be +5-8 minutes)

**Validation**: All CI jobs pass

### Task 5.3: Format and lint

- [ ] Run `npm run format`
- [ ] Run `npm run lint`
- [ ] Fix any issues

**Validation**: Formatting and linting pass

### Task 5.4: Final review

- [ ] Review all changed files
- [ ] Verify test output is clear and helpful
- [ ] Check for any TODOs or incomplete work
- [ ] Update PR description with changes

**Validation**: PR ready for review

## Dependencies

**Phase 1** must complete before Phase 2 & 3 (utilities needed)
**Phase 2 & 3** can run in parallel (independent tests)
**Phase 4** needs Phase 1-3 complete (documents completed work)
**Phase 5** needs everything complete (integration and finalization)

## Estimated Effort

- Phase 1: 4-6 hours (foundation)
- Phase 2: 3-4 hours (dev mode test)
- Phase 3: 4-6 hours (packaged app test)
- Phase 4: 2-3 hours (documentation)
- Phase 5: 1-2 hours (finalization)

**Total**: 14-21 hours (2-3 full days)
