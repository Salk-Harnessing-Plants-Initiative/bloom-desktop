# Design: Ensure Reproducible Database Migrations

## Context

Prisma supports two approaches to database schema management:

1. **`prisma db push`**: Directly syncs schema.prisma to database without migration history
   - Fast and convenient for prototyping
   - No migration tracking (`_prisma_migrations` table)
   - Cannot be used with `prisma migrate deploy` later

2. **`prisma migrate deploy`**: Applies migration files in sequence
   - Tracks applied migrations in `_prisma_migrations` table
   - Production-safe, deterministic
   - Requires migrations to be created via `prisma migrate dev`

The project currently uses `db push` everywhere but has migration files that are never tested.

## Design Decisions

### Decision 1: Keep `db push` for E2E tests, add separate migration verification

**Context**: E2E tests need fast, reliable database setup. Migration application is slower and could introduce flakiness.

**Decision**: Keep `db push` for E2E test databases, but add a dedicated CI job that verifies migrations produce equivalent schema.

**Rationale**:

- E2E tests focus on application behavior, not migration correctness
- A separate verification job provides clear signal when migrations are broken
- No changes to existing E2E test infrastructure

**Alternatives considered**:

- Switch all E2E tests to use migrations: Rejected due to complexity and potential flakiness
- Test migrations only manually: Rejected due to risk of shipping broken migrations

### Decision 2: Schema equivalence verification via SQL dump comparison

**Context**: Need to verify that `migrate deploy` produces the same schema as `db push`.

**Decision**: Create two databases (one via migrations, one via `db push`) and compare their SQLite schemas.

**Implementation**:

```bash
# Create database via migrations
rm -f /tmp/migrate-test.db
BLOOM_DATABASE_URL=file:/tmp/migrate-test.db npx prisma migrate deploy

# Create database via db push
rm -f /tmp/push-test.db
BLOOM_DATABASE_URL=file:/tmp/push-test.db npx prisma db push

# Compare schemas (ignore _prisma_migrations table)
sqlite3 /tmp/migrate-test.db ".schema" | grep -v "_prisma_migrations" > /tmp/migrate-schema.sql
sqlite3 /tmp/push-test.db ".schema" > /tmp/push-schema.sql
diff /tmp/migrate-schema.sql /tmp/push-schema.sql
```

**Rationale**:

- Direct schema comparison catches any drift between migrations and schema.prisma
- SQLite schema dump is deterministic
- Simple to implement and understand

### Decision 3: Database upgrade script for existing databases with data

**Context**: Production databases and databases with valuable data cannot simply be deleted. This includes:

- bloom-desktop databases created via `db push` (lack migration history)
- bloom-desktop-pilot databases (the original pilot application, also lack migration history)

**Decision**: Create a `scripts/upgrade-database.ts` script that:

1. Backs up the database file
2. Detects if `_prisma_migrations` table exists
3. If not, detects current schema version by inspecting columns
4. Creates `_prisma_migrations` table with records for already-applied migrations
5. Runs `prisma migrate deploy` to apply any remaining migrations

**Schema version detection logic**:

Verified against pilot schema at: https://github.com/eberrigan/bloom-desktop-pilot/blob/dev/app/prisma/schema.prisma

```
Schema Version 1 (init) - MATCHES BLOOM-DESKTOP-PILOT:
- PlantAccessionMappings has: accession_id, plant_barcode, accession_file_id
- PlantAccessionMappings does NOT have: genotype_id, accession_name
- Scan has: accession_id (optional)
- Scan does NOT have: accession_name
- NOTE: Pilot schema verified 2026-02-12 to match init migration exactly

Schema Version 2 (add_genotype_id_to_plant_mappings):
- PlantAccessionMappings has: accession_id, plant_barcode, genotype_id, accession_file_id
- Scan has: accession_id

Schema Version 3 (cleanup_accession_fields) - CURRENT:
- PlantAccessionMappings has: plant_barcode, accession_name, accession_file_id
- PlantAccessionMappings does NOT have: accession_id, genotype_id
- Scan has: accession_name (not accession_id)
```

**Rationale**:

- Preserves user data during schema evolution
- Makes existing databases migration-compatible going forward
- Backup ensures recovery if something goes wrong
- Column-based detection is reliable (SQLite `PRAGMA table_info`)

**Alternatives considered**:

- Manual SQL migration: Rejected - not reproducible, error-prone
- Export/import data: Rejected - complex, loses relationships
- Require fresh database: Rejected - unacceptable data loss for production

### Decision 4: Developer database reset workflow (for development)

**Context**: For development databases where data loss is acceptable, a simple reset is faster than upgrading.

**Decision**: Provide an npm script `prisma:reset` that:

1. Deletes existing dev database
2. Creates new database via `prisma migrate deploy`
3. Optionally seeds with test data

**Implementation**:

```json
{
  "scripts": {
    "prisma:reset": "rm -f ~/.bloom/dev.db && npm run prisma:migrate:deploy",
    "prisma:reset:seed": "npm run prisma:reset && npm run prisma:seed"
  }
}
```

**Rationale**:

- Simple, explicit workflow for development
- Faster than upgrade when data doesn't matter
- Seed step is optional for those who want empty database

### Decision 5: Document actual database paths

**Context**: `project.md` incorrectly states dev database is at `./prisma/dev.db`.

**Decision**: Update documentation to reflect actual behavior:

- Development: `~/.bloom/dev.db` (outside project directory)
- Production: `~/.bloom/data/bloom.db`
- E2E tests: Per-test temporary files (e.g., `tests/e2e/renderer-ipc-test.db`)

**Rationale**:

- Accurate documentation prevents confusion
- Current behavior (user home directory) is intentional - keeps data separate from project

## Architecture

### CI Pipeline Addition

```
┌─────────────────────────────────────────────────────────────┐
│  Existing PR Checks                                         │
│  ├─ Lint                                                    │
│  ├─ Unit Tests                                              │
│  ├─ Integration Tests                                       │
│  └─ E2E Tests                                               │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  NEW: Migration Verification Job                            │
│  ├─ Create DB via prisma migrate deploy                     │
│  ├─ Create DB via prisma db push                            │
│  └─ Compare schemas (fail if different)                     │
└─────────────────────────────────────────────────────────────┘
```

### Database Upgrade Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│  npm run db:upgrade                                                      │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  1. Backup database to ~/.bloom/dev.db.backup                           │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  2. Check: Does _prisma_migrations table exist?                         │
│     ├─ YES → Skip to step 5 (already migration-compatible)              │
│     └─ NO  → Continue to step 3                                         │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  3. Detect schema version by inspecting columns:                        │
│     - Check PlantAccessionMappings columns                              │
│     - Check Scan columns                                                │
│     → Determine: v1 (init), v2 (add_genotype_id), or v3 (cleanup)       │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  4. Create _prisma_migrations table with records for applied migrations │
│     - If v1: insert init migration record                               │
│     - If v2: insert init + add_genotype_id records                      │
│     - If v3: insert all three migration records                         │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  5. Run: prisma migrate deploy                                          │
│     - Applies any migrations not yet in _prisma_migrations              │
│     - For v1→v3: applies add_genotype_id, then cleanup_accession_fields │
│     - For v2→v3: applies cleanup_accession_fields only                  │
│     - For v3: no migrations to apply                                    │
└───────────────────────────────────┬─────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  6. Success! Database is now migration-compatible                       │
│     Future migrations can be applied with: prisma migrate deploy        │
└─────────────────────────────────────────────────────────────────────────┘
```

### Database Lifecycle

```
Developer Workflow:
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Fresh Start  │────▶│ prisma:reset │────▶│ Ready to Dev │
│ (no dev.db)  │     │              │     │ (~/.bloom/   │
└──────────────┘     └──────────────┘     │  dev.db)     │
                                          └──────────────┘
                                                 │
                                                 ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Schema       │────▶│ prisma       │────▶│ Migration    │
│ Change       │     │ migrate dev  │     │ Created      │
└──────────────┘     └──────────────┘     └──────────────┘
                                                 │
                                                 ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│ Other Devs   │────▶│ prisma:reset │────▶│ Has New      │
│ Pull Changes │     │ (if needed)  │     │ Schema       │
└──────────────┘     └──────────────┘     └──────────────┘
```

## Implementation Notes

### Why not auto-migrate existing databases?

Prisma's `migrate deploy` requires the `_prisma_migrations` table. Databases created via `db push` don't have this table. While it's technically possible to "baseline" an existing database by inserting migration records, this is error-prone and requires exact schema matching.

For development databases, the simplest approach is to reset: delete and recreate. This is acceptable because:

1. Dev databases contain test data that can be regenerated via seeding
2. The reset workflow is explicit and predictable
3. No complex migration state to manage

### E2E test database isolation

E2E tests already create isolated temporary databases:

- Each test file uses a unique database path
- Databases are deleted after tests complete
- No shared state between test runs

This isolation means the migration verification job is independent of E2E tests.

## Testing Strategy

### Test-Driven Development (TDD) Approach

The database upgrade functionality follows TDD:

1. **Create test fixtures first** - SQLite databases representing each schema version
2. **Write failing tests** - Unit and integration tests that define expected behavior
3. **Implement functionality** - Code to make tests pass
4. **Refactor** - Improve code while keeping tests green

### Test Fixtures

Located in `tests/fixtures/databases/`:

```
tests/fixtures/databases/
├── v1-init.db           # Schema v1 (matches pilot)
├── v2-add-genotype.db   # Schema v2 (has genotype_id)
├── v3-current.db        # Schema v3 (current, has accession_name)
└── generate-fixtures.ts # Script to regenerate fixtures
```

Each fixture contains realistic test data:

- 2 scientists, 2 phenotypers
- 2 experiments with accession links
- 5 scans with plant mappings
- Sample images

### Unit Tests (`tests/unit/schema-detection.test.ts`)

```typescript
describe('detectSchemaVersion', () => {
  it('detects v1 schema (has accession_id, no genotype_id)', async () => {
    const version = await detectSchemaVersion(
      'tests/fixtures/databases/v1-init.db'
    );
    expect(version).toBe('v1');
  });

  it('detects v2 schema (has genotype_id)', async () => {
    const version = await detectSchemaVersion(
      'tests/fixtures/databases/v2-add-genotype.db'
    );
    expect(version).toBe('v2');
  });

  it('detects v3 schema (has accession_name)', async () => {
    const version = await detectSchemaVersion(
      'tests/fixtures/databases/v3-current.db'
    );
    expect(version).toBe('v3');
  });

  it('returns "migrated" for databases with _prisma_migrations table', async () => {
    // Create temp db via migrations
    const version = await detectSchemaVersion(tempMigratedDb);
    expect(version).toBe('migrated');
  });
});
```

### Integration Tests (`tests/integration/database-upgrade.test.ts`)

```typescript
describe('upgradeDatabase', () => {
  it('upgrades v1 → v3 preserving all data', async () => {
    const testDb = copyFixture('v1-init.db');

    // Count records before upgrade
    const beforeCounts = await countRecords(testDb);

    // Run upgrade
    await upgradeDatabase(testDb);

    // Verify schema is now v3
    const version = await detectSchemaVersion(testDb);
    expect(version).toBe('v3');

    // Verify all data preserved
    const afterCounts = await countRecords(testDb);
    expect(afterCounts.scientists).toBe(beforeCounts.scientists);
    expect(afterCounts.experiments).toBe(beforeCounts.experiments);
    expect(afterCounts.scans).toBe(beforeCounts.scans);

    // Verify accession_name populated from genotype_id
    const mappings = await getMappings(testDb);
    expect(mappings.every((m) => m.accession_name !== null)).toBe(true);
  });

  it('creates backup before modifying database', async () => {
    const testDb = copyFixture('v2-add-genotype.db');
    const backupPath = testDb + '.backup';

    await upgradeDatabase(testDb);

    expect(fs.existsSync(backupPath)).toBe(true);
  });

  it('does not modify already-current databases', async () => {
    const testDb = createFreshDbViaMigrations();
    const beforeModTime = fs.statSync(testDb).mtime;

    const result = await upgradeDatabase(testDb);

    expect(result.status).toBe('already-current');
    expect(fs.statSync(testDb).mtime).toEqual(beforeModTime);
  });
});
```

### Data Integrity Verification

After each upgrade, tests verify:

1. **Record counts match** - No data loss
2. **Foreign keys valid** - Relationships preserved
3. **Column values migrated** - `genotype_id` → `accession_name`
4. **Nullable fields handled** - NULL values preserved correctly

### Coverage Requirements

| Component        | Target | Rationale                                    |
| ---------------- | ------ | -------------------------------------------- |
| Schema detection | 100%   | Critical safety - must detect all versions   |
| Upgrade script   | >80%   | Core functionality must be thoroughly tested |
| Backup/restore   | 100%   | Data safety - no untested paths              |

### CI Integration

The CI pipeline runs:

```yaml
- name: Database Upgrade Tests
  run: npm run test:db-upgrade

- name: Migration Verification
  run: ./scripts/verify-migrations.sh
```

Both must pass for PRs to be merged.
