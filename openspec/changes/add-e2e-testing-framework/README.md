# E2E Testing Framework - OpenSpec Change

**Change ID**: `add-e2e-testing-framework`
**Status**: ✅ Validated, Ready for Implementation
**Created**: 2025-11-02

## Quick Start

This OpenSpec change proposes adding Playwright-based end-to-end testing for the Bloom Desktop Electron application.

### Files in This Proposal

```
openspec/changes/add-e2e-testing-framework/
├── README.md           # This file - overview and quick start
├── proposal.md         # Why, what, and impact of the change
├── design.md           # Technical decisions and architecture
├── tasks.md            # Implementation checklist (47 tasks)
└── specs/
    └── e2e-testing/
        └── spec.md     # Requirements and scenarios (9 requirements, 27 scenarios)
```

### How to Use This Proposal

#### 1. Review the Proposal (Before Implementation)

Read the files in this order:

1. **proposal.md** - Understand the why and what
2. **design.md** - Review technical decisions (especially the 6 key decisions)
3. **specs/e2e-testing/spec.md** - See detailed requirements and acceptance scenarios
4. **tasks.md** - Preview the implementation checklist

#### 2. Validate the Proposal

```bash
# Ensure proposal passes all validation checks
openspec validate add-e2e-testing-framework --strict

# View proposal summary
openspec show add-e2e-testing-framework

# Check task count
openspec list  # Shows "0/47 tasks" initially
```

#### 3. Implement the Changes

Follow the tasks in [tasks.md](./tasks.md) sequentially:

**Phase 1: Configuration** (Tasks 1.1-1.3)

- Create/update Playwright config, .env.e2e, .gitignore

**Phase 2: Build Automation** (Tasks 2.1-2.4)

- Create webpack build script

**Phase 3: Test Suite** (Tasks 3.1-3.7)

- Implement E2E tests with proper setup/teardown

**Phase 4: npm Scripts** (Tasks 4.1-4.4)

- Add test execution scripts

**Phase 5: CI/CD** (Tasks 5.1-5.12)

- Integrate E2E tests into GitHub Actions

**Phase 6: Testing & Validation** (Tasks 6.1-6.6)

- Verify tests work locally and in CI

**Phase 7: Documentation** (Tasks 7.1-7.6)

- Update docs and README

**Phase 8: OpenSpec Archival** (Tasks 8.1-8.5)

- Archive change after deployment

#### 4. Mark Tasks Complete

As you complete tasks, update `tasks.md`:

```markdown
- [x] 1.1 Create/Update playwright.config.ts # Changed [ ] to [x]
```

OpenSpec CLI tracks completion automatically.

#### 5. After Implementation

Once all tasks are complete and deployed:

```bash
# Create the final spec file
mkdir -p openspec/specs/e2e-testing
cp openspec/changes/add-e2e-testing-framework/specs/e2e-testing/spec.md \
   openspec/specs/e2e-testing/spec.md

# Archive the change
openspec archive add-e2e-testing-framework --yes

# Validate the archive
openspec validate --strict
```

## Key Technical Decisions

### ✅ Decision 1: Dev Build Approach

- **Use webpack dev build** for Playwright E2E tests (NOT packaged apps)
- **Rationale**: Playwright's `_electron` API doesn't work with packaged apps
- **Trade-off**: Dev builds catch 95% of issues with better DX

### ✅ Decision 2: Electron Launch Method

- **Use `electron.launch({ args: ['.'] })`** (NOT direct path)
- **Rationale**: Avoids `--remote-debugging-port` error
- **Source**: Tested approach from bloom-desktop-pilot

### ✅ Decision 3: Database Isolation

- **Use `file:../tests/e2e/test.db`** for E2E database
- **Rationale**: Clean separation from dev database, Prisma resolves relative to prisma/ dir
- **Cleanup**: Database deleted in beforeEach/afterEach hooks

### ✅ Decision 4: CI Strategy

- **Build webpack once, start dev server in background**
- **Rationale**: Faster than building per-test, HMR needed for renderer
- **Platforms**: Linux, macOS, Windows (via matrix strategy)

## Success Metrics

After implementation, verify:

- ✅ `npm run test:e2e` passes locally (all 3 tests)
- ✅ E2E tests pass in CI on all platforms (>95% success rate)
- ✅ Test duration <5 minutes per platform
- ✅ No flaky tests over 1 week of CI runs
- ✅ Playwright UI debugging works (`npm run test:e2e:ui`)

## Current Implementation Status

**Existing Files** (from pilot migration):

- ✅ `playwright.config.ts` - EXISTS (may need updates)
- ✅ `.env.e2e` - EXISTS (may need updates)
- ✅ `tests/e2e/app-launch.e2e.ts` - EXISTS (needs fixes for webpack approach)
- ❌ `scripts/build-webpack-dev.js` - DOES NOT EXIST (needs creation)
- ⚠️ `.github/workflows/pr-checks.yml` - EXISTS but E2E job may need updates

**Next Steps**:

1. Review existing files against spec requirements
2. Update files to match spec (especially Electron launch approach)
3. Create missing `scripts/build-webpack-dev.js`
4. Test locally before pushing to CI

## References

- **Proposal**: See [proposal.md](./proposal.md)
- **Design**: See [design.md](./design.md)
- **Tasks**: See [tasks.md](./tasks.md)
- **Spec**: See [specs/e2e-testing/spec.md](./specs/e2e-testing/spec.md)
- **Current Status**: See [PLAYWRIGHT_E2E_STATUS.md](../../../PLAYWRIGHT_E2E_STATUS.md)
- **Playwright Docs**: https://playwright.dev/docs/api/class-electron
- **OpenSpec Guide**: See [openspec/AGENTS.md](../../AGENTS.md)

## Questions?

If anything is unclear:

1. Read the design.md "Open Questions" section
2. Check PLAYWRIGHT_E2E_STATUS.md for context on previous attempts
3. Review the spec requirements for detailed acceptance criteria
4. Ask clarifying questions before implementing
