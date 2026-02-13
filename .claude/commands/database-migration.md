# Database Migrations with Prisma

Guide for creating and managing Prisma database migrations for schema changes.

## Commands

### Create Migration

```bash
# Create new migration after schema changes
npm run prisma:migrate

# This will:
# 1. Prompt for migration name
# 2. Generate SQL migration file
# 3. Apply migration to dev database
# 4. Regenerate Prisma Client
```

### Generate Prisma Client

```bash
# Regenerate Prisma Client after schema changes (without migration)
npm run prisma:generate
```

### View Database

```bash
# Open Prisma Studio for dev database
npm run prisma:studio

# Open Prisma Studio for production database
npm run studio:production
```

### Upgrade Database (Preserves Data)

```bash
# Upgrade existing database while preserving all data
npm run db:upgrade

# For a specific database file:
npx ts-node scripts/upgrade-database.ts /path/to/database.db
```

Use this when:
- You have a database created with `prisma db push`
- You have a database from bloom-desktop-pilot
- Your database is missing the `_prisma_migrations` table

### Reset Database (Development Only)

```bash
# Delete dev database and create fresh from migrations
npm run prisma:reset

# Reset and seed with test data
npm run prisma:reset:seed

# WARNING: This deletes all data! Only use in development.
```

Use this when:
- Setting up a new development environment
- Your database has irrecoverable issues
- You want a clean slate (data loss acceptable)

## Migration Workflow

### 1. Modify Schema

Edit `prisma/schema.prisma`:

```prisma
model Scan {
  id          String   @id @default(cuid())
  barcode     String
  timestamp   DateTime @default(now())
  // Add new field
  brightness  Float    @default(0.5)
  // ...
}
```

### 2. Create Migration

```bash
npm run prisma:migrate

# Prompt: Enter migration name
# Example: add_brightness_to_scan
```

This creates:

- `prisma/migrations/20250107120000_add_brightness_to_scan/migration.sql`
- SQL file with ALTER TABLE statements

### 3. Verify Migration

```sql
-- Generated migration.sql
ALTER TABLE "Scan" ADD COLUMN "brightness" REAL NOT NULL DEFAULT 0.5;
```

Check:

- [ ] Column type correct (REAL for Float, TEXT for String, INTEGER for Int)
- [ ] Default value appropriate
- [ ] NOT NULL vs nullable correct
- [ ] No unintended changes

### 4. Test in Development

```bash
# Run app and verify new field works
npm run start

# Check database with Prisma Studio
npm run prisma:studio
```

### 5. Test in Packaged App

```bash
# Build and package
npm run package

# Run packaged app
# Verify migration runs automatically on first launch
```

## Database Locations

### Development

- **Path**: `~/.bloom/dev.db`
- **When**: Running `npm run start` or `npm run dev`
- **Migrations**: Applied on app startup via `prisma migrate deploy`
- **Note**: Database stored outside project directory to persist across branches

### Production (Packaged App)

- **Path**: `~/.bloom/data/bloom.db`
- **When**: Running packaged application
- **Migrations**: Applied on app startup via `prisma migrate deploy`
- **Platform-specific paths**:
  - macOS: `/Users/<username>/.bloom/data/bloom.db`
  - Linux: `/home/<username>/.bloom/data/bloom.db`
  - Windows: `C:\Users\<username>\.bloom\data\bloom.db`

### E2E Tests

- **Path**: `./tests/e2e/test.db`
- **When**: Running E2E tests
- **Migrations**: Applied by test setup

## Migration Best Practices

### Naming Conventions

Use descriptive, verb-led names:

✅ **Good**:

- `add_brightness_to_scan`
- `rename_camera_config_to_camera_settings`
- `create_experiment_table`

❌ **Bad**:

- `migration1`
- `update`
- `changes`

### Backward Compatibility

Maintain compatibility with bloom-desktop-pilot:

- [ ] Don't rename existing tables used by pilot
- [ ] Don't change existing column types
- [ ] Add new columns with DEFAULT values (not NOT NULL without default)
- [ ] See `docs/PILOT_COMPATIBILITY.md` for schema requirements

### Data Migrations

For complex migrations needing data transformation:

1. Create migration SQL
2. Add data transformation script:

```sql
-- Migration: 20250107_normalize_brightness.sql

-- Add new column
ALTER TABLE "Scan" ADD COLUMN "brightness_normalized" REAL;

-- Transform existing data
UPDATE "Scan" SET "brightness_normalized" = "brightness" / 100.0;

-- Drop old column (if removing)
-- ALTER TABLE "Scan" DROP COLUMN "brightness";
```

### Testing Migrations

Always test:

1. **Fresh database**: Migration works on empty database
2. **Existing data**: Migration preserves and transforms existing data correctly
3. **Packaged app**: Migration runs on first launch after upgrade
4. **Rollback**: Can revert if needed (keep backup)

## Common Issues

### "Migration already applied"

**Cause**: Migration file exists but wasn't applied to database

**Solution**:

```bash
# Mark migration as applied without running
npx prisma migrate resolve --applied 20250107120000_migration_name

# Or reset and reapply (DEVELOPMENT ONLY - loses data)
npx prisma migrate reset
```

### "Database schema is not empty" (prisma migrate deploy)

**Cause**: Database was created with `prisma db push` instead of migrations. It has data but no `_prisma_migrations` table.

**Solution**:

```bash
# Option 1: Upgrade (preserves data)
npm run db:upgrade

# Option 2: Reset (loses data)
npm run prisma:reset
```

This is common for databases created during development when using `db push` for rapid iteration.

### "Database schema is not in sync"

**Cause**: Manual database changes or migration issues

**Solution**:

```bash
# Check current status
npx prisma migrate status

# If development and data not important, reset
npm run prisma:reset

# If data important, use upgrade
npm run db:upgrade
```

### Migration Fails in Packaged App

**Cause**: Migration contains syntax not supported by SQLite or references missing data

**Debug**:

1. Check app logs (stderr output)
2. Test migration manually:
   ```bash
   sqlite3 ~/.bloom/data/bloom.db < prisma/migrations/XXX/migration.sql
   ```
3. Fix migration SQL and retest

**Prevention**:

- Test migrations in packaged app before release
- Use SQLite-compatible SQL (no PostgreSQL-specific features)
- Avoid foreign key constraints that might fail on existing data

### Prisma Client Out of Sync

**Error**: `Prisma Client validation error: The provided value for the column is too long for the column's type`

**Cause**: Prisma Client generated before schema change

**Solution**:

```bash
npm run prisma:generate
```

## Rollback Procedures

### Development

```bash
# Reset to previous state (loses data)
npx prisma migrate reset
```

### Production

**Manual rollback** (no automatic rollback):

1. **Backup database**:
   ```bash
   cp ~/.bloom/data/bloom.db ~/.bloom/data/bloom.db.backup
   ```
2. **Revert app to previous version**
3. **If needed, manually undo migration**:
   ```bash
   sqlite3 ~/.bloom/data/bloom.db
   > ALTER TABLE "Scan" DROP COLUMN "brightness";
   > .quit
   ```

**Prevention**: Always backup before upgrading app with migrations

## Prisma Studio Usage

### Development Database

```bash
npm run prisma:studio

# Opens http://localhost:5555
# Browse tables, view/edit data
# Useful for verifying migrations
```

### Production Database

```bash
npm run studio:production

# Opens production database in Prisma Studio
# USE CAREFULLY - this is real user data
# Read-only recommended
```

## CI/CD Considerations

Migrations in CI:

- **E2E tests**: Database created fresh, all migrations applied
- **Integration tests**: Don't use Prisma (Python subprocess testing)
- **No production migrations**: Migrations applied when users launch app

## Schema File

**Location**: `prisma/schema.prisma`

Key sections:

```prisma
datasource db {
  provider = "sqlite"
  url      = env("BLOOM_DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
  // Prisma Client generated to node_modules
}

model Scan {
  id        String   @id @default(cuid())
  barcode   String
  timestamp DateTime @default(now())
  // ... fields
}
```

## Related Commands

- `/packaging` - Database handling in packaged apps
- `/integration-testing` - Testing with database integration
- `/pr-description` - Database migration checklist

## Documentation

- **Database Guide**: `docs/DATABASE.md`
- **Pilot Compatibility**: `docs/PILOT_COMPATIBILITY.md`
- **Prisma Docs**: https://www.prisma.io/docs
