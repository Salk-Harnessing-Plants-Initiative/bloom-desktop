## Context

This is Tier 2 of `docs/superpowers/plans/2026-08-03-cylinderscan-finalization-roadmap.md`.
The roadmap's Tier 2 section explicitly labeled its fix list "provisional
until the actual code is read" — this design was produced by reading the
current code directly (not trusting the roadmap's paraphrase) and reading
the pilot's cited GitHub issues in full (not just their titles). Several
provisional assumptions turned out wrong or incomplete; noted inline below.
Full investigation notes and evidence live in
`docs/superpowers/specs/2026-08-05-cylinderscan-delete-upload-integrity-design.md`
(the brainstormed design doc this proposal formalizes); this file focuses on
the decisions and their rationale.

**Delete (#79/#105):** `db:scans:delete` (`database-handlers.ts:1940-1958`)
is a pure Prisma `update` — no filesystem interaction at all. `metadata.json`
is written by `scan-metadata-json.ts`, called from `scanner-process.ts`
before the Python `scan()` command runs (so metadata survives partial
capture failure). Delete IS implemented today, but only in
`BrowseScans.tsx` (`window.confirm()`, no scan details shown) —
`ScanPreview.tsx` has zero delete affordance. The already-accepted spec's
"Delete Scan" requirement describes a modal with Plant ID + capture date
that the actual code has never implemented.

**Upload (`image-uploader.ts`):** Read the full 382-line file, plus the
*compiled* `@salk-hpi/bloom-fs` source (not just its `.d.ts` — the type
files don't show the actual insert-then-upload orchestration or where
errors get silently discarded). Confirmed:

- No `deleted` check anywhere in `uploadScan`/`uploadBatch`'s fetch or
  upload path.
- `uploadScan` refetches and resends *all* of a scan's images on every
  call, including already-`'uploaded'` ones — `store.insertImageMetadata()`
  is a plain insert, not a client-side upsert, so retries risk duplicate
  remote rows.
- bloom-fs's `uploadImage()` (`dist/cyl/metadata.js`) inserts the metadata
  row, then uploads bytes, then calls `updateImageMetadata(status:
  'SUCCESS')` — **discarding that final call's own error**. The current
  `image-uploader.ts` condition (`if (error || created === null) failed
  else uploaded`) is structurally different from, and safer than, the
  pilot's inverted bug (pilot #60: `created===null && error===null` treated
  as success) — but the user independently confirmed hitting the exact
  failure pattern #60 describes ("uploaded again, marked succeeded, wasn't
  actually uploaded"). The precise internal cause could not be fully pinned
  down from client-side code alone — the dedup semantics of the Postgres
  RPC behind `insertImageMetadata` aren't visible from this repo. That
  uncertainty is itself the argument for an independent, unconditional
  verification rather than a narrowly-targeted patch aimed at a guessed
  root cause.
- `CylImageMetadata` (the payload bloom-fs accepts) has no id field, and
  the remote `cyl_images` table (via `@salk-hpi/bloom-js`'s generated
  `database.types.d.ts`) has no column for one either — confirmed by
  reading the generated Supabase types directly, not assumed.
- Read `bloom-desktop-pilot` issues #57-#61 in full (all filed
  2026-05-22, one real incident). #58's own updated diagnosis (same day)
  concluded the specific 2026-05 event was a server-side incomplete
  storage migration, **not** a client bug — but #60 documents a separate,
  still-open latent client-side gap, which is what this change fixes.

**Duplicate check (#120):** `CaptureScan.tsx:159-205` already polls
`db:scans:getMostRecentScanDate(plantId, experimentId)` every 2s and
hard-blocks `Start Scan` on a same-calendar-day match — stronger than a
passive warning, a UX property worth preserving. The user caught that the
roadmap's proposed key (`plant_id, wave_number, plant_age_days`) omits
`experiment_id`, which is necessary since `plant_id` isn't guaranteed
unique across experiments.

**Acquisition metadata (pilot #3):** Read `python/hardware/camera.py` and
`scanner.py` in full, plus grepped the whole `python/` tree for GenICam
readback node names. Zero readback capability exists — not an "unused but
present" API, a genuinely absent one.

## Goals / Non-Goals

**Goals**

- Close the two confirmed, still-live upload data-integrity gaps (soft-delete
  exclusion, independent storage-existence verification) and the retry
  duplicate-row risk, using only this repo's code.
- Finish #79/#105 (metadata.json sync, ScanPreview delete affordance) and
  bring the delete-confirmation UI in line with the already-accepted spec.
- Replace the imprecise duplicate-scan check with the correct 4-field key.
- Document, precisely and with evidence, why three roadmap-flagged items
  (local↔cloud UUID, audit tooling, acquisition-metadata readback) are
  follow-up work rather than silently dropped.

**Non-Goals**

- No changes to `@salk-hpi/bloom-fs` or any Supabase schema migration (pilot
  #59) — outside this repo's control, see Decision 5.
- No scheduled/automated upload audit tool (pilot #61) — separate, larger
  ops-tooling scope.
- No Basler acquisition-metadata readback implementation (pilot #3) — new
  Python instrumentation work with its own metadata-timing tradeoff,
  deserving its own tier.
- No change to the upload worker count (pilot #110) — documentation only.
- No hard-delete/purge functionality — file retention stays soft-delete-only.
- **No re-verification of images uploaded before this change ships.**
  Found during review: re-verifying an *already*-`'uploaded'` image on
  retry would need a locally-stored remote reference (`cyl_images.id` or
  `object_path`) that nothing in this schema persists, and that this
  proposal does not add — see Decision 9. Historical corruption (an image
  wrongly marked `'uploaded'` by the pre-existing bug, before this tier's
  fixes existed) is not reachable by anything in this tier; it remains the
  #61 follow-up's job, whose scope is now explicitly widened to include
  this (Decision 11).
- No local Prisma schema changes to `Image` (e.g. no `remoteImageId`/
  `objectPath` column) — considered and rejected for this tier, see
  Decision 9.

## Decisions

### Decision 1: soft-delete-only retention, no image-byte purge

Confirmed with the user directly. Deleting a scan never removes image bytes
from disk — matches the pilot's pattern, matches the already-accepted spec,
and avoids irreversible data loss from a mis-click. `markMetadataDeleted()`
only ever sets `deleted: true` in `metadata.json`; it never deletes the
`metadata.json` file itself or any image file.

### Decision 2: build the real delete-confirmation modal, not a spec rewrite

The already-accepted "Delete Scan" requirement describes a modal (Plant ID
+ capture date, Cancel/Delete) that `BrowseScans.tsx` has never actually
implemented (it uses a generic `window.confirm()`). Two options:
(a) build the real modal, matching the spec, used by both `BrowseScans.tsx`
and the new `ScanPreview.tsx` delete button, or (b) leave `window.confirm()`
and rewrite the spec down to match reality.

**Chosen: (a).** Confirmed with the user. Since this change already touches
`BrowseScans.tsx` (delete becomes metadata-aware) and adds delete to
`ScanPreview.tsx` from scratch, building one shared component is a small
incremental cost that closes a real, already-flagged spec/code mismatch
instead of leaving it or degrading the spec.

### Decision 3: duplicate-scan key is `(plant_id, experiment_id, wave_number, plant_age_days)`

The roadmap's stated key (`plant_id, wave_number, plant_age_days`) omits
`experiment_id` — and issue #120's own proposed implementation has the same
gap (it isn't only the roadmap's paraphrase that missed it). The user caught
this during review: `plant_id` (a QR-code barcode) is not guaranteed unique
across experiments, so a key without `experiment_id` risks a false-positive
duplicate match across two unrelated experiments that happen to share a
barcode scheme. All four fields are required for an exact match.

**Alternative considered:** keep the roadmap's 3-field key as originally
stated. Rejected once the `experiment_id` gap was identified — it would
ship a known-imprecise check when the fix is free (the field is already
available in `CaptureScan.tsx`'s existing state).

### Decision 4: the new duplicate check replaces, not supplements, the existing same-day check

`CaptureScan.tsx`'s current same-day/(plant_id+experiment_id) warning and
the new 4-field check both address "accidental re-scan," and the new key is
strictly more precise (adds `wave_number` + `plant_age_days`, keeps
`experiment_id`, drops only the same-calendar-day fuzziness). Running both
would produce two warnings with different, overlapping trigger conditions
for what is fundamentally one concern.

**Chosen:** replace. Confirmed with the user. Same UX (warning banner +
hard-blocked `Start Scan` button), corrected trigger condition,
`db:scans:getMostRecentScanDate` removed as dead code (see Decision 6).

### Decision 5: local↔cloud UUID traceability (pilot #59) is out of scope, not attempted

Traced the actual upload path: `image-uploader.ts` → `@salk-hpi/bloom-fs`'s
`uploadImages()` → `DataStore.insertImageMetadata()` against Supabase's
`cyl_images` table. Confirmed via the generated `database.types.d.ts`:
`cyl_images` has columns `id, scan_id, frame_number, date_scanned,
object_path, status, uploaded_at` — no slot for a local id. The
`CylImageMetadata` type bloom-fs accepts has no id field either. Fixing
this needs a `bloom-fs` package type change *and* a Supabase schema
migration — both outside a `bloom-desktop`-only PR's reach.

**Alternative considered:** encode the local UUID into the `object_path`
filename bloom-fs generates. Rejected — `object_path`'s filename
(`cyl-image_${created}_${uuid.v4()}.png`) is constructed inside bloom-fs's
compiled `uploadImage()`, not passed in by the caller; changing it requires
the same external-package change this decision is trying to avoid.

**Chosen:** document the blocker precisely (this file + the proposal) and
file a follow-up cross-repo issue referencing pilot issue #59, which
already proposes the identical fix (add `local_image_id`/`local_scan_id`
columns) independently.

### Decision 6: remove `db:scans:getMostRecentScanDate` entirely rather than leave it as dead code

Once `CaptureScan.tsx` switches to `db:scans:checkDuplicate` (Decision 4),
`getMostRecentScanDate`'s only production call site disappears — grepped
the full `src/` tree and confirmed no other caller exists. Per this repo's
established convention (CLAUDE.md: "if you are certain that something is
unused, you can delete it completely" — no backwards-compat shims for
unused code), this change removes the handler, its `preload.ts` exposure,
its `electron.d.ts` declaration, and repoints/removes its dedicated test
coverage (`tests/e2e/plant-barcode-validation.e2e.ts`,
`tests/e2e/renderer-database-ipc.e2e.ts`, and two unit test mocks) rather
than leaving a now-pointless handler and its tests in place.

**Alternative considered:** leave `getMostRecentScanDate` in place
"in case something needs it later." Rejected — matches exactly the kind of
speculative-future-use retention this repo's conventions explicitly reject.

### Decision 7: independent storage-existence verification for freshly-uploaded images, not a narrower targeted patch

Given the uncertainty in Context about the precise internal cause of the
user's retry-false-success incident (the underlying Postgres RPC's dedup
semantics aren't visible from this repo), the fix targets the *outcome*
(local status must reflect ground truth) rather than a guessed mechanism,
for images going through `bloom-fs`'s upload call **within the current
`uploadScan()` invocation**. After bloom-fs's callback reports success,
`image-uploader.ts` uses the raw Supabase client (`this.supabase`, already
instantiated) to independently verify the object exists in the `images`
storage bucket before flipping local status to `'uploaded'`. If the object
is confirmed missing, status becomes `'failed'` with a distinguishing
error message ("upload reported success but object not found in storage")
rather than silently matching the existing generic failure path — so if
this class of bug is ever reintroduced upstream in bloom-fs, it's
diagnosable from local logs alone. (This requirement is scoped to
fresh uploads only — see Decision 9 for why re-verifying an
already-`'uploaded'` image on retry is explicitly out of scope.)

**Alternative considered:** patch bloom-fs's dedup path directly (pilot
#60's primary proposed fix). Rejected for this tier — requires a
`bloom-fs` package change, which (like Decision 5) is outside this repo's
reach without a package version bump and coordination with that package's
maintainers. The caller-side check is pilot #60's own documented
alternative for exactly this situation ("if touching bloom-fs is
undesirable, the same verification can be added in
`app/src/main/imageuploader.ts`'s branch"). Issue #60 also has a later
follow-up comment (2026-06-17) proposing a structural fix — deterministic
storage paths keyed by local scan/image UUID — that the comment itself
notes would need both a `bloom-fs` change and an `insert_image_v3_0` RPC
change; that's the same external-package/schema boundary Decision 5
already rejects for this tier, so it's noted here for traceability rather
than adopted.

**#60's own proposed fix also includes an automatic-recovery step this
tier deliberately does not build.** Both of #60's proposed variants (patch
bloom-fs, or the caller-side alternative this tier adopts the shape of)
describe a 4-step flow where a confirmed-missing object is **re-uploaded
in the same call** to the existing `object_path`, not merely flagged.
This tier's verification is read-only: a confirmed-missing object is
marked `'failed'` and left for a human-initiated retry (which generates a
fresh `object_path`, since bloom-fs's `uploadImage()` builds one anew per
call — Decision 5's Context) rather than self-healing in place.
**Rejected for this tier, not silently dropped:** automatic in-line
recovery adds real complexity (re-invoking the storage upload from inside
the verification path, with its own error handling and its own need for
verification-of-the-recovery-attempt) for a case this tier's other fixes
already make visible and actionable via a normal retry. Keeping
verification strictly read-only keeps this tier's blast radius contained;
automatic self-healing is better scoped alongside the #61 follow-up
(Decision 11), which already needs comparable reconciliation logic.

**Implementation detail the verification step depends on (found during
review, not in the original design): bloom-fs never returns the
`object_path` it generated.** `uploadImages()`'s `result` callback signature
is `(index, metadata, created, error)` — no `object_path`. The path
(`cyl-image_${created}_${uuid.v4()}.png`) is built inside bloom-fs's
compiled `uploadImage()` and written to the `cyl_images` row via its own
internal `updateImageMetadata()` call, whose error is discarded and whose
result never reaches the caller. `DataStore` has no read method for
`cyl_images` at all. So the verification step requires an **additional**
Supabase query the original design didn't account for: after `created` is
known (available here because it's the `result` callback's own parameter
for the image that was just uploaded in this call), `ImageUploader` must
`select('object_path').eq('id', created)` against `cyl_images` itself
(via `this.supabase`, not `this.store` — `DataStore`'s interface has no
read method, only `insertImageMetadata`/`updateImageMetadata`; confirmed
`this.supabase` is a full `SupabaseClient<Database>` capable of arbitrary
table queries, the same object handed to both `SupabaseUploader` and
`SupabaseStore` internally) before it can even check storage — and that
query can itself return a null `object_path` (if bloom-fs's own discarded
`updateImageMetadata` call silently failed) or fail outright. Both are
now folded into the three-way outcome below. (`this.supabase` is
currently typed `any` in `image-uploader.ts` — worth typing it properly
as part of this work, given this tier exists precisely because of
undetected Supabase-call bugs, though not itself a design blocker.)

**Verification has three outcomes, not two — the third (network/lookup
failure during verification itself) matters for correctness.** The
original design only specified "object confirmed present → `'uploaded'`"
and "object confirmed missing → `'failed'`." A transient network failure
during the `object_path` lookup or the storage existence check itself is a
third, distinct case: naively folding it into "missing" would mark a
*genuinely successful* upload `'failed'`, which — because a `'failed'`
image is no longer at `'uploaded'` and is therefore re-uploaded on the
next retry (Decision 9) — would recreate the duplicate-remote-row risk
the retry-skip fix exists to prevent. **Resolution**: on a verification-
call failure (not a confirmed-missing result), retry the verification
check itself up to 3 total attempts, with a fixed 500ms delay between
attempts (concrete numbers, not "brief," to avoid two implementations
producing materially different behavior) — this is cheap (a read-only
lookup, not a re-upload) and absorbs ordinary transient blips without
touching the retry/re-upload path at all. If verification is still
inconclusive after 3 attempts, mark the image `'failed'` with a distinct
message ("upload succeeded but verification could not be confirmed —
needs reconciliation") and accept the residual risk documented in Risks —
this is a deliberately scoped decision, not a gap: introducing a fifth
`ImageStatus` value to represent "verification-inconclusive" would be a
bigger change (a new state in the `upload` spec's closed 4-value union,
rippling into `BrowseScans.tsx`'s status-summary logic) than this tier's
scope justifies for a rare residual case pilot #61's audit tooling is the
intended long-term backstop for anyway. **Known residual risk, made worse
by persistent (not transient) failure conditions**: if whatever causes an
inconclusive check is persistent (e.g. a firewall path that blocks the
verification read specifically) rather than a one-off blip, each manual
retry cycle can produce its own new duplicate remote row (bloom-fs
upload succeeds → verification exhausts 3 attempts → `'failed'` → user
retries → fresh upload, fresh row → verification exhausts again → repeat)
— this is a repeated, retry-count-proportional risk, not a single bounded
one-time event. Not solved in this tier (would need the same
"distinguish never-uploaded from uploaded-but-unverifiable" capability
Decision 9 explains is out of reach without a schema change); flagged
explicitly in Risks rather than understated as a one-time residual.

### Decision 8: `uploadScan()` explicitly awaits verification work; does not rely on `bloom-fs`'s per-item callback timing

Found during review: `bloom-fs`'s compiled `uploadImages()`
(`concurrentMap` over `nWorkers` workers) invokes the `result` callback
**without awaiting it** — each worker's loop fires `result(...)` and moves
on to its next image (or exits) without waiting for that call to resolve.
Today this is a narrow, low-consequence race (the callback's only async
work is one `prisma.image.update()` call), but Decision 7 turns that
callback into up to 3 network round-trips plus backoff — stretching an
already-present race from milliseconds to potentially seconds, for
whichever image each worker processes last. Without a fix, `uploadScan()`
can return (and the batch/UI can treat the upload as "done") before the
trailing images' verification and status writes have actually completed —
undercounting `result.uploaded`/`result.failed` and leaving those images'
final DB status to land asynchronously after the caller has moved on.

**Chosen:** the `result` callback only synchronously records
`(index, created, error)` into an in-memory list; `uploadScan()` then
explicitly runs the verification-and-status-write work for every recorded
entry via `Promise.all(...)` **after** `await this.uploadImagesFn(...)`
returns, and only resolves once that `Promise.all` completes. This fixes
the race without needing any change to `bloom-fs` itself — the fix lives
entirely on this repo's side of the callback boundary.

### Decision 9: retry skips already-`'uploaded'` images entirely — re-verification on retry is out of scope for this tier

An earlier version of this decision proposed that retry should re-verify
(without re-uploading) images already at `'uploaded'`, to avoid a
historically-corrupted `'uploaded'` image becoming permanently invisible
once Decision 7 ships. **Found during a second round of review: that
design is not implementable as scoped, for three independent reasons**,
any one of which would block it:

1. **No lookup key persists across calls.** Decision 7's verification
   needs `created` (the `cyl_images.id`) to look up `object_path`.
   `created` only exists as an in-memory value inside the single
   `uploadScan()` call that produced it — `ImageUploader` is constructed
   fresh per IPC call (`new ImageUploader(db)` in `database-handlers.ts`),
   and the local `Image` Prisma model stores only
   `id, scan_id, frame_number, path, status` — no column for a remote id
   or `object_path`. Re-verifying an image uploaded in a *prior* call has
   nothing to look up. This is the same gap Decision 5 already identifies
   for a different reason (no local↔remote join key exists anywhere in
   this schema) — Decision 9's original design silently assumed a link
   that Decision 5, in the same document, already established doesn't
   exist.
2. **The UI never reaches this code path for the scans it's meant to
   fix.** `BrowseScans.tsx`'s and `ScanPreview.tsx`'s Upload/Retry buttons
   are both disabled once a scan's images are all locally `'uploaded'`
   (`getUploadStatus()`/`canUpload` derive purely from local `Image.status`
   — exactly the field the historical bug corrupts). There is no separate
   "verify" affordance. So even a correct re-verification implementation
   would never run for a scan currently displaying "All uploaded" — the
   exact state historical corruption produces.
3. **Re-verifying on every retry would compound Decision 8's fix,** not
   just reuse it — every already-`'uploaded'` image would need its own
   awaited verification call each retry, extending the awaited-`Promise.all`
   window further for no benefit given points 1-2 already make the
   feature unreachable/non-functional.

**Chosen (rescoped):** retry skips already-`'uploaded'` images
**completely** — no re-upload, no re-verification, status untouched. This
still delivers the fix's actually-implementable half: it stops retry from
creating duplicate/orphaned remote rows for images that already succeeded
(the original motivating concern), without the unreachable re-verification
half. **Explicit, acknowledged limitation**: an image wrongly marked
`'uploaded'` by the pre-existing bug — including scans uploaded before
this tier ships — is not reachable by anything in this tier. Detecting
and repairing that class of historical corruption is the #61 follow-up's
job (Decision 11), whose scope is now explicitly widened to include a
write-back/reconciliation capability (not just a report), since that's
the only place a lookup-key strategy for historical data can be designed
properly (e.g. a business-key join on `(plant_qr_code, frame_number,
date_scanned)`, or a local schema addition made as part of that tool's own
scoped design) rather than bolted onto this tier's retry button.

**Alternative considered:** add a local schema column
(`Image.remoteImageId`/`objectPath`) so retry-time re-verification has a
key to look up. Rejected for this tier — contradicts the "no Prisma
schema changes" scope this tier otherwise holds to, still wouldn't help
scans uploaded *before* the column existed (a backfill/business-key
fallback would still be needed for those, and the pilot's own postmortem
on issue #59 describes exactly this kind of fallback matching as
"brittle" in practice), and still leaves the UI-gating problem (point 2
above) unsolved on its own. This is squarely the shape of problem the
#61 follow-up should own, not a schema change squeezed into this tier
under review pressure.

### Decision 10: index-safety for the filtered retry-skip array

Found during review: `image-uploader.ts`'s current `uploadScan()` builds
`imagePaths`/`metadata` as 1:1, same-order arrays with `scan.images`
(`scan.images.map(...)`), and its `result` callback recovers the DB row via
`scan.images[index]` — this only works because the arrays passed to
`uploadImagesFn` are never filtered. Decision 9's retry-skip logic makes
`imagePaths`/`metadata` a **filtered subset** of `scan.images`; if the
result/progress callbacks keep indexing into the *unfiltered* `scan.images`
array, `index` (a position in the filtered array) will resolve to the
wrong `Image` row the moment any image in the scan is already `'uploaded'`
— silently applying a status update to an untouched image. This is exactly
the class of bug this whole tier exists to close, so it must not be
reintroduced by the fix itself.

**Chosen:** build an explicit `imagesToUpload` array (the filtered subset,
excluding already-`'uploaded'` images per Decision 9) and have the
result/progress callbacks index into `imagesToUpload[index]`, not
`scan.images[index]`. The "mark all images as uploading" loop (which
today unconditionally sets every `scan.images` row to `'uploading'`) must
filter the same way — otherwise a retried image already at `'uploaded'`
would be flipped to `'uploading'` and never resolved back, since it's
excluded from the filtered call. `UploadResult.total`/progress denominators
use `imagesToUpload.length`, matching the `upload` spec's requirement that
`total` reflect only images actually attempted in that call — confirmed
this has no observable UI regression, since neither `BrowseScans.tsx` nor
`ScanPreview.tsx` reads `UploadResult`'s counts; both recompute their
displayed status directly from a fresh `scan.images` read after upload
completes. A regression test asserting the correct `Image` row receives
each status update — not just that *some* row does — is required (see
`tasks.md`).

### Decision 11: pilot #3 (acquisition-metadata readback) and pilot #61 (audit tooling, now widened) are follow-up tiers, not this one

Both confirmed real (Context) and explicitly requested by the roadmap to be
"decided explicitly, not silently left unaddressed." Confirmed with the
user: neither is in scope for this tier. #3 needs new Python/PyPylon
instrumentation plus a `metadata.json` write-timing design decision
(current behavior writes before capture, specifically so metadata survives
partial failures — post-capture readback data would need either a second
write pass or an explicit decision to accept that tradeoff, which deserves
its own scoped design). #61 needs a scheduled job / ops-tooling design
independent of anything else in this tier — **its scope is now explicitly
widened** (found during review) beyond "detect and report drift" to
include a **reconciliation/write-back capability**: flipping a
historically-corrupted `'uploaded'` image back to a re-uploadable status
once drift is confirmed, and designing whatever lookup strategy (schema
addition, business-key join, or otherwise) that requires. Decision 9
explains why that capability doesn't belong in this tier.

### Decision 12: comment on #79 (all three unmet acceptance criteria, not just one) and file a follow-up for #110's unaddressed asks

Found during review, then found incomplete on a second pass: #79's full
acceptance-criteria list has three items this proposal doesn't satisfy,
all for the same reason (Decision 1's soft-delete-only choice) — "scan
images removed from disk," **"scan removed from database"** (this
proposal sets `deleted: true`, not a row delete), and **"associated
records cleaned up"** (`Image` rows are left completely untouched; the
`Image` model has no `deleted` field of its own). The first pass only
caught the disk-file criterion. `tasks.md`'s comment-on-#79 task now names
all three. Similarly, #110 asks for three things (benchmark 4/8/10
workers, consider configurability, document the rationale) — this tier
only does the third; `tasks.md` files a follow-up issue for the other two
(alongside the already-planned #59/#61/#3 follow-ups).

### Decision 13: `metadata.json`'s `deleted` field gets an explicit absence-handling helper; `markMetadataDeleted` mirrors the existing absolute-path guard

Two small gaps found during review, both cheap to close now:

- No code in this repo currently reads `metadata.json` back in (confirmed
  by grep — this field is inert today, written only for future/external
  consumers such as the eventual #61 audit tooling). The Migration Plan's
  "treat a missing `deleted` key as `false`" guidance was prose-only, with
  no enforcement point. This change adds a one-line helper,
  `isScanMetadataDeleted(json): boolean` (returns `json.deleted === true`),
  next to `ScanMetadataJson` in `scan-metadata-json.ts`, so any future
  consumer has a correct-by-construction way to check the field instead of
  risking an inverted `=== false` check against files that predate it.
- `image-uploader.ts:255-257` already branches on `path.isAbsolute()`
  before resolving `image.path`, because some legacy/pilot-imported scans
  store an absolute path instead of a relative one. `markMetadataDeleted`'s
  path resolution (`path.join(scansDir, scan.path, 'metadata.json')`) must
  mirror that same guard for `scan.path`, not assume it's always relative.

### Decision 14: intended duplicate-check override path is delete-then-rescan; this creates a new, unaddressed cloud-data-integrity gap

`checkDuplicate`'s spec excludes soft-deleted scans, and Part 1 (delete)
and Part 3 (duplicate block) ship in the same tier — so a researcher who
legitimately needs to redo a scan for an already-used `(plant_id,
experiment_id, wave_number, plant_age_days)` key has a working path:
delete the old scan, then rescan. This was an emergent property of two
independently-motivated features, not a stated design decision, until
now — this design doc and the proposal now say so explicitly, so it isn't
silently rediscovered later.

**Known limitation (local UX), deliberately not solved here**: this
conflates "delete because the old scan was bad" with "delete solely to
unblock a legitimate second scan at the same key" (e.g. a QC
re-verification protocol needing two valid scans at one key) — soft-delete
hides the original from `BrowseScans.tsx` either way.

**Known limitation (cloud data integrity), found on a second round of
review and more serious than the local-UX one above**: delete is
soft-delete-only and purely local (Decision 1) — it never touches
Supabase, and per Decision 5 there is no local↔cloud join key even in
principle. So delete-then-rescan at the same key can leave **two
independently-valid, fully-verified (per Decision 7) image sets in cloud
storage**, with no cloud-side marker of which is authoritative and no way
for a downstream consumer querying Bloom directly (not through this
desktop app) to tell them apart. This tier's own upload-verification
hardening makes this worse in one specific sense: both copies will now
reliably *pass* verification and look equally legitimate, whereas today
that's already true. This is not fixable without the same local↔cloud
traceability Decision 5 already defers (a fix would need exactly the kind
of linkage pilot issue #59 asks for), so it is not solved in this tier —
flagged here and as an Open Question so it isn't silently rediscovered
during the #59 follow-up's eventual design, since that follow-up is now
the natural place to also address it.

### Decision 15: disable the Delete button while an upload is in flight for that scan

Found during review: `BrowseScans.tsx`'s Delete button is only disabled
while a delete for that same scan is in flight (`deleteInProgress ===
scan.id`) — it does not check `uploadInProgress === scan.id`, so a user
can click Delete while that scan's upload is actively running. Delete and
upload touch disjoint tables (`Scan`/`metadata.json` vs. `Image`), so
there's no data-corruption path, but the `upload` spec's "Upload Excludes
Soft-Deleted Scans" guarantee is only checked once, at the top of
`uploadScan()` — a delete that lands mid-upload isn't re-checked
per-image, so images could keep uploading for a scan that's now marked
deleted until the in-flight call finishes.

**Chosen:** disable the Delete button while `uploadInProgress === scan.id`
in `BrowseScans.tsx`, matching the existing pattern the Upload button
already uses for the reverse case (`ui-management-pages` spec's "Upload
Progress Indication" scenario already requires "the delete button is
disabled" during upload — this proposal's job is to make the code match
that already-accepted requirement, not to establish new behavior).

### Decision 16: build a minimal one-off success message for this tier; do not depend on an unmerged toast system

Found during review: an open, unmerged PR (`feat/auto-plate-assignment`,
#148) already implements a general-purpose `ToastContext`/`useToast()`
wrapping the whole app. This tier's success-message task (Part 1) was
scoped assuming no toast infrastructure exists anywhere in the renderer —
true of `main` today, but not of everything in flight.

**Chosen:** proceed with a minimal, local success-message affordance in
`BrowseScans.tsx` for this tier, not a dependency on `useToast()` — #148
is unmerged, and its API could still change before landing. Building
against an unmerged PR's interface risks needing rework regardless of
which of the two changes merges first. **Explicit trade-off accepted**: if
#148 merges first, this tier's one-off banner becomes exactly the kind of
duplicate ad hoc UI a real toast system exists to replace, and should be
migrated to `useToast()` in a small follow-up cleanup rather than left as
permanent inconsistency — noted here so that follow-up isn't a surprise.

## Risks / Trade-offs

- **Storage-existence verification adds one to several round-trips per
  uploaded image** (the object_path lookup, the storage check, and up to 3
  bounded retries on a transient failure — Decision 7). Acceptable given
  the confirmed production data-loss history this directly targets; no
  evidence current upload volume makes this a meaningful performance
  concern (worker count stays at 4). Decision 8's explicit `Promise.all`
  await means `uploadScan()` now genuinely waits for all of this work
  before returning, so total call latency increases accordingly — also
  acceptable for the same reason.
- **The exact root cause of the user's past retry-false-success incident
  remains unconfirmed** (Decision 7) — the fix targets the observable
  outcome rather than a pinned-down mechanism, which is deliberately more
  robust to variations in the underlying RPC's behavior but means this
  proposal cannot claim to have identified *why* the old incident happened,
  only that the new verification step would have caught it regardless of
  cause.
- **A verification check that's inconclusive after 3 retries risks a
  duplicate remote row on every subsequent manual retry, not just once**,
  if the underlying cause is persistent rather than transient (Decision
  7's expanded note). Accepted as a residual risk rather than solved with
  a fifth `ImageStatus` value — pilot #61's audit tooling (once built,
  scope widened per Decision 11) is the intended long-term backstop.
- **This tier does not close the historical-corruption gap it originally
  set out to close via retry** (Decision 9, rescoped after review found
  the original design unimplementable). Images already wrongly marked
  `'uploaded'` — including ones uploaded before this tier ships — remain
  invisible until the #61 follow-up (now widened in scope) is built. This
  is a real, acknowledged reduction in this tier's ambition versus its
  first draft, not a silent gap: Decision 7 still closes the bug for all
  future uploads, which is the majority of this tier's value.
- **Delete-then-rescan can orphan two independently-valid image sets in
  cloud storage** with no way to tell which is authoritative (Decision 14)
  — not fixable without the local↔cloud traceability Decision 5 already
  defers to a follow-up.
- **Removing `getMostRecentScanDate` touches files outside the immediate
  delete/upload/duplicate feature areas** (two unit test files, two
  dedicated E2E test blocks across two files) — a deliberate, scoped
  cleanup (Decision 6), not scope creep, since this change's own Part 3
  work is what makes the handler dead. This also removes a currently
  user-facing string ("This plant was already scanned today") that one
  existing E2E test (`plant-barcode-validation.e2e.ts`'s "UI: Duplicate
  Scan Prevention" describe block) asserts on directly — that test needs
  rewriting (including filling in the wave-number/plant-age-days form
  fields the old test never needed) to the new key/message, not just
  deletion, since the *feature* (a duplicate warning) still exists, only
  its trigger condition changed.
- **A one-off success-message banner (Decision 16) may need migrating to
  a real toast system** if PR #148 merges — accepted, not solved here.
- **Tier 1 (PR #280) has already merged to `main`** (confirmed during
  round-2 review, 2026-08-05) — this branch has been rebased onto current
  `main`; the "whichever merges first" coordination language in earlier
  drafts is now resolved, not still pending.

## Migration Plan

No Prisma schema changes. `Scan.deleted` already exists on `main`. The only
schema-shaped change is adding `deleted?: boolean` to the `ScanMetadataJson`
TypeScript interface (an on-disk JSON file shape, not a database table) —
existing `metadata.json` files without the field are still valid; the new
`isScanMetadataDeleted()` helper (Decision 13) is the enforced access point
for that "absence means false" contract rather than leaving it as
unenforced prose. Decision 9's rejection of a local `Image` schema
addition (see its Alternative Considered) means this remains true even
after the redesign — no migration is needed anywhere in this tier.

## Open Questions

Not blocking this proposal's approval — flagged so they aren't lost:

1. **Delete-then-rescan conflates two different researcher intents**
   locally, and separately **orphans indistinguishable duplicate data in
   cloud storage** (Decision 14, both angles) — revisit alongside the #59
   follow-up, which is the natural place a fix for the cloud-side half
   would live.
2. **Soft-delete-only means deleted scans never free disk space** — a
   pre-existing property (Decision 1 matches the pilot and the already-
   accepted spec), not a regression introduced here, but worth surfacing
   given "production-level data integrity" is this roadmap's stated goal
   alongside actually running lab hardware with finite storage.

Follow-up issues for pilot #59, #61, #3, and #110's unaddressed asks
(Decision 12) should be filed once this proposal is approved (tracked in
`tasks.md`) — their content is already fully specified above and in the
proposal, so no further human decision is needed before filing them.
