# CylinderScan Delete & Upload Data-Integrity Design

**Status:** Drafted 2026-08-05, brainstormed interactively with the user.
Implements Tier 2 of `2026-08-03-cylinderscan-finalization-roadmap.md`
("Delete & upload data-integrity + acquisition metadata completion").

## Context

CylinderScan's #78 (Cloud Upload) and #79 (Delete Scan) are both partially
implemented today. Tier 1 (`add-cylinderscan-delete-upload-integrity`'s
sibling PR #280, `harden-cylinderscan-tier1`) hardens unrelated
correctness/security issues in the same era of code; this tier is scoped to
be independent of it, touching disjoint regions of the one shared file
(`image-uploader.ts`).

This design was produced by first auditing the actual current code (not
trusting the roadmap's provisional fix list, which was explicitly
"provisional until the actual code is read") and reading the pilot's GitHub
issues (#57-#61, `bloom-desktop-pilot`, all filed 2026-05-22 from one real
incident) in full rather than relying on the roadmap's paraphrase. Several
of the roadmap's provisional assumptions turned out to be wrong or
incomplete — documented inline below wherever that happened.

## Decisions locked in with the user before this design

- **File-retention policy: soft-delete-only.** Deleting a scan never removes
  image bytes from disk — matches the pilot's pattern, matches the existing
  accepted spec, avoids irreversible data loss from a mis-click.
- **Pilot #61 (automated upload/storage audit tool): follow-up issue, not
  this tier.** This tier's fixes (below) directly address the specific
  failure mode the user has hit in production; a scheduled drift-detector
  is separate, larger ops tooling.
- **Pilot #110 (upload worker count, pilot uses 10 vs. this app's 4):
  document only, no behavior change.**
- **Pilot #3 (Basler acquisition-metadata readback gap): follow-up
  tier/issue, not this tier.** Confirmed via full read of `camera.py` and
  `scanner.py` that zero readback capability exists anywhere in the current
  stack (no getter calls on any PyPylon node) — this is new instrumentation
  work, not a config change, and deserves its own scoped tier.
- **Pilot #59 (local↔cloud UUID traceability): follow-up cross-repo issue,
  not this tier.** Traced the actual upload path (see Part 2) and confirmed
  this cannot be fixed from `bloom-desktop` alone — the remote `cyl_images`
  Supabase table has no column for it, and the `@salk-hpi/bloom-fs`
  package's `CylImageMetadata` type has no id field either. Fixing it needs
  a `bloom-fs` type change plus a Supabase schema migration, both outside
  this repo's control.
- **Duplicate-scan check key: `(plant_id, experiment_id, wave_number,
  plant_age_days)`**, replacing (not running alongside) the existing
  same-day/(plant_id+experiment_id) check. The user caught that `plant_id`
  alone isn't guaranteed unique across experiments — the roadmap's
  originally-stated key omitted `experiment_id`.
- **Delete confirmation UI: build the real modal** the already-accepted
  spec describes (Plant ID + capture date), used identically in both
  `BrowseScans.tsx` and the new `ScanPreview.tsx` delete button — rather
  than leaving the current generic `window.confirm()` and rewriting the
  spec down to match it.

## Part 1 — Delete completion (#79/#105)

### Current state (confirmed by reading the code)

- `db:scans:delete` (`database-handlers.ts:1940-1958`) does a pure Prisma
  `update` setting `deleted: true`. It does not touch `metadata.json` or
  any file on disk — confirmed no `fs` import/call anywhere in the delete
  path. The doc comment above it already documents "Does NOT delete
  associated Image records" as intentional.
- `metadata.json` is written by `scan-metadata-json.ts`
  (`buildMetadataObject`/`writeMetadataJson`), called from
  `scanner-process.ts:99-114` **before** the Python `scan()` command runs
  (so metadata travels with images even on partial capture failure). Its
  schema (`ScanMetadataJson` interface) has no `deleted` field today.
- Delete is fully implemented today, but in `BrowseScans.tsx`
  (`handleDelete`, lines 101-125), not `ScanPreview.tsx` — which has zero
  delete affordance, only an Upload button. `BrowseScans.tsx`'s
  confirmation is a generic `window.confirm()` — it does not match the
  already-accepted spec's description of a custom modal showing Plant ID +
  capture date (`openspec/specs/ui-management-pages/spec.md:1333-1365`).
- `Scan.path` (Prisma) stores the same relative directory
  (`<date>/<plant_id>/<uuid>`) that `metadata.json` lives in, alongside
  `scan_path` in the metadata file itself. Both are relative to the
  configured scans directory (`loadEnvConfig(...).scans_dir`, same
  resolution `image-uploader.ts` already uses).

### Design

1. Add `deleted?: boolean` to `ScanMetadataJson` and a new
   `markMetadataDeleted(outputDir: string): void` in `scan-metadata-json.ts`,
   reusing the existing atomic write pattern (write `.tmp`, rename). Read
   the existing file, set `deleted: true`, rewrite.
2. `db:scans:delete` handler: after the existing Prisma update, resolve
   `path.join(scansDir, scan.path, 'metadata.json')` and call
   `markMetadataDeleted`. If the file doesn't exist (e.g. a legacy
   pre-#99 scan), log a warning and continue — do not fail the delete
   over a missing file.
3. New shared `DeleteConfirmModal` component (Plant ID + capture date,
   Cancel/Delete buttons), used by:
   - `BrowseScans.tsx`, replacing its `window.confirm()`.
   - `ScanPreview.tsx`'s new delete button (added to its toolbar next to
     Upload), which calls the same `scans.delete` IPC method.
4. Amend `openspec/specs/ui-management-pages/spec.md`'s "Scan Delete IPC
   Handler" requirement to add a scenario/acceptance criterion for the
   `metadata.json` update. The existing "Delete Scan" UI requirement
   (modal w/ Plant ID + date) needs no change — the implementation now
   catches up to it.

## Part 2 — Upload data-integrity audit (`image-uploader.ts`)

### Current state (confirmed by reading the full file, plus the actual
compiled `@salk-hpi/bloom-fs` source — not just its `.d.ts` files)

- **No soft-delete filtering anywhere in the upload call path.** `uploadScan`
  (lines 212-350) fetches via `prisma.scan.findUnique({ where: { id: scanId },
  ... })` with no `deleted` clause, and there is no queue — uploads are only
  ever triggered per explicit `scanId`(s) via `db:scans:upload`/
  `db:scans:uploadBatch`. If a caller passes a soft-deleted scan's id (stale
  batch selection, or a race with an in-flight delete), it uploads normally.
- **Retry resends every image, not just failed ones.** `uploadScan` builds
  `imagePaths`/`metadata` from *all* `scan.images` (line 255-260) with no
  status filter, and marks all of them `'uploading'` again (lines 263-269)
  on every call. Since `store.insertImageMetadata()` is a plain insert (not
  a client-side upsert — confirmed via the `DataStore` interface, which
  returns `{created: number | null, error}` with no upsert semantics
  visible from the client side), retrying a scan risks creating duplicate/
  orphaned remote metadata rows for images that already uploaded
  successfully.
- **Status-marking trust chain, traced precisely:** bloom-fs's compiled
  `uploadImage()` (`dist/cyl/metadata.js:326-358`) does: insert metadata row
  first (`created`, `dbError`) → if that succeeded, upload bytes via
  `uploader.uploadImage()` (`uploadError`) → call
  `store.updateImageMetadata(created, {object_path, status})` to record the
  outcome remotely, **discarding that call's own error** → returns
  `{created, error: dbError || uploadError}`. `image-uploader.ts`'s
  callback (lines 282-338) marks local status `'uploaded'` whenever
  `!error && created !== null`.
  - This means the *current* code's condition is structurally different
    from — and safer than — the pilot's inverted `created===null &&
    error===null` bug (pilot issue #60): current code treats
    `created===null` as failure, not success.
  - However, per the pilot incident: filed 2026-05-22, `bloom-desktop-pilot`
    issues #57-#61. The pilot's post-incident re-diagnosis (#58, updated
    2026-05-22) found the *specific* 2026-05 data-loss event was actually
    server-side (an incomplete AWS→local-storage migration, not a client
    bug) — but #60 documents a **separate, still-open, latent client-side
    gap**: bloom-fs's dedup/"already exists" path can report success
    without the caller independently verifying bytes exist. The user
    confirmed hitting this exact pattern directly ("it errored, then we
    uploaded again and it marked it as succeeded even though it was not
    actually uploaded") — matching #60's proposed fix almost exactly.
  - Root cause of the retry-false-success the user saw could not be fully
    pinned down from client-side code alone (the dedup semantics of the
    underlying Postgres RPC behind `insertImageMetadata` aren't visible
    from this repo), and that uncertainty is itself the reason to fix this
    with an independent verification rather than a narrower targeted patch.
- **No local scan/image UUID in the cloud payload.** Confirmed via
  `buildCylImageMetadata()` (lines 172-200) — the `CylImageMetadata` object
  sent to bloom-fs has no id field, and the remote `cyl_images` table
  (traced via `@salk-hpi/bloom-js`'s generated `database.types.d.ts`) has
  columns `id, scan_id, frame_number, date_scanned, object_path, status,
  uploaded_at` — no slot for a local id at all.
- **Upload worker count:** hardcoded `nWorkers: 4` (line 274), no comment.
  GraviScan's equivalent constant (`graviscan-upload.ts:230-234`,
  `UPLOAD_CONCURRENCY = 4`) has an explicit rationale comment ("each image
  is 3 round-trips: insert RPC → file upload → update RPC") that applies
  identically here.

### Design

1. **Soft-delete guard.** `uploadScan`/`uploadBatch`: after fetching the
   scan, check `scan.deleted` and return a clear `UploadResult` error
   (`success: false`, explanatory message) instead of proceeding, if the
   scan is deleted. Defense-in-depth regardless of whether the UI already
   prevents reaching this state.
2. **Skip already-uploaded images on retry.** Filter `scan.images` to
   `status !== 'uploaded'` before building `imagePaths`/`metadata` and
   before the "mark uploading" loop. `UploadResult.total` reflects only the
   images actually attempted this call (already-uploaded images aren't
   counted as part of this run).
3. **Independent storage-existence verification.** After bloom-fs's
   `result` callback reports `!error && created !== null` for an image, use
   the raw Supabase client (`this.supabase`, already instantiated in
   `authenticate()`) to verify the uploaded object actually exists in the
   `images` bucket (e.g. `storage.from('images').list(dir, { search:
   filename })` or an equivalent existence check against the `object_path`
   bloom-fs assigned) **before** flipping local status to `'uploaded'`. If
   the object is missing, mark `'failed'` instead, with an error message
   distinguishing this case ("upload reported success but object not found
   in storage") so it's diagnosable if it ever fires. This is the same
   caller-side fix pilot issue #60 itself proposed as the alternative to
   patching `bloom-fs` directly, and requires no external package or schema
   changes.
4. **Local↔cloud UUID:** no code change in this tier. File a follow-up
   issue against `@salk-hpi/bloom-fs`/the Supabase schema (add a
   `local_image_id`/`local_scan_id` column, thread it through
   `insertImageMetadata`), referencing pilot issue #59 as prior art (which
   proposed the identical fix independently).
5. **Audit/reconciliation:** no code change in this tier. File a follow-up
   issue referencing pilot issue #61 (which already lists reusable
   HEAD-check scripts as a starting point).
6. **Worker count:** add a comment to `nWorkers: 4` matching
   `graviscan-upload.ts`'s rationale. No value change.

## Part 3 — Duplicate-scan blocking (#120)

### Current state

- `CaptureScan.tsx:159-205` already has a duplicate-scan warning, polling
  every 2s via `db:scans:getMostRecentScanDate(plantId, experimentId)`
  (`database-handlers.ts:1829-1859`, which already filters
  `deleted: false`). It warns only if the same `(plant_id, experiment_id)`
  was scanned on the *same calendar day* — no `wave_number` or
  `plant_age_days` awareness. The warning **hard-blocks** `Start Scan`
  (`canStartScan`, lines 462-467 requires `!duplicateScanWarning`) — this is
  stronger than a passive warning, worth preserving in the replacement.

### Design

1. New `db:scans:checkDuplicate` handler in `database-handlers.ts`,
   matching existing `db:scans:*` conventions (inline `ipcMain.handle`,
   returns `DatabaseResponse<boolean>` or similar), checking for any
   non-deleted scan matching `(plant_id, experiment_id, wave_number,
   plant_age_days)` exactly.
2. Replace `CaptureScan.tsx`'s existing check with a call to the new
   handler — same polling/warning-banner/hard-block UX, new trigger
   condition. Remove `getMostRecentScanDate`'s usage from this component
   (the handler itself can stay if anything else uses it — confirm during
   implementation).
3. New E2E test in `tests/e2e/renderer-database-ipc.e2e.ts`, matching the
   file's existing `window.evaluate(...)` + direct-Prisma-seed pattern
   (see `getMostRecentScanDate`'s tests, lines ~1408-1451, as the closest
   structural analog) — required by the IPC coverage gate, which statically
   scans this file for `db:*` handler calls.

## Part 4 — Acquisition metadata completeness gap (pilot #3)

### Current state (confirmed by full read of `python/hardware/camera.py`
and `python/hardware/scanner.py`)

- `scan-metadata-json.ts` writes only user-configured values
  (`exposure_time`, `gain`, hardcoded `brightness`/`contrast` = 0, `gamma`,
  `seconds_per_rot`) from `ScannerSettings` — never touched again after the
  form submits.
- `camera.py`'s `Camera` class is write-only against the PyPylon API:
  `_configure_camera()` only ever assigns `.Value = ...` (setters). No
  getter call exists anywhere in the file for exposure/gain readback,
  `DeviceSerialNumber`, `PixelFormat`, ROI (`Width`/`Height`/`OffsetX`/
  `OffsetY`), or `DeviceFirmwareVersion`. Grepped the entire `python/` tree
  for these GenICam node names — zero matches.
- `scanner.py`'s `ScanResult` (returned from `perform_scan()`) carries no
  camera-state fields at all, so even if readback existed, there's no
  plumbing to carry it back to Electron today.

### Design

No implementation in this tier. Document this finding (above) in this
design doc as the record of the investigation, and file a follow-up
tier/issue scoped to: adding PyPylon getter calls after configuration,
extending `ScanResult` to carry the readback values, and deciding whether
metadata.json is written before capture (current behavior, needed so
metadata survives partial failures) or gets a second post-capture write
pass to include readback data (a real design tradeoff for that follow-up
to resolve, not this one).

## Testing

- TDD throughout, per repo convention.
- Part 1: unit tests for `markMetadataDeleted`/schema field; E2E test for
  `ScanPreview.tsx`'s new delete button and the shared modal in both call
  sites.
- Part 2: unit tests for the soft-delete guard, the retry-skip filter, and
  the storage-verification step (mocking the Supabase client to simulate a
  false-positive `bloom-fs` success with a missing object).
- Part 3: new E2E test in `renderer-database-ipc.e2e.ts` for
  `db:scans:checkDuplicate` (required by the IPC coverage gate) plus a
  renderer-level test for `CaptureScan.tsx`'s updated warning condition.
- No regressions: full existing suite stays green.

## Out of scope (explicitly, with follow-up issues to file)

- Pilot #59 equivalent (local↔cloud UUID traceability) — needs a
  `bloom-fs` package change + Supabase schema migration, outside this
  repo's control.
- Pilot #61 equivalent (scheduled upload/storage audit tool) — separate ops
  tooling, larger scope than this tier.
- Pilot #3 equivalent (Basler acquisition-metadata readback) — needs new
  Python/PyPylon instrumentation and a `ScanResult`/metadata-timing design
  decision; deserves its own tier.
- Upload worker-count tuning beyond documentation (pilot #110) — no
  evidence current value of 4 is wrong; only documenting the existing
  rationale.
