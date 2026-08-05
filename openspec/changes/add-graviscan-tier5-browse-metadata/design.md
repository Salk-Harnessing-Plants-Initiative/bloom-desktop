## Context

Confirmed directly against the current worktree (`bloom-desktop-tier5-browse-metadata`,
commit `df2de82`), not assumed from the roadmap doc:

- The full GraviScan DB data-layer (`graviscans.*`, `graviscanSessions.*`,
  `graviscanPlateAssignments.*`, `graviPlateAccessions.*`) and the
  wave-metadata-link handlers (`experiments.{link,unlink,list}GraviMetadata`)
  are already registered, preload-exposed, and typed
  (`src/main/database-handlers.ts`, `src/main/preload.ts:184-314`,
  `src/types/electron.d.ts`). This change adds no new IPC handler and no
  migration.
- `ensure-dir`/`list-scan-files` exist as `ipcMain.handle('graviscan:ensure-dir'
, ...)`/`ipcMain.handle('graviscan:list-scan-files', ...)`
  (`register-handlers.ts:397,436`) but are absent from `preload.ts`'s
  `graviAPI` object (grep confirms zero occurrences) and from `GraviAPI` in
  `electron.d.ts`.
- `App.tsx` nests all routes under one `<Route path="/" element={<Layout
mode={mode} />}>`; child route elements are declared directly in
  `App.tsx`'s own JSX with whatever props they need — mode is not passed via
  `Outlet` context, it's simply passed as a prop at the point each route
  element is written (e.g. `<Route index element={<Home mode={mode} />} />`).
  This is the existing convention this change follows for every new route
  element that needs `mode`.
- `WorkflowSteps.tsx`'s `graviScanSteps` array has "Metadata" → `route:
'/experiments'` (an alias, not a distinct page) and "Browse Scans" →
  `route: '/browse-scans'` (CylinderScan's shared route).
  `BrowseScans.tsx` calls `database.scans.list` (its `total` count comes
  from that same paginated response, not a separate `count` method — no
  such method exists on `databaseAPI.scans`) — the CylinderScan `Scan`/
  `Image` models, with zero GraviScan awareness anywhere in that handler
  (`database-handlers.ts` around line 1660) — so a
  GraviScan-mode user visiting `/browse-scans` today sees an empty,
  irrelevant table (confirmed by reading the handler, not inferred).
  `Experiments.tsx`, by contrast, manages `Experiment` records generically
  (name/species/scientist/accession) with no scan-type filtering anywhere —
  it is legitimately shared, not a placeholder standing in for a future
  GraviScan-specific page.
- `ExperimentForm.tsx`'s zod schema has no `experiment_type` field; its
  `onSubmit` never sets one. `experiments.create`'s handler accepts a raw
  `Prisma.ExperimentCreateInput` with no field allow-list, so it _would_
  accept `experiment_type: 'graviscan'` if a caller sent it — only test
  fixtures ever do. No open or closed issue tracked this before #286 (filed
  during this change's scoping).
- `box-backup.ts` shells out to `rclone` against a remote the user
  configures entirely outside this app (`RCLONE_REMOTE = 'Box'`, hardcoded);
  there is no in-app Box connect/setup flow to build here. `runBoxBackup()`
  is only ever called from `uploadAllScans()`
  (`image-handlers.ts:215-268`, `Promise.allSettled` merging Bloom + Box
  results into one response), exposed as the single
  `graviscan:upload-all-scans` handler/`uploadAllScans()` preload method —
  there is no separate Box-specific IPC channel to add or call.
  Zapier's Box-folder-watching Slack bot (issue #248) has zero code-level
  coupling to any of this — confirmed via repo-wide grep — and needs no
  accounting in this UI.
- Main's push-event model already includes session-level
  `onIntervalStart`/`onIntervalComplete`/`onCancelled` listeners
  (`preload.ts:407-485`, forwarded 1:1 from `ScanCoordinator` via
  `wiring.ts:170-205`) that fire once per whole scan session, not per job —
  adequate for a "is a scan currently active" boolean, unlike the
  production branch's 3-second `getScanStatus()` poll, which had no stated
  reason for polling over subscribing.

## Decision 1: Route structure and mode-gating

New routes (`/browse-graviscans`, `/graviscan-experiment/:experimentId`,
`/metadata`) are added as one `{mode === 'graviscan' && (...)}` block in
`App.tsx`, exactly mirroring Tier 1's `/configure-scanner` block — not a
separate dispatcher shell (the production branch's `Scanning.tsx` pattern,
already rejected by the roadmap for the whole project). `ExperimentDetail`'s
route uses `graviscan-experiment/:experimentId` rather than reusing
CylinderScan's `/scan/:scanId`-style naming, to avoid any ambiguity with
`BrowseScans.tsx`'s existing scan-detail concept — these are experiment-level
detail pages over entirely different data.

**Alternative considered and rejected**: nesting Tier 5's routes under
`/browse-scans/*` (matching the production branch's
`navigate('/browse-scans/:id')` for its Experiment Detail link). Rejected
because `/browse-scans` is CylinderScan's own top-level route in this
codebase (unlike the production branch, which deleted it) — nesting under it
would either collide with CylinderScan's existing route tree or require
CylinderScan-side changes this tier has no reason to make.

## Decision 2: Sidebar nav vs. workflow-step routes, kept independently correct

Two distinct fixes, from two distinct pieces of evidence gathered while
scoping this change (both already stated in `proposal.md`'s "What Changes"):
`WorkflowSteps.tsx`'s GraviScan "Metadata"/"Browse Scans" step routes change
because they point at the wrong page (an alias / a CylinderScan-only route);
`Layout.tsx`'s sidebar `alwaysLinks` entry for "Browse Scans" is hidden in
graviscan mode specifically because it is _functionally dead_ there (queries
a table with zero GraviScan rows), not merely because a nicer page now
exists. `Layout.tsx`'s "Experiments" entry is untouched under both
rationales — its target page is neither an alias nor scan-type-filtered.

## Decision 3: `mode` reaches new/modified components via props, not a new Context

Every new or modified renderer file that needs to know the active mode
(`ExperimentForm.tsx`, `Experiments.tsx`) receives `mode` as an ordinary
prop, threaded from `App.tsx` the same way `Home.tsx`/`Layout.tsx` already
do. `BrowseGraviScans.tsx`/`ExperimentDetail.tsx`/`Metadata.tsx` don't need
the prop at all — they're only ever mounted inside the `mode === 'graviscan'`
route block, so their own mode is never in question.

**Alternative considered and rejected**: a new `AppModeContext` consumed via
`useContext` in each component, avoiding prop drilling through
`Experiments.tsx` → `ExperimentForm.tsx`. Rejected as unwarranted
abstraction — there is exactly one level of drilling (`Experiments.tsx`
already renders `<ExperimentForm>` directly and can pass one more prop), no
existing convention in this codebase uses a mode context, and introducing
one here would touch `App.tsx`'s render tree for a problem two prop
declarations already solve.

## Decision 4: `experiment_type` fix scoped to `ExperimentForm.tsx` only; `mode` prop is optional

`ExperimentForm.tsx`'s create payload includes `experiment_type: mode ===
'graviscan' ? 'graviscan' : 'cylinderscan'` (explicit for both branches,
rather than relying on the Prisma default for the cylinderscan case, so the
field's value is never implicit). No backend change: `experiments.create`
already accepts the field unrestricted. This fixes issue #286 exactly at its
root — the only place in the app that ever creates an `Experiment` row.

The new `mode` prop is **optional, defaulting to `'cylinderscan'`** —
existing behavior for every one of `tests/unit/components/ExperimentForm.test.tsx`'s
current render call sites (confirmed: none pass a `mode` prop today), none of
which need to change. `Experiments.tsx` is the only real caller that passes
the actual resolved `mode` explicitly (Decision 3); a default that
reproduces today's exact behavior when the prop is omitted is not a
backwards-compatibility shim for legacy data, it is simply the correct
fallback for "no mode information was provided" — the same value the field
already defaults to today at the Prisma layer.

**Non-goal**: retroactively fixing existing CylinderScan-mode-created
experiments that a lab might, in principle, want to reclassify — no
migration or bulk-edit tooling is in scope; this only fixes new creates
going forward.

**No second accession picker, and it's filtered to GraviScan-eligible
accessions in graviscan mode.** `ExperimentForm.tsx` already has one
required "Accession" dropdown (`accession_id`, existing validation
unchanged). Rather than adding a second, visually-similar "metadata file"
dropdown for the graviscan branch — which would leave two pickers into the
same `Accessions` table on one form, an avoidable source of operator
confusion identified during review — the graviscan branch reuses that same
existing dropdown as the initial wave's metadata-file selection. It adds
only one new field: a wave-number input (default `0`), shown beside the
existing dropdown, only when `mode === 'graviscan'`. On submit, the
graviscan branch creates the experiment with `accession_id` set exactly as
it is today, then calls `linkGraviMetadata(newExperimentId, waveNumber,
accessionId)` using that same already-selected accession — one dropdown,
two consequences (the legacy field write and the new wave link), not two
dropdowns. `Experiments.tsx`'s post-creation "attach" panel and
`ExperimentDetail.tsx`'s "link a new wave" form (Decision 5) are unaffected
by this — they have no pre-existing accession field to reuse, since they
operate on an already-created experiment, so they keep their own dedicated
wave-number + metadata-file picker as originally scoped.

Reusing the dropdown surfaced a second, independent problem, caught during
review and fixed here rather than left implicit: `Accessions` has no
type/kind discriminator (tracked separately as issue #275) — a CylinderScan
barcode-mapping file and a GraviScan metadata file are the same table,
distinguished only by which child relation is populated. The dropdown's
existing data source, `accessions.list()`, is unfiltered by kind, so
without a change a scientist in graviscan mode could select a
CylinderScan-only accession and only discover the mistake after the
experiment is already created, via `linkGraviMetadata`'s rejection ("has no
plate or section data") surfacing as the generic "Experiment created but
metadata link failed" message. **Fix**: in graviscan mode, this dropdown
(and every other wave-metadata-file picker this change adds —
`Experiments.tsx`'s attach panel, `ExperimentDetail.tsx`'s link-a-new-wave
form) sources its options from `graviPlateAccessions.listFiles()` instead
of `accessions.list()`. That handler already filters to `Accessions` rows
with at least one `GraviPlateAccession` child (the same filter
`linkGraviMetadata` itself enforces) — no new backend query, no schema
change, and no dependency on issue #275 being resolved; it only requires
each of these three pickers to call the already-existing,
already-preload-exposed handler instead of the generic one.

## Decision 5: Wave-scoped metadata-link UI — one shared hook, two call sites

`useWaveMetadataLinks(experimentId)` (new, `src/renderer/hooks/`) wraps
`listGraviMetadata`/`linkGraviMetadata`/`unlinkGraviMetadata`, exposing
`{links, linkError, link(waveNumber, accessionId), unlink(waveNumber),
suggestedNextWave}` (the last computed as `max(existing wave numbers) + 1`,
matching the production branch's UX). Used by both `Experiments.tsx` (inline
list under each graviscan experiment, plus its "attach" panel's
graviscan branch) and `ExperimentDetail.tsx` (its own Linked Metadata
section) — extracting one hook rather than duplicating fetch/mutate/error
logic in two files, since both concrete call sites exist within this
change itself (not a hypothetical future one).

`ExperimentForm.tsx`'s create-time link (Decision 4's sibling: setting
`experiment_type` and then, for graviscan, immediately calling
`linkGraviMetadata` using the form's existing required accession selection
and the new wave-number field, defaulting to wave `0`) is a separate,
simpler one-shot call inline in the form's `onSubmit` — it doesn't need the
hook's list/unlink surface, only a single `link()` call after creation
succeeds, with the "Experiment created but metadata link failed: …"
fallback message on failure (matching the production branch's
error-handling pattern, which does not lose the just-created experiment on
a link failure). This call is not conditional on an extra operator choice
— the accession is already a required field on this form, so the link
attempt always fires in graviscan mode.

## Decision 6: Box-backup UX — match production's shape, fix two known gaps

One global "Backup to Box" button in `BrowseGraviScans.tsx` (not
per-experiment — matches production and matches what `uploadAllScans()`
itself does: back up everything server-side finds `pending`/`failed`,
scoped by nothing narrower). States: idle ("Backup to Box"), disabled +
"Backing up…" while the call is in flight, disabled + "Scan in progress…"
while a scan session is active. Result surfaces as a dismissable inline
banner (not a toast — see Decision 7) summarizing uploaded/skipped/failed
counts; per-experiment rows show a "Box X/Y" mini progress indicator,
updated from the same `onUploadProgress` payload (Box's progress fields are
already distinguishable from Bloom's by field name in that single merged
event, per `image-handlers.ts`'s existing `Promise.allSettled` merge — no
new channel needed).

Two deliberate departures from the production branch, both already flagged
in Context:

- **Scan-active detection**: `getScanStatus()` once on mount (correctly
  handles navigating to Browse mid-scan, when a session-start event already
  fired before this component existed) plus subscribing to
  `onIntervalStart`/`onIntervalComplete`/`onCancelled` for live updates
  thereafter — no polling interval.
- **rclone-unavailable messaging**: after a backup call, if
  `result.errors.includes('rclone not installed')`, render "Box backup
  unavailable (rclone not installed)" instead of the generic
  `Box backup completed with N error(s): <errors[0]>` string the production
  branch always shows regardless of cause.

**Explicitly out of scope**: issue #156 (parallel rclone execution — a
backend change with no renderer surface to add) and issue #242 (an orphaned-
DB-row cleanup action — an independent maintenance concern; the new Browse
screen's own correctness doesn't depend on it, and folding it in here would
widen this already-large UI change for an unrelated problem). Both are
named in `proposal.md` so they aren't silently dropped.

## Decision 7: Global upload-progress indicator — inline banner in `Layout.tsx`, not a toast

`UploadStatusContext` (new, `src/renderer/contexts/`) is provided once in
`App.tsx` (wrapping the whole tree, so it survives route changes) and
subscribes to `onUploadProgress` for the lifetime of the app rather than
just while `BrowseGraviScans.tsx` is mounted. `Layout.tsx` renders a small,
dismissable inline status row (below the top nav, same positioning
precedent as Tier 3's `WedgeBanner`) whenever the context reports an
in-flight or just-finished upload, so the operator sees progress/results
even after navigating to Experiment Detail or Metadata mid-upload. This is
an inline banner, consistent with `ui-management-pages/spec.md`'s
"Per-Scanner Remove Button" requirement's "Failure surfaces an inline error
message" scenario, whose note records that "the original spec called for
`useToast.showToast`... the implementation uses the existing inline
`saveError` banner pattern... avoids introducing a new toast
dependency... re-introducing toasts is a future-redo concern" — that note,
specifically, not the requirement's own top-level scenario text (which
permits either a toast or an inline confirmation) — not the production
branch's `ToastContext.tsx`, which the roadmap already excludes
project-wide.

**Alternative considered and rejected**: leaving upload state local to
`BrowseGraviScans.tsx` (deferring the global indicator, as the roadmap left
open). Rejected per explicit user direction during scoping — the concrete
need (browsing away mid-upload and losing visibility) is real and this tier
is where it was scoped, so building it now avoids a component-boundary
rework later once `ExperimentDetail.tsx`/`Metadata.tsx` already exist
without any awareness of in-flight uploads.

## Decision 8: Shared resizable-column hook

`useResizableColumns(initialWidths)` (new, `src/renderer/hooks/`) returns
`{widths, onResizeStart(column)}`, internally using one ref for drag state
(`{column, startX, startWidths}`) and one pair of
`document.addEventListener('mousemove'/'mouseup')` calls attached on
`onResizeStart` and removed on `mouseup` — cleanup also runs on unmount
(via a `useEffect` return), fixing the production branch's `GraviScan.tsx`
divider (no unmount-safety) and its stale-closure bug (reading
`fileBrowserWidth` from a captured closure instead of the ref written
during the drag). `ExperimentDetail.tsx`'s file table is this change's only
call site.

**Alternative considered and rejected**: a drag-resize library (e.g.
`re-resizable`). Rejected — this codebase has no existing drag-resize
dependency, one ~40-line hook covers the one real need here, and Tier 4
(whenever it needs the second production-branch call site, the live-scan
file-browser panel) can reuse this same hook rather than either tier
depending on a new third-party package.

## Decision 9: Unlink requires confirmation; the audit-trail gap it exposes is named, not silently inherited

`unlinkGraviMetadata` deletes a `GraviExperimentWaveMetadata` row outright,
and — per the already-merged `add-wave-scoped-metadata-linking` change's own
`design.md` Open Questions — the table has no history/audit fields, so once
a wave is unlinked and relinked to a different accession, which accession
was actually in effect while that wave's scans were captured becomes
unrecoverable. That gap already existed in the backend before this change;
what this change does is make it reachable by any operator with two clicks
(no confirmation), from two screens (`Experiments.tsx`, `ExperimentDetail.tsx`).
Recorded here explicitly, rather than silently inheriting a
previously-deferred backend risk into a newly one-click-reachable UI action:

- **Unlink requires a `window.confirm()` step** naming the wave number and
  the accession about to be unlinked (e.g. `Unlink wave 2 from
"2026-plates-batch3.xlsx"? This does not preserve a record of what was
linked at scan time.`), matching this codebase's existing convention for
  irreversible actions (`BrowseScans.tsx`'s scan-delete confirmation, same
  `window.confirm()` pattern) — not a new confirmation mechanism. For wave
  `0` specifically (the wave `ExperimentForm.tsx`'s create-time flow always
  links, per Decision 4), the confirmation copy adds one more sentence:
  "This experiment's default accession was originally set to this same
  file; unlinking wave 0 does not change that default." — naming the
  divergence risk from the Open Questions entry below at the one moment an
  operator is about to create it, rather than leaving it fully undocumented
  in the running app.
- This is **not** symmetric with Decision 6's Box-backup button having no
  confirmation: Box backup is idempotent and non-destructive to provenance
  (re-clicking just re-queries `pending`/`failed` scans); Unlink is not
  idempotent with respect to provenance (a relink can silently replace what
  a later reader would believe was authoritative at scan time). Treating
  both the same, on the grounds that the production branch confirms neither,
  would ignore that difference in risk profile.
- **`unlinkGraviMetadata` and `linkGraviMetadata` each write a durable
  `scanLog()` line** (`src/main/graviscan/scan-logger.ts`, the same per-day
  log file Tier 3's wedge auto-pause action already writes to, per that
  tier's own design.md Decision 3) recording `experimentId`, `waveNumber`,
  and — critically, **the accession's file name, not only its id** (e.g.
  `2026-plates-batch3.xlsx`, not just its cuid) — so a human reading the log
  later doesn't have to separately query the database to resolve an opaque
  id before the line means anything. This is the missing piece a
  confirmation dialog alone doesn't provide: the dialog informs the operator
  _in the moment_; the log line is what lets anyone — including the same
  operator's future self — reconstruct _after the fact_ which accession was
  linked to a wave and when it changed, without adding a new DB table or
  migration. It is a small addition to the two existing main-process
  handlers (`database-handlers.ts:915,1018`), not a new IPC handler, so it
  doesn't expand this tier's backend scope beyond what it already touches
  for these handlers' existing logic.
  **Named limitation on this mitigation**: `scan-logger.ts`'s
  `LOG_RETENTION_DAYS` defaults to 180 days — the log line is durable for
  six months by default, not for the life of the experiment. For scientific
  metadata that may be scrutinized during publication or years-later
  reanalysis, this is a materially weaker guarantee than a real DB-level
  history table would provide; it is still strictly better than nothing
  (today's status quo), but should not be read as a permanent record.
- **Explicitly not fixed here**: adding actual link-history/audit rows (the
  archived design's own Open Question 1) — that is a schema change, out of
  scope for a renderer-only tier. The confirmation dialog plus the
  `scanLog()` line are mitigations (make the operator aware in the moment,
  and leave a durable trail afterward), not a fix for the underlying gap —
  neither lets a future reader query "what was linked as of date X" the way
  a real history table would.

## Decision 10: `downloadImages`'s legacy-accession CSV export is a known, named limitation — not fixed here

`src/main/graviscan/image-handlers.ts`'s `downloadImages()` (called
unmodified by `BrowseGraviScans.tsx`'s Download action, Decision 1) resolves
each wave's exported `plates.csv`/`sections.csv` metadata via the
experiment's single legacy `Experiment.accession_id`
(`waveScans[0]?.experiment.accession?.graviPlateAccessions`,
`image-handlers.ts:504`) — **not** the wave-scoped `GraviExperimentWaveMetadata`
link this very change lets an operator create per wave. That line already
carries a comment, from PR #271 (merged 2026-07-30, well before this
change), reading "wave-aware `GraviExperimentWaveMetadata` lookup is
deferred — see proposal's 'Out of scope'" — i.e. a past change anticipated
that whichever tier built the per-wave linking UI would need to name this
gap explicitly. This change does so (see `proposal.md`'s "Out of scope"
list) rather than silently leaving it uncharacterized. **Fixing the actual
CSV generation is still not done here** — that requires a main-process
change to `downloadImages()` beyond this tier's "preload wiring only"
backend scope per the roadmap table, tracked as a follow-up issue (tasks.md
11.3) rather than expanded into this change.

**What this change does add**: a UI-visible warning, not just a design-doc
footnote a researcher will never read. `BrowseGraviScans.tsx`'s per-wave
Download control checks (via `useWaveMetadataLinks`, already fetched for
that experiment) whether the selected wave's linked accession differs from
the experiment's legacy `accession_id`; if it does, the page shows an
inline warning ("This wave's linked metadata differs from the experiment's
default accession — the downloaded CSV will reflect the default accession,
not this wave's link") before the download proceeds, rather than
proceeding silently. This is within scope because the comparison uses data
this change's own `useWaveMetadataLinks` hook already has client-side — no
main-process change, no new IPC call. A silent, undetectable mismatch on a
scientific data-export path is a materially different risk than a named
limitation in a doc no operator opens; the warning doesn't fix the export,
but it stops the operator from unknowingly acting on it.

## Decision 11: `Metadata.tsx` has no internal mode branch

The production branch's `Metadata.tsx` branches on a build-time `APP_MODE`
constant to decide whether to render tabs or a single mode's content
directly. This change's `Metadata.tsx` has no such branch at all — it is
only ever rendered inside the `{mode === 'graviscan'}` route block (Decision
1), so it unconditionally renders `GraviMetadataList` + `GraviMetadataUpload`
with no internal mode check to write, test, or keep in sync with the outer
route gate.

## Risks / Trade-offs

- **Global upload-status context adds one more always-mounted subscriber**
  to `onUploadProgress`, alongside whatever `BrowseGraviScans.tsx` itself
  subscribes to while mounted. Both receive every event; neither
  interferes with the other (IPC event listeners are independent), but it
  is one more thing torn down on unmount/app-quit — covered by this
  change's own tests (Decision 7), not a change to existing upload-handler
  behavior.
- **`useWaveMetadataLinks` fetches on every mount of each call site** (no
  cross-component cache) — `Experiments.tsx`'s list view and
  `ExperimentDetail.tsx` each independently call `listGraviMetadata` for the
  same experiment if both are open in sequence during one session. Accepted
  as the existing convention (no data-fetching cache layer exists anywhere
  else in this codebase either) rather than introducing one for this change
  alone.
- **Box backup's "Backup to Box" button has no per-item retry**, matching
  production — re-clicking re-queries everything still `pending`/`failed`.
  Not changed here; a per-item retry UI is a bigger redesign this tier's
  scope doesn't call for.

## Migration Plan

No database migration. No feature flag — GraviScan mode already gates all
of this behind existing `scanner_mode` configuration, matching every prior
tier.

## Open Questions

- Whether `ExperimentDetail.tsx`'s per-plate verification-status display
  should account for Tier 4's not-yet-built `verify-plates` preload wiring
  landing later (today, with no wiring, every plate's `verification_status`
  simply reads whatever value already exists in the DB — `pending` for
  scans no one has verified yet, which the file table renders as an
  unremarkable default state, not an error). Left open for Tier 4 to close,
  consistent with the roadmap's "Closing the loop" convention of re-checking
  the next tier's scope once this one actually ships.
- `ExperimentDetail.tsx`'s inline TIFF preview is a new caller of the
  existing `readScanImage` path-containment guard
  (`register-handlers.ts:340-364`, validates any `filePath` against
  `getOutputDir()`). The guard is caller-agnostic so it does cover this new
  caller correctly for security purposes, but if a `GraviImage.path` row
  predates a since-changed machine-config output directory, the guard would
  legitimately reject a real, legitimate file with the generic "Path
  outside scan directory" error — not an attack, just a stale-path/
  reconfiguration edge case pre-existing to this change (any current caller
  of `readScanImage` already has this property). Not addressed here; left
  open in case Tier 4 or a future change wants a friendlier "file may have
  moved" message for this specific case.
- `ExperimentForm.tsx`'s create-time flow (Decision 4) writes the same
  selected accession to both `Experiment.accession_id` and wave `0`'s
  `GraviExperimentWaveMetadata` link, so the two agree only by construction
  at creation time — nothing enforces continued agreement afterward. If
  wave `0` is later unlinked/relinked (Decision 9) to a different accession,
  `Experiment.accession_id` stays frozen at its original value, and
  `downloadImages()` (Decision 10) treats `accession_id`, not the current
  wave-0 link, as authoritative — so a relinked wave 0 is exposed to the
  same silent-CSV-mismatch risk Decision 10 names for other waves, not just
  "other waves." Named here and in Decision 9's wave-0 confirmation copy;
  not fixed beyond that (fixing it fully means deciding which field is
  authoritative when they disagree, a real design question with no
  precedent yet in this codebase — a candidate for whoever picks up the
  Decision 10 follow-up issue to resolve alongside it, since both stem from
  the same "legacy field vs. wave-scoped link" divergence).
