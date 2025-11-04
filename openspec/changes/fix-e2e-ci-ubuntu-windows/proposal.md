# Proposal: Fix E2E CI Failures on Ubuntu and Windows

## Change ID
`fix-e2e-ci-ubuntu-windows`

## Summary
Fix platform-specific E2E test failures in CI while ensuring macOS continues to pass. Ubuntu tests fail due to page content not loading (blank renderer), and Windows tests fail due to PowerShell incompatibility in the cleanup script.

## Problem Statement
After implementing E2E testing framework, CI results show:
- ✅ **macOS**: All 3 tests passing
- ❌ **Ubuntu**: 2/3 tests failing (page content not loading)
- ❌ **Windows**: CI step fails before tests run (PowerShell syntax error in cleanup)

This prevents merging the E2E testing PR and blocks automated quality assurance across all platforms.

## Goals
1. Fix Windows PowerShell syntax error in dev server cleanup step
2. Fix Ubuntu renderer loading issue causing blank page content
3. Ensure all fixes preserve macOS test success
4. Document platform-specific behavior for future reference

## Non-Goals
- Rewriting the entire E2E testing approach
- Changing test framework (staying with Playwright)
- Testing packaged apps (dev build only, as per original design)

## Proposed Solution

### Fix 1: Windows PowerShell Compatibility
**Problem**: Bash syntax `if [ -f electron-forge.pid ]; then` fails on Windows PowerShell with `ParserError: Missing '(' after 'if'`

**Solution**: Use cross-platform Node.js script for process cleanup instead of shell-specific syntax

### Fix 2: Ubuntu Renderer Loading
**Problem**: Ubuntu tests show blank page (empty `<body>` content) suggesting renderer process isn't loading from dev server

**Root Cause Hypothesis**:
- Xvfb virtual display may affect localhost networking
- 15-second wait may be insufficient for Ubuntu dev server startup
- --no-sandbox flag may be required for Chromium/Electron on Linux

**Solution**: Add platform-specific Electron launch args for Linux and increase dev server startup wait time

## Impact Assessment
- **Risk**: Low - Changes are isolated to CI configuration and platform-specific code paths
- **Breaking Changes**: None - Only affects CI, no API changes
- **Platforms Affected**: Ubuntu (Linux) and Windows only
- **macOS**: No changes to working macOS flow

## Dependencies
- Existing `add-e2e-testing-framework` change (already implemented)
- No new external dependencies required

## Success Criteria
- ✅ All 3 E2E tests pass on Ubuntu in CI
- ✅ All 3 E2E tests pass on Windows in CI
- ✅ All 3 E2E tests continue to pass on macOS in CI
- ✅ No false positives or flaky tests introduced
- ✅ Local development workflow unchanged
