# Pilot Compatibility

This document describes compatibility between bloom-desktop and bloom-desktop-pilot.

**Last Verified:** 2026-02-13
**Pilot Reference:** https://github.com/eberrigan/bloom-desktop-pilot/blob/dev/app/prisma/schema.prisma

## Important: Schema Differences

As of v3 (cleanup_accession_fields migration), bloom-desktop has renamed some columns:
- `Scan.accession_id` → `Scan.accession_name`
- `PlantAccessionMappings.accession_id` and `genotype_id` → `PlantAccessionMappings.accession_name`

**Pilot databases require upgrade to work with the current schema.** See [Migration Path](#migration-path) below.

## Database Schema Compatibility

### ✅ Scan Model - Compatible After Upgrade

Pilot databases require running the upgrade script. The `accession_id` column is renamed to `accession_name`:

| Field             | Type     | Pilot         | Ours (v3)       | Notes                    |
| ----------------- | -------- | ------------- | --------------- | ------------------------ |
| `id`              | String   | ✅            | ✅              | UUID primary key         |
| `experiment_id`   | String   | ✅            | ✅              | Foreign key              |
| `phenotyper_id`   | String   | ✅            | ✅              | Foreign key              |
| `scanner_name`    | String   | ✅            | ✅              | Hardware identifier      |
| `plant_id`        | String   | ✅            | ✅              | Plant identifier         |
| `accession_id`    | String?  | ✅            | → `accession_name` | Renamed in v3 migration |
| `path`            | String   | ✅            | ✅              | Directory path           |
| `capture_date`    | DateTime | ✅            | ✅              | Auto-generated           |
| `num_frames`      | Int      | ✅            | ✅              | Frame count              |
| `exposure_time`   | Int      | ✅            | ✅              | Microseconds             |
| `gain`            | Float    | ✅            | ✅              | Camera gain              |
| `brightness`      | Float    | ✅            | ✅              | Camera brightness        |
| `contrast`        | Float    | ✅            | ✅              | Camera contrast          |
| `gamma`           | Float    | ✅            | ✅              | Camera gamma             |
| `seconds_per_rot` | Float    | ✅            | ✅              | Rotation speed           |
| `wave_number`     | Int      | ✅            | ✅              | Time point               |
| `plant_age_days`  | Int      | ✅            | ✅              | Plant age                |
| `deleted`         | Boolean  | ✅            | ✅              | Soft delete flag         |

**Relationships:**

- ✅ `phenotyper` → Phenotyper
- ✅ `experiment` → Experiment
- ✅ `images` → Image[]

### ✅ Image Model - 100% Compatible

All fields match pilot schema exactly:

| Field          | Type   | Pilot | Ours | Notes             |
| -------------- | ------ | ----- | ---- | ----------------- |
| `id`           | String | ✅    | ✅   | UUID primary key  |
| `scan_id`      | String | ✅    | ✅   | Foreign key       |
| `frame_number` | Int    | ✅    | ✅   | 1-indexed         |
| `path`         | String | ✅    | ✅   | Image file path   |
| `status`       | String | ✅    | ✅   | Processing status |

**Relationships:**

- ✅ `scan` → Scan

## Implementation Compatibility

### Scanner-Database Integration

Our scanner automatically saves to database following pilot patterns:

**Nested Create Pattern (Pilot-Compatible):**

```typescript
// Both use atomic nested create
await prisma.scan.create({
  data: {
    ...scanMetadata,
    images: { create: imagesArray },
  },
});
```

**Frame Number Indexing (Pilot-Compatible):**

- Scanner internally: 0-indexed (frame 0-71)
- Database: 1-indexed (frame 1-72) ← **Matches pilot**
- Automatic conversion: `frame_number + 1`

**Field Mappings:**
| Scanner Field | Database Field | Pilot Compatible |
|---------------|----------------|------------------|
| `exposure_time` | `exposure_time` | ✅ |
| `gain` | `gain` | ✅ |
| `brightness` | `brightness` | ✅ |
| `contrast` | `contrast` | ✅ |
| `gamma` | `gamma` | ✅ |
| `seconds_per_rotation` | `seconds_per_rot` | ✅ |

## Non-Breaking Additions

Our schema includes **performance indexes** that don't break compatibility:

```prisma
@@index([experiment_id])  // Faster experiment queries
@@index([phenotyper_id])  // Faster phenotyper queries
@@index([plant_id])       // Faster plant lookups
@@index([capture_date])   // Faster date range queries
```

These are **additive only** - they improve performance without changing data structure.

## Compatibility Guarantees

✅ **Can read pilot databases after upgrade** - Use `npm run db:upgrade`
✅ **Data fully preserved during upgrade** - All pilot data is migrated
✅ **Upgrade creates backup** - Original database saved as `.backup`

⚠️ **Note**: After upgrading to v3, the database is NOT backwards compatible with pilot. The upgrade is one-way.

## Migration Path

If you have an existing pilot database:

1. Copy `bloom.db` to bloom-desktop data directory (`~/.bloom/`)
2. Run the upgrade script to migrate the schema:
   ```bash
   npm run db:upgrade
   # Or for a specific file:
   npx ts-node scripts/upgrade-database.ts ~/.bloom/bloom.db
   ```
3. The script will:
   - Create a backup at `bloom.db.backup`
   - Detect the pilot schema (v1)
   - Rename `accession_id` → `accession_name` in Scan table
   - Create proper migration history
4. Run bloom-desktop normally

### What the Upgrade Does

The upgrade script applies these transformations to pilot databases:

| Table | Pilot Column | After Upgrade |
|-------|--------------|---------------|
| Scan | `accession_id` | `accession_name` (values preserved) |
| PlantAccessionMappings | `accession_id` | Removed (was redundant) |
| PlantAccessionMappings | N/A | `accession_name` added from `accession_id` |

All data is preserved during the upgrade. The values in `accession_id` are copied to the new `accession_name` column.

## Testing Compatibility

Run the scanner-database integration test to verify:

```bash
npm run test:scanner-database
```

**Test Coverage:**

- ✅ Creates scans with all pilot-compatible fields
- ✅ Uses 1-indexed frame numbers
- ✅ Uses nested create pattern
- ✅ Verifies all relationships work

## Maintenance

When updating the schema:

1. **Always check pilot compatibility first**
2. **Use additive changes only** (new optional fields, indexes)
3. **Never remove or rename fields** without pilot coordination
4. **Test with pilot databases** before releasing
5. **Update this document** with any changes

## References

- Pilot Schema: https://github.com/eberrigan/bloom-desktop-pilot/blob/dev/app/prisma/schema.prisma
- Pilot Database Code: https://github.com/eberrigan/bloom-desktop-pilot/blob/dev/app/src/main/prismastore.ts
- Our Database Code: [src/main/database.ts](../src/main/database.ts)
- Our Scanner Integration: [src/main/scanner-process.ts](../src/main/scanner-process.ts)
