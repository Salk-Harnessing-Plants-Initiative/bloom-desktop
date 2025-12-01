# Pre-Merge Checks

**Comprehensive pre-merge verification workflow**

Run all quality checks, create PR, review feedback, and update changelog before merging.

## Your Task

Perform a complete pre-merge check following this workflow:

### Phase 1: Code Quality Checks

1. **Linting**
   - Run `/lint` command
   - Verify no errors or warnings
   - If failures: fix them and re-run

2. **TypeScript Type Checking**
   - Run `npx tsc --noEmit`
   - Verify no type errors
   - If failures: fix them and re-run

3. **Formatting**
   - Run `npm run format`
   - Verify all files formatted
   - Commit any formatting changes

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
   - Mark proposal as ready for archive after merge

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
    - Run `/changelog` command
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

Provide a comprehensive summary in this format:

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
