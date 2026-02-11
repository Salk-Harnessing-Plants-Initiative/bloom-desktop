## Why

The database auto-initialization feature lacks E2E test coverage. While unit tests verify individual functions, they don't test the actual user scenarios: starting the app with various database states and verifying the app works correctly. The existing E2E tests pre-create the database before each test, bypassing the auto-initialization logic entirely.

## What Changes

- Add E2E tests for fresh install scenario (no database file exists)
- Add E2E tests for existing database with current schema (data preserved)
- Add E2E tests for existing database with user data (verifies data survives restart)
- Add E2E tests for corrupted database handling (preserved and new one created)
- Modify E2E test setup to test auto-initialization instead of bypassing it

## Impact

- Affected specs: `e2e-testing`
- Affected code: `tests/e2e/database-auto-init.e2e.ts` (new file)
- No changes to production code - this is purely test coverage
