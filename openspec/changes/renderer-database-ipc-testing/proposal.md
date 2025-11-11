# Renderer Database IPC Testing

## Summary

Add Playwright-based integration tests that verify the complete renderer-to-database path through IPC handlers, ensuring context isolation works correctly and all database operations are accessible from the UI.

## Why

**Current gap**: We have main process database tests and packaged app smoke tests, but no tests for the critical renderer → IPC → main → database path that the UI will use.

**Context from pilot**: The [bloom-desktop-pilot](https://github.com/eberrigan/bloom-desktop-pilot) includes UI pages for managing database entities:
- Scientists management page (list, create, edit scientists)
- Phenotypers management page (list, create, edit phenotypers)
- Experiments management page (list, create, edit experiments with relations)
- Accessions management page (list, create, edit accessions)
- Browse Scans page (list scans with filtering by experiment, phenotyper, date)
- Scan Preview page (view individual scan details with all relations)

**Migration plan**: These UI features will be migrated to the new codebase (see Issues #45, #46, #49, #51). The database IPC handlers already exist in `src/main/database-handlers.ts`, but currently only the scanner uses them (from main process, not renderer).

**Risks without this**:
- Context isolation bugs could break database access when UI pages are added
- Preload script API changes could break future UI without detection
- IPC handler changes could break renderer integration silently
- Error handling from renderer might not work correctly
- No confidence that the IPC bridge works before building UI pages

**Value**: Validates the complete IPC bridge now, providing confidence for future UI development and catching context isolation issues early.

**Relationship to pilot E2E tests**: The pilot has full E2E tests ([example](https://github.com/eberrigan/bloom-desktop-pilot/blob/benfica/add-testing/app/tests/e2e/create-experiments.e2e.ts)) that test complete user workflows (UI → renderer → IPC → main → database). These IPC-only tests serve a different purpose:
- **IPC tests** (this proposal): Validate the IPC bridge infrastructure before UI exists, run fast (~90s), catch IPC/context isolation issues early
- **E2E tests** (pilot): Validate complete user workflows with UI interactions, run slower, will be migrated with UI pages

The two test types complement each other: IPC tests validate infrastructure now, E2E tests validate workflows later.

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
- Issue #45 - Browse Scans page (will need `db:scans:list` from renderer)
- Issue #46 - Scan Preview page (will need `db:scans:get` from renderer)
- Issue #49 - Machine Configuration UI (will need database access from renderer)
- Issue #51 - Per-experiment camera settings (will need `db:experiments:*` from renderer)
- PR #62 - Database test infrastructure
- [bloom-desktop-pilot](https://github.com/eberrigan/bloom-desktop-pilot) - Source of UI patterns being migrated
- `tests/e2e/app-launch.e2e.ts` - Existing E2E test pattern