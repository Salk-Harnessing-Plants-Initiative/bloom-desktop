# Proposal: Ensure Reproducible Database Migrations

## Summary

Currently, databases cannot be reliably created or migrated using `prisma migrate deploy`. E2E tests use `prisma db push` which bypasses migrations entirely, and development databases created via `db push` lack the `_prisma_migrations` table required for migration tracking. This proposal establishes a reproducible database workflow where all databases (dev, test, production) can be created and updated via Prisma migrations.

## Problem Statement

### Current State

1. **E2E tests use `prisma db push`** ([renderer-database-ipc.e2e.ts:126](tests/e2e/renderer-database-ipc.e2e.ts#L126)):
   ```typescript
   execSync('npx prisma db push --skip-generate', { ... });
   ```
   This syncs schema directly without using migrations, so tests never verify that migrations work.

2. **Development databases lack migration history**: Databases created via `db push` don't have a `_prisma_migrations` table, so `prisma migrate deploy` fails with "database schema is not empty".

3. **Inconsistent database path documentation**: [project.md](openspec/project.md) says development uses `./prisma/dev.db`, but the actual code in [database.ts:367-375](src/main/database.ts#L367-L375) uses `~/.bloom/dev.db`.

4. **No CI validation of migrations**: Migration files exist but are never tested in CI.

### Impact

- Developers with existing databases cannot apply new schema migrations
- Schema changes may work in tests but fail in production
- No confidence that migration files are correct or complete
- Database state cannot be reproduced from migration history alone

## Proposed Solution

### 1. Add migration-based E2E test setup option

Create a test helper that uses `prisma migrate deploy` instead of `db push`, ensuring migrations are tested in CI.

### 2. Add database upgrade script for existing databases

Create a script that can upgrade existing databases to be migration-compatible while preserving data. This includes:
- **bloom-desktop databases** created via `prisma db push`
- **bloom-desktop-pilot databases** (the original pilot application)

The script will:

1. Detect if database has `_prisma_migrations` table
2. If not, detect current schema version by inspecting table columns
3. Create `_prisma_migrations` table with records for already-applied migrations
4. Apply any remaining migrations via `prisma migrate deploy`

### 3. Add explicit database reset workflow (for development)

Document and provide tooling for developers to reset their database when needed:
- Delete existing database file
- Run `prisma migrate deploy` to create from scratch

### 4. Fix documentation inconsistency

Update `project.md` to accurately reflect that development databases are stored at `~/.bloom/dev.db` (not `./prisma/dev.db`).

### 5. Add CI job to verify migrations

Add a dedicated CI step that:
- Creates a fresh database using only migrations
- Verifies the resulting schema matches `prisma db push` output

## Scope

### In Scope

- E2E test infrastructure changes to support migration-based setup
- **Database upgrade script** for migrating existing databases while preserving data
- New npm scripts for database reset workflow (development)
- Documentation updates for database management
- CI workflow additions for migration verification
- Spec updates for developer-workflows

### Out of Scope

- Schema changes beyond the current migrations
- Automatic upgrade at app startup (users run the upgrade script manually before launching the app)

## Success Criteria

1. CI includes a job that verifies `prisma migrate deploy` produces correct schema
2. E2E tests can optionally use migrations instead of `db push`
3. **Database upgrade script** successfully upgrades existing databases while preserving data
4. Clear documentation for developers on how to reset or upgrade their database
5. `project.md` accurately reflects actual database paths

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Upgrade script fails on unexpected schema | Script detects schema version before modifying; backs up database first |
| Data loss during upgrade | Script creates backup before any modifications; can restore on failure |
| Upgrade script misidentifies schema version | Use multiple column checks to reliably detect schema state |
| CI time increase | Migration verification is fast (~5 seconds) |
| Test flakiness from migration step | Migration step is deterministic; add retry logic if needed |

## Related Work

- Existing spec: [developer-workflows/spec.md](openspec/specs/developer-workflows/spec.md) - Database Migration Command requirement
- Migration files: `prisma/migrations/` directory
- Database module: [src/main/database.ts](src/main/database.ts)
