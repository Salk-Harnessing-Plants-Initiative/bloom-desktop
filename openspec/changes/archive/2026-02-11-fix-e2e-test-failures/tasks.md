# Fix E2E Test Failures Tasks

## Phase 1: Fix machine-config-fetch-scanners.e2e.ts ✅

- [x] Read the current test file to understand the structure
- [x] Change `test.beforeAll()` to `test.beforeEach()` for proper test isolation
- [x] Add database cleanup and creation in beforeEach (following other test patterns)
- [x] Do NOT create `~/.bloom/.env` - let app auto-redirect to Machine Config (per spec)
- [x] Add `closeElectronApp()` in afterEach
- [x] Add proper env file backup/restore in beforeEach/afterEach
- [x] Run the fixed tests locally to verify (6/7 pass, 1 intermittent timeout)

## Phase 2: Increase Timeouts (Optional)

- [x] Increase `waitForLoadState` timeout from 30s to 60s in affected files (Not needed - root cause was different)
- [x] Consider adding retry logic for Prisma operations (Not needed - root cause was different)

## Phase 3: Verification

- [x] Run full E2E test suite locally
- [x] Verify CI pipeline passes after push (PR #84 merged successfully)
