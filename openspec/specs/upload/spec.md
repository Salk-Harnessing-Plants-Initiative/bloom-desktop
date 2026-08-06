# upload Specification

## Purpose

TBD - created by archiving change fix-upload-database-registration. Update Purpose after archive.
## Requirements
### Requirement: Upload Creates Database Records

The ImageUploader SHALL create records in the Supabase `image_metadata` table for each uploaded image, in addition to uploading files to Supabase Storage.

#### Scenario: Database records created during upload

- **GIVEN** a scan with N images ready for upload
- **WHEN** `uploadScan()` is called
- **THEN** N records SHALL be created in the `image_metadata` table
- **AND** each record SHALL contain the complete `CylImageMetadata` for that image
- **AND** this matches pilot behavior using `@salk-hpi/bloom-fs` `uploadImages` function

#### Scenario: Metadata includes experiment information

- **GIVEN** a scan associated with an experiment
- **WHEN** `CylImageMetadata` is built for upload
- **THEN** `species` SHALL be set to `experiment.species`
- **AND** `experiment` SHALL be set to `experiment.name`
- **AND** `scientist_name` SHALL be set to `experiment.scientist.name` (or "unknown" if not set)
- **AND** `scientist_email` SHALL be set to `experiment.scientist.email` (or "unknown" if not set)

#### Scenario: Metadata includes phenotyper information

- **GIVEN** a scan with an associated phenotyper
- **WHEN** `CylImageMetadata` is built for upload
- **THEN** `phenotyper_name` SHALL be set to `phenotyper.name` (or "unknown" if not set)
- **AND** `phenotyper_email` SHALL be set to `phenotyper.email` (or "unknown" if not set)

#### Scenario: Metadata includes scan details

- **GIVEN** a scan with capture metadata
- **WHEN** `CylImageMetadata` is built for upload
- **THEN** the following fields SHALL be populated from the scan:
  - `wave_number` from `scan.wave_number`
  - `plant_age_days` from `scan.plant_age_days`
  - `date_scanned` from `scan.capture_date.toISOString()`
  - `device_name` from `scan.scanner_name`
  - `plant_qr_code` from `scan.plant_id`
  - `accession_name` from `scan.accession_id`
  - `num_frames` from `scan.num_frames`

#### Scenario: Metadata includes camera settings

- **GIVEN** a scan with camera configuration
- **WHEN** `CylImageMetadata` is built for upload
- **THEN** the following camera settings SHALL be populated:
  - `exposure_time` from `scan.exposure_time` (default 0)
  - `gain` from `scan.gain` (default 0)
  - `brightness` from `scan.brightness` (default 0)
  - `contrast` from `scan.contrast` (default 0)
  - `gamma` from `scan.gamma` (default 0)
  - `seconds_per_rot` from `scan.seconds_per_rot` (default 0)

#### Scenario: Metadata includes image-specific frame number

- **GIVEN** an image with frame_number N
- **WHEN** `CylImageMetadata` is built for that image
- **THEN** `frame_number` SHALL be set to N
- **AND** this allows correlating database records with physical image files

### Requirement: Upload Uses bloom-fs Package

The ImageUploader SHALL use the `uploadImages` function from `@salk-hpi/bloom-fs` to ensure consistent behavior with other Bloom ecosystem tools.

#### Scenario: Single coordinated upload call

- **GIVEN** a scan with multiple images
- **WHEN** `uploadScan()` is called
- **THEN** a single `uploadImages()` call SHALL handle all images
- **AND** this provides concurrent upload with worker pool management
- **AND** this coordinates both Storage and database operations

#### Scenario: Progress tracking via callbacks

- **GIVEN** an upload in progress
- **WHEN** each image completes (success or failure)
- **THEN** the `result` callback SHALL be invoked with index, metadata, created ID, and error
- **AND** the calling code SHALL update local image status accordingly

### Requirement: Typed Image Status

The system SHALL define an `ImageStatus` TypeScript union type constraining image status values to `'pending'`, `'uploading'`, `'uploaded'`, and `'failed'`.

#### Scenario: Valid status values accepted

- **WHEN** a status value of `'pending'`, `'uploading'`, `'uploaded'`, or `'failed'` is assigned to a variable of type `ImageStatus`
- **THEN** the TypeScript compiler SHALL accept the assignment without error

#### Scenario: Invalid status values rejected at compile time

- **WHEN** a status value not in the set (`'pending'`, `'uploading'`, `'uploaded'`, `'failed'`) is assigned to a variable of type `ImageStatus`
- **THEN** the TypeScript compiler SHALL emit a type error

#### Scenario: Scanner image creation uses typed status

- **WHEN** `scanner-process.ts` creates image records with `status: 'pending'`
- **THEN** the status literal SHALL be checked against the `ImageStatus` type at compile time

#### Scenario: Upload status transitions use valid status values

- **WHEN** `image-uploader.ts` updates image status to `'uploading'`, `'uploaded'`, or `'failed'`
- **THEN** each status literal used for an upload status transition SHALL be assigned through an `ImageStatus`-typed variable, checked at compile time

### Requirement: Upload Excludes Soft-Deleted Scans

`ImageUploader.uploadScan()` and `uploadBatch()` SHALL refuse to upload
images belonging to a soft-deleted scan.

#### Scenario: Single-scan upload of a deleted scan is rejected

- **GIVEN** a scan with `deleted: true`
- **WHEN** `uploadScan(scanId)` is called for that scan
- **THEN** the method SHALL return `{ success: false, ... }` with an error
  indicating the scan is deleted
- **AND** no images SHALL be uploaded
- **AND** no image status SHALL be changed

#### Scenario: Batch upload skips deleted scans without aborting the batch

- **GIVEN** a batch upload request includes one deleted scan and one
  non-deleted scan
- **WHEN** `uploadBatch([deletedScanId, validScanId])` is called
- **THEN** the deleted scan SHALL be skipped with a per-scan failure result
- **AND** the non-deleted scan SHALL upload normally
- **AND** the overall batch result SHALL report both outcomes

### Requirement: Upload Skips Already-Uploaded Images on Retry

`ImageUploader.uploadScan()` SHALL NOT re-insert remote metadata or
re-send bytes for an image already at `status: 'uploaded'`, to avoid
creating duplicate/orphaned remote rows on retry. Status updates for the
images actually attempted SHALL apply to the correct `Image` row, even
when the set of images attempted is a filtered subset of the scan's full
image list.

#### Scenario: Retry only re-uploads failed or pending images

- **GIVEN** a scan with 3 images: one `'uploaded'`, one `'failed'`, one
  `'pending'`
- **WHEN** `uploadScan(scanId)` is called
- **THEN** only the `'failed'` and `'pending'` images SHALL be passed to
  the underlying `bloom-fs` upload call
- **AND** the already-`'uploaded'` image's status SHALL NOT change
- **AND** the returned result's `total` SHALL reflect only the images
  actually re-uploaded in this call

#### Scenario: Status updates apply to the correct image, not by stale position

- **GIVEN** a scan with 3 images in order [A (`'uploaded'`), B (`'failed'`),
  C (`'pending'`)]
- **WHEN** `uploadScan(scanId)` is called and `bloom-fs` reports B's upload
  as successful and C's as failed
- **THEN** image B (not image A or C) SHALL be the one verified and
  possibly marked `'uploaded'`
- **AND** image C (not image A or B) SHALL be the one marked `'failed'`
- **AND** image A's status SHALL remain unchanged throughout this call

#### Scenario: All images already uploaded is a no-op success

- **GIVEN** a scan where every image has `status: 'uploaded'`
- **WHEN** `uploadScan(scanId)` is called
- **THEN** the method SHALL return success with zero images attempted
- **AND** no `bloom-fs` upload call SHALL be made
- **AND** no image's status SHALL be changed (this tier does not
  re-verify already-`'uploaded'` images — see design.md Decision 9)

### Requirement: Upload Verifies Storage Object Existence Before Marking Uploaded

`ImageUploader` SHALL look up a freshly-uploaded image's `object_path`
from the `cyl_images` table and independently verify the object exists in
Supabase storage before marking that image `'uploaded'`, after
`@salk-hpi/bloom-fs`'s `uploadImages()` reports the upload as successful
(no error, non-null `created`) for that image — the `object_path` is
looked up separately because `bloom-fs`'s callback does not return it. A
verification-call failure (network/lookup error) is distinct from a
confirmed-missing object and SHALL be retried up to 3 total attempts, with
a fixed 500ms delay between attempts, before falling back to a failure
state — an inconclusive check must not be treated the same as a
confirmed-missing object.

#### Scenario: Verified object marks the image uploaded

- **GIVEN** `bloom-fs` reports success for an image, and its `object_path`
  lookup succeeds
- **WHEN** `ImageUploader` checks the Supabase storage client and confirms
  the object exists at that path
- **THEN** the local `Image.status` SHALL be set to `'uploaded'`

#### Scenario: Confirmed-missing object marks the image failed

- **GIVEN** `bloom-fs` reports success for an image, its `object_path`
  lookup succeeds, but the object does not actually exist in Supabase
  storage when independently checked
- **WHEN** `ImageUploader` performs the existence check
- **THEN** the local `Image.status` SHALL be set to `'failed'`, not
  `'uploaded'`
- **AND** the error recorded SHALL distinguish this case (e.g. "upload
  reported success but object not found in storage") from an ordinary
  upload failure
- **AND** because the image is no longer at `'uploaded'`, a subsequent
  `uploadScan()` call SHALL re-upload it normally

#### Scenario: object_path lookup returns null despite a successful bloom-fs report

- **GIVEN** `bloom-fs` reports success for an image (non-null `created`,
  no error), but the `cyl_images` row's `object_path` is null (e.g.
  because `bloom-fs`'s own internal post-upload metadata update silently
  failed)
- **WHEN** `ImageUploader` attempts the `object_path` lookup
- **THEN** this SHALL be treated as an inconclusive verification (the next
  scenario's bounded-retry rule), not as a confirmed-missing object

#### Scenario: A transient verification failure is retried, not treated as confirmed-missing

- **GIVEN** the `object_path` lookup or the storage existence check itself
  fails (e.g. a network error), rather than cleanly confirming the object
  present or absent
- **WHEN** `ImageUploader` performs the verification
- **THEN** the check SHALL be retried, for a total of 3 attempts, with a
  fixed 500ms delay between attempts, before giving up
- **AND** if any attempt confirms the object present, the image SHALL be
  marked `'uploaded'`
- **AND** if all 3 attempts remain inconclusive, the image SHALL be marked
  `'failed'` with an error distinguishing "verification could not be
  confirmed" from both an ordinary upload failure and a confirmed-missing
  object

### Requirement: Upload Awaits Verification Before Returning

`ImageUploader.uploadScan()` SHALL NOT return until every attempted
image's verification (and corresponding local status write) has
completed, regardless of `@salk-hpi/bloom-fs`'s own internal callback
timing.

#### Scenario: uploadScan does not resolve while verification is still in flight

- **GIVEN** a scan with multiple images being uploaded concurrently across
  worker slots
- **WHEN** `@salk-hpi/bloom-fs`'s `uploadImages()` call resolves (its
  internal per-item callbacks may not all have completed their own
  asynchronous work at that point)
- **THEN** `uploadScan()` SHALL NOT resolve until every image's
  verification and status write has completed
- **AND** the returned `UploadResult`'s `uploaded`/`failed` counts SHALL
  reflect the final, post-verification status of every attempted image

