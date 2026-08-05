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
- Wave-scoped QR verification (issue #162): when `waveNumber` is supplied,
  the plate *lookup* resolves the wave's linked accession via
  `GraviExperimentWaveMetadata` and scopes the `GraviPlateSectionMapping`
  lookup to that accession directly, rather than the existing
  experiment-wide (legacy single-accession-relation) scope. The
  swap-correction `GraviScan` *write* is scoped to the same wave (via
  `GraviScan.wave_number`, which already exists), so a wave-precise read
  is never paired with an experiment-wide write that could touch another
  wave's scan history — this depends on `useScanSession` actually calling
  `database.graviscans.create(...)` with the real wave number per
  completed job, since no existing caller in the app does this today (the
  real scan lifecycle currently persists no `GraviScan` rows at all —
  there was no renderer to trigger one before this tier). Also exports
  `database-handlers.ts`'s existing (currently un-exported)
  `isValidWaveNumber()` helper for reuse rather than a second copy of the
  same check. `GraviScanPlateAssignment.verification_status` remains
  current-state-only (no `wave_number` column, an existing, separate
  design predating this proposal), and a mis-load that persisted across
  several waves before detection is now corrected only for the wave just
  verified, not retroactively for earlier waves — both accepted, named
  limitations (design.md Decision 2/Risks), not schema changes.
- Plate auto-fill via `listGraviMetadata` (already fully wired,
  zero renderer callers today), with fixes over both the reference
  implementation and draft PR #212: auto-filled fields stay editable
  (not read-only text); manual overrides are derived by comparing
  persisted assignment values against a freshly recomputed auto-fill
  baseline for same-wave re-fires, surviving renderer remount/navigation
  unlike an in-memory dirty flag; and — found during a second review
  round — a genuine wave switch always unconditionally resets to the new
  wave's own fresh computation rather than ever comparing against a
  previous wave's persisted values, closing the PR #216 stale-assignment
  bug for every wave-switch case (not only "no metadata linked").
  Manually entering a barcode triggers the same accession-match lookup
  auto-fill uses, populating transplant date/note (the actual #223 fix,
  not merely a side effect of editable fields).
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
  provides around its existing `useWedgeEvents()` call — both
  `WedgeBanner` and this screen consume the same shared state, rather
  than each independently subscribing (an independent second subscription
  was the first draft's approach; review found it would start blank on
  every navigation back to this screen, silently missing a wedge that
  occurred while the operator was elsewhere).
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
- Affected code: `src/renderer/GraviScan.tsx` (new),
  `src/renderer/hooks/{useScannerStatus,useWaveNumber,usePlateAssignments,
  useContinuousMode,useScanSession,useTestScan}.ts` (new),
  `src/renderer/components/graviscan/*` (new),
  `src/renderer/utils/cadenceEstimator.ts` (new), `src/renderer/App.tsx`,
  `src/renderer/Layout.tsx`, `src/main/graviscan/verify-plates.ts`,
  `src/main/graviscan/register-handlers.ts`, `src/main/preload.ts`,
  `src/types/electron.d.ts`, `src/types/graviscan.ts` (new
  `VerificationStatus` type — no such type exists in this repo today;
  this is a creation, not a "unification" of anything currently present),
  `tests/unit/graviscan/{verify-plates,register-handlers}.test.ts`,
  `tests/unit/hooks/{useScannerStatus,useWaveNumber,usePlateAssignments,
  useContinuousMode,useScanSession,useTestScan}.test.ts` (new, matching
  this repo's existing convention — e.g. `tests/unit/hooks/
  useWedgeEvents.test.ts` — not a `tests/unit/renderer/` prefix, which
  doesn't exist anywhere in this codebase),
  `tests/unit/components/{CadenceWarningBanner,QRVerificationBanner,
  ScanFormSection,ScanControlSection,ScannerStatusPanel}.test.tsx` (new,
  matching e.g. `tests/unit/components/WedgeBanner.test.tsx`),
  `tests/unit/renderer/cadenceEstimator.test.ts` (pure utility, not a
  hook/component — kept separate from the two directories above),
  `tests/unit/pages/{App,Layout,GraviScan}.test.tsx` (existing `App.test.tsx`/
  `Layout.test.tsx` modified, new `GraviScan.test.tsx` — matching e.g.
  `tests/unit/pages/ConfigureScanner.test.tsx`), `tests/e2e/
  graviscan-ipc.e2e.ts` (the actual existing home for `gravi.*` IPC
  round-trip E2E coverage — not `renderer-database-ipc.e2e.ts`, which
  covers the separate `db:*` namespace and its own static coverage gate,
  unrelated to `graviscan:*` handlers).
- **Not affected, left as-is on purpose**: `graviscan:ensure-dir` and
  `graviscan:list-scan-files` preload wiring (Tier 5); `WedgeBanner`/
  `useWedgeEvents` (Tier 3, already globally mounted — this screen
  consumes, does not modify, that mechanism); `ScannerConfigSection`/
  `useScannerConfig` (confirmed dead code, not ported);
  `graviscan:upload-all-scans` (verification status does not gate uploads
  — already explicitly deferred by the accepted spec, unchanged here).
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
