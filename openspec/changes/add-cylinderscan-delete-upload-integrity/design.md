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
`experiment_id`. The user caught this during review: `plant_id` (a QR-code
barcode) is not guaranteed unique across experiments, so a key without
`experiment_id` could false-positive across unrelated experiments sharing a
barcode scheme, or false-negative isn't possible but the match would be
overly broad. All four fields are required for an exact match.

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
local status to `'uploaded'`. If the object is missing, status becomes
`'failed'` with a distinguishing error message ("upload reported success
but object not found in storage") rather than silently matching the
existing generic failure path — so if this class of bug is ever
reintroduced upstream in bloom-fs, it's diagnosable from local logs alone.

**Alternative considered:** patch bloom-fs's dedup path directly (pilot
#60's primary proposed fix). Rejected for this tier — requires a
`bloom-fs` package change, which (like Decision 5) is outside this repo's
reach without a package version bump and coordination with that package's
maintainers. The caller-side check is pilot #60's own documented
alternative for exactly this situation ("if touching bloom-fs is
undesirable, the same verification can be added in
`app/src/main/imageuploader.ts`'s branch").

### Decision 8: pilot #3 (acquisition-metadata readback) and pilot #61 (audit tooling) are follow-up tiers, not this one

Both confirmed real (Context) and explicitly requested by the roadmap to be
"decided explicitly, not silently left unaddressed." Confirmed with the
user: neither is in scope for this tier. #3 needs new Python/PyPylon
instrumentation plus a `metadata.json` write-timing design decision
(current behavior writes before capture, specifically so metadata survives
partial failures — post-capture readback data would need either a second
write pass or an explicit decision to accept that tradeoff, which deserves
its own scoped design). #61 needs a scheduled job / ops-tooling design
independent of anything else in this tier.

## Risks / Trade-offs

- **Storage-existence verification adds a round-trip per uploaded image.**
  Acceptable given the confirmed production data-loss history this
  directly targets; no evidence current upload volume makes this a
  meaningful performance concern (worker count stays at 4).
- **The exact root cause of the user's past retry-false-success incident
  remains unconfirmed** (Decision 7) — the fix targets the observable
  outcome rather than a pinned-down mechanism, which is deliberately more
  robust to variations in the underlying RPC's behavior but means this
  proposal cannot claim to have identified *why* the old incident happened,
  only that the new verification step would have caught it regardless of
  cause.
- **Removing `getMostRecentScanDate` touches files outside the immediate
  delete/upload/duplicate feature areas** (two unit test files, one
  dedicated E2E file) — a deliberate, scoped cleanup (Decision 6), not
  scope creep, since this change's own Part 3 work is what makes the
  handler dead.
- **No coordination lock with Tier 1** beyond the documented rebase
  discipline (proposal.md Impact) — both branches are in flight
  concurrently; whichever merges first, the other rebases. Disjoint line
  ranges in the same file make a silent merge conflict unlikely but not
  impossible.

## Migration Plan

No Prisma schema changes. `Scan.deleted` already exists on `main`. The only
schema-shaped change is adding `deleted?: boolean` to the `ScanMetadataJson`
TypeScript interface (an on-disk JSON file shape, not a database table) —
existing `metadata.json` files without the field are still valid; consumers
should treat a missing `deleted` key as `false`.

## Open Questions

None blocking. The follow-up issues for pilot #59, #61, and #3 should be
filed once this proposal is approved (tracked as a task in `tasks.md`), but
their content is already fully specified above and in the proposal — no
further human decision is needed before filing them.
