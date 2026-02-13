# Tasks: Ensure Reproducible Database Migrations

## Overview

Total tasks: 15
Estimated complexity: Medium-High
Dependencies: None (can start immediately)

## Task List

### Phase 1: Test Fixtures and TDD Setup

- [x] **Task 1: Create test fixture databases for each schema version**
  - Create `tests/fixtures/databases/` directory
  - Create `v1-init.db` - schema matching init migration (and pilot)
  - Create `v2-add-genotype.db` - schema with genotype_id column
  - Create `v3-current.db` - current schema with accession_name
  - Each fixture should contain sample data (scientists, experiments, scans, mappings)
  - Add script to regenerate fixtures: `scripts/generate-db-fixtures.ts`
  - **Validation**: ✅ Fixtures can be loaded and queried successfully

- [x] **Task 2: Write unit tests for schema version detection (TDD)**
  - Create `tests/unit/schema-detection.test.ts`
  - Test: detects v1 schema (has accession_id, no genotype_id)
  - Test: detects v2 schema (has genotype_id)
  - Test: detects v3 schema (has accession_name, no accession_id)
  - Test: detects already-migrated database (has _prisma_migrations table)
  - Test: handles empty database gracefully
  - Test: handles missing tables gracefully
  - **Validation**: ✅ 12 tests pass, 100% coverage of detection logic

### Phase 2: Database Upgrade Script (Data-Preserving)

- [x] **Task 3: Write integration tests for upgrade paths (TDD)**
  - Create `tests/integration/database-upgrade.test.ts`
  - Test: v1 → v3 upgrade preserves all data
  - Test: v2 → v3 upgrade preserves all data
  - Test: pilot database → v3 upgrade preserves all data
  - Test: already-current database reports "up to date"
  - Test: backup file is created before any modifications
  - Test: backup can be restored if upgrade fails
  - Test: data integrity after upgrade (counts match, foreign keys valid)
  - **Validation**: ✅ 18 tests pass, covers all upgrade paths

- [x] **Task 4: Create schema version detection utility**
  - Create `scripts/detect-schema-version.ts`
  - Use SQLite `PRAGMA table_info` to inspect columns
  - Detect v1 (init), v2 (add_genotype_id), or v3 (cleanup)
  - Export as module for use in upgrade script and tests
  - **Validation**: ✅ Unit tests pass

- [x] **Task 5: Create database upgrade script**
  - Create `scripts/upgrade-database.ts`
  - Backup database before modifications
  - Create `_prisma_migrations` table with appropriate records
  - Apply schema changes while preserving data
  - **Validation**: ✅ Integration tests pass

- [x] **Task 6: Add npm script for database upgrade**
  - Add `db:upgrade` script to package.json
  - Add `test:db-upgrade` script for running upgrade tests
  - Handle cross-platform compatibility
  - Add helpful output messages
  - **Validation**: ✅ `npm run db:upgrade` works on existing dev database

### Phase 3: CI Migration Verification

- [x] **Task 7: Add migration verification script**
  - Create `scripts/verify-migrations.sh`
  - Script creates two temp databases (migrate vs push)
  - Compares SQLite schemas
  - Exits non-zero if schemas differ
  - **Validation**: ✅ Script runs successfully, exits 0 when migrations match schema

- [x] **Task 8: Add CI job for migration verification and upgrade tests**
  - Add new job to `.github/workflows/pr-checks.yml`
  - Runs `scripts/verify-migrations.sh`
  - Runs `npm run test:db-upgrade` (upgrade integration tests)
  - Runs on Linux only (SQLite behavior is consistent)
  - **Validation**: ✅ CI job added to workflow

### Phase 4: Developer Reset Workflow

- [x] **Task 9: Add npm scripts for database reset**
  - Add `prisma:reset` script to delete dev.db and run migrations
  - Add `prisma:reset:seed` to also run seed script
  - Handle cross-platform path differences via `scripts/reset-database.js`
  - **Validation**: ✅ `npm run prisma:reset` creates fresh database from migrations

- [x] **Task 10: Update `/database-migration` command docs**
  - Update `.claude/commands/database-migration.md` with upgrade and reset workflows
  - Document when to use upgrade vs reset
  - Add troubleshooting section for migration failures
  - **Validation**: ✅ Command docs include both upgrade and reset instructions

### Phase 5: Documentation Updates

- [x] **Task 11: Fix database paths in project.md**
  - Update "Environment-based database paths" section
  - Change dev path from `./prisma/dev.db` to `~/.bloom/dev.db`
  - Add note about why dev database is in user home directory
  - **Validation**: ✅ Documentation matches actual code behavior

- [x] **Task 12: Update DATABASE.md with migration workflow**
  - Add section on "Database Upgrade Workflow" for preserving data
  - Add section on "Database Reset Workflow" for development
  - Document migration verification CI job
  - Add troubleshooting for common migration errors
  - **Validation**: ✅ DATABASE.md covers complete migration lifecycle

- [x] **Task 13: Update PILOT_COMPATIBILITY.md**
  - Update Scan model to show `accession_name` instead of `accession_id`
  - Document that pilot databases need upgrade script to use new schema
  - Update "Migration Path" section with `npm run db:upgrade` instructions
  - Update "Last Verified" date
  - **Validation**: ✅ Documentation accurately reflects current schema differences

### Phase 6: Spec Updates

- [x] **Task 14: Add spec requirements for database upgrade**
  - Add requirement to `developer-workflows/spec.md`
  - Requirement for `db:upgrade` script that preserves data
  - Scenarios for upgrading from each schema version
  - **Validation**: ✅ `openspec validate` passes

- [x] **Task 15: Add spec requirements for migration verification and reset**
  - Add requirement for CI migration verification
  - Add requirement for `prisma:reset` script
  - Scenarios for fresh setup and schema changes
  - **Validation**: ✅ `openspec validate` passes

## Task Dependencies

```
Phase 1 (TDD Setup):
Task 1 (fixtures) ──▶ Task 2 (unit tests)
                           │
Phase 2 (Implementation):  │
Task 2 ──▶ Task 3 (integration tests) ──▶ Task 4 (detection) ──▶ Task 5 (upgrade) ──▶ Task 6 (npm script)
                                                                                            │
Phase 3 (CI):                                                                               │
Task 7 (verify script) ──▶ Task 8 (CI job) ◀────────────────────────────────────────────────┘

Phase 4 (Reset):
Task 9 (reset scripts) ──▶ Task 10 (docs)

Phase 5 (Documentation):
Task 11, 12, 13 can run in parallel

Phase 6 (Specs):
Task 14 ──▶ Task 15
```

**TDD Order** (write tests first):
1. Task 1: Create fixture databases
2. Task 2: Write unit tests for schema detection (tests will fail)
3. Task 4: Implement schema detection (tests pass)
4. Task 3: Write integration tests for upgrade (tests will fail)
5. Task 5: Implement upgrade script (tests pass)
6. Task 6+: Continue with remaining tasks

## Verification Checklist

After all tasks complete:

**Testing:**
1. [ ] Unit tests pass: `npm run test:unit` includes schema detection tests
2. [ ] Integration tests pass: `npm run test:db-upgrade` covers all upgrade paths
3. [ ] Test coverage: schema detection has 100% coverage
4. [ ] Test coverage: upgrade script has >80% coverage
5. [ ] CI runs upgrade tests on every PR

**Functionality:**
6. [ ] `npm run db:upgrade` upgrades v1 databases while preserving data
7. [ ] `npm run db:upgrade` upgrades v2 databases while preserving data
8. [ ] `npm run db:upgrade` upgrades pilot databases while preserving data
9. [ ] `npm run db:upgrade` creates backup before modifying database
10. [ ] `npm run prisma:reset` creates fresh database from migrations

**Documentation:**
11. [ ] `project.md` shows correct database paths
12. [ ] `DATABASE.md` includes upgrade and reset workflows
13. [ ] `PILOT_COMPATIBILITY.md` reflects current schema and upgrade path
14. [ ] `/database-migration` command documents both upgrade and reset
15. [ ] `openspec validate ensure-reproducible-database-migrations` passes
