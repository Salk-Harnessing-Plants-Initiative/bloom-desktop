# Tasks: Renderer Database IPC Testing

**Note**: These tests validate the IPC bridge (renderer → IPC → main → database) without UI components. For reference on full E2E tests with UI, see the pilot's [create-experiments.e2e.ts](https://github.com/eberrigan/bloom-desktop-pilot/blob/benfica/add-testing/app/tests/e2e/create-experiments.e2e.ts) which uses Prisma from test context to verify persistence.

## Phase 1: Test Infrastructure Setup

- [x] Create `tests/integration/renderer-database-ipc.test.ts` test file
- [x] Set up Playwright test fixtures with database setup/teardown
- [x] Implement helper function to launch Electron with test database
- [x] Implement helper function to seed test data via Prisma
- [x] Verify test can launch app and access renderer context

**Validation**: Basic test launches Electron and executes simple `window.evaluate()`

## Phase 2: Scientists IPC Tests

- [x] Test `db:scientists:list` from renderer (empty state)
- [x] Test `db:scientists:list` from renderer (with seeded data)
- [x] Test `db:scientists:create` from renderer (success case)
- [x] Test `db:scientists:create` from renderer (error case - missing email)
- [x] Verify created scientist exists in database via direct query

**Validation**: All scientists IPC handlers work from renderer with correct error handling

## Phase 3: Phenotypers IPC Tests

- [x] Test `db:phenotypers:list` from renderer (empty state)
- [x] Test `db:phenotypers:list` from renderer (with seeded data)
- [x] Test `db:phenotypers:create` from renderer (success case)
- [x] Test `db:phenotypers:create` from renderer (error case - missing email)
- [x] Verify created phenotyper exists in database via direct query

**Validation**: All phenotypers IPC handlers work from renderer with correct error handling

## Phase 4: Accessions IPC Tests

- [x] Test `db:accessions:list` from renderer (empty state)
- [x] Test `db:accessions:list` from renderer (with seeded data)
- [x] Test `db:accessions:create` from renderer (success case)
- [x] Test `db:accessions:create` from renderer (error case - missing required field)
- [x] Verify created accession exists in database via direct query

**Validation**: All accessions IPC handlers work from renderer with correct error handling

## Phase 5: Experiments IPC Tests (with Relations)

- [x] Seed scientist and accession data for experiments
- [x] Test `db:experiments:list` from renderer verifying relations loaded
- [x] Test `db:experiments:get` from renderer with specific ID
- [x] Test `db:experiments:create` from renderer (success case)
- [x] Test `db:experiments:update` from renderer (success case)
- [x] Test `db:experiments:delete` from renderer (success case)
- [x] Test experiments error cases (invalid foreign keys, missing fields)

**Validation**: Experiments CRUD works from renderer with relations correctly loaded

## Phase 6: Scans IPC Tests (with Filters)

- [x] Seed phenotyper and experiment data for scans
- [x] Create multiple test scans with different phenotypers/experiments
- [x] Test `db:scans:list` from renderer without filters (all scans)
- [x] Test `db:scans:list` from renderer with phenotyper_id filter
- [x] Test `db:scans:list` from renderer with experiment_id filter
- [x] Test `db:scans:get` from renderer verifying all relations loaded
- [x] Test scans error cases

**Validation**: Scans queries work from renderer with filters and relations

## Phase 7: Context Isolation Verification

- [x] Test that renderer cannot access `require()` function
- [x] Test that renderer cannot access `process` object directly
- [x] Test that renderer can only access `window.electron.*` APIs
- [x] Verify no main process internals are exposed via window

**Validation**: Context isolation is properly enforced

## Phase 8: CI Integration

- [x] Add `test:renderer:database` script to package.json
- [x] Create CI job `test-renderer-database-ipc` in pr-checks.yml
- [x] Configure job to run on Linux with xvfb
- [x] Set timeout to 5 minutes (expected: ~90 seconds)
- [x] Add job to `all-checks-passed` dependencies
- [x] Fix CI configuration issues (lint errors, unit test exclusions, artifact paths)
- [ ] Verify CI job runs and passes (pending PR update)

**Validation**: Tests run successfully in CI on Linux

## Phase 9: Documentation

- [x] Update README.md with `npm run test:renderer:database` command
- [x] Add test description to tests/integration/README.md (or create if missing)
- [x] Document test patterns for future renderer IPC tests
- [ ] Update Issue #58 with completion status (after CI verification)

**Validation**: Documentation clearly explains how to run and extend renderer IPC tests
