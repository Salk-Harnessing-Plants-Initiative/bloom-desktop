# Change Proposal: Add Safe Database Auto-Initialization

## Why

When a user starts Bloom Desktop for the first time, the app fails silently or shows incorrect behavior because the database schema doesn't exist:

1. **No "out of the box" experience**: Users must manually run `npx prisma db push` before the app works
2. **False positive warnings**: The duplicate scan check shows "This plant was already scanned today" even when no scans exist, because database queries fail
3. **Silent failures**: Database operations fail without clear error messages to the user
4. **Existing database handling**: No safe way to upgrade schema when user has existing data

This breaks the scientific workflow expectation of reproducibility and reliability - a fresh install should "just work".

## What Changes

**Safe Auto-Initialization on Startup:**

- Detect if database file exists and has valid schema
- If database is missing or empty: create schema automatically using Prisma migrations
- If database exists with data: apply pending migrations safely (preserving data)
- If schema is current: proceed normally (no action needed)

**Clear User Feedback:**

- Show initialization status in console logs
- Surface database errors to users with actionable messages
- Log migration history for debugging

**Safety Guarantees:**

- **NEVER delete existing data** - only additive migrations
- Create automatic backup before applying migrations
- Rollback on migration failure
- Validate schema integrity after initialization

**No breaking changes** - existing databases continue to work, this only adds automatic initialization.

## Impact

**Affected specs:**

- `configuration` - Database initialization behavior

**Affected code:**

- `src/main/database.ts` - Add auto-initialization logic
- `src/main/main.ts` - Handle initialization errors gracefully

**User impact:**

- Fresh installs work immediately without manual CLI commands
- Existing users see no changes (their databases are already initialized)
- Schema upgrades happen automatically and safely
- Clear error messages if something goes wrong

**Developer impact:**

- Adding new migrations automatically applies to user databases
- No need to document manual migration steps for users
