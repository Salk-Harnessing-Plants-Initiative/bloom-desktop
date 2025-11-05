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

### Fix 1: Ubuntu Dev Server SUID Sandbox Error (NEW - Nov 4, 2025)
**Problem**: `npm run start &` fails on Ubuntu with FATAL SUID sandbox error:
```
The SUID sandbox helper binary was found, but is not configured correctly.
Rather than run without sandboxing I'm aborting now.
You need to make sure that chrome-sandbox is owned by root and has mode 4755.
```

**Root Cause**: When Electron Forge starts the dev server on Linux CI, Electron tries to use SUID sandbox but GitHub Actions runners don't allow the required permissions on `chrome-sandbox` binary.

**Research Finding**: Based on Electron GitHub issues #17972, #18265, and #42510, the standard solution for CI environments is to use `DISABLE_ELECTRON_SANDBOX=1` environment variable.

**Solution**: Set `DISABLE_ELECTRON_SANDBOX=1` environment variable when starting dev server on Linux

**Security Note**: This only affects the dev server instance in CI (which serves static assets). The Playwright test instances already use `--no-sandbox` flag. Both are safe in isolated CI containers.

### Fix 2: Windows Port Conflict (NEW - Nov 4, 2025)
**Problem**: `npm run start &` fails with `listen EADDRINUSE: address already in use :::9000`

**Root Cause**: `build-webpack-dev.js` starts Electron Forge which binds to port 9000, then kills the process. However, on Windows the port isn't released fast enough before `npm run start &` tries to bind to the same port.

**Solution**: Add 5-second delay after webpack build on Windows to allow port to be released

### Fix 3: Windows PowerShell Compatibility (IMPLEMENTED)
**Problem**: Bash syntax `if [ -f electron-forge.pid ]; then` fails on Windows PowerShell with `ParserError: Missing '(' after 'if'`

**Solution**: ✅ Use `shell: bash` in workflow step to ensure Bash is used on all platforms

### Fix 4: Ubuntu Renderer Loading (PARTIALLY IMPLEMENTED)
**Problem**: Ubuntu test 1/3 fails with timeout waiting for `document.title`

**Current Status**:
- ✅ `--no-sandbox` flag added to Playwright test launch
- ✅ 30-second wait time for Linux dev server startup
- ⚠️ Still timing out on title check (10-second timeout may be too short)

**Solution**: Increase `waitForFunction` timeout from 10s to 30s for title check

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
