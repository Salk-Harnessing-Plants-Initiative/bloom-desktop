## Why

The GraviScan integration requires 8 new database models for multi-scanner flatbed phenotyping. No GraviScan data can be stored until the schema exists. This is Increment 1 of the GraviScan integration plan (epic #126).

## What Changes

- **Add `experiment_type` field** to Experiment model with default `'cylinderscan'` — backfills all existing experiments automatically via SQLite column default
- **Create 8 new GraviScan models** in 1 clean migration (not cherry-picked from Ben's 14 incremental migrations):
  - `GraviScan` — individual scan record with plate/timing/resolution metadata
  - `GraviScanSession` — groups scans from a single time-lapse operation
  - `GraviScanner` — USB scanner device registry
  - `GraviConfig` — singleton scan settings (grid mode, resolution, format)
  - `GraviImage` — image file with upload/backup status tracking
  - `GraviScanPlateAssignment` — per-experiment plate-to-scanner configuration
  - `GraviPlateAccession` — specimen-to-plate mapping from metadata CSV
  - `GraviPlateSectionMapping` — plant QR to plate section mapping
- **Add relations** to existing models (Experiment, Phenotyper, Accessions) — no breaking changes
- **Update upgrade infrastructure**: `upgrade-database.ts` checksums, `detect-schema-version.ts`, verification scripts, test fixtures
- **Migration verification tests**: schema comparison, upgrade path testing, checksum validation

Part of GraviScan epic #126.

## Impact

- Affected specs: `scanning` (adds GraviScan schema requirements)
- Affected code:
  - `prisma/schema.prisma` — 8 new models + experiment_type field + new relations
  - `prisma/migrations/` — 2 new migrations
  - `scripts/upgrade-database.ts` — new migration entry + checksum + v3→v4 step function
  - `scripts/detect-schema-version.ts` — v4 detection
  - `scripts/lib/verify-database.sh` — add GraviScan tables to expected list
  - `tests/integration/database-upgrade.test.ts` — v3→v4 upgrade tests + checksum validation
  - `tests/fixtures/databases/` — new v4 fixture
- Does NOT affect: renderer code, IPC handlers, Python code, existing CylinderScan functionality
