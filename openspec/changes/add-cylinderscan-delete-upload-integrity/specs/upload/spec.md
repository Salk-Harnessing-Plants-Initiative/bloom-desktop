# Spec Delta: upload

This change adds three data-integrity guarantees to `ImageUploader`,
closing gaps confirmed live via a direct audit against `bloom-desktop-pilot`
issues #57 and #60 (both from the pilot's real 2026-05-22 incident), plus
two correctness properties (found during pre-implementation review) that
the fix itself must not violate: already-verified images must stay
reachable by verification on retry, and a filtered retry list must not
misapply a status update to the wrong image.

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

### Requirement: Upload Skips Re-Uploading, But Not Re-Verifying, Already-Uploaded Images on Retry

`ImageUploader.uploadScan()` SHALL NOT re-insert remote metadata or
re-send bytes for an image already at `status: 'uploaded'`, but SHALL
still independently re-verify that image's storage object exists (per
"Upload Verifies Storage Object Existence Before Marking Uploaded") before
leaving its status unchanged — so an image wrongly marked `'uploaded'` by
a past bug does not become permanently unreachable once this fix ships.
Correctly attributing each verification result to the right `Image` row
is required even when the set of images actually uploaded is a filtered
subset of the scan's full image list.

#### Scenario: Retry only re-uploads failed or pending images

- **GIVEN** a scan with 3 images: one `'uploaded'`, one `'failed'`, one
  `'pending'`
- **WHEN** `uploadScan(scanId)` is called
- **THEN** only the `'failed'` and `'pending'` images SHALL be passed to
  the underlying `bloom-fs` upload call
- **AND** the already-`'uploaded'` image SHALL NOT be re-uploaded (no new
  remote metadata row, no re-sent bytes)
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
- **AND** image A's status SHALL only ever change as a result of its own
  re-verification (see next scenario), never as a side effect of B or C's
  outcome

#### Scenario: Retry re-verifies an already-uploaded image and confirms it

- **GIVEN** an image at `status: 'uploaded'` whose storage object actually
  exists
- **WHEN** `uploadScan(scanId)` is called for that scan
- **THEN** no re-upload SHALL occur for that image
- **AND** the existence check SHALL run for that image
- **AND** its status SHALL remain `'uploaded'`

#### Scenario: Retry re-verifies an already-uploaded image and finds it missing

- **GIVEN** an image at `status: 'uploaded'` whose storage object does
  NOT actually exist (e.g. wrongly marked by a past bug)
- **WHEN** `uploadScan(scanId)` is called for that scan
- **THEN** no re-upload SHALL be attempted in this call
- **AND** the image's status SHALL be changed to `'failed'`, with the
  same distinguishing error used for a fresh verification failure
- **AND** because the image is no longer at `'uploaded'`, a subsequent
  retry call SHALL re-upload it normally

#### Scenario: All images already uploaded still re-verifies, but uploads nothing

- **GIVEN** a scan where every image has `status: 'uploaded'`
- **WHEN** `uploadScan(scanId)` is called
- **THEN** no `bloom-fs` upload call SHALL be made
- **AND** each image SHALL still be independently re-verified against
  storage per the scenarios above
- **AND** the returned result's `total` (re-upload count) SHALL be zero

### Requirement: Upload Verifies Storage Object Existence Before Marking Uploaded

`ImageUploader` SHALL look up an image's `object_path` from the
`cyl_images` table and independently verify the object exists in Supabase
storage before marking that image `'uploaded'`, after `@salk-hpi/bloom-fs`'s
`uploadImages()` reports the upload as successful (no error, non-null
`created`) — the `object_path` is looked up separately because `bloom-fs`'s
callback does not return it. The same check applies when re-verifying an
already-`'uploaded'` image on retry. A verification-call failure
(network/lookup error) is distinct from a confirmed-missing object and
SHALL be retried, bounded, before falling back to a failure state — an
inconclusive check must not be treated the same as a confirmed-missing
object.

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
- **THEN** the check SHALL be retried up to 3 times with a brief backoff
  before giving up
- **AND** if any retry confirms the object present, the image SHALL be
  marked `'uploaded'`
- **AND** if all 3 attempts remain inconclusive, the image SHALL be marked
  `'failed'` with an error distinguishing "verification could not be
  confirmed" from both an ordinary upload failure and a confirmed-missing
  object
