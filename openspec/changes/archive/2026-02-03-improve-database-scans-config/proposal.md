# Change Proposal: Improve Database and Scans Directory Configuration

## Why

The current database and scans directory configuration has inconsistencies that reduce clarity for admin users during initial scanner station setup:

1. **Development environment inconsistency**:
   - Database: `<project-root>/prisma/dev.db`
   - Scans: `~/.bloom/scans`
   - Creates asymmetry where dev database is in project but scans are in user home

2. **Missing UI guidance**: Machine Configuration form doesn't explain the relationship between database location (`~/.bloom/data/bloom.db`) and scans directory default (`~/.bloom/scans`), making it unclear when admins should override the scans location

3. **No writable validation**: Users can configure non-existent or non-writable scans directories, only discovering the issue when a scan fails

Both locations are configured once by an admin during initial deployment (not changed by regular users), so clear guidance and validation are critical during that one-time setup.

## What Changes

**Development Environment Consistency:**

- Update development database default from `<project-root>/prisma/dev.db` to `~/.bloom/dev.db`
- Update development scans default from `~/.bloom/scans` to `~/.bloom/dev-scans`
- Keep production unchanged: database at `~/.bloom/data/bloom.db`, scans at `~/.bloom/scans`

**UI Improvements:**

- Add help text to Machine Configuration scans directory field explaining:
  - Default location (`~/.bloom/scans`) keeps data together with database
  - When to use external storage (large datasets, network shares)
  - Example: `/mnt/scanner-data` for external volumes

**Validation:**

- Add writable directory validation to ensure scans_dir exists and is writable before allowing save
- Provide clear error messages if directory doesn't exist or isn't writable

**No breaking changes** - existing configurations continue to work, this only improves defaults and guidance.

## Impact

**Affected specs:**

- `configuration` - Development paths, UI guidance, validation

**Affected code:**

- `src/main/database.ts` - Development database path logic
- `src/main/config-store.ts` - Add writable directory validation, update dev defaults
- `src/renderer/MachineConfiguration.tsx` - Add help text for scans directory field

**User impact:**

- Admins get clearer guidance during scanner station setup
- Development environment fully consistent (all dev data in `~/.bloom/`)
- Prevents configuration errors (non-writable directories)
- Production users see no changes (existing configs work as-is)
