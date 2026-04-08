## 1. Prisma Schema + Migrations

- [x] 1.1 Add `experiment_type` field to Experiment model in `prisma/schema.prisma`:
  - Type: `String @default("cylinderscan")`
  - Add new GraviScan relations to Experiment, Phenotyper, Accessions models
- [x] 1.2 Add all 8 GraviScan models to `prisma/schema.prisma` with exact fields from Ben's final schema (using `'cylinderscan'` instead of `'cylinder'` for experiment_type default):
  - GraviScan (21 fields + 6 indexes including composite)
  - GraviScanSession (10 fields + 2 indexes)
  - GraviScanner (11 fields)
  - GraviConfig (5 fields)
  - GraviImage (5 fields + 1 index)
  - GraviScanPlateAssignment (10 fields + 1 unique constraint + 2 indexes)
  - GraviPlateAccession (7 fields + 1 unique constraint + 2 indexes + CASCADE delete)
  - GraviPlateSectionMapping (6 fields + 1 unique constraint + 2 indexes + CASCADE delete)
- [x] 1.3 Run `npx prisma validate` — verify schema is valid
- [x] 1.4 Run `npx prisma generate` — verify client generation succeeds
- [x] 1.5 Create Migration 1: `npx prisma migrate dev --name add_experiment_type`
  - **Important**: at this point, only the `experiment_type` field should be added to schema.prisma (not the 8 models yet). Prisma diffs against current state, so adding everything first then trying to split migrations won't work.
  - Adds `experiment_type` column to Experiment with DEFAULT 'cylinderscan' (backfills existing rows)
- [x] 1.6 Create Migration 2: `npx prisma migrate dev --name add_graviscan_models`
  - Creates all 8 GraviScan tables with fields, indexes, constraints, and FK relations
- [x] 1.7 Run `scripts/verify-migrations.sh` — verify migrate-deploy matches db-push
- [x] 1.8 Commit: `feat: add GraviScan database schema with 8 new models`

## 2. Upgrade Infrastructure

- [x] 2.1 Update `scripts/detect-schema-version.ts`:
  - Add `'v4'` to SchemaVersion type
  - Refactor `'migrated'` detection: currently returns `'migrated'` for ANY DB with `_prisma_migrations` table, which short-circuits further checks. Change to: if `_prisma_migrations` exists, check migration count or check for `GraviScan` table to distinguish v3-migrated from v4-migrated. Return `'v4'` if GraviScan table exists (regardless of how it got there), `'v3'` if migrations table exists but no GraviScan table, or keep existing v1/v2 detection for pre-migration DBs.
  - Update "already-current" check in `upgradeDatabase()` to recognize v4
- [x] 2.2 Update `scripts/upgrade-database.ts`:
  - Add new migration entries to MIGRATIONS constant with SHA-256 checksums (computed from the actual migration SQL files)
  - Add `applyV3ToV4` step function that executes the 2 new migration SQLs within a single transaction (matching `applyV2ToV3` pattern: BEGIN TRANSACTION / COMMIT / ROLLBACK). Ensure ALTER TABLE includes `DEFAULT 'cylinderscan'` for experiment_type backfill.
  - Update `upgradeDatabase()` to handle v3→v4 transition
  - Update `toVersion` from `'v3'` to `'v4'`
  - **Also update existing test assertions in the same commit** to avoid broken test suite between phases: update `toVersion` assertions from `'v3'` to `'v4'`, update `afterVersion` checks to include `'v4'`, flip the v3 "already-current" test to a v3→v4 upgrade test
- [x] 2.3 Update `scripts/detect-schema-version.ts` tests (`schema-detection.test.ts`):
  - Add `'v4'` to SchemaVersion type test
  - Add v4 detection test (DB with GraviScan table)
- [x] 2.4 Update `scripts/lib/verify-database.sh`:
  - Add all 8 GraviScan tables to the `expected_tables` array in `verify_schema()`
- [x] 2.5 Run upgrade script against a v3 fixture to verify: `npx ts-node scripts/upgrade-database.ts tests/fixtures/databases/v3-current.db`
- [x] 2.6 Commit: `feat: update upgrade infrastructure for GraviScan schema (v3→v4)`

## 3. Test Fixtures + Upgrade Tests

- [x] 3.1 Generate `tests/fixtures/databases/v4-graviscan.db` fixture:
  - Update `scripts/generate-db-fixtures.ts` to produce the v4 fixture (don't hand-create)
  - Run all migrations against a fresh SQLite DB via `prisma migrate deploy`
  - Populate with sample CylinderScan data (experiments with experiment_type='cylinderscan') for coexistence testing
  - Optionally include sample GraviScan data (scanner, config, scan records)
- [x] 3.2 Update `tests/integration/database-upgrade.test.ts`:
  - Add v3→v4 upgrade test: load v3 fixture, run upgrade, verify all 8 GraviScan tables exist
  - Add v3→v4 data preservation test: verify existing experiments get `experiment_type = 'cylinderscan'`
  - Update existing v1→v3 test to become v1→v4 test (full upgrade path)
  - Update existing v2→v3 test to become v2→v4 test (full upgrade path)
  - Add migrated-v3→v4 test: DB with `_prisma_migrations` table (3 entries, v3 schema) upgrades to v4
  - Add empty-v3→v4 test: v3 DB with no experiments still upgrades cleanly
  - Add checksum validation tests for new migrations
  - Update migration count assertions (3→5)
  - Update table count/list assertions to include GraviScan tables
  - Update `toVersion` assertions from `'v3'` to `'v4'`
- [x] 3.3 Add FK behavior integration tests (requires PRAGMA foreign_keys = ON):
  - Test: Deleting an Accessions record cascade-deletes linked GraviPlateAccession and GraviPlateSectionMapping records
  - Test: Deleting a GraviScanSession sets session_id to NULL on linked GraviScan records (preserves scans)
  - Test: Creating an Experiment without experiment_type defaults to 'cylinderscan' (Prisma default, not just SQLite column default)
- [x] 3.4 Run integration tests: `npx vitest run tests/integration/database-upgrade.test.ts`
- [x] 3.5 Commit: `test: add GraviScan schema upgrade tests, FK behavior tests, and v4 fixture`

## 4. Final Verification

- [x] 4.1 Run `npx prisma validate`
- [x] 4.2 Run `npx prisma generate`
- [x] 4.3 Run `npx tsc --noEmit`
- [x] 4.4 Run `npx vitest run`
- [x] 4.5 Run `uv run pytest python/tests/ -v`
- [x] 4.6 Run `npx eslint --ext .ts,.tsx src/ tests/`
- [x] 4.7 Run `npx prettier --check "**/*.{ts,tsx,json}"`
- [x] 4.8 Run `scripts/verify-migrations.sh`
- [x] 4.9 Commit any remaining fixes
