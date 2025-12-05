## Why

GitHub Actions CI workflow is failing with `ENOSPC: no space left on device` errors during E2E tests. Ubuntu runners have ~14GB disk space, but the workflow accumulates ~2GB+ of artifacts (node_modules, webpack cache, Playwright browsers, Python venv, build artifacts) which can exceed available space when combined with OS overhead and prior workflow remnants.

## What Changes

- Use the `jlumbroso/free-disk-space@main` GitHub Action to free disk space on Ubuntu runners
- Add the action to disk-intensive jobs: `test-e2e-dev` (Linux) and `test-dev-database`
- Configure the action to remove Android SDK (~14GB), .NET (~2.7GB), Haskell, large packages (~5.3GB), and Docker images
- Keep `tool-cache: false` to preserve Node.js, Python, and other cached tools we need

## Impact

- Affected specs: developer-workflows (CI workflow requirements)
- Affected code: `.github/workflows/pr-checks.yml`
- Non-breaking: Only adds cleanup steps before existing operations
- No changes to test behavior or outcomes
- Expected: ~25GB freed on Ubuntu runners, preventing ENOSPC errors