# Spec Delta: upload

This change adds three data-integrity guarantees to `ImageUploader`,
closing gaps confirmed live via a direct audit against `bloom-desktop-pilot`
issues #57 and #60 (both from the pilot's real 2026-05-22 incident).

## ADDED Requirements

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

`ImageUploader.uploadScan()` SHALL only attempt to upload images that are
not already at `status: 'uploaded'`, to avoid re-inserting remote metadata
rows for images that previously succeeded.

#### Scenario: Retry only resends failed or pending images

- **GIVEN** a scan with 3 images: one `'uploaded'`, one `'failed'`, one
  `'pending'`
- **WHEN** `uploadScan(scanId)` is called
- **THEN** only the `'failed'` and `'pending'` images SHALL be passed to
  the underlying `bloom-fs` upload call
- **AND** the already-`'uploaded'` image SHALL NOT be re-uploaded or have
  its status changed
- **AND** the returned result's `total` SHALL reflect only the images
  actually attempted in this call

#### Scenario: All images already uploaded is a no-op success

- **GIVEN** a scan where every image has `status: 'uploaded'`
- **WHEN** `uploadScan(scanId)` is called
- **THEN** the method SHALL return success with zero images attempted
- **AND** no `bloom-fs` upload call SHALL be made

### Requirement: Upload Verifies Storage Object Existence Before Marking Uploaded

`ImageUploader` SHALL independently verify a storage object exists in
Supabase before marking the corresponding image `'uploaded'`, after
`@salk-hpi/bloom-fs`'s `uploadImages()` reports that image's upload as
successful (no error, non-null `created`).

#### Scenario: Verified object marks the image uploaded

- **GIVEN** `bloom-fs` reports success for an image with a given
  `object_path`
- **WHEN** `ImageUploader` checks the Supabase storage client and confirms
  the object exists at that path
- **THEN** the local `Image.status` SHALL be set to `'uploaded'`

#### Scenario: Missing object despite reported success marks the image failed

- **GIVEN** `bloom-fs` reports success for an image, but the object does
  not actually exist in Supabase storage when independently checked
- **WHEN** `ImageUploader` performs the existence check
- **THEN** the local `Image.status` SHALL be set to `'failed'`, not
  `'uploaded'`
- **AND** the error recorded SHALL distinguish this case (e.g. "upload
  reported success but object not found in storage") from an ordinary
  upload failure
