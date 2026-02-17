# Tasks: Fix Zero Value Persistence and Copilot Review Comments

## TDD: Write Tests First - Zero Value Persistence

- [x] 1.1 Write IPC test for session state with zero values (renderer-database-ipc.e2e.ts)
- [x] 1.2 Write E2E test for CaptureScan session persistence with wave number = 0

## Implementation - Zero Value Persistence

- [x] 2.1 Fix save logic to preserve zero values in CaptureScan.tsx
- [x] 2.2 Fix load check to handle zero values correctly (use !== null)
- [x] 2.3 Fix load restore to use nullish coalescing (??)
- [x] 2.4 Fix display logic in MetadataForm.tsx (use ?? instead of ||)
- [x] 2.5 Fix waveNumber min attribute from "1" to "0"

## Limit Validation (Copilot Comment)

- [x] 3.1 Validate limit parameter in database-handlers.ts getRecent

## TDD: Write Tests First - Migration Checksums

- [x] 4.1 Write test to verify checksums compute correctly (SHA-256, 64 chars)
- [x] 4.2 Write test to verify upgraded database checksums match migration files
- [x] 4.3 Tests placed in correct scope (inside upgradeDatabase describe block)

## Implementation - Migration Checksums

- [x] 4.4 Updated MIGRATIONS object with real SHA-256 checksums:
  - `20251028040530_init`: `30988f39ce45f569219c734eae8c18587c0f79326b3f7dbd6f4c9b84f72f1240`
  - `20251125180403_add_genotype_id_to_plant_mappings`: `428b3a040b4abac2721c37eb047f5259552b1141737e3ef19c1cca3455abf54a`
  - `20260211195433_cleanup_accession_fields`: `ed0532a62d4c4c49ad2d06101e11e4ada508e235121a82e73a20d6fb09f89036`

## Fix E2E Test Strict Mode Violations

- [x] 6.1 Add data-testid to RecentScansPreview plant barcode span
- [x] 6.2 Update tests to use specific data-testid selectors

## Validation

- [x] 5.1 Run unit tests (228 passed)
- [x] 5.2 Run database upgrade tests (22 passed)
- [x] 5.3 Run zero value E2E tests (5 passed)
- [x] 5.4 Run full E2E test suite (181 passed, 2 skipped - all platforms passing in CI)
- [x] 5.5 Commit and push (b101f14)

## Additional Fixes

- [x] 7.1 Fix E2E startup delay - increased from 100ms to 500ms for consistent test runs
- [x] 7.2 Updated E2E_TESTING.md documentation
- [x] 7.3 Updated Serena memory with new empirical results
