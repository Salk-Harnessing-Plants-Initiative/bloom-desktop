# Proposal: End-to-End Testing Framework with Playwright

## Why

The bloom-desktop application currently lacks comprehensive end-to-end testing for the full Electron application lifecycle. While we have:
- Python unit tests (80%+ coverage)
- TypeScript unit tests (50%+ coverage)
- Integration tests for IPC, camera, DAQ, and scanner components

We need E2E tests that validate the complete user experience including:
- Electron app launch and window management
- Database initialization across environments (dev, E2E, production)
- UI rendering and user interactions
- Full workflow testing (experiment creation → scan capture → data persistence)

**Problem**: Without E2E tests, we cannot catch integration issues between Electron, React UI, Python subprocess, and database that only manifest in the complete application.

**Opportunity**: Playwright provides industry-standard E2E testing for Electron apps with excellent debugging capabilities, cross-platform support, and CI integration.

## What Changes

### New Capabilities
- Playwright framework for Electron E2E testing with dev build approach
- E2E test for app launch, window creation, and basic UI validation
- E2E test for database initialization with environment-specific paths
- E2E environment configuration (`.env.e2e`) for isolated test database
- Webpack build automation for E2E test setup
- CI integration for E2E tests across Linux, macOS, Windows

### Configuration Files
- `playwright.config.ts` - Playwright test configuration
- `.env.e2e` - E2E-specific environment variables
- `tests/e2e/app-launch.e2e.ts` - Core E2E test suite
- `scripts/build-webpack-dev.js` - Webpack build script for E2E setup

### npm Scripts
- `test:e2e` - Run E2E tests with webpack dev build
- `test:e2e:ui` - Run E2E tests with Playwright UI
- `test:e2e:debug` - Run E2E tests in debug mode

### CI Workflow Updates
- Add E2E test job running on Linux, macOS, Windows
- Build webpack dev server before E2E tests
- Capture Playwright traces, screenshots, videos on failure

### Testing Strategy
**Two-tiered approach**:
1. **Primary**: Playwright with webpack dev build (fast, local development)
2. **Secondary**: Existing integration test for packaged apps (`test:package:database`)

**Rationale**: Playwright's `_electron` API works with dev builds but not packaged apps due to debugging flags. Dev build testing catches 95% of issues with better DX.

## Impact

### Affected Specs
- **NEW**: `specs/e2e-testing/spec.md` - E2E testing requirements and scenarios

### Affected Code
- **NEW**: `playwright.config.ts` - Playwright configuration
- **NEW**: `.env.e2e` - E2E environment variables
- **NEW**: `tests/e2e/app-launch.e2e.ts` - E2E test suite
- **NEW**: `scripts/build-webpack-dev.js` - Build automation
- **MODIFIED**: `package.json` - Add E2E scripts and Playwright dependency
- **MODIFIED**: `.github/workflows/pr-checks.yml` - Add E2E test job
- **MODIFIED**: `.gitignore` - Add Playwright artifacts

### Benefits
- ✅ Catch integration bugs before production
- ✅ Validate complete user workflows
- ✅ Prevent database initialization regressions
- ✅ Cross-platform E2E validation (Linux, macOS, Windows)
- ✅ Excellent debugging with Playwright UI and traces
- ✅ Fast iteration with dev build approach (~30 seconds)

### Risks & Mitigations
- **Risk**: Dev build tests may not catch packaging-specific bugs
  - **Mitigation**: Keep existing `test:package:database` integration test for packaged app validation
- **Risk**: E2E tests slower than unit tests
  - **Mitigation**: Run E2E tests on separate CI job, use 1 worker for sequential execution
- **Risk**: Flaky tests due to timing issues
  - **Mitigation**: Use Playwright's built-in wait mechanisms, retry once in CI

### Migration Notes
This is a **new capability** - no breaking changes or migrations required.