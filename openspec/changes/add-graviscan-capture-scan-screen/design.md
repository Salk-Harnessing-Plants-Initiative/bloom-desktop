## Context

`main` has zero GraviScan renderer code for capturing a scan. Selecting
GraviScan mode and clicking "Capture Scan" falls through to the catch-all
route and silently redirects Home — confirmed via direct inspection of
`App.tsx` (no `mode === 'graviscan'` route for `/capture-scan`) and
`Layout.tsx` (`graviscanLinks` has no "Capture Scan" entry at all, not
merely a stale pointer).

The reference implementation
(`origin/fix/v600-wedge-followups-metadata_propogation_followup`, confirmed
running on rig `graviscan-ms-7c56`) has a full working screen with valuable
UX (predictive cadence warning, graded QR-verification banner, session
restore-on-navigation) but also confirmed bugs this design must not
reproduce: a hardcoded `/tmp` output-dir fallback
(`useScanSession.ts:1257-1259`, `useTestScan.ts:76-78`), fire-and-forget
`cancelScan()` (declared as a synchronous prop type even though the
implementation is `async`, with no try/catch around the awaited IPC call),
a divide-by-zero risk in cycle-count math (`Math.ceil(durationMs /
intervalMs)` with no guard on `intervalMs === 0`), a state+ref-mirroring
pattern in `useScanSession.ts` shaped like the coordinator livelock found
during the backend port, and a `verifyPlates` status-enum mismatch between
the renderer's declared `VerificationStatus` type and what the live IPC
data path actually emits (the renderer's type has an unused `'swapped'`
value and lacks the live-emitted `'duplicate_qr'` and `'lookup_failed'`).

Two questions were added to the roadmap's Tier 4 section on 2026-08-04
after `add-wave-scoped-metadata-linking` merged (PR #278): whether to
thread `waveNumber` through `verify-plates.ts` (issue #162), and whether
`usePlateAssignments` should consume `listGraviMetadata` for auto-fill
(informed by unmerged draft PR #212). Both are resolved below (Decisions 2
and 3).

## Goals / Non-Goals

**Goals:**

- A working GraviScan Capture Scan screen: configure a wave, assign plates
  (manually or via metadata auto-fill), start/monitor/cancel a scan
  (single or continuous/interval), see live per-scanner progress, see a
  graded-severity QR-verification result banner after scan completion, and
  restore in-progress-scan UI state across renderer navigation.
- Fix the dead "Capture Scan" workflow-step tile and add the missing
  sidebar nav-link entry, both gated to graviscan mode.
- Reproduce the reference implementation's valuable UX deliberately, with
  tests, avoiding its known bugs — not by copying files.
- Close two real gaps found during design research, present in neither the
  reference branch nor `main`: QR verification is not wave-scoped (issue
  #162), and the predictive-cadence calculation is a hardcoded worst-case
  stub rather than deriving from real per-scanner `grid_mode` (a
  documented divergence from the already-accepted spec text at
  `ui-management-pages/spec.md:1836`).

**Non-Goals:**

- **True cross-app-restart session persistence.** The reference
  implementation's "restoration across app restart" claim is inaccurate —
  its `scanSession` is an in-memory main-process variable never
  rehydrated in `app.on('ready')` (confirmed: no such logic exists in
  `main.ts`); what actually works is restoration across renderer
  remount/navigation while the main process stays alive. This tier
  matches that real, working behavior and documents the app-restart gap
  explicitly. A future tier could add DB-backed full-restart durability
  if an operator incident makes it worth the cost.
- **Upload gating on verification status.** Already explicitly deferred
  by the accepted spec (`scanning/spec.md:3085`, "verification_status
  does not gate uploads"). This tier only displays the graded banner; it
  does not change `graviscan:upload-all-scans` behavior.
- **`ensure-dir`/`list-scan-files` preload wiring.** Tier 5's
  responsibility per the roadmap table.
- Porting `ScannerConfigSection`/`useScannerConfig` (confirmed 1,508 lines
  of dead code via `git grep`) or `ToastContext` (this codebase
  deliberately uses inline banners; see roadmap "Closing the loop"
  section).

## Decisions

### Decision 1 — Hook state: replace ref-mirroring with a reducer

Reference's `useScanSession.ts` declares a parallel `useRef` for nearly
every piece of state used inside its one long-lived `deps: []`
IPC-listener effect (`pendingJobsRef`, `selectedExperimentRef`,
`waveNumberRef`, `isScanningRef`, `scannerStatesRef`, ...), each mirrored
via a separate `useEffect` that only fires after the render that changed
the source state has committed — i.e. always exactly one render behind.
Downstream code then hand-compensates for the known lag: in
`onScanComplete`, progress is computed by counting jobs still in
`pendingJobsRef.current`, then subtracting 1 because the code "knows" the
just-completed job's removal hasn't reached the ref yet
(`useScanSession.ts:536-548`). This is the same shape — a trusted-stale
cache plus a hardcoded correction for a known staleness window — as the
coordinator livelock found during the backend port, and it silently
breaks if two same-scanner completions land before a re-render flushes
(no assertion checks the ref against the real state for consistency).

**Decision:** `useScanSession` centralizes `pendingJobs`, `currentCycle`,
`verificationResults`, and `coordinatorState` in a single `useReducer`.
The IPC-listener effect dispatches actions (`JOB_COMPLETE`,
`CYCLE_ADVANCE`, `VERIFY_RESULT`, ...); progress/derived values are
computed inside the reducer from the just-updated state, never from a
separately-lagging ref. One `stateRef` synced by a single effect still
exists (the stable-identity listener closure needs to read current state
for validation, e.g. "is this jobId still pending"), but no code performs
arithmetic assuming a specific staleness window.

**Alternatives considered:** keep individual `useState` calls and fix only
the specific `-1` fudge by decrementing inside the `setPendingJobs`
functional updater itself. Rejected as a narrower fix that leaves the
general ref-mirroring shape (and its risk for the *next* piece of state
someone adds) in place — the reducer removes the whole class, not just
today's instance.

### Decision 2 — Wave-scoped QR verification (issue #162)

`verify-plates.ts`, its IPC handler, and the preload binding all gain an
**optional** `waveNumber?: number` parameter — additive, so the existing
"experimentId scopes both the plate lookup and every DB write" scenario
(`scanning/spec.md:2888`) remains true, unmodified, for any caller that
omits it.

When Tier 4 (the first and only renderer caller) passes `waveNumber`:

1. Resolve `accessionId` via
   `db.graviExperimentWaveMetadata.findUnique({ where: {
   experiment_id_wave_number: { experiment_id: experimentId, wave_number:
   waveNumber } } })` — the same lookup `usePlateAssignments` already
   performs for auto-fill (Decision 3).
2. Scope the `GraviPlateSectionMapping` lookup to
   `plate: { metadata_file_id: accessionId }` directly, instead of the
   existing `plate.metadata_file.experiments.some.id = experimentId`
   filter (which resolves through the legacy single `Experiment.
   accession_id` relation — correct for the pre-#278 model, but not
   guaranteed populated for an experiment using wave-scoped links, and
   imprecise across waves regardless: it would match plates from *any*
   accession ever linked to the experiment, not just the current wave's).
3. If no `GraviExperimentWaveMetadata` row exists for that
   `(experimentId, waveNumber)`, every plate in the batch is classified
   `lookup_failed` with a clear warning — matching the existing
   "lookup fails" status semantics — rather than silently falling back to
   unscoped, broader matching.

**Alternatives considered:** defer again (as `add-wave-scoped-metadata-
linking` did), tracked as a follow-up. Rejected per this proposal's user
decision — Tier 4 is exactly the caller that was missing, and the
addition is small and additive.

### Decision 3 — Plate auto-fill with manual override

`usePlateAssignments` mirrors the reference's working mechanism: resolve
`accessionId` for the current wave via `listGraviMetadata` (already fully
wired end-to-end — preload, IPC, handler — with zero renderer callers
today), then `graviPlateAccessions.list(accessionId)` to auto-populate
`plantBarcode`/`transplantDate`/`customNote`/`selected` per position.

Two fixes over the reference implementation (and draft PR #212, whose
`usePlateAssignments.ts` diff is a strict subset of the reference's),
whose auto-fill has **effectively replaced** manual entry once a wave has
linked metadata (confirmed: `plantBarcode` renders as a static `<span>`,
not an input, in `isGraviMetadata` mode; the one remaining editable
field, `selected`, has no protection against being silently overwritten
if the auto-fill effect re-fires for any reason — wave switch, experiment
switch, scanner reconfig — since it unconditionally rebuilds all
assignments with no merge logic):

1. `ScanFormSection.tsx` renders `plantBarcode`/`transplantDate`/
   `customNote` as editable inputs in **both** gravi-metadata and manual
   modes — auto-fill pre-populates, it does not lock the field.
2. The auto-fill effect tracks a per-position `dirty: Set<string>` (keyed
   `` `${scannerId}:${plateIndex}` ``). On any re-fire, positions in
   `dirty` keep the operator's current values; only non-dirty positions
   get freshly auto-filled. `dirty` is cleared when the operator switches
   wave or experiment (a new wave's auto-fill is a fresh start, not
   tainted by the previous wave's edits).

**Alternatives considered:** manual-entry-only, deferring all auto-fill to
Tier 5. Rejected per user decision — `listGraviMetadata` is already fully
wired with no caller, and manual-only would be a real UX regression for
the first working Capture Scan screen.

### Decision 4 — Session restore: in-process only

`useScanSession` restores UI state on remount via `getScanStatus()` (the
existing main-process `ScanSessionState`, already includes `waveNumber`
per `src/types/graviscan.ts:451-468`) — the same mechanism the reference
implementation uses, which genuinely works for renderer
navigation/remount while the main process stays alive. No new
persistence layer is added; see Non-Goals for the app-restart gap this
leaves, called out explicitly rather than implied away.

**Alternatives considered:** build true cross-restart persistence
(persist full session state to DB/disk, rehydrate in `app.on('ready')`,
reconcile orphaned coordinator/subprocess state). Rejected per user
decision as meaningfully larger scope than the reference implementation
ever achieved; revisit only if a real operator incident demonstrates the
need.

### Decision 5 — Cadence warning: real per-scanner calculation

The already-accepted spec (`ui-management-pages/spec.md:1836`,
"Predictive Cadence Warning on Continuous-Scan Form") says
`platesPerScanner` should derive from each scanner's `grid_mode`. The
reference implementation never does this —
`cadenceFallbackPlatesPerScanner()` is a documented hardcoded stub always
returning `4` because its `ScannerPanelState` doesn't carry `gridMode`.

**Decision:** `main`'s `getScannerStatus()` handler already returns
`gridMode` per scanner today (`src/main/graviscan/scanner-handlers.ts:
773-800`, sourced from the `GraviConfig` singleton — a known port
limitation, config is global rather than truly per-scanner, but the field
is populated and matches Tier 1's own documented behavior, per
`ui-management-pages/spec.md:1964-1976`). `useScannerStatus`/
`ScannerPanelState` carries it through, and `platesPerScanner` is computed
as `Math.max(...scannerStates.map(s => createPlateAssignments(s.gridMode).
length))` instead of a hardcoded worst case.

**Alternatives considered:** keep the worst-case-4 stub, file the gap as a
separate follow-up. Rejected per user decision — this tier already
rebuilds `useScannerStatus` from scratch, so carrying `gridMode` through
costs little.

## Architecture

```
src/renderer/GraviScan.tsx                                  — screen root
src/renderer/hooks/useScannerStatus.ts                       — polls getScannerStatus(), ScannerPanelState[] incl. gridMode
src/renderer/hooks/useWaveNumber.ts                          — wave selection + "suggested next wave" (getMaxWaveNumber)
src/renderer/hooks/usePlateAssignments.ts                    — plate/position state, wave-metadata auto-fill w/ override (Decision 3)
src/renderer/hooks/useContinuousMode.ts                      — interval/duration form state, cadence estimate wiring
src/renderer/hooks/useScanSession.ts                         — reducer-based session state (Decision 1), start/cancel/verify, restore-on-mount (Decision 4)
src/renderer/hooks/useTestScan.ts                            — single test capture, independent of session state
src/renderer/components/graviscan/ScanControlSection.tsx     — start/cancel/continuous-mode controls
src/renderer/components/graviscan/ScanFormSection.tsx        — plate grid: editable barcode/date/note + selected checkbox (Decision 3)
src/renderer/components/graviscan/ScannerStatusPanel.tsx     — per-scanner live status
src/renderer/components/graviscan/CadenceWarningBanner.tsx   — real gridMode-derived estimate (Decision 5)
src/renderer/components/graviscan/QRVerificationBanner.tsx   — graded severity banner (wave-scoped per Decision 2)
src/renderer/utils/cadenceEstimator.ts                       — pure estimateCycleSeconds(), per accepted spec
```

No `ScannerConfigSection`/`useScannerConfig` port. `WedgeBanner` stays
globally mounted in `Layout.tsx` (unconditionally rendered for
`showGraviscanLinks`, prop-less) — this screen does not re-render or
embed a second wedge banner; it may call `useWedgeEvents()` a second time
only if it needs wedge state inline (e.g. disabling "Start Scan" while a
wedge is active).

**Event model consumption:** Tier 2's coordinator emits both snake_case
(`scanner_id`, `plate_index`) and camelCase (`scannerId`, `plateIndex`)
fields depending on emission site (subprocess-relayed vs.
coordinator-direct — see `wiring.ts`'s `GranularScanEvent` and its
`resolveScannerId()`/`resolvePlateIndex()`/`resolveJobId()` fallback
helpers). `useScanSession`'s event handlers adopt the same dual-casing
fallback pattern rather than assuming either casing is always present,
since no shared TypeScript type currently pins the preload-boundary
payload shape for renderer consumption.

**Routing / nav:** `App.tsx` adds
`<Route path="capture-scan" element={<GraviScan />} />` inside the
existing `mode === 'graviscan'` block. `WorkflowSteps.tsx` needs no
change (the route now exists; the tile becomes live). `Layout.tsx` adds a
"Capture Scan" entry to `graviscanLinks` (currently absent entirely, not
a stale pointer).

## Known-bug avoidance checklist

- No hardcoded `/tmp` fallback — `getOutputDir()` failure surfaces a
  blocking error banner in both `useScanSession` and `useTestScan`.
- `handleCancelScan` is `async`, awaited by its caller, wrapped in
  try/catch; a rejection surfaces an error banner and the UI does not get
  stuck mid-scan.
- Cycle-count math guards `intervalMs <= 0` before computing
  `totalCycles`, rejecting/clamping rather than producing
  `Infinity`/`NaN`.
- No ref-mirroring-with-hardcoded-lag-compensation shape (Decision 1).
- `VerifyStatus`/`VerificationStatus` unified to one type matching the
  live IPC contract exactly (`verified | incorrect | unreadable |
  needs_review | duplicate_qr | swapped | lookup_failed | pending |
  skipped`), consumed identically by the DB-persisted and live-event
  paths — no renderer surface silently misses `incorrect` or
  `lookup_failed` the way the reference branch's banner/label logic did.

## Risks / Trade-offs

- Wave-scoped verify-plates (Decision 2) changes lookup precision for the
  one real caller (Tier 4) but is additive at the API boundary → low risk
  to existing callers/tests, which pass no `waveNumber` today.
- The `dirty`-set override mechanism (Decision 3) adds modest
  state-tracking complexity to `usePlateAssignments` beyond the
  reference's simpler (but data-loss-prone) unconditional-overwrite
  approach → judged worth it for operator data safety in a lab setting.
- Session-restore Non-Goal (Decision 4) is an honest scope limitation, not
  a technical blocker → a future tier could add it if an operator
  incident demonstrates the need.
- This is the largest tier in the roadmap by file count (6 hooks + 5
  components + screen + backend change) → mitigated by TDD per unit and
  the standard multi-round review-cycling process (see roadmap's
  "Process per tier").

## Migration Plan

No Prisma schema migration needed — `GraviExperimentWaveMetadata` already
exists (added by PR #278). No data backfill required: `waveNumber` is
optional everywhere it's added, so existing rows/callers are unaffected.
Rollout is a single PR; rollback is a plain revert (no schema or data
changes to unwind).

## Open Questions

None outstanding — both roadmap-flagged questions (issue #162 threading,
PR #212-informed auto-fill scope) and two design ambiguities surfaced
during research (session-restore scope, cadence-calc accuracy) were
resolved with the user during this proposal's clarifying-questions phase.
