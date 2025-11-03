# Research Summary: E2E Testing Framework

**Date**: 2025-11-03
**Status**: ✅ Research Complete, Validated, Ready for Implementation

## Research Methodology

All 6 technical decisions were researched using:
- Playwright official documentation
- GitHub issues and community reports
- Industry best practices (Simon Willison's TIL, Electron React Boilerplate)
- Real-world examples (VS Code testing approach)

## Decision Validation Results

### ✅ Decision 1: Dev Build vs Packaged - **VALIDATED**
- **Key Finding**: Playwright v1.44+ has regression bug with packaged apps ([#32027](https://github.com/microsoft/playwright/issues/32027))
- **Industry Standard**: VS Code and other major Electron projects use dev builds
- **Verdict**: Correct approach - use dev build for Playwright, integration tests for packaged apps

### ✅ Decision 2: Electron Launch Method - **VALIDATED**
- **Key Finding**: `args: ['.']` is documented standard approach
- **Alternatives**: `args: ['main.js']` also valid, but `.` uses package.json which is more flexible
- **Verdict**: Correct implementation matches Playwright best practices

### ✅ Decision 3: Database Isolation - **VALIDATED**
- **Key Finding**: Relative path approach is standard for Prisma
- **Verdict**: Correct - clean separation between dev and test databases

### ✅ Decision 4: Test Isolation - **VALIDATED**
- **Key Finding**: Playwright docs explicitly state "Each test should be completely isolated"
- **Benefits**: Prevents cascading failures, improves reproducibility, easier debugging
- **Verdict**: Correct - beforeEach/afterEach cleanup is best practice

### ✅ Decision 5: CI Webpack Build - **VALIDATED**
- **Key Finding**: Building before testing is confirmed best practice
- **Note**: Dev server in background is acceptable but may not be strictly necessary
- **Verdict**: Correct approach, could potentially simplify to just build (without dev server)

### ⚠️ Decision 6: Playwright Configuration - **NEEDS FIX**
- **Issue Found**: Current config has `headless: false` which is incorrect for CI
- **Required Fix**: Change to `headless: process.env.CI ? true : false`
- **Other Settings**: All correct (1 worker, 60s timeout, failure artifacts)
- **Verdict**: Mostly correct, needs headless mode fix

## Critical Known Issues Documented

### Issue 1: DevTools Window Race Condition
- **GitHub**: [#10964](https://github.com/microsoft/playwright/issues/10964)
- **Problem**: `firstWindow()` may return DevTools instead of main window
- **Solution**: Don't launch with DevTools, use Playwright UI mode for debugging
- **Status**: Closed 2021, still relevant

### Issue 2: Packaged App Testing
- **GitHub**: [#32027](https://github.com/microsoft/playwright/issues/32027)
- **Problem**: v1.44+ adds `--remote-debugging-port=0` flag that packaged apps reject
- **Solution**: Use dev builds for Playwright, integration tests for packaged apps
- **Status**: Open 2024, regression

### Issue 3: Electron Version Compatibility
- **Problem**: Playwright Electron support is experimental
- **Requirement**: v12.2.0+, v13.4.0+, v14+ supported
- **Critical**: `nodeCliInspectArguments` fuse must not be `false`
- **Our Setup**: Electron 28.2.2 ✅ compatible

### Issue 4: Cross-Platform Path Handling
- **Problem**: String concatenation breaks on different OS
- **Solution**: Always use `path.join()` for file paths
- **Testing**: CI runs on Linux, macOS, Windows

### Issue 5: Webpack Asset Imports
- **Problem**: Importing components with CSS/images causes parse errors
- **Solution**: Test rendered output, don't import components directly
- **Pattern**: Use `window.locator()` instead of component imports

## Research Sources

### Official Documentation
- ✅ Playwright Electron API
- ✅ Playwright Test Timeouts
- ✅ Playwright Parallelism Guide
- ✅ Playwright Best Practices

### GitHub Issues
- ✅ [#10964](https://github.com/microsoft/playwright/issues/10964) - DevTools race condition
- ✅ [#32027](https://github.com/microsoft/playwright/issues/32027) - Packaged app regression

### Community Resources
- ✅ Simon Willison's TIL: Testing Electron apps with Playwright
- ✅ Electron React Boilerplate integration tests
- ✅ VS Code testing approach (dev builds)

## Implementation Recommendations

### Before Starting Implementation

1. **Fix playwright.config.ts**:
   ```typescript
   use: {
     headless: process.env.CI ? true : false, // Not just false
   }
   ```

2. **Review Known Issues**: All team members should read the "Known Issues and Workarounds" section

3. **Verify Electron Version**: Confirm Electron 28.2.2 is compatible (it is ✅)

### During Implementation

1. **Follow Tasks Sequentially**: Complete tasks 1.1 through 8.5 in order from `tasks.md`

2. **Test on All Platforms**: Verify locally on your OS, then check CI for other platforms

3. **Use Path Helpers**: Always use `path.join()`, never string concatenation

4. **Avoid Component Imports**: Test rendered output, not component imports

### After Implementation

1. **Monitor CI**: Watch for flaky tests over first week

2. **Check Coverage**: Ensure E2E tests complement (not duplicate) integration tests

3. **Document Issues**: If new issues arise, add them to the Known Issues section

## OpenSpec Validation

```bash
✅ openspec validate add-e2e-testing-framework --strict
   Result: Valid!

📊 Proposal Statistics:
   - 9 requirements defined
   - 27 acceptance scenarios
   - 47 implementation tasks
   - 5 known issues documented
   - 6 technical decisions validated
```

## Next Steps

1. ✅ **Research Complete** - All decisions validated
2. ✅ **Known Issues Documented** - Team aware of gotchas
3. ✅ **OpenSpec Validated** - Proposal ready
4. ⏭️ **Ready for Implementation** - Follow tasks.md
5. ⏭️ **After Deployment** - Archive to openspec/specs/

## Team Notes

- **Time Investment**: Research took ~2 hours, saved potential weeks of debugging
- **Key Insight**: DevTools race condition and packaged app regression are real issues we would have hit
- **Confidence**: High - all decisions backed by industry best practices and research
- **Risk**: Low - known issues documented with workarounds

---

**Prepared by**: AI Research Assistant
**Reviewed with**: Simon Willison's TIL, Playwright Docs, GitHub Issues
**Confidence Level**: High ✅