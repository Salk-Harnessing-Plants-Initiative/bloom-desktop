# Pilot Compatibility

This document verifies backwards compatibility between bloom-desktop and bloom-desktop-pilot.

**Last Verified:** 2025-01-29
**Pilot Reference:** https://github.com/eberrigan/bloom-desktop-pilot/blob/dev/app/prisma/schema.prisma

## Database Schema Compatibility

### ✅ Scan Model - 100% Compatible

All fields match pilot schema exactly:

| Field | Type | Pilot | Ours | Notes |
|-------|------|-------|------|-------|
| `id` | String | ✅ | ✅ | UUID primary key |
| `experiment_id` | String | ✅ | ✅ | Foreign key |
| `phenotyper_id` | String | ✅ | ✅ | Foreign key |
| `scanner_name` | String | ✅ | ✅ | Hardware identifier |
| `plant_id` | String | ✅ | ✅ | Plant identifier |
| `accession_id` | String? | ✅ | ✅ | Optional |
| `path` | String | ✅ | ✅ | Directory path |
| `capture_date` | DateTime | ✅ | ✅ | Auto-generated |
| `num_frames` | Int | ✅ | ✅ | Frame count |
| `exposure_time` | Int | ✅ | ✅ | Microseconds |
| `gain` | Float | ✅ | ✅ | Camera gain |
| `brightness` | Float | ✅ | ✅ | Camera brightness |
| `contrast` | Float | ✅ | ✅ | Camera contrast |
| `gamma` | Float | ✅ | ✅ | Camera gamma |
| `seconds_per_rot` | Float | ✅ | ✅ | Rotation speed |
| `wave_number` | Int | ✅ | ✅ | Time point |
| `plant_age_days` | Int | ✅ | ✅ | Plant age |
| `deleted` | Boolean | ✅ | ✅ | Soft delete flag |

**Relationships:**
- ✅ `phenotyper` → Phenotyper
- ✅ `experiment` → Experiment
- ✅ `images` → Image[]

### ✅ Image Model - 100% Compatible

All fields match pilot schema exactly:

| Field | Type | Pilot | Ours | Notes |
|-------|------|-------|------|-------|
| `id` | String | ✅ | ✅ | UUID primary key |
| `scan_id` | String | ✅ | ✅ | Foreign key |
| `frame_number` | Int | ✅ | ✅ | 1-indexed |
| `path` | String | ✅ | ✅ | Image file path |
| `status` | String | ✅ | ✅ | Processing status |

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
    images: { create: imagesArray }
  }
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

✅ **Can read pilot databases** - No migration needed
✅ **Can write pilot-compatible data** - Pilot can read our data
✅ **Pilot can read our databases** - Full interoperability
✅ **No schema changes required** - Drop-in compatibility

## Migration Path

If you have an existing pilot database:

1. **No migration needed!** - Schemas are identical
2. Copy `bloom.db` to bloom-desktop data directory
3. Run bloom-desktop normally
4. Optionally run `npx prisma migrate deploy` to add performance indexes

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
