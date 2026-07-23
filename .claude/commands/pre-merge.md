# Pre-Merge Checks

**Comprehensive pre-merge verification workflow**

Run all quality checks, create PR, review feedback, and update changelog before merging.

## Your Task

Perform a complete pre-merge check following this workflow:

### Phase 0: Fast Sweep (optional shortcut)

0. **Environment + CI reproduction**
   - First time on this machine, or after dependency changes: run `/validate-env`
   - Run `/run-ci-locally` to reproduce CI jobs 1-6 (format, lint, typecheck, unit tests, build) in one pass — this covers the same ground as Phases 1-2 below in less detail. Use it as a fast gate; fall back to the phase-by-phase steps below if it fails and you need to isolate which check broke.

### Phase 1: Code Quality Checks

1. **Formatting**
   - Run `/fix-formatting` if you know there are formatting issues; otherwise run `npm run format:check` / `uv run black --check python/` directly
   - Commit any formatting changes separately from logic changes

2. **Linting**
   - Run `/lint` command (ESLint + ruff, check-only)
   - Verify no errors or warnings
   - If failures: fix them and re-run

3. **TypeScript Type Checking**
   - Run `npx prisma generate && npx tsc --noEmit`
   - Verify no type errors
   - If failures: fix them and re-run

### Phase 2: Test Coverage

4. **Unit Tests**
   - Run `npm run test:unit`
   - Verify all tests pass
   - Check coverage is acceptable (>80% for changed files)
   - If failures: investigate and fix

5. **E2E Tests**
   - Run `/e2e-testing` command to verify dev server is running
   - Run `npm run test:e2e`
   - Verify all functional tests pass
   - Document any intentionally skipped tests
   - If failures: investigate and fix

6. **Integration Tests** (if applicable)
   - Run `/integration-testing` command
   - Verify all integration tests pass

### Phase 3: Build & Package Verification

7. **Packaging**
   - Run `/packaging` command
   - Verify application builds successfully
   - Test packaged application launches
   - Check bundle size hasn't increased significantly

### Phase 4: Documentation

8. **Documentation Review**
   - Run `/docs-review` command
   - Verify README is up-to-date
   - Check API documentation reflects changes
   - Ensure OpenSpec proposals are completed (if applicable)
   - Update any stale documentation

### Phase 5: OpenSpec Verification (if applicable)

9. **OpenSpec Proposal Status**
   - Check if current branch has an active OpenSpec proposal
   - Verify all tasks in `tasks.md` are completed
   - Ensure acceptance criteria are met
   - Note: After merge, use `/cleanup-merged` to archive proposals on main (do NOT archive on the feature branch)

### Phase 6: Pull Request

10. **Create or Update PR**
    - Run `/pr-description` command
    - Create comprehensive PR description including:
      - Summary of changes
      - Test results
      - Breaking changes (if any)
      - Screenshots/recordings (if UI changes)
      - OpenSpec proposal link (if applicable)
    - Push all changes
    - Create PR if not exists: `gh pr create`

### Phase 7: CI Monitoring

11. **Monitor GitHub Actions**
    - After PR creation, check CI status: `gh pr checks <PR_NUMBER>`
    - Monitor all workflows:
      - Lint (Node.js + Python)
      - TypeScript compilation
      - Unit tests
      - E2E IPC coverage
      - Python builds (macOS, Ubuntu, Windows)
      - Python tests
    - Wait for all checks to complete
    - If any fail: use `/ci-debug` command to investigate
    - Review workflow logs for failures
    - Address failures incrementally

### Phase 8: Review Feedback

12. **Review PR Comments**
    - Run `/copilot-review` to fetch and triage GitHub Copilot inline comments specifically
    - Run `/review-pr` command
    - Check for GitHub Actions failures
    - Review comments from:
      - GitHub Copilot
      - Human reviewers
      - Automated linters/tests
      - CI failure messages
    - Address all concerns

13. **Plan Fixes** (if issues found)
    - Use planning mode with ultrathink
    - Create action plan for each concern
    - Implement fixes incrementally
    - Re-run relevant checks after each fix
    - Push updated commits
    - Monitor CI re-runs: `gh pr checks <PR_NUMBER>`

### Phase 9: Changelog

14. **Update Changelog**
    - Run `/update-changelog` command
    - Add entry for this PR
    - Follow semantic versioning
    - Include migration notes if needed

### Phase 10: Final Verification

15. **Final Check**
    - Verify all CI checks are green: `gh pr checks <PR_NUMBER>`
    - Confirm all review comments are addressed
    - Check branch is up-to-date with main: `git fetch origin main && git merge-base --is-ancestor origin/main HEAD`
    - Verify no merge conflicts
    - Ensure PR has required approvals
    - Check for "ready to merge" status

## Output Format

Use the three-state checkbox convention from `/pr-description`: `[x]` verified green, `[!]` pre-existing failure on `main` (link the issue), `[ ]` not yet verified / doesn't apply. Provide a comprehensive summary in this format:

```markdown
# Pre-Merge Check Results

## ✅ Code Quality

- [x] Linting: PASS
- [x] TypeScript: PASS
- [x] Formatting: PASS

## ✅ Testing

- [x] Unit Tests: X passed, Y skipped
- [x] E2E Tests: X passed, Y skipped
- [x] Integration Tests: X passed (or N/A)
- [x] Coverage: X% (meets threshold)

## ✅ Build & Package

- [x] Package builds successfully
- [x] Application launches
- [x] Bundle size: XMB (change: +/-YMB)

## ✅ Documentation

- [x] README up-to-date
- [x] API docs current
- [x] OpenSpec completed (or N/A)

## ✅ Pull Request

- [x] PR created: #X
- [x] Description comprehensive
- [x] All checks passing
- [x] No review blockers

## ✅ Changelog

- [x] Entry added for vX.Y.Z

## 🎯 Status: READY TO MERGE
```

If any checks fail, provide:

- Clear explanation of failure
- Proposed fix
- Steps to implement
- Re-run instructions

## Best Practices

- **Incremental Fixes**: Address one issue at a time
- **Test After Each Fix**: Don't batch fixes without testing
- **Clear Communication**: Document why tests are skipped
- **Version Awareness**: Update version numbers appropriately
- **Breaking Changes**: Clearly flag and document
- **Review Context**: Understand the full scope before addressing feedback

## When to Use

Run this command before:

- Creating a pull request
- Requesting code review
- Merging to main/production
- Releasing a new version

## Notes

- Some checks may not apply to all PRs (e.g., packaging for docs-only changes)
- Use judgment to skip irrelevant checks but document why
- If OpenSpec is not being used, skip that phase
- For hotfixes, abbreviated checks may be acceptable (document reasoning)

## Related Commands

- `/validate-env` - confirm environment is healthy (Phase 0, first-time/after dependency changes)
- `/run-ci-locally` - fast local reproduction of CI jobs 1-6 (Phase 0 shortcut for Phases 1-2)
- `/fix-formatting` - auto-format before the check
- `/lint` - lint + typecheck
- `/coverage` - test coverage report
- `/copilot-review` - triage GitHub Copilot inline comments
- `/review-pr` - adversarial multi-lens PR review
- `/ci-debug` - debug a failing CI run
- `/update-changelog` - maintain the changelog
- `/pr-description` - generate the PR body
- `/cleanup-merged` - post-merge branch cleanup + OpenSpec archive
