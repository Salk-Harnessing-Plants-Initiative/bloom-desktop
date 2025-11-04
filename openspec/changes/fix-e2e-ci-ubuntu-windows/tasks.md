# Tasks: Fix E2E CI Failures on Ubuntu and Windows

## Implementation Tasks

### Task 1: Create cross-platform dev server cleanup script
**Description**: Replace Bash-specific process cleanup with Node.js script that works on all platforms.

**Actions**:
1. Create `scripts/stop-electron-forge.js` with cross-platform process kill logic
2. Handle PID file reading, process termination, and cleanup
3. Add error handling for missing PID file or already-terminated process

**Validation**:
- Script runs without errors on local macOS
- Script handles missing PID file gracefully
- Script cleans up PID file after execution

**Dependencies**: None

---

### Task 2: Add Linux-specific --no-sandbox flag
**Description**: Detect Linux platform and add `--no-sandbox` Electron launch arg to fix Chromium rendering in CI.

**Actions**:
1. Update `tests/e2e/app-launch.e2e.ts` beforeEach fixture
2. Add platform detection: `process.platform === 'linux'`
3. Conditionally append `--no-sandbox` to Electron args array
4. Add comment explaining why this is needed

**Validation**:
- Local macOS tests still pass (no `--no-sandbox` added)
- Code inspection confirms flag only added on Linux

**Dependencies**: None

---

### Task 3: Update CI workflow for platform-specific behavior
**Description**: Modify `.github/workflows/pr-checks.yml` to handle Windows PowerShell and Ubuntu timing.

**Actions**:
1. Replace Bash cleanup script with `node scripts/stop-electron-forge.js`
2. Add conditional dev server wait time (30s for Linux, 15s for others)
3. Ensure `if: always()` condition remains on cleanup step
4. Test YAML syntax validity

**Validation**:
- YAML lints successfully
- Node.js script path is correct
- Conditional logic uses correct GitHub Actions syntax

**Dependencies**: Task 1 (cleanup script must exist)

---

### Task 4: Document platform-specific requirements
**Description**: Update E2E testing design doc with new "Issue 6" for platform-specific CI requirements.

**Actions**:
1. Add "Issue 6: Platform-Specific CI Requirements" section to `openspec/changes/add-e2e-testing-framework/design.md`
2. Document `--no-sandbox` requirement for Linux
3. Document dev server timing differences
4. Document PowerShell incompatibility and Node.js solution
5. Link to relevant GitHub issues and resources

**Validation**:
- Documentation is clear and complete
- Links are valid
- Markdown renders correctly

**Dependencies**: None (can be done in parallel)

---

### Task 5: Test on all platforms in CI
**Description**: Push changes and verify all three platforms pass E2E tests.

**Actions**:
1. Push changes to PR branch
2. Wait for CI to run on macOS, Ubuntu, Windows
3. Review test results for each platform
4. Check for any new errors or warnings
5. Verify test artifacts (traces, screenshots) only on failures

**Validation**:
- ✅ macOS: 3/3 tests passing
- ✅ Ubuntu: 3/3 tests passing
- ✅ Windows: 3/3 tests passing
- ✅ No flaky tests (re-run if needed to verify)
- ✅ CI completes in <10 minutes per platform

**Dependencies**: Tasks 1-3 (all code changes must be pushed)

---

### Task 6: Update this OpenSpec change with results
**Description**: After CI succeeds, update this change's design.md with final results and learnings.

**Actions**:
1. Document actual CI timing results
2. Note any unexpected behaviors encountered
3. Mark change as ready for archive
4. Update success criteria with actual metrics

**Validation**:
- Results documented clearly
- Any follow-up questions addressed
- Change marked complete

**Dependencies**: Task 5 (CI must pass first)

---

## Parallel Work Opportunities

Tasks 1, 2, and 4 can be completed in parallel (no dependencies between them).

Task 3 depends on Task 1 (needs cleanup script to exist).

Tasks 5 and 6 are sequential (must happen after Tasks 1-4 complete).

## Estimated Timeline

- **Tasks 1-4**: 30-45 minutes (coding + documentation)
- **Task 5**: 8-15 minutes (CI run time, waiting)
- **Task 6**: 5-10 minutes (final documentation)

**Total**: ~1 hour including CI wait time
