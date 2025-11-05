# Implementation Tasks: E2E Testing Framework

## 1. Configuration Files

- [ ] 1.1 Create/Update `playwright.config.ts` with proper test directory, patterns, timeout, and worker settings
- [ ] 1.2 Create/Update `.env.e2e` with E2E-specific environment variables (BLOOM_DATABASE_URL)
- [ ] 1.3 Update `.gitignore` to exclude Playwright artifacts (`playwright-report/`, `test-results/`, `.playwright/`)

## 2. Webpack Build Automation

- [ ] 2.1 Create `scripts/build-webpack-dev.js` to automate webpack build for E2E setup
- [ ] 2.2 Implement logic to check if `.webpack/` artifacts exist before building
- [ ] 2.3 Configure script to build both main and renderer webpack configs
- [ ] 2.4 Add error handling and console output for build status

## 3. E2E Test Suite

- [ ] 3.1 Create/Update `tests/e2e/app-launch.e2e.ts` with proper Electron launch configuration
- [ ] 3.2 Implement beforeEach hook with database cleanup and schema creation via `prisma db push`
- [ ] 3.3 Implement Electron launch using `electron.launch({ args: ['.'] })` approach (avoid direct path to avoid --remote-debugging-port issue)
- [ ] 3.4 Implement afterEach hook to close Electron app and clean up test database
- [ ] 3.5 Write test: "should launch successfully and show window" (verify app, window, title, visibility)
- [ ] 3.6 Write test: "should initialize database on startup" (verify test.db file exists after 3-second delay)
- [ ] 3.7 Write test: "should display page content" (verify body content after networkidle)

## 4. npm Scripts

- [ ] 4.1 Add `build:webpack` script to package.json: `npx webpack --config webpack.main.config.ts --config webpack.renderer.config.ts`
- [ ] 4.2 Add `test:e2e` script: `playwright test` (dependencies built by CI or manually)
- [ ] 4.3 Add `test:e2e:ui` script: `playwright test --ui`
- [ ] 4.4 Add `test:e2e:debug` script: `playwright test --debug`

## 5. CI/CD Integration

- [ ] 5.1 Add `test-e2e-dev` job to `.github/workflows/pr-checks.yml`
- [ ] 5.2 Configure job matrix for ubuntu-latest, macos-latest, windows-latest
- [ ] 5.3 Add step to install Node.js dependencies with npm ci
- [ ] 5.4 Add step to install Playwright browsers with `npx playwright install --with-deps`
- [ ] 5.5 Add step to build Python executable with `npm run build:python`
- [ ] 5.6 Add step to generate Prisma Client with `npx prisma generate`
- [ ] 5.7 Add step to build webpack dev build with `node scripts/build-webpack-dev.js`
- [ ] 5.8 Add step to start webpack dev server in background (for renderer HMR)
- [ ] 5.9 Add step to run Playwright E2E tests with `npm run test:e2e`
- [ ] 5.10 Add step to stop webpack dev server in cleanup (always runs)
- [ ] 5.11 Add step to upload Playwright artifacts on failure (traces, screenshots, videos) with 7-day retention
- [ ] 5.12 Update `all-checks-passed` job to depend on `test-e2e-dev`

## 6. Testing & Validation

- [ ] 6.1 Run E2E tests locally on development machine: `npm run test:e2e`
- [ ] 6.2 Verify all 3 tests pass: app launch, database initialization, page content
- [ ] 6.3 Run E2E tests in UI mode to verify debugging capabilities: `npm run test:e2e:ui`
- [ ] 6.4 Test cleanup: verify test database is deleted after tests complete
- [ ] 6.5 Test isolation: run tests multiple times to ensure no state leakage
- [ ] 6.6 Push to PR branch and verify CI E2E tests pass on all platforms (Linux, macOS, Windows)

## 7. Documentation

- [ ] 7.1 Update main README.md with E2E testing section explaining how to run tests
- [ ] 7.2 Document environment variables in `.env.e2e` with inline comments
- [ ] 7.3 Add comments to `playwright.config.ts` explaining configuration choices
- [ ] 7.4 Add JSDoc comments to E2E test file explaining test structure and approach
- [ ] 7.5 Update or create E2E testing documentation in `docs/E2E_TESTING.md` (optional)
- [ ] 7.6 Archive `PLAYWRIGHT_E2E_STATUS.md` or update to reflect completed status

## 8. OpenSpec Archival (After Deployment)

- [ ] 8.1 Verify all tasks completed and E2E tests passing in production
- [ ] 8.2 Create new spec file: `openspec/specs/e2e-testing/spec.md` with finalized requirements
- [ ] 8.3 Run `openspec archive add-e2e-testing-framework --yes` to move to archive
- [ ] 8.4 Verify archived change with `openspec validate --strict`
- [ ] 8.5 Commit spec updates and archive in separate PR

## Notes

- **Critical**: Use `electron.launch({ args: ['.'] })` approach, NOT direct path to webpack file, to avoid --remote-debugging-port error
- **Database Path**: E2E database uses relative path `file:../tests/e2e/test.db` which resolves to `prisma/tests/e2e/test.db` from prisma/ directory
- **Webpack Dev Server**: Only needed in CI for renderer HMR; local dev can skip if webpack build exists
- **Test Order**: Execute tasks sequentially - each task depends on previous completion
