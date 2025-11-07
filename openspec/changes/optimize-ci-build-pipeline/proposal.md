# Proposal: Optimize CI Build Pipeline

**Change ID:** `optimize-ci-build-pipeline`
**Status:** Proposed
**Related:** [`fix-integration-test-ci-failures`](../fix-integration-test-ci-failures/proposal.md)

## Problem Statement

The CI pipeline contains **12-15 minutes of redundant work per run**, identified during investigation of integration test failures. The same build artifacts are created multiple times, dependencies are installed repeatedly without caching, and database schemas are generated unnecessarily.

This redundancy:
- Increases CI run time by 40-50%
- Wastes GitHub Actions minutes
- Delays feedback for developers
- Makes the pipeline harder to maintain

## Current State Analysis

### Redundant Operations Identified

#### 1. Python Build Duplication (HIGH IMPACT)

**Problem:** `npm run build:python` is executed 3+ times per CI run despite identical source code.

**Affected Jobs:**
- `.github/workflows/pr-checks.yml` line 207: `test-integration` builds Python
- Line 261: `test-e2e-dev` builds Python again
- Line 345: `test-package-database` builds Python a third time

**Cost:** ~45 seconds × 3 jobs × 3 OS = **~7 minutes per run**

**Root Cause:** Each integration test job independently builds the Python executable even though the source code is identical across jobs.

#### 2. Prisma Generation Duplication (MEDIUM IMPACT)

**Problem:** `npx prisma generate` runs 6 times per CI run with identical output.

**Affected Jobs:**
- Line 52-55: `lint-node` ← **Not needed for linting!**
- Line 106-109: `compile-typescript`
- Line 132-135: `test-unit`
- Line 222-224: `test-integration`
- Line 263-266: `test-e2e-dev`
- Line 339-342: `test-package-database`

**Cost:** ~10 seconds × 6 jobs = **~1 minute per run**

**Root Cause:** Prisma generation is run in jobs that don't actually use the database, and is duplicated across jobs that do.

#### 3. npm ci Without Caching (MEDIUM IMPACT)

**Problem:** `npm ci` runs in all 9 jobs without `node_modules` caching.

**Cost:** ~30 seconds × 9 jobs = **~4.5 minutes per run**

**Root Cause:** Only `package-lock.json` is cached (via `cache: 'npm'`), but not the actual `node_modules` directory.

#### 4. Duplicate Package.json Scripts (LOW IMPACT)

**Problem:** `test:camera` and `test:streaming` are identical scripts.

```json
"test:camera": "npm run build:python && ts-node tests/integration/test-streaming.ts",
"test:streaming": "npm run build:python && ts-node tests/integration/test-streaming.ts"
```

**Cost:** Negligible runtime impact, but confusing for maintainers.

## Proposed Solution: 3-Phase Optimization

### Phase 1: Quick Wins (30 minutes, ~1 min savings)

**Low risk, immediate value, no architectural changes**

#### 1.1 Remove Duplicate test:camera Script

**Change:** Make `test:camera` an alias to `test:streaming`

```json
"test:streaming": "npm run build:python && ts-node tests/integration/test-streaming.ts",
"test:camera": "npm run test:streaming"
```

**Files:** `package.json`
**Risk:** Very low - simple alias
**Savings:** 0s (organizational benefit)

#### 1.2 Remove Prisma Generate from lint-node Job

**Change:** Remove Prisma generation step from `.github/workflows/pr-checks.yml` line 52-55

**Rationale:** Linting doesn't execute code or access database. Prisma types aren't needed for ESLint.

**Files:** `.github/workflows/pr-checks.yml`
**Risk:** Low - linting doesn't use Prisma
**Savings:** ~10 seconds per run

#### 1.3 Add node_modules Caching

**Change:** Add `actions/cache` for `node_modules` directory

```yaml
- name: Cache node_modules
  uses: actions/cache@v4
  with:
    path: node_modules
    key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}
    restore-keys: |
      ${{ runner.os }}-node-
```

**Files:** `.github/workflows/pr-checks.yml` (add to each job before `npm ci`)
**Risk:** Low - standard practice
**Savings:** ~20-25 seconds per job = ~3-4 minutes per run

**Total Phase 1 Savings:** ~4 minutes per CI run

---

### Phase 2: Python Build Caching (2-4 hours, ~2-4 min savings)

**Medium risk, high value, introduces artifact dependencies**

#### 2.1 Create build-python Job

**Change:** Add dedicated job to build Python executable once per OS

```yaml
jobs:
  build-python:
    name: Build - Python Executable
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]

    steps:
      - name: Checkout code
        uses: actions/checkout@v5

      - name: Setup uv
        uses: astral-sh/setup-uv@v7
        with:
          enable-cache: true
          cache-dependency-glob: "pyproject.toml"
          python-version: "3.12"

      - name: Build Python executable
        run: |
          uv sync --extra dev
          uv run pyinstaller python/main.spec

      - name: Upload Python executable
        uses: actions/upload-artifact@v4
        with:
          name: python-executable-${{ runner.os }}
          path: dist/
          retention-days: 1
```

#### 2.2 Update Integration Test Jobs

**Change:** Replace `npm run build:python` with artifact download

```yaml
test-integration:
  needs: build-python

  steps:
    # ... other setup ...

    - name: Download Python executable
      uses: actions/download-artifact@v4
      with:
        name: python-executable-${{ runner.os }}
        path: dist/

    - name: Make executable (macOS/Linux)
      if: runner.os != 'Windows'
      run: chmod +x dist/bloom-hardware

    # Skip npm run build:python - already have executable
    - name: Run integration tests
      run: npm run test:camera
```

**Files:** `.github/workflows/pr-checks.yml`
**Risk:** Medium - adds job dependency, artifact paths must be correct
**Savings:** ~45 seconds × 2 jobs = ~1.5 minutes per run (builds once instead of 3x)

**Total Phase 2 Savings:** ~1.5 minutes per CI run

---

### Phase 3: Structural Improvements (4-8 hours, ~1-2 min + maintainability)

**Higher risk, long-term value, significant refactoring**

#### 3.1 Create Composite Setup Action

**Change:** Extract common setup steps into `.github/actions/setup-bloom/action.yml`

```yaml
name: 'Setup Bloom Environment'
description: 'Sets up Node.js, uv, and installs dependencies'

inputs:
  setup-python:
    description: 'Whether to setup uv for Python'
    required: false
    default: 'false'

runs:
  using: 'composite'
  steps:
    - name: Setup Node.js
      uses: actions/setup-node@v6
      with:
        node-version: '20'
        cache: 'npm'

    - name: Cache node_modules
      uses: actions/cache@v4
      with:
        path: node_modules
        key: ${{ runner.os }}-node-${{ hashFiles('package-lock.json') }}

    - name: Setup uv
      if: inputs.setup-python == 'true'
      uses: astral-sh/setup-uv@v7
      with:
        enable-cache: true
        cache-dependency-glob: "pyproject.toml"
        python-version: "3.12"

    - name: Install dependencies
      shell: bash
      run: npm ci
```

**Usage in jobs:**
```yaml
- name: Setup environment
  uses: ./.github/actions/setup-bloom
  with:
    setup-python: 'true'
```

**Files:** New `.github/actions/setup-bloom/action.yml`, all workflow files
**Risk:** Medium-High - centralized setup, need to test on all platforms
**Savings:** ~30 seconds per run + easier maintenance

#### 3.2 Cache Prisma Client

**Change:** Cache generated Prisma Client

```yaml
- name: Cache Prisma Client
  uses: actions/cache@v4
  with:
    path: node_modules/.prisma
    key: prisma-${{ hashFiles('prisma/schema.prisma') }}

- name: Generate Prisma Client
  run: npx prisma generate
  if: steps.cache-prisma.outputs.cache-hit != 'true'
```

**Files:** `.github/workflows/pr-checks.yml`
**Risk:** Low-Medium - must ensure cache invalidation works
**Savings:** ~5-10 seconds per job = ~30-60 seconds per run

**Total Phase 3 Savings:** ~1-1.5 minutes per run + maintainability

---

## Total Expected Savings

| Phase | Effort | Savings | Risk |
|-------|--------|---------|------|
| Phase 1 | 30 min | ~4 min/run | Low |
| Phase 2 | 2-4 hrs | ~1.5 min/run | Medium |
| Phase 3 | 4-8 hrs | ~1-2 min/run | Medium-High |
| **Total** | **7-12 hrs** | **~6.5-7.5 min/run** | **Managed** |

**Current redundant work:** ~12-15 minutes per run
**After optimizations:** ~5-7 minutes
**Net savings:** 40-50% reduction in redundant work

## Implementation Plan

### Step 1: Phase 1 (This PR)

- [ ] Remove duplicate `test:camera` script
- [ ] Remove Prisma generate from `lint-node` job
- [ ] Add `node_modules` caching to all jobs
- [ ] Test on all platforms (Linux, macOS, Windows)
- [ ] Measure time savings

### Step 2: Phase 2 (Next PR)

- [ ] Create `build-python` job with matrix strategy
- [ ] Add artifact upload/download
- [ ] Update `test-integration`, `test-e2e-dev`, `test-package-database` jobs
- [ ] Handle executable permissions on Unix systems
- [ ] Test artifact paths on all platforms
- [ ] Verify builds are identical to direct builds

### Step 3: Phase 3 (Future PR)

- [ ] Create composite `setup-bloom` action
- [ ] Test composite action on all platforms
- [ ] Migrate all jobs to use composite action
- [ ] Add Prisma Client caching
- [ ] Validate cache invalidation works correctly
- [ ] Document new workflow structure

## Risks & Mitigation

### Risk 1: Cache Invalidation Issues

**Problem:** Stale caches could cause mysterious failures
**Mitigation:**
- Use strict cache keys based on file hashes
- Include cache busting in troubleshooting docs
- Monitor for "works on CI but not locally" issues

### Risk 2: Artifact Path Differences

**Problem:** Python executable paths differ by OS (`.exe` on Windows)
**Mitigation:**
- Use `${{ runner.os }}` in artifact names
- Test downloads on all platforms before merging
- Document artifact structure

### Risk 3: Job Dependency Bottlenecks

**Problem:** Dependent jobs can't start until `build-python` completes
**Mitigation:**
- Keep `build-python` fast (~45 seconds)
- Run linting/compilation jobs (which don't need Python) in parallel
- Monitor overall CI time, not just individual job time

### Risk 4: Debugging Complexity

**Problem:** Cached artifacts make "works on my machine" harder to debug
**Mitigation:**
- Clear logging of cache hits/misses
- Document how to bypass caching for debugging
- Keep artifact retention short (1 day) to force rebuilds

## Success Metrics

- [ ] CI run time reduced by 6-7 minutes
- [ ] No increase in failure rate
- [ ] No platform-specific issues
- [ ] Developer feedback positive
- [ ] Easier to add new jobs (with composite action)

## Files to Change

### Phase 1
- `package.json` - Remove duplicate script
- `.github/workflows/pr-checks.yml` - Remove Prisma from lint-node, add node_modules cache

### Phase 2
- `.github/workflows/pr-checks.yml` - Add build-python job, update test jobs

### Phase 3
- `.github/actions/setup-bloom/action.yml` - New composite action
- `.github/workflows/pr-checks.yml` - Use composite action, add Prisma caching

## Related Documentation

- [GitHub Actions Caching](https://docs.github.com/en/actions/using-workflows/caching-dependencies-to-speed-up-workflows)
- [GitHub Actions Artifacts](https://docs.github.com/en/actions/using-workflows/storing-workflow-data-as-artifacts)
- [Composite Actions](https://docs.github.com/en/actions/creating-actions/creating-a-composite-action)

## References

- Discovered during: [`fix-integration-test-ci-failures`](../fix-integration-test-ci-failures/proposal.md)
- Current CI config: `.github/workflows/pr-checks.yml`
- Build script: `scripts/build-python.js`
