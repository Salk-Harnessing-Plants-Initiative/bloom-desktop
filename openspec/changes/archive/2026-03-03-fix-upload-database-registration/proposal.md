## Why

The current upload implementation in `src/main/image-uploader.ts` only uploads images to Supabase Storage but does NOT create records in the Supabase PostgreSQL database. This breaks the Bloom ecosystem because:

- Images uploaded from bloom-desktop are invisible to the Bloom web interface
- Analysis pipelines cannot find or process the uploaded images
- Upload appears successful but data is effectively lost

The pilot implementation (`bloom-desktop-pilot/app/src/main/imageuploader.ts`) correctly uses `@salk-hpi/bloom-fs` which coordinates both storage upload AND database registration.

## What Changes

**Refactor `ImageUploader` to use `@salk-hpi/bloom-fs`:**

- Replace direct `SupabaseUploader.uploadImage()` calls with `uploadImages` from `@salk-hpi/bloom-fs`
- Create `SupabaseStore` instance for database operations (alongside existing `SupabaseUploader`)
- Build `CylImageMetadata[]` array with all required scan metadata from Prisma
- Fetch related data (experiment, phenotyper, scientist) to populate metadata fields

**Required metadata fields (from pilot):**

- `species`, `experiment` - from Experiment relation
- `wave_number`, `plant_age_days`, `date_scanned`, `num_frames` - from Scan
- `device_name` (scanner_name), `plant_qr_code` (plant_id), `accession_name` - from Scan
- `phenotyper_name`, `phenotyper_email` - from Phenotyper relation
- `scientist_name`, `scientist_email` - from Experiment.Scientist relation
- `frame_number` - from Image
- Camera settings: `exposure_time`, `gain`, `brightness`, `contrast`, `gamma`, `seconds_per_rot`

**New dependency:**

- `@salk-hpi/bloom-fs@0.2.1` (already installed via GitLab NPM registry)

## Impact

- **Affected specs**: None (new spec will be created)
- **Affected code**:
  - `src/main/image-uploader.ts` - Major refactor to use bloom-fs
  - `package.json` - Already updated with @salk-hpi/bloom-fs dependency
  - `tests/unit/image-uploader.test.ts` - Update/add unit tests
  - `tests/integration/` - Add integration tests for upload
- **Related Issues**:
  - #94 - Upload feature doesn't register images in Supabase database (primary)
  - #78 - Cloud Upload for Scan Images
  - #45 - BrowseScans page
- **Dependencies**:
  - `@salk-hpi/bloom-fs` for `uploadImages`, `CylImageMetadata`
  - `@salk-hpi/bloom-js` for `SupabaseStore`, `SupabaseUploader`
- **Pilot Reference**: `bloom-desktop-pilot/app/src/main/imageuploader.ts`
