## Why

Tier 2 of `docs/superpowers/plans/2026-08-03-cylinderscan-finalization-roadmap.md`
("Delete & upload data-integrity + acquisition metadata completion") is the
highest-stakes tier in that roadmap — it's what "production-level data
integrity and metadata preservation" points at directly. Three concrete
problems motivate it:

1. **#79/#105 are half-done.** `db:scans:delete` soft-deletes the DB row but
   never touches the scan's `metadata.json` on disk, and `ScanPreview.tsx`
   has no delete affordance at all (upload-only) — a user can only delete
   from `BrowseScans.tsx`.
2. **Upload data integrity has caused real production data loss.** Tracing
   the pilot's 2026-05-22 incident issues (`bloom-desktop-pilot` #57-#61) and
   confirming directly with the user: the specific failure pattern
   experienced — "it errored, then we uploaded again and it marked it as
   succeeded even though it was not actually uploaded" — matches pilot issue
   #60 (a still-open, latent client-side gap where a dedup/"already exists"
   path can report upload success without independently verifying storage
   bytes exist). The current `bloom-desktop` `image-uploader.ts` has never
   been audited against this or the pilot's other two confirmed bugs (#57:
   soft-deleted scans still uploadable; #59: no local↔cloud traceability).
3. **#120 duplicate-scan blocking is imprecise.** `CaptureScan.tsx` already
   warns on same-day (plant_id + experiment_id) duplicates, but not on the
   same (plant_id, experiment_id, wave_number, plant_age_days) combination
   the roadmap and the user identified as the actual duplicate key that
   matters for wave-based experiments.

Pilot issue #3 (Basler acquisition-metadata readback gap) was investigated
per the roadmap's request but is **not implemented here** — see Impact.

## What Changes

**Part 1 — Delete completion (#79/#105)**

- `db:scans:delete` (`database-handlers.ts`) now also writes `deleted: true`
  into the scan's `metadata.json` on disk, via a new
  `markMetadataDeleted()` in `scan-metadata-json.ts` (atomic write, reusing
  the existing `.tmp`-then-rename pattern). Missing/legacy files log a
  warning and do not fail the delete.
- New shared `DeleteConfirmModal` component (Plant ID + capture date,
  Cancel/Delete) replaces `BrowseScans.tsx`'s generic `window.confirm()`
  and is added to `ScanPreview.tsx`'s toolbar as a new delete button —
  bringing both call sites in line with the spec's existing "Delete Scan"
  UI requirement, which already described this modal.
- Amends the "Scan Delete IPC Handler" requirement
  (`ui-management-pages` spec) to add the `metadata.json` scenario, and
  broadens "Delete Scan" to cover deleting from ScanPreview as well as
  BrowseScans.

**Part 2 — Upload data-integrity fixes (`image-uploader.ts`)**

- `uploadScan`/`uploadBatch` now reject soft-deleted scans outright
  (`success: false` with a clear message) instead of silently uploading
  their images.
- Retrying a scan now skips **re-uploading** images already at `status:
  'uploaded'` instead of resending every image in the scan — avoids
  creating duplicate/orphaned remote metadata rows on retry. Critically,
  already-`'uploaded'` images are still independently re-verified against
  storage (not re-uploaded) on retry, so a historically-corrupted
  `'uploaded'` image doesn't become permanently invisible to the new
  verification logic below (design.md Decision 9 — found during review).
  The internal per-image index mapping is fixed to key off the filtered
  upload list, not the full scan, so this doesn't misapply a status update
  to the wrong image (design.md Decision 10 — found during review).
- After `@salk-hpi/bloom-fs` reports an image upload as successful, the
  code now independently verifies the object exists in Supabase storage
  (via the raw Supabase client already held by `ImageUploader`, plus one
  additional Supabase query to look up the `object_path` bloom-fs never
  returns to the caller — design.md Decision 7) before marking the local
  image `'uploaded'` — the same caller-side fix pilot issue #60 itself
  proposed, requiring no changes to the external `bloom-fs` package or the
  Supabase schema. A verification call that itself fails (not a confirmed-
  missing object) is retried up to 3 times before falling back to
  `'failed'`, so a transient network blip during the check can't silently
  mark a real success as failed (design.md Decision 7 — found during
  review).
- `nWorkers: 4` gets a documentation-only comment (matching
  `graviscan-upload.ts`'s existing rationale for the same constant); no
  behavior change (pilot issue #110 — see Impact for the follow-up on its
  other two, unaddressed asks).
- New `upload` spec requirements: "Upload Excludes Soft-Deleted Scans",
  "Upload Skips Already-Uploaded Images on Retry", "Upload Verifies Storage
  Object Existence Before Marking Uploaded".

**Part 3 — Duplicate-scan blocking (#120)**

- New `db:scans:checkDuplicate` IPC handler, matching this file's existing
  `db:scans:*` conventions, checking for any non-deleted scan matching
  `(plant_id, experiment_id, wave_number, plant_age_days)`.
- `CaptureScan.tsx`'s existing same-day/(plant_id+experiment_id) warning is
  **replaced** (not supplemented) by a call to the new handler — same
  warning-banner/hard-block UX, corrected trigger condition.
- **BREAKING**: `db:scans:getMostRecentScanDate` becomes dead code once
  this switch happens (its only production call site is the code being
  replaced, confirmed by an independent full-tree search, not just the
  original claim) and is removed entirely, per this repo's no-dead-code
  convention — including its `preload.ts`/`electron.d.ts` exposure and its
  dedicated test coverage in `tests/e2e/plant-barcode-validation.e2e.ts`
  and two blocks in `tests/e2e/renderer-database-ipc.e2e.ts`. This is an
  internal Electron IPC surface (no external consumers), but it is a real
  API removal, marked as such per this repo's proposal conventions. The
  "Plant Barcode IPC Handlers" requirement drops that scenario; the
  "Duplicate Scan Prevention" requirement is rewritten for the new key and
  handler name — including a new scenario for the changed cross-day
  behavior (a match on a *different* day is now correctly flagged, since
  day is no longer part of the key).
- New E2E test in `tests/e2e/renderer-database-ipc.e2e.ts` for
  `db:scans:checkDuplicate` — required by this repo's CI coverage gate,
  which statically scans that specific file for `db:*` handler calls (a
  unit test alone does not satisfy it).

**Part 4 — Acquisition metadata gap (pilot #3) — investigated, not
implemented**

- Confirmed by reading `python/hardware/camera.py` and `scanner.py` in
  full: zero Basler API readback capability exists anywhere in the current
  stack (no getter calls on any PyPylon node; `ScanResult` carries no
  camera-state fields). This is new instrumentation work with its own
  design tradeoff (whether `metadata.json`'s current before-capture write
  timing needs to change to accommodate post-capture readback data) —
  scoped as a follow-up tier/issue, not attempted here.

**Not fixed by this change (explicitly, with follow-ups):**

- Pilot #59 (local↔cloud UUID traceability) — traced the actual upload path
  and confirmed this needs a `@salk-hpi/bloom-fs` type change plus a
  Supabase schema migration to the `cyl_images` table, neither of which
  this repo's PR can do alone. Follow-up cross-repo issue.
- Pilot #61 (scheduled upload/storage audit tool) — separate, larger ops
  tooling; this tier's fixes address the specific failure mode already
  confirmed in production, and narrow (but don't eliminate) the
  historical-corruption blind spot this tool would fully close — see
  design.md Decision 9/Risks. Follow-up issue.
- #110's two unaddressed asks (benchmark 4/8/10 workers; consider making
  concurrency configurable) — only its third ask (document the rationale)
  is done here. Follow-up issue for the other two.
- #79's own acceptance criteria include removing scan files from disk on
  delete — deliberately not done (Decision 1, soft-delete-only). This
  proposal comments on #79 explaining the decision rather than silently
  diverging from one of its stated criteria.

## Impact

- **Affected specs**: `ui-management-pages` (MODIFIED: "Delete Scan", "Scan
  Delete IPC Handler", "Duplicate Scan Prevention", "Plant Barcode IPC
  Handlers"; ADDED: "Scan Duplicate Check IPC Handler"); `upload` (ADDED:
  three new requirements, see above).
- **Affected code**: `src/main/database-handlers.ts`,
  `src/main/cylinderscan/scan-metadata-json.ts` (adds
  `isScanMetadataDeleted()`, design.md Decision 13), `src/main/image-uploader.ts`,
  `src/main/preload.ts`, `src/types/electron.d.ts`,
  `src/renderer/BrowseScans.tsx` (also gains a success-message affordance —
  no toast/message infrastructure exists anywhere in the renderer today,
  confirmed by search, so this is new, minimal UI, not a wire-up of
  something existing), `src/renderer/ScanPreview.tsx`,
  `src/renderer/CaptureScan.tsx`, a new
  `src/renderer/components/DeleteConfirmModal.tsx` (or equivalent shared
  location — confirmed during implementation).
- **Affected tests** (existing, modified or removed):
  `tests/e2e/renderer-database-ipc.e2e.ts` (removes 2 `getMostRecentScanDate`
  tests inside its larger scans-with-filters describe block, adds the new
  `checkDuplicate` test), `tests/e2e/plant-barcode-validation.e2e.ts`
  (removes its dedicated `getMostRecentScanDate` describe block, and
  **rewrites** — not just deletes — its separate "UI: Duplicate Scan
  Prevention" test, which asserts on the old "already scanned today"
  message that no longer applies), `tests/unit/capture-scan-config.test.tsx`
  (replaces the `getMostRecentScanDate` mock with a `checkDuplicate` mock,
  not just removes it), `tests/unit/pages/CaptureScan-event-cleanup.test.tsx`
  (mock removal only — this file's suite is currently `describe.skip`'d,
  so it doesn't run in CI either way).
- **New tests**: `markMetadataDeleted()`/`isScanMetadataDeleted()` unit
  tests; `db:scans:delete`'s metadata-sync and missing-file-handling unit
  tests; a `DeleteConfirmModal` component test; `BrowseScans.tsx`/
  `ScanPreview.tsx` delete-flow tests including the new success message;
  `checkDuplicateScan` unit test plus its required `renderer-database-ipc.e2e.ts`
  entry; `CaptureScan.tsx` duplicate-check tests including an invalid/
  incomplete `waveNumber`/`plantAgeDays` edge case; and `image-uploader.ts`
  unit tests for the soft-delete guard, the retry-skip-but-still-verify
  behavior (design.md Decision 9), the filtered-index correctness
  regression test (design.md Decision 10), and the three-way verification
  outcome including the bounded-retry-on-inconclusive-check path
  (design.md Decision 7).
- **No Prisma schema changes** — `Scan.deleted` already exists; this
  change only adds a `deleted` field (plus a helper function) to the
  on-disk `ScanMetadataJson` TypeScript interface, not the database.
- **Coordination with Tier 1** (`harden-cylinderscan-tier1`, PR #280, not
  yet merged): both touch `image-uploader.ts`, in disjoint regions — Tier 1
  fixes 4 `any`-typed fields (lines ~96-103), this change touches
  `uploadScan`/`uploadBatch` (lines ~212-350+) and the `nWorkers` constant.
  Whichever merges first, the other should rebase before finalizing, per
  the same discipline the roadmap already calls out.
- **Not affected, left as-is on purpose**: pilot #59 (local↔cloud UUID) —
  see "Not fixed by this change" above. Pilot #3 (acquisition-metadata
  readback) — see Part 4.
