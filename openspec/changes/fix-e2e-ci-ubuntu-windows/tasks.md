# Tasks: Fix E2E CI Failures on Ubuntu and Windows

## Status: IN PROGRESS (Nov 4, 2025)

## Implementation Tasks

### Task 1: ✅ Create cross-platform dev server cleanup script (COMPLETED)
**Description**: Replace Bash-specific process cleanup with Node.js script that works on all platforms.

**Status**: ✅ DONE - `scripts/stop-electron-forge.js` created in commit b235d5c

---

### Task 2: ✅ Add Linux-specific --no-sandbox flag (COMPLETED)
**Description**: Detect Linux platform and add `--no-sandbox` Electron launch arg to fix Chromium rendering in CI.

**Status**: ✅ DONE - Already in `tests/e2e/app-launch.e2e.ts` line 84

---

### Task 3: ⚠️ Update CI workflow for platform-specific behavior (PARTIALLY DONE)
**Description**: Modify `.github/workflows/pr-checks.yml` to handle Windows PowerShell and Ubuntu timing.

**Status**:
- ✅ Added `shell: bash` in commit b235d5c
- ✅ Added 30s wait for Linux, 15s for others
- ❌ NEW ISSUE: Need to add `DISABLE_ELECTRON_SANDBOX=1` env var for Linux dev server
- ❌ NEW ISSUE: Need to add 5s delay after webpack build on Windows for port release

**Remaining Actions**:
1. Add environment variable to dev server start step:
   ```yaml
   env:
     DISABLE_ELECTRON_SANDBOX: ${{ runner.os == 'Linux' && '1' || '' }}
   ```
2. Add delay after webpack build on Windows:
   ```yaml
   - name: Wait for port release (Windows)
     if: runner.os == 'Windows'
     run: sleep 5
   ```

**Dependencies**: None

---

### Task 4: Increase document.title timeout (NEW)
**Description**: Ubuntu test 1 times out waiting for document.title after 10 seconds.

**Actions**:
1. Update `tests/e2e/app-launch.e2e.ts` line 131
2. Change timeout from 10000 to 30000
3. Add comment explaining slower CI startup

**Code Change**:
```typescript
await window.waitForFunction(
  () => document.title.includes('Bloom Desktop'),
  { timeout: 30000 } // Increased from 10000 for slower CI (especially Ubuntu)
);
```

**Dependencies**: None

---

### Task 5: ✅ Document platform-specific requirements (COMPLETED)
**Description**: Update E2E testing design doc with "Issue 6" for platform-specific CI requirements.

**Status**: ✅ DONE - Added to `design.md` lines 566-631

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
