# Tasks: Fix Development Database Path Parsing

## Overview

Fix the database path parsing bug where `file:./prisma/dev.db` in `BLOOM_DATABASE_URL` is incorrectly parsed as an absolute path `/prisma/dev.db` instead of a relative path.

## Phase 1: Implementation

### Task 1.1: Fix relative path handling in database.ts

- [x] Modify `src/main/database.ts` to detect `file:./` pattern
- [x] Add regex match: `/^file:(\.\/.*)$/`
- [x] Resolve relative paths using `path.resolve(app.getAppPath(), relativePath)`
- [x] Preserve existing absolute path handling
- [x] Add console logging for relative path resolution

### Task 1.2: Update .env documentation

- [x] Add comments to `.env` explaining supported formats:
  - `file:./relative/path` - Resolved relative to app root
  - `file:///absolute/path` - Used as-is

## Phase 2: Testing

### Task 2.1: Manual verification

- [x] Set `BLOOM_DATABASE_URL="file:./prisma/dev.db"` in `.env`
- [x] Run `npm run start`
- [x] Verify database opens successfully
- [x] Check console log shows correct path resolution
- [x] Verify Phenotypers page loads data

### Task 2.2: Verify existing tests

- [x] Existing E2E tests use absolute paths (no changes needed)
- [x] Database initialization works with absolute paths

## Phase 3: Quality Checks

### Task 3.1: Code quality

- [x] Run linting: `npm run lint`
- [x] Run type check: `npx tsc --noEmit`

## Acceptance Criteria

- [x] Dev server starts successfully with `file:./prisma/dev.db`
- [x] Console shows relative path resolution: `[Database] Using BLOOM_DATABASE_URL (relative): ./prisma/dev.db -> /Users/elizabethberrigan/repos/bloom-desktop/prisma/dev.db`
- [x] Database queries work correctly
- [x] Existing E2E tests unchanged (use absolute paths)
- [x] Absolute paths continue to work
- [x] No breaking changes to existing workflows
