## Why

When users navigate away from CaptureScan and return, they lose all context: recent scans disappear and metadata form resets. This forces repetitive re-entry of phenotyper, experiment, wave number, and plant age during scanning sessions—a significant workflow friction that the pilot implementation solved with in-memory session state.

Additionally, the current data model has a bug: `genotype_id` in PlantAccessionMappings stores what should be the accession name, while `accession_id` redundantly stores the same UUID as `accession_file_id`. This doesn't match the pilot or Bloom schema and causes confusion.

## What Changes

### 1. Schema Fix: PlantAccessionMappings

**Current (broken):**
```prisma
model PlantAccessionMappings {
  accession_id      String     // UUID - redundant copy of accession_file_id (NEVER USED)
  genotype_id       String?    // Actually stores accession name like "Col-0" (MISNAMED)
  accession_file_id String     // FK to Accessions
}
```

**Target (cleaned up):**
```prisma
model PlantAccessionMappings {
  accession_name    String?    // Stores "Col-0" (renamed from genotype_id)
  accession_file_id String     // FK to Accessions
}
```

**Changes:**
- **REMOVE** `accession_id` - redundant, always equals `accession_file_id`, never read anywhere
- **RENAME** `genotype_id` → `accession_name` - clarifies what it actually stores

### 2. Schema Fix: Scan Table

**Current:**
```prisma
model Scan {
  accession_id    String?    // Actually stores accession NAME like "Col-0"
}
```

**Target:**
```prisma
model Scan {
  accession_name    String?    // Renamed for clarity
}
```

### 3. Session Metadata Persistence

Store session fields in main process memory via a new `SessionStore` module:

**Fields that persist** (survive navigation, reset on app restart):
- `phenotyperId` (string | null) - selected phenotyper UUID
- `experimentId` (string | null) - selected experiment UUID
- `waveNumber` (number | null) - current wave number
- `plantAgeDays` (number | null) - plant age in days
- `accessionName` (string | null) - accession name, auto-populated from barcode lookup

**Fields that do NOT persist** (change per scan):
- `plantQrCode` - unique per plant

### 4. Recent Scans Loading

Load today's scans from database on CaptureScan mount.

### 5. UI Updates

- Rename "Genotype ID" → "Accession" throughout UI
- Update column selector in AccessionFileUpload
- Update table headers in AccessionList
- Update form labels in MetadataForm

## Impact

### Files to Modify

| File | Type | Changes |
|------|------|---------|
| `prisma/schema.prisma` | Schema | Remove `accession_id`, rename `genotype_id` → `accession_name` |
| `src/main/database-handlers.ts` | Backend | Update handlers, remove `accession_id` writes |
| `src/main/scanner-process.ts` | Backend | Rename `accession_id` → `accession_name` |
| `src/main/preload.ts` | IPC | Update method parameters |
| `src/main/session-store.ts` | **NEW** | In-memory session state |
| `src/main/main.ts` | Backend | Register session IPC handlers |
| `src/types/electron.d.ts` | Types | Update DatabaseAPI, add SessionAPI |
| `src/types/scanner.ts` | Types | Rename `accession_id` → `accession_name` |
| `src/renderer/components/AccessionFileUpload.tsx` | Component | Rename genotypeId → accessionName |
| `src/renderer/components/AccessionList.tsx` | Component | Rename genotypeId → accessionName |
| `src/components/MetadataForm.tsx` | Component | Rename genotypeId → accessionName |
| `src/components/PlantBarcodeInput.tsx` | Component | Rename callback |
| `src/renderer/CaptureScan.tsx` | Component | Session persistence, recent scans |

### Database Handlers to Update

1. `db:accessions:createWithMappings` - Remove `accession_id`, change `genotype_id` → `accession_name`
2. `db:accessions:updateMapping` - Change parameter from `genotype_id` → `accession_name`
3. `db:accessions:getGenotypeByBarcode` → `db:accessions:getAccessionNameByBarcode`

### Test Files to Update

- `tests/unit/components/AccessionFileUpload.test.tsx`
- `tests/unit/components/AccessionList.test.tsx` (if exists)
- `tests/integration/database.test.ts`
- `tests/e2e/accessions-management.e2e.ts`

## Migration Strategy

1. **Schema migration**:
   - Remove `PlantAccessionMappings.accession_id` (redundant column)
   - Rename `PlantAccessionMappings.genotype_id` → `accession_name`
   - Rename `Scan.accession_id` → `accession_name`
2. **Backend updates**: Update handlers and types
3. **Frontend updates**: Update components (leaf-first: PlantBarcodeInput → MetadataForm → CaptureScan)
4. **Test updates**: Update test data and assertions
5. **Session persistence**: Add SessionStore and IPC handlers
6. **E2E verification**: Run full test suite

## References

- Issue #85: CaptureScan page does not persist state across navigation
- Issue #83: Feature: Session persistence for scan metadata
- Issue #88: Rename accession_id field for clarity (addressed in this PR)
- Pilot implementation: `bloom-desktop-pilot/app/src/main/scanner.ts`
