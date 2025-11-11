# Add Database Test Infrastructure

## Why

**Problem**: Critical gaps in database testing coverage create risk of production issues

Currently, bloom-desktop has good unit test coverage for database operations (Node.js environment) and basic packaged app smoke tests (initialization only). However, there are critical untested code paths:

1. **Dev mode Electron environment** (Issue #55): The development mode uses a different database initialization path (`prisma/dev.db`) and different Prisma module resolution (direct node_modules vs symlink). This path is completely untested, meaning developers could encounter database issues that don't appear in CI until much later.

2. **Packaged app CRUD operations** (Issue #56): The current packaged app test only verifies database initialization, not actual database operations. Prisma packaging is complex (binary query engines extracted from ASAR), and we need confidence that CREATE, READ, UPDATE, DELETE operations work correctly in production environment.

**Risk without this change**:

- Developers encounter database initialization failures in dev mode
- Prisma packaging issues go undetected until production
- Database operations fail silently in packaged apps
- Foreign key constraints or transactions don't work as expected
- Time wasted debugging environment-specific issues

**Business impact**:

- Slows down development (debugging environmental issues)
- Reduces confidence in releases
- Potential data corruption if DB operations fail
- Poor developer experience

**Related issues**: #55 (P2 - High), #56 (P2 - Medium)

## What Changes

This proposal adds comprehensive database testing infrastructure covering both development and packaged environments:

### 1. Shared Test Infrastructure

- Log-based test utilities for monitoring Electron app behavior
- Database verification helpers for SQLite introspection
- Enhanced structured logging in database handlers

### 2. Dev Mode Electron Database Test (Issue #55)

- Script-based test launching `electron-forge start` with log monitoring
- Verifies database initialization at correct path (`prisma/dev.db`)
- Validates dev mode-specific code paths
- CI integration (Linux only for speed)

### 3. Full Database Operations Test for Packaged App (Issue #56)

- Extends existing packaged app test to verify CRUD operations
- Tests all Prisma models (Scientist, Phenotyper, Experiment, Scan, Image)
- Validates relations, foreign keys, and transactions
- Uses log-based approach + direct SQLite verification
- CI integration (macOS only, existing platform)

**Out of scope** (deferred to future proposal):

- Cross-platform packaged app testing (Issue #57) - will reuse infrastructure built here
- Renderer process IPC testing (Issue #58) - requires Playwright, separate concern
- UI-driven database workflows - covered by E2E tests

**Technical approach**:

- **Log-based testing**: Matches existing `test-package-database.sh` pattern, avoids Playwright packaging bugs
- **Script-based**: Bash scripts with SQLite CLI for direct verification
- **Reusable utilities**: Shared infrastructure for future tests

**CI impact**: +5-8 minutes total (acceptable within budget)

## Dependencies

**Prerequisites**:

- Existing packaged app test infrastructure (already present)
- SQLite CLI in CI (already available)
- GitHub Actions bash environment (already available)

**Blocks**:

- Future cross-platform testing proposal (Issue #57)
- Future IPC testing proposal (Issue #58)

**Related specs**:

- `developer-workflows` - Will add database testing requirements
- `e2e-testing` - Complements existing E2E database tests

## Success Criteria

**Functional**:

- ✅ Dev mode database test runs on CI (Linux)
- ✅ Packaged app test verifies all CRUD operations
- ✅ Tests detect database initialization failures
- ✅ Tests detect Prisma packaging issues
- ✅ Reusable test utilities for future work

**Quality**:

- ✅ Tests pass consistently (<5% flake rate)
- ✅ Clear failure messages for debugging
- ✅ Tests complete within time budget (dev: 2-3 min, packaged: 3-5 min)

**Documentation**:

- ✅ Test scripts have clear comments
- ✅ Developer workflows spec updated
- ✅ CI workflow documented

**Validation**:

- Run tests locally on all platforms (dev mode: macOS, Linux; packaged: macOS)
- Verify tests fail when they should (inject failures)
- Run in CI and confirm timing
