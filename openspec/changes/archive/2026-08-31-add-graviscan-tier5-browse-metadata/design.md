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

## Decision 12: Closing the styling + spec-conformance gap found after round-22 convergence (2026-08-12)

**Context**: rounds 1-22 of `/review-pr` (tasks.md Sections 13-36) converged
to zero blocking/important findings, but every round reviewed backend logic
(`box-backup.ts`'s duplicate-detection) — none reviewed rendered visual
output. Manually launching the app (per the standing pre-merge walkthrough
checklist) found `BrowseGraviScans.tsx`/`ExperimentDetail.tsx` render as
unstyled, running-together text (1 and 0 Tailwind `className` occurrences
respectively, vs. 29 in the comparably-sized, already-shipped
`BrowseScans.tsx`). Auditing feature-by-feature against the production rig
branch (`fix/v600-wedge-followups-metadata_propogation_followup`) while
investigating found this is not purely cosmetic: several scenarios already
accepted in this change's own `specs/ui-management-pages/spec.md` delta were
never implemented. This decision scopes closing both gaps together, and
draws the line at what's already-accepted vs. genuinely new.

**Already-accepted, unimplemented — fixed as part of this decision, not new
scope**:

- "Per-experiment row content" (`spec.md` line 13-17) requires each
  `BrowseGraviScans` row to show scientist, phenotyper(s), date range,
  image-count breakdown, and resolution/grid mode. Today's row shows none of
  phenotyper(s)/date-range/image-breakdown, and reads resolution/grid mode
  from `scans[0]` only (silently wrong for a multi-scanner experiment with
  mixed settings, and the same bug independently exists in
  `ExperimentDetail.tsx`'s "Metadata summary," `spec.md` line 136-140).
- "Download images for a wave" (`spec.md` line 37-41) requires the page to
  report `downloadImages()`'s result; today the result is discarded.
- "Successful backup reports counts" (`spec.md` line 108-112) requires a
  _dismissable_ inline banner; today's banner has no dismiss control.
- The file table's Acceptance Criteria (`spec.md` line 184) requires scanner/
  wave filter chips to show live counts; today's chips show neither counts
  nor a way to toggle one back off.
- "Column mapping" (`spec.md` line 207-212) requires the upload preview
  table to have color-coded columns; today's preview table is plain.

**Small backend change needed for the first bullet, scoped narrowly**: no
`Experiment.phenotypers` relation exists in `prisma/schema.prisma` — each
`GraviScan` row has its own `phenotyper_id`/`phenotyper` relation instead.
Rather than a schema change, `graviscansBrowseByExperiment`'s existing
`graviScans` include (`database-handlers.ts:389-393`) gains a nested
`phenotyper: true`, and `graviscansExperimentDetail`'s
`db.graviScan.findMany` call (`database-handlers.ts:463-470`, currently no
`include` at all) gains the same. Both renderers already fetch the full
`scans`/`graviScans` array per experiment; phenotyper name(s), date range
(min/max `capture_date`), image-count breakdown (distinct `scanner_id` ×
`plate_index` × `cycle_number` counts), and resolution/grid mode (as a
`Set`, not `[0]`) are then all computed client-side from data already in
hand — no new query, no migration, no new IPC handler or preload method.

**Explicitly still out of scope, not silently dropped**: production's
per-experiment continuous-session interval/duration display. Checked against
the same "Per-experiment row content" scenario this decision otherwise
closes gaps against — that scenario's field list does not include session
cadence/duration at all, so building it now would be adding capability the
spec never asked for (the thing Tier 5's own roadmap section already warns
against treating "production has it" as sufficient justification for), not
closing a gap. If wanted later, it needs its own `ADDED` requirement and
review, once Tier 4's live continuous-mode screen exists to give it a more
natural home.

**Styling**: `BrowseGraviScans.tsx`, `ExperimentDetail.tsx`,
`GraviMetadataUpload.tsx`, and `GraviMetadataList.tsx` are retrofitted to
this codebase's existing Tailwind convention (established in `BrowseScans.tsx`
and surveyed across `Phenotypers.tsx`/`Experiments.tsx`/`Home.tsx`): `p-6`
page wrapper, `bg-white border rounded-lg shadow-sm` cards/containers,
`px-4 py-3` table cells, `hover:bg-gray-50` row states, the existing
green/yellow/red status-color convention, and `DeleteConfirmModal`-style
button treatment. No new shared component is introduced — matching every
existing page, each screen applies utility classes inline; no
theme file or shared `<Button>`/`<Table>` exists anywhere in this codebase to
extract into.

**Convention-alignment additions, not spec-mandated but included under this
decision's "full fix, not partial" framing**: loading states on all three
screens (every comparable shipped page has one; these three are the only
pages in the app without one), a "Clear filters" control and result-count/
page-position text on `BrowseGraviScans.tsx` (already present on its own
sibling `BrowseScans.tsx` — this closes a same-app inconsistency, not a new
UX idea), a "Showing X of Y" / "no images match filters" line on
`ExperimentDetail.tsx`, a "Remove file" control plus a "Parsing file…"
loading state on `GraviMetadataUpload.tsx`, and a loading/failed-to-load
state for `FileRow`'s expanded TIFF preview in `ExperimentDetail.tsx`
(currently: nothing renders while `readScanImage` is in flight or on
failure) — same rationale as the other convention-alignment items, not
tied to a specific accepted scenario.

**Correction found during openspec-review (2026-08-12): the distinct-set
fix needs three refinements, not a bare `Set.join(', ')`** — caught by the
Scientific Rigor reviewer, who found the naive version would be a real
traceability regression, not just an incomplete polish:

1. **Per-scan resolution and phenotyper must also appear in the file
   table.** Today's `FileRow` expanded view already shows `grid_mode` per
   scan but not `resolution`, and shows `scanner_id` but not phenotyper.
   Once the experiment-level summary shows an aggregate ("600, 800 DPI"),
   the file table is the only place left for a researcher to determine
   _which_ scan had _which_ resolution/phenotyper — without this, the fix
   correctly stops showing a silently-wrong single value but removes the
   only path to the real per-scan answer entirely. `FileRow` gains
   `resolution` and `phenotyper.name` alongside its existing per-scan
   fields (Section 39).
2. **Cap the displayed distinct-value list.** Show up to 3 distinct values
   joined with ", "; beyond that, show the first 3 followed by
   "+N more" (e.g. "600, 800, 1200 +2 more") rather than an unbounded
   string. Applies to resolution, grid mode, and phenotyper name lists
   wherever they're rendered as an aggregate (Sections 38, 39).
3. **Visually flag when a field is non-uniform**, not just list the
   values plainly — this is the entire point of fixing the `[0]`-only bug,
   so it must be legible as "this experiment mixes resolutions," not read
   identically to a uniform value. Use the same amber
   attention-color convention as "Needs Review" (not a new color meaning)
   when the distinct-value count is greater than 1, on the resolution/
   grid-mode fields specifically (not on phenotyper, where multiple names
   is the normal case, not an anomaly — every experiment lasting more than
   one scan session plausibly has multiple phenotypers, unlike resolution/
   grid mode, which are configuration values expected to stay constant
   across scanners within one experiment).

**Nullable `cycle_number` in the image-count breakdown**: `GraviScan.
cycle_number` is nullable (single-cycle/non-continuous scans may never set
it). The "scanners × plates × cycles" breakdown counts distinct non-null
`cycle_number` values; if any scan in the experiment has a null
`cycle_number`, the breakdown appends "(+N without a cycle number)" rather
than either treating null as its own distinct bucket (which would silently
inflate the cycle count) or dropping those scans from the total image count
(which would under-report how many images actually exist).

**Round 2 correction found during openspec-review (2026-08-12): five more
refinements, all still on the distinct-value/traceability fix above** —
round 2 re-reviewed round 1's fix itself and found it introduced new,
real gaps rather than just needing documentation polish:

1. **Concrete helper contract, not "whatever 37.4's helper actually
   consumes."** Two distinct, minimal return shapes, not one shape reused
   with a field one caller must remember to ignore — and neither helper
   caps, formats, or decides "+N more": that's a rendering-layer concern
   (item 4 below), so the helpers stay pure and trivially testable.
   `computeDistinctValueSummary(values)` (resolution/grid-mode) returns
   `{values: string[], isMixed: boolean}` — the full, untruncated distinct
   set. `computeNameList(names)` (phenotyper) returns `{values: string[]}`
   — no `isMixed` field at all, since "multiple phenotypers" has no
   anomalous/non-anomalous distinction to carry. Neither returns a
   `hasMore` flag; the rendering layer computes `values.length > 3` itself
   from the full set both helpers already return.
   `BrowseGraviScans.tsx`'s `GraviExperimentRow` interface drops its stale,
   currently-unpopulated `phenotypers?: {name: string}[]` field entirely;
   phenotyper/resolution/grid-mode/date-range/image-breakdown aggregates are
   computed at render time from the raw `graviScans` array (typed with a
   nested `phenotyper: {name: string}` per Section 37.2's Prisma-side
   change), not stored as separate interface fields.
2. **An explicit zero-scans test case, not just the 2-4+ distinct-value
   cases.** `tests/unit/pages/BrowseGraviScans.test.tsx`'s `makeExperiment()`
   fixture defaults `graviScans: []` at all 14 of its current call sites —
   every pre-existing empty-state/pagination/filter/download/box-backup test
   will exercise the new helper against an empty array as soon as it's
   wired in. Each helper has a specified, tested behavior for empty input:
   `{values: [], isMixed: false}` for resolution/grid-mode, `{values: []}`
   for phenotyper, `null` for date range, and a concrete zero-value result
   for the image-count-breakdown helper (`{scannerCount: 0, plateCount: 0,
cycleCount: 0, scansWithoutCycle: 0, totalImages: 0}` or equivalent named
   fields — not just "0 images" as prose) — not an unverified default that
   happens not to crash.
3. **The mixed-value indicator is a distinct neutral marker, not amber —
   and not the same gray this app already uses for a different meaning.**
   `BrowseGraviScans.tsx` already renders an amber "Needs Review" pill
   (`hasNeedsReview`) on the same experiment card that would also carry the
   new mixed-value flag — two amber signals with unrelated meanings on one
   card is a real ambiguity round 1 didn't address. Separately,
   `BrowseScans.tsx`'s existing upload-status convention already uses
   `text-gray-600` as the _default/neutral_ progress-status color (an
   in-progress upload with no error) — the same card's Box/Bloom progress
   indicator (Section 38's styling task) must not reuse that same gray for
   its default state, or it collides with the new marker's meaning too.
   The mixed-value indicator uses a neutral gray badge (`bg-gray-100
text-gray-600`, e.g. a small "≠" or split-values glyph); Box/Bloom
   progress indicators use blue/slate (e.g. `text-blue-600`) for their
   default in-progress state instead of reusing this same gray, reserving
   amber exclusively for "Needs Review" and gray exclusively for "mixed
   values" everywhere on this card. It carries a
   `data-testid="mixed-value-indicator"` so tests can assert its presence
   directly — a semantic marker, not a className assertion, consistent with
   this decision's own styling-verification approach below.
4. **A reveal mechanism for values past the cap.** The rendering layer (not
   the helper — see item 1) caps the inline display at the first 3 values
   from the helper's full set and sets a `title` attribute on the rendered
   element to the full, uncapped comma-joined list — a plain hover tooltip,
   no new interaction pattern (matches this same screen family's existing
   per-cell `title`-attribute convention, e.g. `ExperimentDetail.tsx`'s file
   -table cells). This doesn't replace per-scan drill-down for a researcher
   who needs to know _which_ scan had the hidden 4th value, but it means
   "+N more" is never a dead end — the full list is always one hover away,
   not locked behind expanding every row in the file table.
5. **`FileRow` needs a visible expand affordance, not just expandable
   content.** Today's `FileRow` (`ExperimentDetail.tsx:92-105`) is a bare
   clickable `<div>` with no chevron or other visual cue that it's
   expandable — item 1 above adds resolution/phenotyper to the expanded
   content, but a researcher has no reason to know clicking a row reveals
   anything. Section 39's styling retrofit adds a chevron/expand icon to
   `FileRow` that rotates with `expanded` state; Section 40's styling task
   adds the equivalent rotating chevron to `GraviMetadataList`'s own
   expandable rows — both this addendum's own additions, not a pre-existing
   convention one borrows from the other, so neither depends on the other's
   task-list position.

**Verification approach for styling changes**: Tailwind class additions are
not asserted via className-snapshot tests (no existing test in this codebase
does that, including `BrowseScans.test.tsx`) — they're verified by (1) every
existing/extended behavioral test in Sections 37-41 continuing to pass
unchanged by the visual treatment, and (2) the user's own manual golden-path
walkthrough (tasks.md 12.6, still open), which is what surfaced this gap in
the first place.

**Round 3 correction found during a post-implementation `/review-pr` cycle
(2026-08-12): a duplicate-testid bug, a missing in-flight guard, a false
total-failure report, a persistence bug on the Box-backup banner, and a
narrow timezone edge case in date-range display — fixed, and named here for
the same reason Decision 12's other corrections are**:

1. **`data-testid="mixed-value-indicator"` was shared between the
   resolution and grid-mode fields** on the same card/summary strip —
   confirmed reproducible (an experiment with both fields mixed renders two
   identical testids). Split into
   `mixed-value-indicator-resolution`/`mixed-value-indicator-grid-mode`.
2. **`BrowseGraviScans.tsx`'s Download button had no in-flight guard** —
   a rapid double-click could fire two concurrent `downloadImages` calls
   against the same experiment/wave. Added an `isDownloading` state
   disabling the button while the call is in flight, matching every other
   async action this addendum already guards (Link/Unlink, Import).
3. **A partial download failure (`copied > 0`, `success: false`) was
   reported as a flat "Download failed," dropping the copied count and
   showing only the first of possibly several errors** — falsely implying
   nothing landed on disk. Now reports "Downloaded N of M image(s), K
   error(s): {all errors}" when `copied > 0`, reserving "Download failed"
   for the true `copied === 0` case, and lists every distinct error (not
   just the first), matching this same file's own Box-backup precedent.
4. **The Box-backup result banner auto-cleared failure messages after 4s,
   identically to success** — a real drift from the cited `BrowseScans.tsx`
   precedent (whose separate `error` state has no timer; only its dedicated
   success state auto-clears). This mattered specifically because a Box
   collision/failure needs manual resolution and has no other durable trace
   in this UI (`box_status` isn't surfaced by the "Upload Status" filter,
   which only inspects the Bloom-side `img.status`) — missing the toast left
   zero remaining way to see it. Added a `backupIsError` flag; the
   auto-clear effect now skips failure messages entirely, leaving them
   visible until dismissed.
5. **`formatDateRange`'s date-only display can silently shift by one
   calendar day** for a `capture_date` near a UTC day boundary, in any
   timezone behind UTC (e.g. a scan captured at 11pm Pacific / 6am UTC the
   next day). This isn't a new inconsistency — every other date formatter in
   this codebase (`formatDate` in `ExperimentDetail.tsx`, `BrowseScans.tsx`)
   already converts to local time the same way — but those also show the
   time-of-day, so a late-night local time reads as obviously late-night;
   `formatDateRange`'s date-only summary drops that context, so the shift
   is invisible to the reader. Not fixed (switching to UTC display would
   itself be a new inconsistency against every other date shown in this
   app, and the summary strip is explicitly a coarse aggregate, not the
   precise-instant file-table view `FileRow` already provides per-scan) —
   named as a known, narrow limitation instead, consistent with Decision
   10's own precedent for a similarly-scoped gap.

**Round 4 correction found during the user's own manual walkthrough
(tasks.md 41.3, 2026-08-13) — four real bugs, none caught by any prior
review round or test, because none of them are visible from a unit test's
mocked data or a `git diff` read:**

1. **`ExperimentDetail.tsx`'s "Back to Browse" was a plain
   `<a href="/browse-graviscans">`, not a React Router `Link`.** In the real
   Electron app (renderer served by the webpack dev server), this triggers
   an actual page load instead of client-side routing — the dev server has
   no such HTTP route, producing "Cannot GET /browse-graviscans" and
   leaving the operator stuck outside the SPA entirely. This predates this
   addendum (it's Tier 5's original implementation), but this addendum's
   own Section 39.9 styled this exact line without ever fixing it. Fixed:
   swapped for `<Link to="/browse-graviscans">`, with a regression test
   that renders a real destination route and asserts client-side
   navigation actually occurs (jsdom doesn't implement real navigation, so
   this test only passes for a genuine `Link`).
2. **`FileRow`'s expanded content was still a wall of bare, unlabeled
   `<span>`s** (capture date, transplant date, custom note, plate barcode,
   scanner, grid mode, resolution, phenotyper) — Section 39.9's styling
   pass styled the _wrapper_ around this content but never touched the
   fields themselves, so real data rendered as an illegible run-on string
   (confirmed via screenshot: `"Aug 5, 2026, 12:08 PMAug 4, 2026, 05:00
PMplate_...gridwave1200Alice Williams"`). Fixed: a labeled grid (Capture
   Date / Transplant Date / Plate Barcode / Scanner / Grid Mode /
   Resolution / Phenotyper), matching the summary strip's own
   label-above-value convention, with the image preview shown above it.
3. **Scanner filter chips and the expanded-row "Scanner" field showed the
   raw `scanner_id` UUID** (e.g. `1d51f773-cb96-4a77-808c-7c3ef95ad873`) —
   neither `graviscansExperimentDetail`'s Prisma query nor `GraviScanRow`
   ever fetched the scanner's actual name, only the opaque foreign key.
   Fixed the same way Section 37 added `phenotyper: true`: added
   `scanner: true` to `graviscansExperimentDetail`'s include
   (`database-handlers.ts`), added a `scannerLabel()` helper (prefers
   `display_name`, falls back to `name`, never the id) used by both the
   filter chips and the expanded-row field.
4. **A long filename visually bled into the Plate column** — e.g.
   `"00_1785956913481.tiff00"` rendered as one run-on string, the trailing
   `"00"` actually being the _next column's_ plate value, not part of the
   filename. Root cause: the filename/plate/wave `<span>`s had a `width`
   style but no `overflow`/`white-space` handling, so text longer than its
   column's declared width rendered past the boundary directly into the
   next flex sibling's position instead of being clipped. Fixed: added
   Tailwind's `truncate` (`overflow: hidden; text-overflow: ellipsis;
white-space: nowrap`) plus `flexShrink: 0` to each column span, and a
   `title` attribute on the filename cell so the full name is still
   available on hover — the same reveal-mechanism pattern Decision 12 item
   4 already established for capped aggregate lists.

All four fixed via TDD (failing test confirmed red against the
pre-existing/pre-fix code, then the fix applied) and recorded in
`tasks.md`'s Section 41.3 note. None of the four are reproducible from this
change's existing unit tests' mocked fixtures alone — `Link` vs. `<a>`
looks identical in a static diff read (`Link` renders as an `<a>` in the
DOM), unlabeled `<span>`s pass any test asserting the text is present
_somewhere_, and a missing backend `include` only manifests once real,
longer data is on screen. This is the concrete argument for why Section
41.3's manual walkthrough is a required gate, not a formality this PR could
have skipped once its automated suite was green.

**Sample fixture added for the user's own manual testing of the Metadata
page**: `tests/fixtures/excel/graviscan-metadata-sample.xlsx` (4 plates × 4
sections, 2 distinct accessions, one deliberately-blank optional Custom
Note cell). The 5 pre-existing files in that same directory
(`single-sheet.xlsx`, `multi-sheet.xlsx`, `large-batch.xlsx`,
`edge-cases.xlsx`, `alternative-columns.xlsx`) don't work for this —
they're for a different feature entirely (CylinderScan's
`accession-excel-upload.e2e.ts`, hence column names like `PlantBarcode`/
`GenotypeID` that don't match GraviScan's `Plate ID`/`Section ID`/etc.
schema at all). Per the same "an untested fixture can silently rot" concern
that applies to any checked-in file, added a unit test
(`GraviMetadataUpload.test.tsx`, "imports the checked-in
graviscan-metadata-sample.xlsx fixture end to end") that reads this file
from disk (every other test in that file builds an in-memory workbook
instead) and asserts on the exact plate/section/accession shape the sample
data describes — so a future edit to `REQUIRED_FIELDS`/`OPTIONAL_FIELDS`
or to the sample file itself that breaks the correspondence between them
fails CI, not just a future manual tester.

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

## Decision 13: Closing #313 and #207's validation gap during the user's own manual walkthrough (2026-08-31)

**Context**: the user's own pre-merge manual walkthrough of the Metadata
page (task 41.3, still in progress after Decision 12's Round 4 corrections)
found the page "bare" and asked specifically whether metadata format/order
validation and auto-assignment safety exist, having had real issues with
this in the past. Auditing against the actual production rig branch
(`fix/v600-wedge-followups-metadata_propogation_followup`, confirmed via the
roadmap doc's own citation — not the unrelated, diverged
`feature/graviscan-prod` branch checked first in error) found three
distinct gaps, triaged differently:

1. **`GraviMetadataList.tsx` has no loading/error/empty-state message**
   (unlike `BrowseGraviScans.tsx`/`ExperimentDetail.tsx`/
   `GraviMetadataUpload.tsx`, which all got this treatment under Decision
   12's convention-alignment pass — `GraviMetadataList.tsx` was only in
   scope for that pass's chevron/Delete-button/table styling, Section 40.5),
   and its expanded plate/section table has no column headers at all. Filed
   as [#352](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/352)
   per user request — not fixed in this change.
2. **Auto-assignment (Tier 4, `usePlateAssignments.ts`, already-merged PR
   #289) has no duplicate-plate-ID check and no operator-facing
   assignment-summary banner** the way production's equivalent effect does.
   This is the same class of gap
   [#309](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/309)
   already tracks (that issue's own text says Tier 4 "deliberately deferred
   this") — commented with today's findings, not re-filed, and correctly
   stays a follow-up since Tier 4 is already merged and out of this change's
   diff.
3. **Metadata upload has no format/uniqueness validation at all** — closed
   here, in this change, because it's not a new finding: both
   [#313](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/313)
   (filed 2026-08-07, explicitly scoped to "Tier 5's `GraviMetadataUpload.tsx`
   proposal rather than a standalone change") and
   [#207](https://github.com/Salk-Harnessing-Plants-Initiative/bloom-desktop/issues/207)
   (Tier 5's own origin issue, listed alongside #133/#164 in the roadmap's
   Tier 5 row) already call for exactly this. Confirmed still open: neither
   `graviMetadataValidation.ts` nor any equivalent was ever ported from
   production, and `graviPlateAccessionsCreateWithSections`
   (`database-handlers.ts:751`) still only checked for non-empty strings.

**What "fixing #313/#207" means concretely, split backend/frontend**:

- **Backend** (`graviPlateAccessionsCreateWithSections`): added two new
  pre-transaction checks — a plate can't have two sections sharing a
  `plate_section_id`, and a `plant_qr` can't appear on two different plates
  in one upload. The second is the practical equivalent of #313's "unique
  per (experiment, wave)" ask: `GraviExperimentWaveMetadata`'s existing
  `@@unique([experiment_id, wave_number])` means at most one metadata file
  is ever linked to a given wave at a time, so "unique across one file" and
  "unique per (experiment, wave)" are the same guarantee — the same
  chaining logic #313 itself already uses to explain why constraint 1
  (`plate_id` per file) already covers "`plate_id` per (experiment, wave)."
  Also added the schema-level `@@unique([gravi_plate_id, plate_section_id])`
  #313 proposed (new migration
  `20260831175938_add_plate_section_id_uniqueness`), as defense in depth
  behind the app-level check.
- **Frontend**: ported `graviMetadataValidation.ts`
  (`validatePlateIdPattern` + `validateGraviMetadata`) from production,
  wired into `GraviMetadataUpload.tsx`'s `handleImport()` and run against
  rows built directly from `sheet.rows` — not from the already-grouped
  `plates` structure, which was found to silently keep only the first-seen
  accession per `plate_id` and would have hidden exactly the
  inconsistent-accession case this validation exists to catch. Extended
  beyond production's own version (which only checks `plant_qr` uniqueness
  per plate, confirmed via its own test "allows same plant QR on different
  plates") to also flag the same cross-plate `plant_qr` case the backend
  now rejects, and to flag duplicate `plate_section_id` within a plate —
  so an operator sees a specific, pre-submit error instead of a generic
  backend rejection for either.
- **`validatePlateIdPattern` is what directly answers the "order" concern**:
  `graviPlateAccessionsList` already naturally sorts by `plate_id`
  (confirmed via its own existing test), so plate auto-assignment order is
  more robust than production's (which relies purely on raw upload-row
  order, per its own "First-come-first-served by metadata row order"
  comment) — but that sort is only meaningful if plate IDs share a
  consistent prefix/padding shape in the first place; an inconsistent shape
  (e.g. a `Plate3` typo among `P1`/`P2`/`P4`) defeats natural sort's intent
  even though nothing would crash. This validation is the actual guard
  against that failure mode, not a redundant nicety layered on top of
  sorting that already exists.
