# E2E Playwright-Electron Race Condition Fix

## Problem Summary

E2E tests fail intermittently with 60-second timeouts in the `beforeEach` hook. Tests that pass sometimes fail other times, with no code changes. This is a race condition between Playwright's remote debugging connection and Electron app initialization.

## Root Cause

The Machine Configuration feature (commit a6d3cd6) added an async IPC call (`config.exists()`) in `Home.tsx` that runs immediately on app startup. This async operation during initialization creates a race condition with Playwright's remote debugging connection establishment.

**Why it wasn't a problem before:** Previous versions didn't have async IPC calls firing immediately on startup.

## The Fix

A 500ms startup delay in `src/main/database.ts` during E2E mode:

```typescript
if (process.env.E2E_TEST === 'true') {
  const delay = 500;
  await new Promise((resolve) => setTimeout(resolve, delay));
}
```

- **Both Local and CI:** 500ms delay (100ms was found to be insufficient for local)

## Key Files

1. **`src/main/database.ts:243-255`** - The delay implementation
2. **`docs/E2E_TESTING.md` (Pitfall 9)** - Full documentation
3. **`tests/e2e/helpers/electron-cleanup.ts:65-70`** - 500ms cleanup delay between tests
4. **`tests/e2e/helpers/bloom-config.ts`** - Creates `~/.bloom/.env` to prevent redirect
5. **`.github/workflows/pr-checks.yml`** - Has `fail-fast: false` for E2E matrix

## Empirical Results

- Without delay: ~15% tests pass (4/27)
- With 100ms delay: Inconsistent - some tests fail intermittently
- With 500ms delay: 100% pass (181/181) - required for both local and CI

## Debugging Similar Issues

If E2E tests start failing intermittently again:

1. Check if new async IPC calls were added during app startup
2. Try increasing the delay in `database.ts`
3. Check `electron-cleanup.ts` delay if tests fail on second run
4. Ensure `~/.bloom/.env` is created before Electron launches
5. Look for "timeout waiting for" errors in test output

## Related Commits

- a6d3cd6 - Added Machine Configuration feature (introduced the race condition)
- daaba62 - Added 100ms E2E delay fix
- ec69314 - Increased to 500ms for CI, added fail-fast: false

## Warning

Do NOT remove the startup delay. It was empirically verified in February 2025 that removing it causes most E2E tests to fail.
