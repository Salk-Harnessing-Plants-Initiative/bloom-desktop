# CI Debug - GitHub Actions Pipeline

Comprehensive guide for debugging CI failures and understanding the multi-platform CI pipeline for bloom-desktop.

## Overview

Bloom Desktop runs **10 CI jobs** across **3 platforms** (Linux, macOS, Windows) on every PR:

1. **lint-node** (Linux) - ESLint + Prettier
2. **lint-python** (Linux) - black + ruff + mypy
3. **compile-typescript** (Linux) - Type checking
4. **test-unit** (Linux) - Vitest unit tests (50% coverage)
5. **test-python** (Linux) - pytest (80% coverage enforced)
6. **build-python** (Linux/macOS/Windows) - PyInstaller executable
7. **test-integration** (Linux/macOS/Windows) - IPC, camera, DAQ, scanner tests
8. **test-dev-database** (Linux) - Dev mode database initialization
9. **test-e2e-dev** (Linux/macOS/Windows) - Playwright E2E tests
10. **test-package-database** (macOS) - Packaged app database test
11. **all-checks-passed** (Linux) - Summary job (requires all above to pass)

**All jobs must pass for PR to merge.**

## Quick Diagnosis

### Step 1: Identify Failing Job

Check PR checks section on GitHub to see which job(s) failed.

### Step 2: Check Job Logs

Click "Details" next to failed check → View full CI logs.

### Step 3: Common Failure Patterns

| Symptom | Likely Cause | Quick Fix |
|---------|--------------|-----------|
| **Lint failures** | Code style violations | Run `npm run lint` and `npm run format` locally |
| **Type errors** | TypeScript compilation issues | Run `npx tsc --noEmit` locally |
| **Coverage too low** | Tests not meeting thresholds | Add more tests to increase coverage |
| **Timeout errors** | CI slower than local machine | Increase timeout values |
| **Platform-specific** | Fails on one OS only | Test on that OS locally or in Docker |
| **"Module not found"** | PyInstaller bundling issue | Check hidden imports in main.spec |
| **EADDRINUSE** | Port conflict (9000) | Dev server race condition |
| **Xvfb errors** | Linux headless display issues | Check xvfb-run wrapping |
| **Database errors** | Prisma client not generated | Check `prisma generate` step |

## Job-by-Job Debugging

### 1. lint-node (Linux)

**What it does:**
- Runs ESLint on TypeScript/JavaScript files
- Checks Prettier formatting

**Common failures:**
- Code style violations
- Formatting inconsistencies
- Import order issues

**Debug locally:**
```bash
# Run linting
npm run lint

# Check formatting
npm run format:check

# Auto-fix formatting
npm run format
```

**CI-specific considerations:**
- Uses cached `node_modules` for speed
- Only runs on Linux (fastest CI runner)

---

### 2. lint-python (Linux)

**What it does:**
- Runs black (formatter check)
- Runs ruff (linter)
- Runs mypy (type checker)

**Common failures:**
- Python formatting violations
- Type annotation issues
- Unused imports or variables

**Debug locally:**
```bash
# Install Python dependencies
uv sync --all-extras

# Check formatting
uv run black --check python/

# Run linter
uv run ruff check python/

# Run type checker
uv run mypy python/
```

**Auto-fix:**
```bash
# Fix formatting
uv run black python/

# Fix auto-fixable linter issues
uv run ruff check python/ --fix
```

**CI-specific considerations:**
- Uses `astral-sh/setup-uv@v7` for Python environment
- Caches uv dependencies

---

### 3. compile-typescript (Linux)

**What it does:**
- Type-checks TypeScript without emitting files
- Generates Prisma Client
- Validates type definitions

**Common failures:**
- Type errors (`Property 'x' does not exist`)
- Missing type definitions
- Prisma client not generated

**Debug locally:**
```bash
# Generate Prisma Client
npx prisma generate

# Type check
npx tsc --noEmit
```

**CI-specific considerations:**
- Requires `BLOOM_DATABASE_URL` environment variable
- Uses cached `node_modules`

---

### 4. test-unit (Linux)

**What it does:**
- Runs Vitest unit tests
- Enforces 50% minimum coverage
- Tests path sanitizer and database operations

**Common failures:**
- Test failures (logic errors)
- Coverage below 50%
- Database setup issues

**Debug locally:**
```bash
# Run unit tests
npm run test:unit

# Run with coverage
npm run test:unit:coverage

# Run in watch mode (for development)
npm run test:unit:watch

# Run with UI
npm run test:unit:ui
```

**View coverage report:**
```bash
# After running tests with coverage
open coverage/index.html  # macOS
xdg-open coverage/index.html  # Linux
start coverage/index.html  # Windows
```

**CI-specific considerations:**
- Requires Prisma Client generation
- Runs `prisma migrate deploy` to set up test database
- Uses `file:./dev.db` for testing

---

### 5. test-python (Linux)

**What it does:**
- Runs pytest with coverage
- Enforces 80% minimum coverage
- Tests Python hardware modules

**Common failures:**
- Test failures (logic errors)
- Coverage below 80%
- Import errors (missing dependencies)

**Debug locally:**
```bash
# Run Python tests
npm run test:python

# Or directly with uv
uv run pytest python/tests -v --cov=python --cov-report=term --cov-report=html
```

**View coverage report:**
```bash
# After running tests
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
start htmlcov/index.html  # Windows
```

**CI-specific considerations:**
- Uses uv for dependency management
- Caches Python dependencies
- Fails immediately if coverage < 80%

---

### 6. build-python (Linux/macOS/Windows)

**What it does:**
- Builds Python executable with PyInstaller
- Runs on all 3 platforms in parallel
- Uploads executable as artifact for other jobs

**Common failures:**
- Missing hidden imports
- DLL/dylib loading issues
- Platform-specific PyInstaller bugs

**Debug locally:**
```bash
# Build Python executable
npm run build:python

# Or directly with uv
uv sync --extra dev
uv run pyinstaller python/main.spec
```

**Verify build:**
```bash
# Run executable manually
./dist/bloom-hardware --ipc  # macOS/Linux
dist\bloom-hardware.exe --ipc  # Windows

# Send test command
echo '{"command":"ping"}' | ./dist/bloom-hardware --ipc
```

**CI-specific considerations:**
- Builds in parallel on 3 platforms
- Artifacts uploaded for 1 day only
- Subsequent jobs download artifacts by platform

---

### 7. test-integration (Linux/macOS/Windows)

**What it does:**
- Downloads Python executable from build-python job
- Runs IPC, camera, DAQ, scanner, scanner-database tests
- Tests on all 3 platforms

**Common failures:**
- Python subprocess crashes
- IPC communication timeouts
- Mock hardware initialization failures
- Database integration issues

**Debug locally:**
```bash
# Build Python first (or skip if already built)
npm run build:python

# Run tests individually
npm run test:ipc
npm run test:camera
npm run test:daq
npm run test:scanner
npm run test:scanner-database
```

**CI-specific considerations:**
- **Linux**: Requires `libusb-1.0-0-dev` and `libglib2.0-dev` for pypylon
- **All platforms**: Uses `BLOOM_USE_MOCK_HARDWARE=true` environment
- Downloads platform-specific Python executable artifact
- Must run `chmod +x` on Unix platforms
- Now uses `ensure-python-executable.sh` to skip rebuild if executable exists

**Platform-specific debugging:**

**Linux:**
```bash
# Install system dependencies (Ubuntu/Debian)
sudo apt-get update
sudo apt-get install -y libusb-1.0-0-dev libglib2.0-dev

# Run tests
npm run test:integration
```

**macOS:**
```bash
# No special dependencies needed
npm run test:integration
```

**Windows:**
```bash
# Use Git Bash or WSL
npm run test:integration
```

---

### 8. test-dev-database (Linux)

**What it does:**
- Tests database initialization in dev mode
- Verifies Prisma migrations work
- Runs with Electron in headless mode (xvfb)

**Common failures:**
- Database file creation issues
- Migration failures
- Prisma Client not generated

**Debug locally:**
```bash
# Build Python first (or skip if already built)
npm run build:python

# Generate Prisma Client
npx prisma generate

# Run dev database test
npm run test:dev:database
```

**CI-specific considerations:**
- Uses `xvfb-run` on Linux for headless Electron
- Requires Python executable artifact
- Tests dev mode specifically (not packaged app)
- Uses absolute paths for database URL to avoid Prisma resolution issues

---

### 9. test-e2e-dev (Linux/macOS/Windows)

**What it does:**
- Starts Electron Forge dev server in background
- Runs Playwright E2E tests
- Tests on all 3 platforms

**Common failures:**
- Dev server startup timeout
- Blank Electron window (no renderer content)
- Test timeout waiting for elements
- Xvfb issues (Linux)
- Sandbox issues (Linux)

**Debug locally:**
```bash
# Terminal 1: Start dev server
npm run start

# Terminal 2: Run E2E tests (after dev server ready)
npm run test:e2e

# Or use UI mode for debugging
npm run test:e2e:ui

# Or debug mode
npm run test:e2e:debug
```

**CI-specific considerations:**

**Linux:**
- Uses `xvfb-run` for headless display
- Sets `ELECTRON_DISABLE_SANDBOX=1`
- Adds `--no-sandbox` flag automatically when `CI=true`
- Waits 45 seconds for dev server startup (slower than macOS/Windows)

**macOS/Windows:**
- Native display (no Xvfb)
- Waits 30 seconds for dev server startup
- No sandbox issues

**Common E2E issues:**

1. **Port 9000 already in use:**
   - Caused by dev server still running from previous test
   - Solution: `node scripts/stop-electron-forge.js` (runs automatically in CI)

2. **Blank Electron window:**
   - Dev server not running or not ready
   - Solution: Increase wait time in CI config

3. **Timeout waiting for elements:**
   - Slow CI runner
   - Solution: Increase Playwright timeout values

**Stop dev server:**
```bash
# Automatically stopped by CI
node scripts/stop-electron-forge.js

# Or manually (if stuck)
# macOS/Linux
lsof -ti :9000 | xargs kill -9

# Windows
netstat -ano | findstr :9000
taskkill /F /PID <PID>
```

---

### 10. test-package-database (macOS)

**What it does:**
- Packages application with `npm run package`
- Tests database initialization in packaged app
- Verifies Prisma works in production mode

**Common failures:**
- Packaging errors (Prisma ASAR issues)
- Database file creation in wrong location
- Migration failures in packaged app

**Debug locally:**
```bash
# Build Python first (or skip if already built)
npm run build:python

# Generate Prisma Client
npx prisma generate

# Package application
npm run package

# Test packaged app database
npm run test:package:database
```

**CI-specific considerations:**
- Only runs on macOS (fastest packaging)
- Requires Python executable artifact
- Tests production database behavior
- Database should be created in `~/.bloom/data/bloom.db`

---

### 11. all-checks-passed (Linux)

**What it does:**
- Summary job that depends on all other jobs
- Only runs if all jobs pass
- Provides single "check" for branch protection rules

**Common failures:**
- Never fails directly (only if dependencies fail)

**Purpose:**
- Simplifies branch protection (1 required check instead of 10)
- Provides clear success/failure signal

---

## Platform-Specific Issues

### Linux (Ubuntu CI Runner)

**Special requirements:**
- `xvfb-run` for headless Electron
- `ELECTRON_DISABLE_SANDBOX=1` environment variable
- System packages: `libusb-1.0-0-dev`, `libglib2.0-dev`
- Slower than macOS/Windows (use longer timeouts)

**Common Linux-specific errors:**

1. **Missing X server:**
   ```
   [ERROR:ozone_platform_x11.cc(240)] Missing X server or $DISPLAY
   ```
   **Fix:** Wrap command with `xvfb-run --auto-servernum`

2. **SUID sandbox error:**
   ```
   FATAL:setuid_sandbox_host.cc(158)] The SUID sandbox helper binary was found,
   but is not configured correctly.
   ```
   **Fix:** Set `ELECTRON_DISABLE_SANDBOX=1` and add `--no-sandbox` flag

3. **System library missing:**
   ```
   ImportError: libusb-1.0.so.0: cannot open shared object file
   ```
   **Fix:** Install system dependencies in CI step

---

### macOS (macOS CI Runner)

**Special requirements:**
- None (native display)
- Fastest packaging (used for package tests)

**Common macOS-specific errors:**

1. **Code signing issues:**
   - Not applicable for CI (no signing in CI)
   - Only matters for distribution

2. **Notarization:**
   - Not applicable for CI
   - Only matters for distribution

---

### Windows (Windows CI Runner)

**Special requirements:**
- Use `shell: bash` in GitHub Actions (for cross-platform scripts)
- Different executable extension (`.exe`)
- PowerShell vs Bash differences

**Common Windows-specific errors:**

1. **Path separators:**
   ```
   Error: ENOENT: no such file or directory
   ```
   **Fix:** Use `path.join()` instead of string concatenation

2. **Line endings:**
   ```
   SyntaxError: Invalid or unexpected token
   ```
   **Fix:** Ensure `.gitattributes` configures CRLF/LF correctly

3. **Port already in use (EADDRINUSE):**
   - More common on Windows due to slower port cleanup
   **Fix:** Ensure proper dev server shutdown

---

## CI Performance Optimization

The CI pipeline has been optimized to minimize build time:

### Recent Optimizations (Implemented)

1. **Parallel linting** - Node and Python lint in parallel
2. **Single Python build** - Build once per OS, reuse artifact
3. **Dependency caching** - Cache `node_modules` and uv packages
4. **Platform-specific jobs** - Only run slow tests on one platform when possible
5. **Skip Python rebuild** - Integration tests now skip rebuild if executable exists (using `ensure-python-executable.sh`)

### Current Build Times (Approximate)

| Job | Duration |
|-----|----------|
| lint-node | ~1 min |
| lint-python | ~1 min |
| compile-typescript | ~1 min |
| test-unit | ~2 min |
| test-python | ~2 min |
| build-python | ~3-5 min (per platform) |
| test-integration | ~3-5 min (per platform) - faster after optimization |
| test-dev-database | ~1 min |
| test-e2e-dev | ~8-12 min (per platform) |
| test-package-database | ~3 min |

**Total wall time:** ~12-15 minutes (with parallelization and optimizations)

---

## Debugging Failed CI Runs

### Step 1: Reproduce Locally

```bash
# Set CI environment variable (enables CI-specific behavior)
export CI=true  # macOS/Linux
set CI=true     # Windows

# Run failing command
npm run test:e2e
```

### Step 2: Check CI Logs

**Key sections to check:**
1. **Setup steps** - Did dependencies install correctly?
2. **Build steps** - Did Python build succeed?
3. **Test output** - What was the actual error?
4. **Artifacts** - Were artifacts uploaded/downloaded?

**Search for keywords:**
- `ERROR`
- `FAIL`
- `timeout`
- `ENOENT` (file not found)
- `EADDRINUSE` (port conflict)

### Step 3: Download Artifacts

Failed E2E tests upload Playwright reports:

```bash
# From GitHub Actions UI
# 1. Click on failed workflow run
# 2. Scroll to "Artifacts" section
# 3. Download "playwright-results-{OS}"
# 4. Extract and view report:
npx playwright show-report playwright-report/
```

### Step 4: Run on Specific Platform

**Test on Linux (using Docker):**
```bash
# Use Ubuntu container
docker run -it --rm ubuntu:latest bash

# Install dependencies and run tests
apt-get update
apt-get install -y curl git
# ... install Node.js, uv, etc.
# Clone repo and run tests
```

**Test on macOS:**
- Use local macOS machine or GitHub Actions

**Test on Windows:**
- Use local Windows machine, WSL, or GitHub Actions

---

## Common CI Failure Scenarios

### Scenario 1: "Works on my machine, fails in CI"

**Possible causes:**
1. **Different Node/Python versions**
   - Check versions in CI config match local
2. **Missing environment variables**
   - CI might not have same env vars as local
3. **Cached dependencies**
   - CI cache might be stale
4. **Platform differences**
   - Test on same OS as failing CI job

**Debug approach:**
```bash
# Match CI environment locally
node -v  # Should match CI
python --version  # Should match CI
npm ci  # Use clean install (like CI)
uv sync  # Use lockfile (like CI)
```

---

### Scenario 2: Intermittent CI Failures

**Possible causes:**
1. **Race conditions**
   - Timing issues (dev server startup, subprocess init)
2. **Resource limits**
   - CI runner out of memory/CPU
3. **Network issues**
   - Dependency download failures
4. **Flaky tests**
   - Non-deterministic test behavior

**Debug approach:**
```bash
# Run test multiple times
for i in {1..10}; do npm run test:e2e || break; done

# Add more logging
DEBUG=* npm run test:e2e

# Increase timeouts
# Edit test file, increase timeout values
```

---

### Scenario 3: Platform-Specific Failures

**Example:** Test passes on macOS/Windows, fails on Linux

**Debug approach:**
1. **Check platform conditionals:**
   ```typescript
   if (process.platform === 'linux') {
     // Linux-specific code
   }
   ```

2. **Check file paths:**
   ```typescript
   // Bad (hard-coded separator)
   const path = 'dist/python-exe';

   // Good (cross-platform)
   const path = path.join('dist', 'python-exe');
   ```

3. **Check subprocess behavior:**
   ```typescript
   // Different behavior on Windows
   const pythonExe = IS_WINDOWS ? 'bloom-hardware.exe' : 'bloom-hardware';
   ```

---

### Scenario 4: Timeout Errors

**Example:** Test times out in CI but not locally

**Common causes:**
- CI runners are slower than local machines
- Webpack build takes longer
- Python subprocess starts slower

**Solutions:**
```typescript
// Increase timeout in test
await waitForElement({ timeout: 90000 }); // Increase from 60000

// Increase dev server wait time in CI config
sleep 45  # Increase from 30 for Linux
```

---

## CI Workflow File Reference

**Location:** `.github/workflows/pr-checks.yml`

**Key sections:**

**Line 35-64:** lint-node job
- ESLint and Prettier checks
- Uses cached node_modules

**Line 66-89:** lint-python job
- black, ruff, mypy checks
- Uses uv for Python dependencies

**Line 91-123:** compile-typescript job
- Type checking with tsc
- Generates Prisma Client

**Line 125-165:** test-unit job
- Vitest unit tests with 50% coverage
- Uses in-memory test database

**Line 167-189:** test-python job
- pytest with 80% coverage enforcement
- Uses uv for dependencies

**Line 191-220:** build-python job
- PyInstaller build on 3 platforms
- Uploads artifacts for other jobs

**Line 222-293:** test-integration job
- Downloads Python executable artifact
- Runs 5 integration tests on 3 platforms
- Installs system dependencies (Linux)
- Uses `ensure-python-executable.sh` to skip rebuild

**Line 295-344:** test-dev-database job
- Tests dev mode database initialization
- Uses xvfb-run on Linux

**Line 346-445:** test-e2e-dev job
- Starts dev server in background
- Runs Playwright tests on 3 platforms
- Platform-specific xvfb/sandbox handling
- Uploads test results on failure

**Line 447-500:** test-package-database job
- Packages app and tests database
- macOS only (fastest packaging)

**Line 502-520:** all-checks-passed job
- Summary job requiring all others
- Used for branch protection

---

## Environment Variables Used in CI

| Variable | Purpose | Jobs |
|----------|---------|------|
| `BLOOM_DATABASE_URL` | Database connection string | compile-typescript, test-unit, test-integration, test-dev-database, test-e2e-dev, test-package-database |
| `BLOOM_USE_MOCK_HARDWARE` | Enable mock hardware | test-integration |
| `BLOOM_USE_MOCK_CAMERA` | Enable mock camera | test-integration |
| `BLOOM_USE_MOCK_DAQ` | Enable mock DAQ | test-integration |
| `ELECTRON_DISABLE_SANDBOX` | Disable Electron sandbox (Linux) | test-dev-database, test-e2e-dev |
| `CI` | Indicates CI environment | test-e2e-dev |
| `DEBUG` | Enable debug logging (not set by default) | Manual debugging |

---

## Caching Strategy

CI uses caching to speed up builds:

### Node.js Dependencies
```yaml
- name: Cache node_modules
  uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-modules-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-modules-
```

### Python Dependencies (uv)
```yaml
- name: Setup uv
  uses: astral-sh/setup-uv@v7
  with:
    enable-cache: true
    cache-dependency-glob: "pyproject.toml"
```

### Playwright Browsers
- Installed per job (no caching yet)
- Could be optimized in future

---

## GitHub Actions Artifacts

### build-python job uploads:
```yaml
- name: Upload Python executable
  uses: actions/upload-artifact@v4
  with:
    name: python-executable-${{ runner.os }}
    path: dist/
    retention-days: 1  # Short retention (only needed for same workflow)
```

### Subsequent jobs download:
```yaml
- name: Download Python executable
  uses: actions/download-artifact@v4
  with:
    name: python-executable-${{ runner.os }}
    path: dist/
```

### test-e2e-dev uploads on failure:
```yaml
- name: Upload Playwright test results
  uses: actions/upload-artifact@v4
  if: failure()
  with:
    name: playwright-results-${{ matrix.os }}
    path: |
      playwright-report/
      test-results/
    retention-days: 7
```

---

## Branch Protection Rules

**Required checks:**
- `all-checks-passed` (summary job)

**Settings:**
- Require branches to be up to date: Yes
- Require status checks to pass: Yes
- Require linear history: Optional

**Why only one required check?**
- `all-checks-passed` depends on all other jobs
- Simpler branch protection configuration
- Single "green check" for PR merge

---

## Manual CI Re-runs

**Re-run all jobs:**
1. Go to failed workflow run
2. Click "Re-run all jobs" button (top right)

**Re-run failed jobs only:**
1. Go to failed workflow run
2. Click "Re-run failed jobs" button

**When to re-run:**
- Intermittent failures (network, race conditions)
- Infrastructure issues (GitHub Actions outage)
- After fixing code and pushing new commit

**When NOT to re-run:**
- Test failures (fix tests first)
- Linting failures (fix code first)
- Coverage failures (add tests first)

---

## Viewing CI History

**All workflow runs:**
- GitHub repo → Actions tab → "PR Checks" workflow

**Specific branch:**
- Actions tab → Filter by branch

**Specific PR:**
- PR → Checks tab

**Download logs:**
1. Click on workflow run
2. Click on job name
3. Click "⋮" menu (top right)
4. Click "Download log archive"

---

## Quick Reference: Debugging Checklist

When CI fails, go through this checklist:

- [ ] **Identify failing job** - Which of the 10 jobs failed?
- [ ] **Check logs** - What was the error message?
- [ ] **Reproduce locally** - Does it fail on your machine?
- [ ] **Check platform** - Does it only fail on specific OS?
- [ ] **Run related command** - Try the failing command locally
- [ ] **Check recent changes** - Did you add new dependencies or change configs?
- [ ] **Verify environment** - Are environment variables set correctly?
- [ ] **Check artifacts** - Did build-python job upload executables?
- [ ] **Review caching** - Could stale cache cause issues?
- [ ] **Test with CI=true** - Does `CI=true` change behavior locally?
- [ ] **Increase timeouts** - Could slow CI runner cause timeout?
- [ ] **Check permissions** - Are file permissions correct (chmod +x)?
- [ ] **Verify paths** - Are file paths cross-platform compatible?

---

## Getting Help

- **CI-specific issues:** Check GitHub Actions status page
- **Report bugs:** https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues