# Fix Zero Value Persistence and PR #91 Copilot Comments

## Problem 1: Zero Value Persistence

Session state persistence in CaptureScan uses JavaScript's `||` operator for numeric fields,
which incorrectly treats `0` as falsy and converts it to `null` when saving or restoring.

### Affected Fields

- `waveNumber` - Valid value of 0 is converted to null when saving
- `plantAgeDays` - Valid value of 0 is converted to null when saving

### Root Cause

1. **Save logic** uses `metadata.waveNumber || null` which converts 0 to null
2. **Load check** uses `session.waveNumber || session.plantAgeDays` which skips restore when values are 0
3. **Load restore** uses `session.waveNumber || 0` which works but is ineffective since save converts 0 to null
4. **Display logic** in MetadataForm uses `value={values.waveNumber || ''}` which displays 0 as empty string

### Solution

Use explicit null checks instead of truthy/falsy checks:

- Save: Use `metadata.waveNumber` directly (let TypeScript handle the type)
- Load check: Use `!== null` comparisons
- Load restore: Use `??` (nullish coalescing) instead of `||`
- Display: Use `??` (nullish coalescing) instead of `||` in input value bindings
- Also fix `min="1"` to `min="0"` for waveNumber input to allow 0 as valid

### Files Changed

- `src/renderer/CaptureScan.tsx`
- `src/components/MetadataForm.tsx`

---

## Problem 2: Limit Parameter Validation

The `db:scans:getRecent` handler accepts a `limit` parameter without validation, risking DoS.

### Solution

Validate and clamp the limit parameter:

- Default: 10
- Max: 100
- Handle invalid types and negative values

### Files Changed

- `src/main/database-handlers.ts`

---

## Problem 3: Migration Checksum Placeholders

The upgrade-database.ts script has placeholder checksums that will cause `prisma migrate status`
and `prisma migrate deploy` to fail in production.

### How Prisma Computes Checksums

Prisma computes SHA-256 hashes of the migration.sql file contents and stores them in the
`_prisma_migrations` table. When running `migrate status` or `migrate deploy`, it recomputes
the checksum and compares. Mismatches indicate drift.

### Real Checksums

Computed from the actual migration.sql files:

| Migration                                          | Checksum                                                           |
| -------------------------------------------------- | ------------------------------------------------------------------ |
| `20251028040530_init`                              | `30988f39ce45f569219c734eae8c18587c0f79326b3f7dbd6f4c9b84f72f1240` |
| `20251125180403_add_genotype_id_to_plant_mappings` | `428b3a040b4abac2721c37eb047f5259552b1141737e3ef19c1cca3455abf54a` |
| `20260211195433_cleanup_accession_fields`          | `ed0532a62d4c4c49ad2d06101e11e4ada508e235121a82e73a20d6fb09f89036` |

### Use Cases

1. **Fresh install**: User runs app for first time, upgrade runs all migrations with correct checksums
2. **Existing pilot database**: User has v1 database from bloom-desktop-pilot, upgrade adds missing migrations
3. **Already upgraded**: User has already run our app, checksums must match for `migrate status` to pass
4. **CI verification**: Tests must verify checksums match actual migration files

### Test Strategy

TDD tests in `database-upgrade.test.ts` (inside `upgradeDatabase` describe block):

1. **Checksum verification test**: Compute SHA-256 of each migration.sql and compare to MIGRATIONS object
2. **Prisma migrate status test**: After upgrade, run `prisma migrate status` and verify no drift
3. **Migration count test**: Verify all migrations in MIGRATIONS object exist in prisma/migrations/

### Implementation Approach

1. Hardcode the real checksums in the MIGRATIONS object
2. Add CI test that computes checksums and fails if they don't match
3. Document process for future migrations: compute checksum and add to MIGRATIONS

### Files Changed

- `scripts/upgrade-database.ts`
- `tests/integration/database-upgrade.test.ts`

---

## Problem 4: E2E Test Strict Mode Violations

The recent scans persistence tests use text selectors that match multiple elements, causing
Playwright strict mode violations in CI.

### Root Cause

Tests use `locator('text=RECENT_PLANT_001')` which matches both:

1. The plant barcode in test data setup
2. The plant barcode displayed in the recent scans list

### Solution

Add data-testid to RecentScansPreview component and use specific selectors in tests.

### Files Changed

- `src/components/RecentScansPreview.tsx`
- `tests/e2e/plant-barcode-validation.e2e.ts`

---

## Related Issues

- GitHub Copilot review comments on PR #91 (3 comments)
