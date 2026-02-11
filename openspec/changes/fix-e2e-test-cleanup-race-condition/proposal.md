## Why

E2E tests are failing in CI with ~85% of tests timing out at 60 seconds. Analysis shows a race condition: `electronApp.close()` returns before the Electron process fully terminates, causing subsequent tests to fail when launching new Electron instances.

## What Changes

- Add robust Electron app cleanup that waits for process termination
- Add helper utilities for process cleanup shared across all E2E test files
- Modify the "Test Cleanup and Isolation" requirement to specify process termination verification

## Impact

- Affected specs: `e2e-testing`
- Affected code: All E2E test files (`tests/e2e/*.e2e.ts`), new helper file (`tests/e2e/helpers/electron-cleanup.ts`)
