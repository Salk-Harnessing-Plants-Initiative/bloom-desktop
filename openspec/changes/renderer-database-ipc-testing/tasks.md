# Tasks: Renderer Database IPC Testing

## Phase 1: Test Infrastructure Setup

- [ ] Create `tests/integration/renderer-database-ipc.test.ts` test file
- [ ] Set up Playwright test fixtures with database setup/teardown
- [ ] Implement helper function to launch Electron with test database
- [ ] Implement helper function to seed test data via Prisma
- [ ] Verify test can launch app and access renderer context

**Validation**: Basic test launches Electron and executes simple `window.evaluate()`

## Phase 2: Scientists IPC Tests

- [ ] Test `db:scientists:list` from renderer (empty state)
- [ ] Test `db:scientists:list` from renderer (with seeded data)
- [ ] Test `db:scientists:create` from renderer (success case)
- [ ] Test `db:scientists:create` from renderer (error case - missing email)
- [ ] Verify created scientist exists in database via direct query

**Validation**: All scientists IPC handlers work from renderer with correct error handling

## Phase 3: Phenotypers IPC Tests

- [ ] Test `db:phenotypers:list` from renderer (empty state)
- [ ] Test `db:phenotypers:list` from renderer (with seeded data)
- [ ] Test `db:phenotypers:create` from renderer (success case)
- [ ] Test `db:phenotypers:create` from renderer (error case - missing email)
- [ ] Verify created phenotyper exists in database via direct query

**Validation**: All phenotypers IPC handlers work from renderer with correct error handling

## Phase 4: Accessions IPC Tests

- [ ] Test `db:accessions:list` from renderer (empty state)
- [ ] Test `db:accessions:list` from renderer (with seeded data)
- [ ] Test `db:accessions:create` from renderer (success case)
- [ ] Test `db:accessions:create` from renderer (error case - missing required field)
- [ ] Verify created accession exists in database via direct query

**Validation**: All accessions IPC handlers work from renderer with correct error handling

## Phase 5: Experiments IPC Tests (with Relations)

- [ ] Seed scientist and accession data for experiments
- [ ] Test `db:experiments:list` from renderer verifying relations loaded
- [ ] Test `db:experiments:get` from renderer with specific ID
- [ ] Test `db:experiments:create` from renderer (success case)
- [ ] Test `db:experiments:update` from renderer (success case)
- [ ] Test `db:experiments:delete` from renderer (success case)
- [ ] Test experiments error cases (invalid foreign keys, missing fields)

**Validation**: Experiments CRUD works from renderer with relations correctly loaded

## Phase 6: Scans IPC Tests (with Filters)

- [ ] Seed phenotyper and experiment data for scans
- [ ] Create multiple test scans with different phenotypers/experiments
- [ ] Test `db:scans:list` from renderer without filters (all scans)
- [ ] Test `db:scans:list` from renderer with phenotyper_id filter
- [ ] Test `db:scans:list` from renderer with experiment_id filter
- [ ] Test `db:scans:get` from renderer verifying all relations loaded
- [ ] Test scans error cases

**Validation**: Scans queries work from renderer with filters and relations

## Phase 7: Context Isolation Verification

- [ ] Test that renderer cannot access `require()` function
- [ ] Test that renderer cannot access `process` object directly
- [ ] Test that renderer can only access `window.electron.*` APIs
- [ ] Verify no main process internals are exposed via window

**Validation**: Context isolation is properly enforced

## Phase 8: CI Integration

- [ ] Add `test:renderer:database` script to package.json
- [ ] Create CI job `test-renderer-database-ipc` in pr-checks.yml
- [ ] Configure job to run on Linux with xvfb
- [ ] Set timeout to 5 minutes (expected: ~90 seconds)
- [ ] Add job to `all-checks-passed` dependencies
- [ ] Verify CI job runs and passes

**Validation**: Tests run successfully in CI on Linux

## Phase 9: Documentation

- [ ] Update README.md with `npm run test:renderer:database` command
- [ ] Add test description to tests/integration/README.md (or create if missing)
- [ ] Document test patterns for future renderer IPC tests
- [ ] Update Issue #58 with completion status

**Validation**: Documentation clearly explains how to run and extend renderer IPC tests