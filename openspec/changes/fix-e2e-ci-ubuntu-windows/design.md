# Design Document: Fix E2E CI Failures on Ubuntu and Windows

## Context

The E2E testing framework was successfully implemented but CI reveals platform-specific failures:

**macOS** (✅ Passing):

- All 3 tests pass in ~3 minutes
- Dev server starts successfully
- Renderer loads properly
- No platform-specific issues

**Ubuntu** (❌ Failing 2/3 tests):

```
Test 1: "should launch successfully and show window"
- TimeoutError: page.waitForFunction: Timeout 30000ms exceeded
- Waiting for: document.title.includes('Bloom Desktop')
- Actual: Page loads but title not set (renderer not loading)

Test 2: "should initialize database on startup"
- ✅ PASSES (database file created successfully)

Test 3: "should display page content"
- expect(bodyContent).toBeTruthy()
- Received: "" (empty string)
- Body has no content - renderer not loading from dev server
```

**Windows** (❌ CI Step Failure):

```
Stop Electron Forge dev server step:
- ParserError: Missing '(' after 'if' in if statement
- Bash syntax `if [ -f electron-forge.pid ]; then` incompatible with PowerShell
- Error prevents test execution entirely
```

## Root Cause Analysis

### Ubuntu Issue: Blank Renderer

The Ubuntu tests show a pattern:

1. Electron launches successfully (no launch errors)
2. Database initializes (test 2 passes)
3. Window object is valid (no window errors)
4. But page content is empty (body is "")

**Hypothesis**: The renderer process isn't loading from `http://localhost:9000` dev server.

**Possible Causes**:

1. **Chromium sandbox issue on Linux**: Electron's Chromium requires `--no-sandbox` flag in containerized/CI environments
2. **Dev server startup race**: 15-second wait may be insufficient on slower Ubuntu runners
3. **Xvfb display isolation**: Virtual X11 server may affect localhost networking
4. **Webpack dev server binding**: Dev server may bind to `127.0.0.1` instead of `0.0.0.0`

**Evidence from Logs**:

- Test 1 timeout is 30s (global timeout), not 10s (test's waitForFunction timeout)
  - This suggests the test fixture itself is timing out during setup
  - The "Internal error: step id not found: fixture@39" messages indicate Playwright fixture teardown issues
- Page loads but remains blank (empty `<body>`)
- No network errors visible in logs

### Windows Issue: PowerShell vs Bash

Windows GitHub Actions runners use PowerShell by default, not Bash.

**Current Code** (.github/workflows/pr-checks.yml:289-291):

```yaml
- name: Stop Electron Forge dev server
  if: always()
  run: |
    if [ -f electron-forge.pid ]; then
      kill $(cat electron-forge.pid) || true
    fi
```

**Problem**: Bash-specific syntax (`[ -f`, `$(cat ...)`, `||`) doesn't work in PowerShell.

**PowerShell Error**:

```
ParserError: Missing '(' after 'if' in if statement
Line 2: if [ -f electron-forge.pid ]; then
```

## Decisions

### Decision 1: Use --no-sandbox on Linux

**Choice**: Add `--no-sandbox` to Electron launch args on Linux only.

**Rationale**:

- Standard fix for Chromium/Electron in CI environments (Docker, GitHub Actions)
- Already used in many Electron projects (VS Code, Playwright examples)
- Sandboxing not critical for CI test environment
- macOS and Windows don't need this flag (native sandboxing works)

**Implementation**:

```typescript
const launchArgs = [path.join(appRoot, '.webpack/main/index.js')];
if (process.platform === 'linux') {
  launchArgs.push('--no-sandbox');
}

electronApp = await electron.launch({
  executablePath: electronPath,
  args: launchArgs,
  // ...
});
```

**Trade-offs**:

- ✅ Fixes most Linux CI rendering issues
- ✅ Platform-specific, doesn't affect macOS/Windows
- ❌ Disables Chromium sandbox (acceptable for CI)

### Decision 2: Increase Linux Dev Server Startup Wait

**Choice**: Increase dev server startup wait from 15s to 30s on Linux only.

**Rationale**:

- Ubuntu GitHub runners can be slower than macOS/Windows
- Webpack dev server may take longer to compile on first run
- No penalty for macOS/Windows (they keep 15s)
- 30s is still reasonable for CI (total E2E job ~6 minutes)

**Implementation** (.github/workflows/pr-checks.yml):

```yaml
- name: Start Electron Forge dev server in background
  run: |
    npm run start &
    echo $! > electron-forge.pid
    # Platform-specific wait times
    if [ "$RUNNER_OS" == "Linux" ]; then
      sleep 30
    else
      sleep 15
    fi
```

**Trade-offs**:

- ✅ Reduces race condition risk on slower runners
- ✅ Only affects Linux (no slowdown for macOS/Windows)
- ❌ Adds 15s to Linux E2E job time

### Decision 3: Cross-Platform Process Cleanup Script

**Choice**: Replace Bash script with Node.js script for dev server cleanup.

**Rationale**:

- Node.js works identically on Linux, macOS, and Windows
- No shell syntax differences to worry about
- Better error handling (try/catch vs `|| true`)
- More maintainable (TypeScript could be added later)

**Implementation**:

Create `scripts/stop-electron-forge.js`:

```javascript
const fs = require('fs');
const path = require('path');

const pidFile = path.join(process.cwd(), 'electron-forge.pid');

try {
  if (fs.existsSync(pidFile)) {
    const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
    process.kill(pid, 'SIGTERM');
    console.log(`Stopped Electron Forge dev server (PID: ${pid})`);
    fs.unlinkSync(pidFile);
  } else {
    console.log('No electron-forge.pid file found');
  }
} catch (error) {
  console.log(`Error stopping dev server: ${error.message}`);
  // Cleanup PID file even if kill failed
  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
}
```

Update `.github/workflows/pr-checks.yml`:

```yaml
- name: Stop Electron Forge dev server
  if: always()
  run: node scripts/stop-electron-forge.js
```

**Trade-offs**:

- ✅ Works on all platforms
- ✅ Better error handling
- ✅ More maintainable
- ❌ Adds one new file to repo

**Alternative Considered**: Use PowerShell syntax with conditional on `runner.os`

- Rejected because it requires maintaining two separate scripts (Bash + PowerShell)
- More complex, harder to test locally

### Decision 4: Document Platform Behavior

**Choice**: Update `design.md` in `add-e2e-testing-framework` with new "Issue 6: Platform-Specific CI Requirements".

**Rationale**:

- Future developers need to understand why `--no-sandbox` is required
- Explains why cleanup uses Node.js instead of shell script
- Prevents accidental removal of platform-specific fixes

**Documentation Location**:
`openspec/changes/add-e2e-testing-framework/design.md`

Add section:

```markdown
### Issue 6: Platform-Specific CI Requirements

**Problem**: E2E tests pass on macOS but fail on Ubuntu and Windows due to platform differences.

**Ubuntu Requirements**:

1. `--no-sandbox` flag required for Electron/Chromium in CI
2. Longer dev server startup wait (30s vs 15s)
3. Xvfb for virtual display

**Windows Requirements**:

1. Cross-platform process cleanup (Node.js vs Bash)
2. PowerShell incompatibilities avoided

**Implementation**: See test fixture and CI workflow for platform detection logic.
```

## Risks / Trade-offs

### Risk: --no-sandbox reduces security in tests

- **Impact**: Low - Only affects CI test environment, not production
- **Likelihood**: N/A - This is intentional
- **Mitigation**: Document that `--no-sandbox` should never be used in production Electron builds
- **Monitoring**: None needed (security not relevant for CI tests)

### Risk: 30-second wait may still be insufficient

- **Impact**: Medium - Tests could still be flaky on very slow runners
- **Likelihood**: Low - 30s should handle most cases
- **Mitigation**: Add retry logic (already configured: `retries: 1` in CI)
- **Monitoring**: Track Ubuntu E2E test flakiness over next 10 CI runs

### Risk: Platform detection logic fragility

- **Impact**: Low - Easy to debug and fix
- **Likelihood**: Low - `process.platform` and `RUNNER_OS` are stable APIs
- **Mitigation**: Add comments explaining platform-specific behavior
- **Monitoring**: Watch for any platform confusion in CI logs

## Migration Plan

This is a **bug fix** for existing E2E testing - no migration required.

### Rollout Steps

1. Create `scripts/stop-electron-forge.js`
2. Update `.github/workflows/pr-checks.yml`:
   - Add Linux-specific `--no-sandbox` detection (in test code)
   - Increase Linux dev server wait to 30s
   - Replace Bash cleanup with Node.js script
3. Update `tests/e2e/app-launch.e2e.ts` fixture to add `--no-sandbox` on Linux
4. Update `openspec/changes/add-e2e-testing-framework/design.md` with Issue 6
5. Test in CI on all platforms
6. Merge if all green

### Success Criteria

- ✅ Ubuntu E2E: 3/3 tests passing
- ✅ Windows E2E: 3/3 tests passing
- ✅ macOS E2E: 3/3 tests passing (no regression)
- ✅ No new flaky tests introduced
- ✅ CI completion time <10 minutes per platform

### Rollback Plan

If changes cause new failures:

1. Revert the PR
2. Investigate specific failure mode
3. Apply fix and re-test locally before pushing

## Open Questions

### Q1: Should we verify dev server health before running tests?

**Status**: Deferred
**Rationale**: Current wait + test retry should be sufficient
**Follow-up**: Add HTTP health check to dev server startup if flakiness persists

### Q2: Should we cache webpack build output in CI?

**Status**: Out of scope for this fix
**Rationale**: Build caching is a performance optimization, not a bug fix
**Follow-up**: Consider in future PR if CI times become problematic

## References

### Playwright Electron Testing

- [Electron Testing with --no-sandbox](https://github.com/microsoft/playwright/issues/4380)
- [GitHub Actions and Electron](https://til.simonwillison.net/electron/testing-electron-playwright)

### Platform-Specific Issues

- [Chromium Sandbox in Docker/CI](https://github.com/puppeteer/puppeteer/blob/main/docs/troubleshooting.md#running-puppeteer-in-docker)
- [Windows PowerShell vs Bash](https://docs.github.com/en/actions/using-workflows/workflow-syntax-for-github-actions#jobsjob_idstepsshell)

### Related OpenSpec Changes

- `add-e2e-testing-framework` (parent change being fixed)
