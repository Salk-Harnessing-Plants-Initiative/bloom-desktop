## Why

Tier 5 (see `docs/superpowers/plans/2026-07-30-graviscan-renderer-roadmap.md`,
"Tier 5 — Browse / Experiment Detail / Metadata UI") is the last renderer gap
before a scientist can browse GraviScan data, inspect a single experiment's
plates/scans, and manage per-wave metadata files entirely from the app.
Today, selecting GraviScan mode gives no way to see any of that: `main` has
zero GraviScan renderer code beyond Tier 1's Configure Scanner page. The
DB data-layer this UI reads from is already fully built and preload-exposed
(Tier 2, PR #274) and the wave-scoped metadata-link handlers this UI calls
are already merged and archived (`add-wave-scoped-metadata-linking`, PR
#278) — this change is renderer-only, plus the two small preload-wiring
gaps the roadmap table calls out (`ensure-dir`, `list-scan-files`).

While scoping this tier, direct inspection of `ExperimentForm.tsx` found a
gap the roadmap text hadn't named: no UI path anywhere in the app sets
`experiment_type: 'graviscan'` on experiment creation — every experiment
created through the app today defaults to `'cylinderscan'` (Prisma's schema
default), which silently blocks `linkGraviMetadata` (it requires
`experiment_type === 'graviscan'`) for every real experiment a scientist
creates. Filed as issue #286; fixing it is now in this change's scope as a
prerequisite for the wave-scoped metadata-link UI to have anything real to
link against.

Related issues: #133 (GraviScan 7/7: Renderer UI — this change closes only
its Browse/ExperimentDetail/Metadata subset; the file-deletion half of #133
that assumed a build-time `APP_MODE` fork does not apply, since main never
adopted that architecture, per the roadmap's own decision), #207 (port
GraviMetadataUpload/List — this change covers the upload/mapping/list UI
itself; #207's checklist item to document the spreadsheet schema in
`docs/` is included below. Its other checklist item, adding a spreadsheet
dependency to `package.json`, is satisfied with `exceljs` rather than the
`xlsx` it names — found during implementation that the npm-registry build
of `xlsx` (0.18.5, the only version npm has) carries two unpatched
high-severity CVEs (prototype pollution, ReDoS) SheetJS only fixes via
their own CDN, not npm; `xlsx` is also already a pre-existing transitive
dependency of this repo's `@salk-hpi/bloom-fs` package, so adding it again
directly would compound rather than introduce a new instance of the same
vulnerable library. `exceljs`'s only audit finding is a moderate,
unrelated issue via `uuid`), #164
(per-wave metadata uploads for QR verification — **only partially closed**:
this change ships the _linking_ half via PR #278's handlers, and
deliberately deviates from the literal ask of specifying a wave number
inside the upload flow itself (see "What Changes" below) — but #164's other
two "changes needed" items, QR verification scoped to experiment+wave and
Capture Scan passing a wave number to the verification handler, are
untouched by this change and remain open, tracked under #162), #286 (this
change's own experiment_type fix). Also relevant: #275 (`Accessions` lacks
a type/kind discriminator between CylinderScan mapping files and GraviScan
metadata files) — not fixed here (a schema change), but its practical risk
for this tier's UI is mitigated: every wave-metadata-file picker this
change adds sources its options from `graviPlateAccessions.listFiles()`
(already filtered to GraviScan-eligible accessions), not the generic
unfiltered accession list — see design.md Decision 4.

Checked and found not to require action here: #276 (`experiments.delete`
cascading away wave-links — still inert, since neither this change nor any
other adds a delete action to `Experiments.tsx`); #205 (Metadata/CaptureScan
state loss — filed against a plate-assignment flow this change's
upload/list-only `Metadata.tsx` does not build; likely Tier 4's territory,
noted here only to disambiguate the shared file name); #246/#247 (per-plate
`treatment` column, section-level metadata — future CSV-schema additions to
this same upload flow, tracked separately, not blocking). Also found: draft
PR #210 ("wave-scoped metadata linking — Experiment Detail UI (2/4)",
2026-04-30, still open) targets the same `ExperimentDetail.tsx` feature this
change builds, but depends on PR #196/#209, an earlier whole-file renderer
approach the roadmap explicitly superseded with the current tiered
approach — it appears abandoned/superseded rather than active; worth closing
once this change merges, not a blocker beforehand.

## What Changes

- **New screens** (all gated `{mode === 'graviscan' && (...)}` in `App.tsx`,
  matching Tier 1's `/configure-scanner` pattern — no dispatcher shell):
  - `BrowseGraviScans.tsx` at `/browse-graviscans` — one row per experiment
    (not per scan), server-side paginated, filterable (date range,
    experiment name, accession, upload status), each row showing image-count
    breakdown, resolution/grid mode, per-wave Bloom/Box backup progress, a
    per-experiment wave selector + Download action, and "View Images"
    linking to Experiment Detail.
  - `ExperimentDetail.tsx` at `/graviscan-experiment/:experimentId` —
    metadata summary strip, a Linked Metadata section (list existing
    wave→accession links with Unlink, plus a form to link a new wave),
    scanner/wave filter chips, and a resizable-column file table with
    inline TIFF preview and per-plate verification-status badges.
  - `Metadata.tsx` at `/metadata`, composing new `GraviMetadataUpload.tsx`
    (spreadsheet column-mapping upload flow) and `GraviMetadataList.tsx`
    (expandable per-file list with Delete) — gated purely by the outer
    route's mode check, not a build-time `APP_MODE` branch inside the
    component (the production branch's pattern, explicitly not ported).
- **Wave-scoped metadata-link UI**, consuming PR #278's already-merged
  `experiments.{link,unlink,list}GraviMetadata` handlers:
  - `ExperimentForm.tsx`: when `scanner_mode === 'graviscan'` (an optional
    `mode` prop, defaulting to `'cylinderscan'` so every existing render call
    site is unaffected), sets `experiment_type: 'graviscan'` on create (fixes
    issue #286) and adds a wave-number field (default `0`) next to the
    form's existing required Accession dropdown — reusing that one selection
    for both the legacy `accession_id` write and an immediate
    `linkGraviMetadata` call, rather than adding a second, similar-looking
    accession picker. In graviscan mode, that dropdown's options come from
    `graviPlateAccessions.listFiles()` instead of the generic, unfiltered
    accession list, so it only ever offers GraviScan-eligible metadata files
    (mitigating issue #275's practical risk for this form, without needing
    #275's own schema-level fix). A post-create link failure surfaces as
    "Experiment created but metadata link failed: …" rather than silently
    losing the experiment.
  - `Experiments.tsx`: shows each graviscan experiment's linked waves inline
    (via a shared `useWaveMetadataLinks(experimentId)` hook, also used by
    `ExperimentDetail.tsx`), and branches its existing "attach" panel per
    `experiment_type` — graviscan experiments get a wave-number input (its
    metadata-file dropdown likewise sourced from `graviPlateAccessions.listFiles()`)
    calling `linkGraviMetadata`; cylinderscan experiments keep today's
    `attachAccession` call unchanged. Unlink (in both this screen and
    `ExperimentDetail.tsx`) requires a `window.confirm()` step naming the
    wave/accession about to be unlinked and stating that history isn't
    retained — this is not idempotent the way Box backup's no-confirmation
    button is, since it can erase which accession was in effect at scan time
    (a gap already flagged, but not fixed, by PR #278's own design doc).
    Both `linkGraviMetadata` and `unlinkGraviMetadata` also write a durable
    `scanLog()` line (experiment, wave, accession) so the action leaves a
    trail beyond the transient confirmation dialog, matching Tier 3's own
    precedent for auto-pause actions (see design.md Decision 9).
- **Box backup UI** in `BrowseGraviScans.tsx`: one global "Backup to Box"
  button (idle / "Backing up…" / disabled+"Scan in progress…"), driven by
  the existing `uploadAllScans()`/`onUploadProgress` channel (Box progress
  is already merged into that same event by field name, no new IPC needed).
  Two fixes over the production branch's version: (1) scan-active detection
  uses one `getScanStatus()` call on mount plus subscribing to
  `onIntervalStart`/`onIntervalComplete`/`onCancelled`, not a 3-second poll
  loop; (2) an `errors.includes('rclone not installed')` check renders
  "Box backup unavailable (rclone not installed)" instead of a generic error
  string, since that failure reaches the renderer as plain data today but
  nothing gives it a friendly message.
- **Global upload-progress indicator**: a small `UploadStatusContext`
  (inline banner in `Layout.tsx`, not a toast — matching the documented
  precedent in `ui-management-pages/spec.md`'s "Per-Scanner Remove Button"
  requirement, whose "Failure surfaces an inline error message" scenario
  note explicitly records this codebase moving away from a toast for that
  same reason) so upload/backup progress stays visible while the operator
  navigates away from Browse mid-upload.
- **Shared resizable-column hook**: `useResizableColumns` (new,
  `src/renderer/hooks/`), replacing the production branch's imperative
  `document.addEventListener('mousemove'/'mouseup')` pattern (duplicated
  there in `ExperimentDetail.tsx` and `GraviScan.tsx`) with one ref-based,
  unmount-safe implementation. Only `ExperimentDetail.tsx` uses it in this
  change — the second duplicate site is in production's combined scan
  screen, which is Tier 4's territory, not this one's.
- **Nav/routing fixes** (the cross-cutting section's Tier-5-owned entries):
  - `WorkflowSteps.tsx`'s `graviScanSteps`: "Metadata" now points to
    `/metadata` (was `/experiments`, an alias) and "Browse Scans" now
    points to `/browse-graviscans` (was `/browse-scans`, CylinderScan's
    shared, mode-blind route).
  - `Layout.tsx`'s `graviscanLinks`: adds "Metadata" and "Browse GraviScans"
    nav entries; the shared "Browse Scans" link (querying
    CylinderScan-only `Scan`/`Image` data, confirmed to always be
    empty/irrelevant for a GraviScan-mode user) is hidden specifically in
    graviscan mode. "Experiments" is untouched — `Experiment` records
    aren't scan-type-specific and remain relevant in both modes.
- **Preload wiring** for the two handlers already implemented but not yet
  exposed: `graviAPI.ensureDir`/`graviAPI.listScanFiles` in `preload.ts`,
  plus their `GraviAPI` type declarations in `electron.d.ts`. (Confirmed:
  these sit under the `graviscan:*` channel prefix, not `database.*`/
  `db:*`, so they are outside the 90% IPC-coverage gate script's scope —
  no `renderer-database-ipc.e2e.ts` entry is required for them.)
- **Known-bug avoidance** (per the roadmap's validation target): does not
  reproduce the production branch's `document.body.style.cursor`-leaking
  drag-resize duplication (fixed by the shared hook above), does not port
  1,508 dead lines of `ScannerConfigSection`/`useScannerConfig`, and does
  not adopt the build-time `APP_MODE` dispatcher pattern anywhere in these
  new screens.
- **Out of scope, explicitly deferred, not silently dropped**: issue #156
  (parallel rclone uploads — backend-only, no renderer surface to build);
  issue #242 (orphaned-row cleanup UI — an independent maintenance concern,
  not something the new Browse screen needs in order to work); issue #162
  (QR-verification wave-scoping — no renderer caller exists yet regardless,
  per PR #278's own proposal); Tier 4's `verify-plates` preload wiring and
  its status-value handling (a different tier's backend gap, not this
  change's); `downloadImages()`'s CSV export resolving each wave's
  plates/sections via the experiment's legacy `Experiment.accession_id`
  rather than this change's own new wave-scoped `GraviExperimentWaveMetadata`
  links (`image-handlers.ts:501-505`, a gap a prior PR's own comment already
  named as belonging in "the proposal's Out of scope" — named here, not
  fixed, since fixing it means a main-process change beyond this tier's
  preload-wiring-only backend scope; see design.md Decision 10 — to be
  tracked as a follow-up issue). The export bug itself isn't fixed, but it
  isn't shipped silent either: `BrowseGraviScans.tsx`'s Download control
  shows an inline warning when the selected wave's linked accession differs
  from the experiment's legacy accession, using data this change's own
  `useWaveMetadataLinks` hook already has — see design.md Decision 10.

## Impact

- Affected specs:
  - `ui-management-pages` — adds requirements for Browse GraviScans,
    Experiment Detail, Metadata Upload, Metadata List, Box Backup UI, and
    Global Upload-Progress Indicator; modifies "Create Experiment" and
    "Attach Accession to Existing Experiment" to describe the graviscan-mode
    branch.
  - `scanning` — modifies "Mode-Aware Routing", "Mode-Aware Home Page",
    "Mode-Aware Navigation", "GraviScan Preload Context Bridge", and
    "GraviScan Type Definitions for Preload API" to reflect the new routes/
    nav entries and the two newly-exposed preload methods.
- Affected code: `src/renderer/App.tsx`, `src/renderer/Layout.tsx`,
  `src/renderer/components/WorkflowSteps.tsx`,
  `src/renderer/components/ExperimentForm.tsx`, `src/renderer/Experiments.tsx`,
  new `src/renderer/BrowseGraviScans.tsx`, `src/renderer/ExperimentDetail.tsx`,
  `src/renderer/Metadata.tsx`, `src/renderer/components/
GraviMetadataUpload.tsx`, `src/renderer/components/
GraviMetadataList.tsx`, new `src/renderer/hooks/useResizableColumns.ts`,
  new `src/renderer/hooks/useWaveMetadataLinks.ts`, new
  `src/renderer/contexts/UploadStatusContext.tsx`, `src/main/preload.ts`,
  `src/main/database-handlers.ts` (adds a `scanLog()` line each to the
  existing `linkGraviMetadata`/`unlinkGraviMetadata` handlers — no new
  handler, no signature change),
  `src/types/electron.d.ts`, `package.json` (adds the `exceljs` dependency
  for `GraviMetadataUpload.tsx`'s spreadsheet parsing — see "Why" above for
  why `exceljs` instead of issue #207's originally-named `xlsx`), new
  `docs/graviscan-metadata-spreadsheet-schema.md` (documents the expected
  spreadsheet columns, per issue #207).
- **Not affected, left as-is on purpose**: `src/main/box-backup.ts`,
  `src/main/graviscan/image-handlers.ts`'s `uploadAllScans()`,
  `src/main/graviscan/register-handlers.ts`'s existing `ensure-dir`/
  `list-scan-files` handler bodies — all backend logic is already correct;
  this change only wires the missing preload surface and consumes the
  existing handlers.
- **No coordination needed** with the two other in-flight worktrees
  (`bloom-desktop-cylinderscan-finalize`, `bloom-desktop-retry-scanner-status`)
  or with Tier 4 (unstarted) — this change touches none of
  `session-handlers.ts`/`scan-coordinator.ts`, the shared-file concern noted
  elsewhere in the roadmap for Tier 4/#281/#283.

## Addendum (2026-08-12): styling and spec-conformance completion

After round-22 `/review-pr` convergence (tasks.md Section 36), a manual
pre-merge walkthrough found `BrowseGraviScans.tsx`/`ExperimentDetail.tsx`
render essentially unstyled — every prior review round audited backend logic
(`box-backup.ts`), none audited rendered output. Auditing feature-by-feature
against the production rig branch while investigating found this wasn't
purely cosmetic: several scenarios already `ADDED` in this change's own
`specs/ui-management-pages/spec.md` delta (per-experiment row content's
phenotyper/date-range/image-breakdown fields, resolution/grid-mode display,
download-result reporting, dismissable backup banner, live filter-chip
counts, color-coded upload-preview columns) were never implemented. This
addendum — see `design.md` Decision 12 and `tasks.md` Sections 37-41 — closes
those already-accepted gaps, fixes the resolution/grid-mode "first scan
only" correctness bug found in the process, retrofits this codebase's
established Tailwind convention (`BrowseScans.tsx`) to all four affected
files, and adds a small, scoped `graviScans`-include change
(`database-handlers.ts`) for phenotyper data — no schema change, no new IPC
handler. Explicitly excluded: production's per-experiment continuous-session
interval/duration display, which is not named in any accepted scenario and
would be new capability, not a gap-fill (see Decision 12).
