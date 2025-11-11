# Renderer Database IPC Testing

## Summary

Add Playwright-based integration tests that verify the complete renderer-to-database path through IPC handlers, ensuring context isolation works correctly and all database operations are accessible from the UI.

## Why

**Current gap**: We have main process database tests and packaged app smoke tests, but no tests for the critical renderer → IPC → main → database path that the UI actually uses.

**Risks without this**:
- Context isolation bugs could break database access from renderer
- Preload script API changes could break UI without detection
- IPC handler changes could break renderer integration
- Error handling from renderer might not work correctly
- No confidence that UI can actually use database

**Value**: Tests the full integration path the UI depends on, catching context isolation and IPC bridging issues that unit tests miss.

## Scope

**In scope:**
- Playwright tests for all database IPC handlers called from renderer
- Test CRUD operations (create, read, update, delete) for all models
- Test error handling from renderer perspective
- Test data filtering and relations from renderer
- Run tests in CI on Linux (with xvfb)

**Out of scope:**
- Testing database logic itself (covered by existing tests)
- Testing packaged app (use existing smoke test)
- Testing UI components (focus on IPC bridge only)
- Testing on all platforms (Linux sufficient for IPC validation)

**Success criteria:**
- All database IPC handlers verified from renderer context
- Error cases tested and handled correctly
- Tests run in CI successfully
- Tests complete in under 90 seconds
- Context isolation verified (no direct main process access)

## Dependencies

- **Requires**: PR #62 (database test infrastructure, Playwright setup)
- **Requires**: Database IPC handlers in `src/main/database-handlers.ts`
- **Requires**: Preload script API in `src/main/preload.ts`

## Related

- Issue #58 - Original issue request
- PR #62 - Database test infrastructure
- `tests/e2e/app-launch.e2e.ts` - Existing E2E test pattern