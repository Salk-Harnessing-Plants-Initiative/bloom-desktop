## Why

`main` has zero GraviScan renderer code for capturing a scan. Selecting
GraviScan mode and clicking "Capture Scan" (`WorkflowSteps.tsx`'s graviscan
step 5, route `/capture-scan`) falls through to the catch-all route and
silently redirects Home — confirmed via direct inspection: `App.tsx`
registers no `mode === 'graviscan'` route for `/capture-scan`, and
`Layout.tsx`'s `graviscanLinks` array has no "Capture Scan" entry at all
(not merely a stale pointer — the entry has never existed). This is Tier 4
of `docs/superpowers/plans/2026-07-30-graviscan-renderer-roadmap.md`, the
last renderer-facing tier before Tier 5's Browse/Metadata screens, and it
depends on Tiers 1–3 (all merged) for scanner configuration, the DB
data-layer + granular event model, and the wedge-response banner this
screen must integrate with rather than rebuild.

Two questions were added to the roadmap's Tier 4 section after
`add-wave-scoped-metadata-linking` (PR #278) merged, and are resolved by
this proposal: (1) issue #162 — QR verification (`verify-plates.ts`) has no
`waveNumber` anywhere in its call chain today, and this tier is the first
renderer caller, so it threads `waveNumber` through rather than deferring
again (#162's other ask, case-insensitive plate-id comparison, is already
fixed on `main` by PR #270 — not this proposal's concern); (2) draft PR
#212's prior-art suggests `usePlateAssignments` should consume the
now-available `listGraviMetadata` handler for per-wave auto-fill — this
proposal includes it, going beyond that draft by also fixing a real UX gap
it and the reference implementation both have (see design.md Decision 3),
and by closing three related, currently-open draft PRs' bugs in the same
files this tier rebuilds from scratch: #216 (stale plate assignments
across waves), #213 (scanner status stuck on "Connecting..."), and #223
(dropped transplant_date/custom_note on manual pick).

## What Changes

- New `src/renderer/GraviScan.tsx` screen at route `/capture-scan`
  (`mode === 'graviscan'` gated in `App.tsx`), fixing the dead
  `WorkflowSteps.tsx` tile and adding the missing `graviscanLinks` sidebar
  entry in `Layout.tsx`.
- Six new hooks: `useScannerStatus`, `useWaveNumber`, `usePlateAssignments`,
  `useContinuousMode`, `useScanSession`, `useTestScan` — rebuilt against the
  reference implementation's UX, not ported, to avoid its confirmed bugs
  (hardcoded `/tmp` fallback, fire-and-forget `cancelScan()`,
  divide-by-zero cycle-count math, a ref-mirroring state pattern shaped
  like the coordinator livelock found during the backend port, a
  `verifyPlates` status-enum mismatch between declared type and live
  usage, and — found during this proposal's own review — three related
  bugs from open draft PRs #216/#213/#223 targeting these same hooks).
- Five new presentational components: `ScanControlSection`,
  `ScanFormSection`, `ScannerStatusPanel`, `CadenceWarningBanner`,
  `QRVerificationBanner`, plus a pure `cadenceEstimator.ts` utility — no
  port of the reference's dead `ScannerConfigSection`/`useScannerConfig`
  (confirmed 1,508 lines of unused code via `git grep`).
- **BREAKING**: none. `verifyPlates()`, its IPC handler, and its preload
  binding gain an **optional** `waveNumber` parameter, appended as the
  *last* parameter in each signature (not grouped next to `experimentId`)
  — the only placement that doesn't risk silently rebinding an existing
  positional argument at `verifyPlates()`'s ~50 existing call sites.
  Every existing caller/test that omits it keeps today's behavior
  unchanged.
- **Schema migration (added after review — an earlier draft of this
  proposal claimed none was needed):** `GraviScanPlateAssignment` gains a
  `wave_number Int @default(0)` column and a wave-inclusive unique
  constraint; `GraviScan` gains a unique constraint enabling
  upsert-based, idempotent per-job persistence. Both are small, additive,
  default-backed changes with no data loss to existing rows. See
  design.md's Migration Plan.
- Wave-scoped QR verification (issue #162): when `waveNumber` is supplied,
  the plate *lookup* resolves the wave's linked accession via
  `GraviExperimentWaveMetadata` and scopes the `GraviPlateSectionMapping`
  lookup to that accession directly, rather than the existing
  experiment-wide (legacy single-accession-relation) scope. The
  swap-correction `GraviScan` *write* is scoped to the same wave (via
  `GraviScan.wave_number`, which already exists), so a wave-precise read
  is never paired with an experiment-wide write that could touch another
  wave's scan history — this depends on `useScanSession` actually calling
  `database.graviscans.create(...)` (the existing, unchanged
  renderer-facing method — idempotency is added internally, via the new
  unique constraint above, by changing that handler's own Prisma call to
  an upsert, not by exposing a new method) with the real wave number per
  completed job, since no existing caller in the app does this today (the
  real scan lifecycle currently persists no `GraviScan` rows at all —
  there was no renderer to trigger one before this tier). Also exports
  `database-handlers.ts`'s existing (currently un-exported)
  `isValidWaveNumber()` helper for reuse rather than a second copy of the
  same check.
  `GraviScanPlateAssignment.verification_status` becomes genuinely
  wave-attributable via the same schema column the plate-assignment fix
  below needs anyway (no longer a separate accepted limitation, as an
  earlier draft framed it). A mis-load that persisted across several
  waves before detection is still corrected only for the wave just
  verified, not retroactively for earlier waves — this one remains an
  accepted, named limitation (design.md Decision 2/Risks).
- **Plate auto-fill via `listGraviMetadata`, now wave-scoped at the schema
  level, not by renderer-side inference.** Two prior review rounds each
  found a real bug in a purely renderer-side approach to "did the operator
  override this value" (round 1: an in-memory `Set` that doesn't survive
  remount; round 2: a ref-based wave-switch heuristic that *also* doesn't
  survive remount, and could silently discard a real operator override on
  ordinary navigation — a worse bug than the display glitch it fixed).
  The actual fix: `GraviScanPlateAssignment` gains the `wave_number`
  column named above, so each wave has its own genuinely separate
  persisted row per position — there is no render-history inference left
  to get wrong. Auto-filled fields stay editable (not read-only text);
  manual overrides are detected by comparing the current wave's own
  persisted row against a freshly recomputed auto-fill baseline, correct
  on first load, same-wave re-fires, wave switches, and remounts alike,
  since "which wave's row" is now an explicit parameter rather than
  inferred state. This closes PR #216's stale-cross-wave-assignment bug
  for every case, including a third mechanism found in a later review
  round: a staleness guard discards an out-of-order async response from
  an abandoned wave selection during rapid wave-switching, the same
  guard idiom already used by `useAppMode.ts` elsewhere in this codebase.
  Manually entering a barcode triggers the same accession-match lookup
  auto-fill uses, populating transplant date/note (the actual #223 fix,
  not merely a side effect of editable fields). Also fixes a write
  collision found in review between this feature and Decision 2's
  verification writes to the same table: `graviscanPlateAssignments`'s
  existing upsert handler now preserves `verification_status`/
  `previous_plate_barcode` when a plate-assignment edit's payload doesn't
  carry them, instead of silently resetting a QR-verification result
  every time the operator edits an unrelated field on the same row.
- Session restore scoped honestly to renderer navigation/remount while the
  main process stays alive — matching what the reference implementation's
  "restoration across app restart" claim actually delivers (its
  main-process `scanSession` is in-memory and never rehydrated on
  `app.on('ready')`). True cross-app-restart durability is an explicit
  non-goal (design.md). A renderer-local `localStorage` marker (keyed by
  experiment+wave, set on scan start, cleared on clean completion/cancel)
  surfaces an abandoned session as an informational banner on mount — a
  DB-query-based design was considered and rejected once review found the
  session table it would have queried has no writer anywhere in the app
  and no wave-number column to scope by; the localStorage approach needs
  neither.
- "Start Scan" is disabled while any assigned scanner has an active,
  unacknowledged wedge, via a small `WedgeContext` that `Layout.tsx`
  provides — the `useWedgeEvents()` call moves up from `WedgeBanner.tsx`
  (where it lives today) to `Layout.tsx`, and both `WedgeBanner` and this
  screen consume the shared context instead of each subscribing
  independently (an independent second subscription was the first draft's
  approach; review found it would start blank on every navigation back to
  this screen, silently missing a wedge that occurred while the operator
  was elsewhere).
- Predictive cadence warning computes `platesPerScanner` from each
  scanner's real `gridMode` (already returned by `getScannerStatus()`
  today), closing a spec-conformance gap the reference implementation
  left open (its own `platesPerScanner` is a hardcoded worst-case stub of
  `4`).
- New preload wiring: `verifyPlates` + its `onVerifyStarted`/
  `onVerifyResult`/`onVerifyComplete` events (the only backend/preload
  work this tier needs, per the roadmap's dependency table — `ensure-dir`/
  `list-scan-files` remain Tier 5's).

## Impact

- Affected specs: `scanning` (MODIFIED — "GraviScan Post-Scan Plate
  Position Verification" gains the optional `waveNumber` parameter and
  wave-scoped lookup scenarios); `ui-management-pages` (ADDED — Capture
  Scan screen composition and routing, QR verification banner UI, plate
  auto-fill/override UX, session restore-on-navigation UX, test-scan UI,
  cancel-scan UI, real cadence-calculation wiring).
- Affected code: `prisma/schema.prisma` + a new migration under
  `prisma/migrations/` (`GraviScanPlateAssignment.wave_number` +
  constraint, `GraviScan`'s new unique constraint),
  `src/renderer/GraviScan.tsx` (new),
  `src/renderer/hooks/{useScannerStatus,useWaveNumber,usePlateAssignments,
  useContinuousMode,useScanSession,useTestScan}.ts` (new),
  `src/renderer/components/graviscan/*` (new),
  `src/renderer/components/WedgeBanner.tsx` (modified — its internal
  `useWedgeEvents()` call moves up into a new `WedgeContext`),
  `src/renderer/utils/cadenceEstimator.ts` (new), `src/renderer/App.tsx`,
  `src/renderer/Layout.tsx` (modified — provides `WedgeContext`, adds the
  nav-link entry), `src/main/graviscan/verify-plates.ts`,
  `src/main/graviscan/register-handlers.ts`,
  `src/main/database-handlers.ts` (existing
  `graviscanPlateAssignments.{upsertMany,list}` gain a `waveNumber`
  parameter and preserve `verification_status`/`previous_plate_barcode`
  when a caller's payload omits them; `graviscansCreate` becomes
  upsert-based internally, same external method name/signature),
  `src/main/preload.ts`, `src/types/electron.d.ts`,
  `src/types/graviscan.ts` (new `VerificationStatus` type — no such type
  exists in this repo today; this is a creation, not a "unification" of
  anything currently present),
  `tests/unit/graviscan/{verify-plates,register-handlers,
  database-handlers}.test.ts`,
  `tests/unit/preload-database-graviscan.test.ts` (existing positional
  assertions for `graviscanPlateAssignments.list`/`.upsertMany` need the
  new trailing `waveNumber` argument),
  `tests/e2e/renderer-database-ipc.e2e.ts` (add coverage for the new
  `waveNumber` parameter and `graviscans.create`'s upsert-based
  idempotency — both are `db:*` channels squarely inside this file's
  existing static IPC-coverage gate, unlike `graviscan:verify-plates`),
  `tests/unit/hooks/{useScannerStatus,useWaveNumber,usePlateAssignments,
  useContinuousMode,useScanSession,useTestScan}.test.ts` (new, matching
  this repo's existing convention — e.g. `tests/unit/hooks/
  useWedgeEvents.test.ts` — not a `tests/unit/renderer/` prefix),
  `tests/unit/components/{CadenceWarningBanner,QRVerificationBanner,
  ScanFormSection,ScanControlSection,ScannerStatusPanel,
  WedgeContext}.test.tsx` (new, matching e.g.
  `tests/unit/components/WedgeBanner.test.tsx`),
  `tests/unit/cadenceEstimator.test.ts` (pure utility — this repo's
  convention for such files is a flat path directly under `tests/unit/`,
  e.g. `tests/unit/date-helpers.test.ts`, not a `tests/unit/renderer/`
  subdirectory; an earlier draft of this proposal used that nonexistent
  prefix for this one file while correctly avoiding it everywhere else),
  `tests/unit/pages/{App,Layout,GraviScan}.test.tsx` (existing `App.test.tsx`/
  `Layout.test.tsx` modified, new `GraviScan.test.tsx` — matching e.g.
  `tests/unit/pages/ConfigureScanner.test.tsx`), `tests/e2e/
  graviscan-ipc.e2e.ts` (the actual existing home for `gravi.*` IPC
  round-trip E2E coverage — not `renderer-database-ipc.e2e.ts`, which
  covers the separate `db:*` namespace and its own static coverage gate,
  unrelated to `graviscan:*` handlers).
- **Not affected, left as-is on purpose**: `graviscan:ensure-dir` and
  `graviscan:list-scan-files` preload wiring (Tier 5); `ScannerConfigSection`/
  `useScannerConfig` (confirmed dead code, not ported);
  `graviscan:upload-all-scans` (verification status does not gate uploads
  — already explicitly deferred by the accepted spec, unchanged here).
  **Recommended immediate follow-up, not this tier's scope**:
  `image-handlers.ts`'s `downloadImages`, `box-backup.ts`, and
  `graviscan-upload.ts` all resolve per-wave metadata via the legacy
  single `Experiment.accession_id` relation rather than
  `GraviExperimentWaveMetadata` — a gap `add-wave-scoped-metadata-linking`
  (PR #278) named for two of these three files as pending exactly this
  tier's existence; this tier is what activates it into an observable
  defect (see design.md Non-Goals) but rewiring three existing,
  backend-only, unrelated-to-this-screen files is out of scope here.
- Depends on Tiers 1–3 (all merged: PRs #273, #274, #277) and
  `add-wave-scoped-metadata-linking` (merged PR #278, archived
  `openspec/changes/archive/2026-08-04-add-wave-scoped-metadata-linking/`).
  Unblocks Tier 5 no further than it already was (Tier 5 depends on Tier 2
  + PR #278, not on this change).
- Coordination: a separate concurrent worktree is working Tier 5 (Browse/
  Experiment Detail/Metadata UI) in its own session. Both tiers touch
  `WorkflowSteps.tsx`/`Layout.tsx`, but each only rewires its own named
  workflow step ("Capture Scan" here; "Metadata"/"Browse Scans" there) —
  the same disjoint-hunk pattern Tiers 1–3 already merged through cleanly.
  New-file scope is fully disjoint.
