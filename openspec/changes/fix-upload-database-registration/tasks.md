# TDD Implementation Plan

## Background Analysis

### Current vs Expected Behavior

| Aspect                | Current (Broken) | Expected (Pilot-compatible)           |
| --------------------- | ---------------- | ------------------------------------- |
| Storage Upload        | ✅ Works         | ✅ Works                              |
| Database Registration | ❌ Missing       | ✅ Creates image_metadata records     |
| Metadata Fields       | N/A              | All CylImageMetadata fields populated |
| Visibility in Bloom   | ❌ Invisible     | ✅ Visible in web interface           |

### Required Prisma Relations

To build complete `CylImageMetadata`, we need to fetch:

```prisma
scan {
  images
  experiment {
    species
    scientist { name, email }
  }
  phenotyper { name, email }
}
```

### Pilot Reference

From `bloom-desktop-pilot/app/src/main/imageuploader.ts`:

- Uses `uploadImages` from `@salk-hpi/bloom-fs`
- Builds `CylImageMetadata[]` with all required fields
- Creates both `SupabaseStore` and `SupabaseUploader` instances

---

## Phase 1: RED - Write Failing Tests

### 1.1 Unit Tests (`tests/unit/image-uploader.test.ts`)

- [x] Test `buildCylImageMetadata()` returns correct metadata structure
- [x] Test metadata includes experiment.species from relation
- [x] Test metadata includes phenotyper name/email from relation
- [x] Test metadata includes scientist name/email from experiment.scientist
- [x] Test metadata has correct frame_number from image
- [x] Test `uploadScan()` calls `uploadImages` with correct arguments
- [x] Run tests to confirm they fail (RED)

### 1.2 Integration/Manual Tests

> These require real Supabase credentials and cannot run in CI.
> Blocked by #95 (Supabase `insert_image_v3_0` integer type mismatch).

- [ ] Test upload creates records in test Supabase instance
- [ ] Test uploaded metadata matches local scan data
- [ ] Test upload handles missing optional fields gracefully

---

## Phase 2: GREEN - Implement Fix

### 2.1 Update ImageUploader Class

- [x] Import `uploadImages`, `CylImageMetadata` from `@salk-hpi/bloom-fs`
- [x] Import `SupabaseStore` from `@salk-hpi/bloom-js`
- [x] Add `store: SupabaseStore` property
- [x] Update `authenticate()` to create both `SupabaseStore` and `SupabaseUploader`
- [x] Add `buildCylImageMetadata()` helper method

### 2.2 Implement buildCylImageMetadata

```typescript
private buildCylImageMetadata(
  scan: ScanWithRelations,
  image: Image
): CylImageMetadata {
  return {
    species: scan.experiment?.species,
    experiment: scan.experiment?.name,
    wave_number: scan.wave_number,
    germ_day: 0,
    germ_day_color: 'none',
    plant_age_days: scan.plant_age_days,
    date_scanned: scan.capture_date?.toISOString(),
    device_name: scan.scanner_name,
    plant_qr_code: scan.plant_id,
    frame_number: image.frame_number,
    accession_name: scan.accession_id,
    phenotyper_name: scan.phenotyper?.name || 'unknown',
    phenotyper_email: scan.phenotyper?.email || 'unknown',
    scientist_name: scan.experiment?.scientist?.name || 'unknown',
    scientist_email: scan.experiment?.scientist?.email || 'unknown',
    num_frames: scan.num_frames || 0,
    exposure_time: scan.exposure_time || 0,
    gain: scan.gain || 0,
    brightness: scan.brightness || 0,
    contrast: scan.contrast || 0,
    gamma: scan.gamma || 0,
    seconds_per_rot: scan.seconds_per_rot || 0,
  };
}
```

### 2.3 Refactor uploadScan()

- [x] Update Prisma query to include experiment, phenotyper, scientist relations
- [x] Build `CylImageMetadata[]` array for all images
- [x] Collect image paths array
- [x] Replace direct `uploader.uploadImage()` loop with single `uploadImages()` call
- [x] Use `before` callback for progress updates
- [x] Use `result` callback for status tracking and error handling

### 2.4 Verify Tests Pass

- [x] Run `npm run test:unit` - unit tests pass (34/34)
- [x] CI pipeline passes

---

## Phase 3: REFACTOR - Clean Up

### 3.1 Code Quality

- [ ] Remove `any` type annotations (use proper types from bloom-fs/bloom-js)
- [x] Add JSDoc comments to new methods
- [x] Ensure error messages are descriptive

### 3.2 Linting

- [x] Run `npm run lint` - fix any issues
- [x] Run `npm run format` - format code

### 3.3 Type Safety

- [x] Define `ScanWithRelations` type for Prisma include query
- [x] Ensure all CylImageMetadata fields are correctly typed

---

## Phase 4: Manual Verification — BLOCKED by #95

> **Blocker**: Supabase `insert_image_v3_0` RPC function defines camera setting parameters
> (`brightness`, `contrast`, `gamma`, `gain`, `seconds_per_rot`) as `INTEGER` but they are
> floats in practice (e.g., `brightness: 0.5`). All uploads fail with PostgreSQL error
> `22P02: invalid input syntax for type integer: "0.5"`.
>
> See: https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/95

**IMPORTANT**: Complete ALL manual tests before requesting merge approval.

### 4.1 Prerequisites Setup

- [ ] Configure machine with valid Bloom credentials:
  1. Open app: `npm run start`
  2. Navigate to Settings > Machine Configuration (Cmd+Shift+I or menu)
  3. Enter valid Bloom API URL, username, password
  4. Click "Test Connection" - verify success
  5. Save configuration

- [ ] Create test scan with images:
  1. Navigate to Capture Scan
  2. Select experiment, phenotyper, enter plant ID
  3. Complete a mock capture (or use real scanner)
  4. Verify scan appears in Browse Scans with Images > 0

### 4.2 Upload Flow Test

**Test A: Single Scan Upload**

- [ ] Navigate to Browse Scans page
- [ ] Find a scan with images (Images column > 0)
- [ ] Click the Upload button for that scan
- [ ] **VERIFY**: Progress indicator appears
- [ ] **VERIFY**: Progress updates as images upload
- [ ] **VERIFY**: Success message appears when complete
- [ ] **VERIFY**: No errors in terminal (check `npm run start` output)

**Test B: Upload Error Handling**

- [ ] Disconnect from internet (turn off WiFi)
- [ ] Attempt to upload a scan
- [ ] **VERIFY**: Appropriate error message displayed
- [ ] **VERIFY**: App does not crash
- [ ] Reconnect to internet

**Test C: Re-upload Already Uploaded Scan**

- [ ] Find a scan that was previously uploaded
- [ ] Attempt to upload again
- [ ] **VERIFY**: Either succeeds (idempotent) or shows clear message

### 4.3 Supabase Database Verification

**Open Supabase Dashboard** (https://app.supabase.com or your instance)

- [ ] Navigate to Table Editor
- [ ] Open `image_metadata` table
- [ ] Filter/search by the `plant_qr_code` you just uploaded

**Verify Record Count**

- [ ] **VERIFY**: Number of records = number of images in scan
- [ ] Example: 72-frame scan should have 72 records

**Verify Metadata Fields** (check at least 3 random records)

- [ ] `species` - matches experiment species (e.g., "arabidopsis")
- [ ] `experiment` - matches experiment name
- [ ] `plant_qr_code` - matches plant ID from scan
- [ ] `frame_number` - values 1 through N (1-indexed)
- [ ] `date_scanned` - ISO timestamp of scan
- [ ] `device_name` - matches scanner name from config
- [ ] `wave_number` - matches scan wave number
- [ ] `plant_age_days` - matches scan plant age
- [ ] `phenotyper_name` - populated (not "unknown" if phenotyper was set)
- [ ] `scientist_name` - populated (if experiment has scientist)

**Verify Storage Paths**

- [ ] Records should have valid `storage_path` pointing to images bucket
- [ ] Path format: `scans/{scanId}/{NNN}.png`

### 4.4 Bloom Web Interface Verification

- [ ] Login to Bloom web interface (https://your-bloom-instance.com)
- [ ] Navigate to the plant you just uploaded
- [ ] **VERIFY**: Plant appears in plant list
- [ ] **VERIFY**: Images load and display correctly
- [ ] **VERIFY**: Can navigate through frames
- [ ] **VERIFY**: Metadata (experiment, wave, etc.) displays correctly

### 4.5 Edge Cases

**Test: Scan with Missing Optional Fields**

- [ ] Create scan without accession ID
- [ ] Upload and verify `accession_name` is empty/null (not crash)

**Test: Scan with Many Images**

- [ ] Upload a full 72-frame scan
- [ ] Verify all 72 records created
- [ ] Verify progress showed reasonable updates

**Test: Concurrent Upload Stability**

- [ ] Do NOT test concurrent uploads (one at a time for now)
- [ ] Document this as known limitation if needed

---

## Phase 5: Pre-Merge Verification

### 5.1 Automated Tests

- [ ] `npm run lint` - passes with no errors
- [ ] `npx tsc --noEmit` - TypeScript compiles
- [ ] `npm run format` - code is formatted
- [ ] `npm run test:unit` - unit tests pass
- [ ] `npm run test:e2e` - E2E tests pass
- [ ] `npm run build` - app builds successfully

### 5.2 CI Pipeline

- [ ] All GitHub Actions checks pass
- [ ] No new security vulnerabilities introduced
- [ ] Bundle size acceptable

### 5.3 Code Review Checklist

- [ ] No hardcoded credentials or tokens
- [ ] Error handling is comprehensive
- [ ] Types are properly defined (no unnecessary `any`)
- [ ] JSDoc comments on public methods
- [ ] No console.log statements left in production code

### 5.4 Documentation

- [ ] README updated if needed
- [ ] CHANGELOG entry added
- [ ] OpenSpec proposal completed

---

## Verification Summary Checklist

### Must Pass Before Merge

| Category   | Item                        | Status         |
| ---------- | --------------------------- | -------------- |
| **Tests**  | Unit tests pass (34/34)     | ✅             |
| **Tests**  | TypeScript compiles         | ✅             |
| **Tests**  | Linting passes              | ✅             |
| **CI**     | All GitHub Actions pass     | ✅             |
| **Manual** | Single upload works         | ⏳ Blocked #95 |
| **Manual** | Records created in Supabase | ⏳ Blocked #95 |
| **Manual** | Metadata fields correct     | ⏳ Blocked #95 |
| **Manual** | Images visible in Bloom web | ⏳ Blocked #95 |

### Feature Parity with Pilot

| Feature                   | Pilot | This Implementation | Verified       |
| ------------------------- | ----- | ------------------- | -------------- |
| Uses `@salk-hpi/bloom-fs` | ✅    | ✅                  | ✅ unit tests  |
| Calls `uploadImages()`    | ✅    | ✅                  | ✅ unit tests  |
| Builds `CylImageMetadata` | ✅    | ✅                  | ✅ unit tests  |
| Creates database records  | ✅    | ✅                  | ⏳ Blocked #95 |
| Images visible in web     | ✅    | ✅                  | ⏳ Blocked #95 |
| Progress tracking         | ✅    | ✅                  | ✅ unit tests  |
