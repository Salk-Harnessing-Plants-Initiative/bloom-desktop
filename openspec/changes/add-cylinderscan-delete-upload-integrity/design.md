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

### Decision 7: independent storage-existence verification, not a narrower targeted patch

Given the uncertainty in Context about the precise internal cause of the
user's retry-false-success incident (the underlying Postgres RPC's dedup
semantics aren't visible from this repo), the fix targets the *outcome*
(local status must reflect ground truth) rather than a guessed mechanism.
After bloom-fs's callback reports success, `image-uploader.ts` uses the raw
Supabase client (`this.supabase`, already instantiated) to independently
verify the object exists in the `images` storage bucket before flipping
local status to `'uploaded'`. If the object is confirmed missing, status
becomes `'failed'` with a distinguishing error message ("upload reported
success but object not found in storage") rather than silently matching
the existing generic failure path — so if this class of bug is ever
reintroduced upstream in bloom-fs, it's diagnosable from local logs alone.

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
known, `ImageUploader` must `select('object_path').eq('id', created)`
against `cyl_images` itself before it can even check storage — and that
query can itself return a null `object_path` (if bloom-fs's own discarded
`updateImageMetadata` call silently failed) or fail outright. Both are
now folded into the three-way outcome in the scenario below.

**Verification has three outcomes, not two — the third (network/lookup
failure during verification itself) matters for correctness.** The
original design only specified "object confirmed present → `'uploaded'`"
and "object confirmed missing → `'failed'`." A transient network failure
during the `object_path` lookup or the storage existence check itself is a
third, distinct case: naively folding it into "missing" would mark a
*genuinely successful* upload `'failed'`, and since Decision 9 (below) only
skips re-sending images already at `'uploaded'`, a `'failed'` status from a
merely-inconclusive check would cause a subsequent retry to fully
re-upload an image whose bytes may already be sitting in storage —
recreating the duplicate-remote-row risk the retry-skip fix exists to
prevent. **Resolution**: on a verification-call failure (not a confirmed-
missing result), retry the verification check itself up to 3 times with a
brief backoff, within the same upload attempt — this is cheap (a read-only
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
intended long-term backstop for anyway.

### Decision 9: retry re-verifies (but does not re-upload) images already marked `'uploaded'`

Found during review: the retry-skip fix (previously "skip already-
`'uploaded'` images on retry," full stop) has a serious interaction with
Decision 7's own verification step. Once this change ships, any image that
was **already** wrongly marked `'uploaded'` by the pre-existing bug (the
exact class of bug pilot #60 and this proposal's motivating incident
describe) becomes permanently unreachable by the new verification logic —
it's already at `'uploaded'`, so retry-skip means it's never looked at
again. Worse, before this change a manual retry at least resent the bytes
(even though it couldn't detect a storage gap either); after this change,
retrying a scan with a historically-corrupted `'uploaded'` image becomes a
silent, falsely-reassuring no-op.

**Chosen:** retry does not re-upload (re-insert metadata, re-send bytes)
for an already-`'uploaded'` image, but it **does** run the same lightweight
storage-existence check (Decision 7) against that image's already-recorded
`object_path` before leaving it at `'uploaded'`. If the object is
confirmed missing, the image is flipped to `'failed'` (making the gap
visible and eligible for a real re-upload on the *next* retry, since it's
no longer at `'uploaded'`); if confirmed present, it's left unchanged; if
the check is inconclusive, apply the same bounded-retry-then-`'failed'`
rule as Decision 7. This closes the "old corruption becomes permanently
invisible" gap using a check this tier is already building, without
reintroducing the duplicate-row risk retry-skip exists to prevent (no
metadata re-insert or byte re-upload happens for these images — only a
read-only existence check).

**Alternative considered:** leave the original retry-skip behavior
(fully untouched, no re-verification) and treat historical corruption as
entirely the audit tool's (#61 equivalent) problem. Rejected — the audit
tool isn't scoped or built yet, and shipping a change that actively closes
off the one remaining accidental detection path (a user-initiated retry)
for a bug class this severe, in the same tier that fixes the bug going
forward, is an avoidable regression for a small amount of additional work.

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

**Chosen:** build an explicit `imagesToUpload` array (the filtered subset)
and have the result/progress callbacks index into `imagesToUpload[index]`,
not `scan.images[index]`. The "mark all images as uploading" loop (which
today unconditionally sets every `scan.images` row to `'uploading'`) must
filter the same way — otherwise a retried image already at `'uploaded'`
would be flipped to `'uploading'` and never resolved back, since it's
excluded from the filtered call. `UploadResult.total`/progress denominators
use `imagesToUpload.length`, matching the `upload` spec's requirement that
`total` reflect only images actually attempted in that call. A regression
test asserting the correct `Image` row receives each status update — not
just that *some* row does — is required (see `tasks.md`).

### Decision 11: pilot #3 (acquisition-metadata readback) and pilot #61 (audit tooling) are follow-up tiers, not this one

Both confirmed real (Context) and explicitly requested by the roadmap to be
"decided explicitly, not silently left unaddressed." Confirmed with the
user: neither is in scope for this tier. #3 needs new Python/PyPylon
instrumentation plus a `metadata.json` write-timing design decision
(current behavior writes before capture, specifically so metadata survives
partial failures — post-capture readback data would need either a second
write pass or an explicit decision to accept that tradeoff, which deserves
its own scoped design). #61 needs a scheduled job / ops-tooling design
independent of anything else in this tier.

### Decision 12: comment on #79 and file a follow-up for #110's unaddressed asks, closing the documentation loop

Found during review: #79's own acceptance criteria include "scan images
removed from disk" — Decision 1 deliberately does the opposite
(soft-delete-only), for good reason, but nothing in this proposal closes
the loop with #79 itself. Similarly, #110 asks for three things
(benchmark 4/8/10 workers, consider configurability, document the
rationale) — this tier only does the third. Both are process gaps, not
design gaps: `tasks.md` now includes commenting on #79 explaining the
soft-delete-only decision and its rationale, and filing a follow-up issue
for #110's unaddressed benchmarking/configurability asks (alongside the
already-planned #59/#61/#3 follow-ups).

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

### Decision 14: intended duplicate-check override path is delete-then-rescan; documenting it, not changing it

`checkDuplicate`'s spec excludes soft-deleted scans, and Part 1 (delete)
and Part 3 (duplicate block) ship in the same tier — so a researcher who
legitimately needs to redo a scan for an already-used `(plant_id,
experiment_id, wave_number, plant_age_days)` key has a working path:
delete the old scan, then rescan. This was an emergent property of two
independently-motivated features, not a stated design decision, until
now — this design doc and the proposal now say so explicitly, so it isn't
silently rediscovered later. **Known limitation, deliberately not solved
here**: this conflates "delete because the old scan was bad" with "delete
solely to unblock a legitimate second scan at the same key" (e.g. a QC
re-verification protocol needing two valid scans at one key) — soft-delete
hides the original from `BrowseScans.tsx` either way. Flagged as an open
question below rather than addressed in this tier.

## Risks / Trade-offs

- **Storage-existence verification adds one to several round-trips per
  uploaded image** (the object_path lookup, the storage check, and up to 3
  bounded retries on a transient failure — Decision 7). Acceptable given
  the confirmed production data-loss history this directly targets; no
  evidence current upload volume makes this a meaningful performance
  concern (worker count stays at 4).
- **The exact root cause of the user's past retry-false-success incident
  remains unconfirmed** (Decision 7) — the fix targets the observable
  outcome rather than a pinned-down mechanism, which is deliberately more
  robust to variations in the underlying RPC's behavior but means this
  proposal cannot claim to have identified *why* the old incident happened,
  only that the new verification step would have caught it regardless of
  cause.
- **A verification check that's inconclusive after 3 retries still risks a
  duplicate remote row on the next full retry**, in the rare case the
  object actually exists but every verification attempt hit a transient
  failure (Decision 7). Accepted as a residual, low-probability risk rather
  than solved with a fifth `ImageStatus` value — pilot #61's audit tooling
  (once built) is the intended long-term backstop for this class of drift,
  which raises that follow-up's practical priority beyond "nice to have"
  now that this tier's own fixes narrow, but don't eliminate, the
  historical-corruption blind spot (see Decision 9).
- **Removing `getMostRecentScanDate` touches files outside the immediate
  delete/upload/duplicate feature areas** (two unit test files, two
  dedicated E2E test blocks across two files) — a deliberate, scoped
  cleanup (Decision 6), not scope creep, since this change's own Part 3
  work is what makes the handler dead. This also removes a currently
  user-facing string ("This plant was already scanned today") that one
  existing E2E test (`plant-barcode-validation.e2e.ts`'s "UI: Duplicate
  Scan Prevention" describe block) asserts on directly — that test needs
  rewriting to the new key/message, not just deletion, since the *feature*
  (a duplicate warning) still exists, only its trigger condition changed.
- **No coordination lock with Tier 1** beyond the documented rebase
  discipline (proposal.md Impact) — both branches are in flight
  concurrently; whichever merges first, the other rebases. Disjoint line
  ranges in the same file make a silent merge conflict unlikely but not
  impossible.

## Migration Plan

No Prisma schema changes. `Scan.deleted` already exists on `main`. The only
schema-shaped change is adding `deleted?: boolean` to the `ScanMetadataJson`
TypeScript interface (an on-disk JSON file shape, not a database table) —
existing `metadata.json` files without the field are still valid; the new
`isScanMetadataDeleted()` helper (Decision 13) is the enforced access point
for that "absence means false" contract rather than leaving it as
unenforced prose.

## Open Questions

Not blocking this proposal's approval — flagged so they aren't lost:

1. **Delete-then-rescan conflates two different researcher intents**
   (Decision 14) — revisit if this friction actually comes up in lab use;
   no evidence yet that it will.
2. **Soft-delete-only means deleted scans never free disk space** — a
   pre-existing property (Decision 1 matches the pilot and the already-
   accepted spec), not a regression introduced here, but worth surfacing
   given "production-level data integrity" is this roadmap's stated goal
   alongside actually running lab hardware with finite storage.

Follow-up issues for pilot #59, #61, #3, and #110's unaddressed asks
(Decision 12) should be filed once this proposal is approved (tracked in
`tasks.md`) — their content is already fully specified above and in the
proposal, so no further human decision is needed before filing them.
