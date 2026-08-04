# GraviScan Tier 4 — Core Scan-Operation Screen: Design

**Status:** Approved by user 2026-08-04, ready for OpenSpec proposal scaffolding.
**Roadmap context:** `docs/superpowers/plans/2026-07-30-graviscan-renderer-roadmap.md`,
"### Tier 4 — Core scan-operation screen". Depends on Tiers 1–3 (all merged) and
re-checked against `add-wave-scoped-metadata-linking` (PR #278, merged, archived).

## Context

`main` has zero GraviScan renderer code for capturing a scan. Selecting
GraviScan mode and clicking "Capture Scan" (`WorkflowSteps.tsx`'s graviscan
step 5, route `/capture-scan`) falls through to the catch-all route and
silently redirects Home — confirmed via direct inspection of `App.tsx`
(no `mode === 'graviscan'` route registered for `/capture-scan`) and
`Layout.tsx` (`graviscanLinks` has no "Capture Scan" entry either — the
roadmap's "dead nav-link" framing was only half right: the sidebar link
doesn't exist at all, only the Home-page workflow-step tile is a literal
dead link).

The reference implementation
(`origin/fix/v600-wedge-followups-metadata_propogation_followup`, confirmed
running on rig `graviscan-ms-7c56`) has a full working screen with valuable
UX (predictive cadence warning, graded QR-verification banner, session
restore-on-navigation) but also confirmed bugs this design must not
reproduce: a hardcoded `/tmp` output-dir fallback, fire-and-forget
`cancelScan()`, a divide-by-zero risk in cycle-count math, a state+ref-mirror
pattern shaped like the coordinator livelock found during the backend port,
and a `verifyPlates` status-enum mismatch between the renderer's declared
type and what the live IPC data path actually emits.

Two questions were added to the roadmap's Tier 4 section on 2026-08-04 after
`add-wave-scoped-metadata-linking` merged (PR #278), and were resolved during
this design's clarifying-questions phase (see Decisions below): whether to
thread `waveNumber` through `verify-plates.ts` (issue #162), and whether
`usePlateAssignments` should consume the now-available `listGraviMetadata`
handler for auto-fill (informed by, but going beyond, unmerged draft PR
#212).

## Goals

- A working GraviScan Capture Scan screen: configure a wave, assign plates
  (manually or via metadata auto-fill), start/monitor/cancel a scan
  (single or continuous/interval), see live per-scanner progress, see a
  graded-severity QR-verification result banner after scan completion, and
  restore in-progress-scan UI state across renderer navigation.
- Fix the dead "Capture Scan" workflow-step tile and add the missing
  sidebar nav-link entry, both gated to graviscan mode.
- Reproduce the reference implementation's valuable UX deliberately, with
  tests, avoiding its known bugs — not by copying files.
- Close two real gaps found during design research (not present in the
  reference branch at all): QR verification is not wave-scoped (issue
  #162), and the predictive-cadence calculation is a hardcoded worst-case
  stub rather than deriving from real per-scanner `grid_mode` (a documented
  divergence from the already-accepted spec text).

## Non-Goals

- **True cross-app-restart session persistence.** The reference
  implementation's "restoration across app restart" claim is inaccurate —
  its `scanSession` is an in-memory main-process variable never rehydrated
  in `app.on('ready')`; what actually works is restoration across renderer
  remount/navigation while the main process stays alive. This tier matches
  that real, working behavior and documents the app-restart gap explicitly
  rather than silently promising more. A future tier could add DB-backed
  full-restart durability if an operator incident makes it worth the cost.
- **Upload gating on verification status.** Already explicitly deferred by
  the accepted spec (`scanning/spec.md:3085`, "verification_status does not
  gate uploads"). This tier only displays the graded banner; it does not
  change `graviscan:upload-all-scans` behavior.
- **`ensure-dir`/`list-scan-files` preload wiring.** Tier 5's responsibility
  per the roadmap table.
- Porting `ScannerConfigSection`/`useScannerConfig` (confirmed 1,508 lines
  of dead code on the reference branch via `git grep`) or `ToastContext`
  (this codebase deliberately uses inline banners; see roadmap "Closing the
  loop" section).

## Decisions

### D1 — Hook state: replace ref-mirroring with a reducer

Reference's `useScanSession.ts` declares a parallel `useRef` for nearly
every piece of state used inside its one long-lived `deps: []` IPC-listener
effect, mirrored via separate one-render-lagging effects
(`useEffect(() => { pendingJobsRef.current = pendingJobs }, [pendingJobs])`
for six+ pieces of state). Downstream code then hand-compensates for the
known one-render lag — e.g. `onScanComplete` subtracts 1 from a count read
off `pendingJobsRef.current` because it knows the ref hasn't caught up yet.
This is the same shape (a trusted-stale cache plus a hardcoded correction
for a known staleness window) as the coordinator livelock found during the
backend port, and it silently breaks if two same-scanner completions ever
land before a re-render flushes.

**Decision:** `useScanSession` centralizes `pendingJobs`, `currentCycle`,
`verificationResults`, and `coordinatorState` in a single `useReducer`.
The IPC-listener effect dispatches actions (`JOB_COMPLETE`, `CYCLE_ADVANCE`,
`VERIFY_RESULT`, ...); progress/derived values are computed inside the
reducer from the just-updated state, never from a separately-lagging ref.
One `stateRef` synced by a single effect still exists (unavoidable — the
stable-identity listener closure needs to read current state for
validation, e.g. "is this jobId still pending"), but no code performs
arithmetic that assumes a specific staleness window.

### D2 — Wave-scoped QR verification (issue #162)

`verify-plates.ts`, its IPC handler, and the preload binding all gain an
**optional** `waveNumber?: number` parameter — additive, so the existing
"experimentId scopes both the plate lookup and every DB write" scenario
(`scanning/spec.md:2888`) remains true, unmodified, for any caller that
omits it.

When Tier 4 (the first and only renderer caller) passes `waveNumber`:
1. Resolve `accessionId` via `GraviExperimentWaveMetadata.findUnique({
   where: { experiment_id_wave_number: { experiment_id: experimentId,
   wave_number: waveNumber } } })` — the same lookup `usePlateAssignments`
   already performs for auto-fill (see D3).
2. Scope the `GraviPlateSectionMapping` lookup to
   `plate: { metadata_file_id: accessionId }` directly, instead of the
   existing `plate.metadata_file.experiments.some.id = experimentId`
   filter (which resolves through the legacy single `Experiment.accession_id`
   relation — correct for the pre-#278 model, but not guaranteed to be
   populated for a graviscan experiment using wave-scoped links, and
   imprecise across waves regardless: it would happily match plates from
   *any* accession ever linked to the experiment, not just the current
   wave's).
3. If no `GraviExperimentWaveMetadata` row exists for that
   `(experimentId, waveNumber)`, every plate in the batch is classified
   `lookup_failed` with a clear warning — matching the existing "lookup
   fails" status semantics — rather than silently falling back to
   unscoped, broader matching.

This is a **MODIFIED** delta to the existing "GraviScan Post-Scan Plate
Position Verification" requirement (paste full existing text, add the new
parameter and a new scenario for wave-scoped lookup + the no-link-found
case).

### D3 — Plate auto-fill with manual override

`usePlateAssignments` mirrors the reference's working mechanism: resolve
`accessionId` for the current wave via `listGraviMetadata` (already fully
wired end-to-end — preload, IPC, handler — with zero renderer callers
today), then `graviPlateAccessions.list(accessionId)` to auto-populate
`plantBarcode`/`transplantDate`/`customNote`/`selected` per position.

Two fixes over the reference implementation, whose auto-fill has
**effectively replaced** manual entry once a wave has linked metadata
(confirmed: `plantBarcode` renders as a static `<span>`, not an input, in
`isGraviMetadata` mode; the one remaining editable field, `selected`, has
no protection against being silently overwritten if the auto-fill effect
re-fires for any reason — wave switch, experiment switch, scanner
reconfig — since it unconditionally rebuilds all assignments with no
merge logic):

1. `ScanFormSection.tsx` renders `plantBarcode`/`transplantDate`/
   `customNote` as editable inputs in **both** gravi-metadata and manual
   modes — auto-fill pre-populates, it does not lock the field.
2. The auto-fill effect tracks a per-position `dirty: Set<string>`
   (keyed `` `${scannerId}:${plateIndex}` ``). On any re-fire, positions in
   `dirty` keep the operator's current values; only non-dirty positions get
   freshly auto-filled. `dirty` is cleared when the operator switches wave
   or experiment (a new wave's auto-fill is a fresh start, not tainted by
   the previous wave's edits).

### D4 — Session restore: in-process only

`useScanSession` restores UI state on remount via `getScanStatus()` (the
existing main-process `ScanSessionState`, already includes `waveNumber`
per `src/types/graviscan.ts:451-468`) — the same mechanism the reference
implementation uses, which genuinely works for renderer
navigation/remount while the main process stays alive. No new persistence
layer is added; see Non-Goals for the app-restart gap this leaves, called
out explicitly rather than implied away.

### D5 — Cadence warning: real per-scanner calculation

The already-accepted spec (`ui-management-pages/spec.md:1836`,
"Predictive Cadence Warning on Continuous-Scan Form") says
`platesPerScanner` should derive from each scanner's `grid_mode`. The
reference implementation never does this — `cadenceFallbackPlatesPerScanner()`
is a documented hardcoded stub always returning `4` because its
`ScannerPanelState` doesn't carry `gridMode`.

**Decision:** `main`'s `getScannerStatus()` handler already returns
`gridMode` per scanner today (`src/main/graviscan/scanner-handlers.ts:773-800`,
sourced from the `GraviConfig` singleton — a known port limitation, config
is global rather than truly per-scanner, but the field is populated).
`useScannerStatus`/`ScannerPanelState` carries it through, and
`platesPerScanner` is computed as
`Math.max(...scannerStates.map(s => createPlateAssignments(s.gridMode).length))`
instead of a hardcoded worst case — closing the spec-conformance gap
rather than reproducing it.

## Architecture

```
src/renderer/GraviScan.tsx                                  — screen root
src/renderer/hooks/useScannerStatus.ts                       — polls getScannerStatus(), ScannerPanelState[] incl. gridMode
src/renderer/hooks/useWaveNumber.ts                          — wave selection + "suggested next wave" (getMaxWaveNumber)
src/renderer/hooks/usePlateAssignments.ts                    — plate/position state, wave-metadata auto-fill w/ override (D3)
src/renderer/hooks/useContinuousMode.ts                      — interval/duration form state, cadence estimate wiring
src/renderer/hooks/useScanSession.ts                         — reducer-based session state (D1), start/cancel/verify, restore-on-mount (D4)
src/renderer/hooks/useTestScan.ts                            — single test capture, independent of session state
src/renderer/components/graviscan/ScanControlSection.tsx     — start/cancel/continuous-mode controls
src/renderer/components/graviscan/ScanFormSection.tsx        — plate grid: editable barcode/date/note + selected checkbox (D3)
src/renderer/components/graviscan/ScannerStatusPanel.tsx     — per-scanner live status
src/renderer/components/graviscan/CadenceWarningBanner.tsx   — real gridMode-derived estimate (D5)
src/renderer/components/graviscan/QRVerificationBanner.tsx   — graded severity banner (wave-scoped per D2)
src/renderer/utils/cadenceEstimator.ts                       — pure estimateCycleSeconds(), per accepted spec
```

No `ScannerConfigSection`/`useScannerConfig` port. `WedgeBanner` stays
globally mounted in `Layout.tsx` (unconditionally rendered for
`showGraviscanLinks`, prop-less) — this screen does not re-render or embed
a second wedge banner; it may call `useWedgeEvents()` a second time only if
it needs wedge state inline (e.g. disabling "Start Scan" while a wedge is
active).

### Event model consumption

Tier 2's coordinator emits both snake_case (`scanner_id`, `plate_index`)
and camelCase (`scannerId`, `plateIndex`) fields depending on emission
site (subprocess-relayed vs. coordinator-direct — see `wiring.ts`'s
`GranularScanEvent` and its `resolveScannerId()`/`resolvePlateIndex()`/
`resolveJobId()` fallback helpers). `useScanSession`'s event handlers adopt
the same dual-casing fallback pattern rather than assuming either casing
is always present, since no shared TypeScript type currently pins the
preload-boundary payload shape for renderer consumption.

### Routing / nav

`App.tsx`: add `<Route path="capture-scan" element={<GraviScan />} />`
inside the existing `mode === 'graviscan'` block. `WorkflowSteps.tsx`:
no change needed (route now exists, tile becomes live). `Layout.tsx`:
add a "Capture Scan" entry to `graviscanLinks` (currently absent
entirely, not a stale pointer).

## Known-bug avoidance checklist

- No hardcoded `/tmp` fallback — `getOutputDir()` failure surfaces a
  blocking error banner in both `useScanSession` and `useTestScan`.
- `handleCancelScan` is `async`, awaited by its caller, wrapped in
  try/catch; a rejection surfaces an error banner and the UI does not get
  stuck mid-scan.
- `scanInterval`-equivalent math guards `intervalMs <= 0` before computing
  `totalCycles`, rejecting/clamping rather than producing `Infinity`/`NaN`.
- No ref-mirroring-with-hardcoded-lag-compensation shape (D1).
- `VerifyStatus`/`VerificationStatus` unified to one type matching the
  live IPC contract exactly (`verified | incorrect | unreadable |
  needs_review | duplicate_qr | swapped | lookup_failed | pending |
  skipped`), consumed identically by the DB-persisted and live-event
  paths — no renderer surface silently misses `incorrect` or
  `lookup_failed` the way the reference branch's banner/label logic did.

## OpenSpec deltas anticipated

Almost all renderer-facing behavior here has zero existing spec coverage
(confirmed by exhaustive search of `scanning/spec.md` and
`ui-management-pages/spec.md` — only backend/IPC/DB requirements exist
today for session lifecycle, verify-plates, cancel, and wave-scoping).

- **ADDED** (new capability surface, `ui-management-pages` and/or a new
  `graviscan-capture-scan` capability — decided at proposal-scaffolding
  time): scan-screen composition, QR verification banner UI, plate
  auto-fill/override UX, session-restore-on-navigation UX, test-scan UI,
  cancel-scan UI button, "Capture Scan" nav/workflow-step wiring.
- **MODIFIED**: "GraviScan Post-Scan Plate Position Verification" (D2,
  optional `waveNumber` param + new scenarios), any `ScannerPanelState`-
  adjacent spec text if one exists for Tier 1's Configure Scanner screen
  (checked at proposal time — cadence calc is new, not a Tier 1 spec
  change).

## Testing

TDD per hook/component, matching this repo's existing conventions. New
`verifyPlates`/`onVerifyStarted`/`onVerifyResult`/`onVerifyComplete`
preload bindings get real coverage added to
`tests/e2e/renderer-database-ipc.e2e.ts` — this repo's CI coverage gate
statically scans that file for `db:*`/`graviscan:*` handler calls, so unit
tests alone will not satisfy it. Before calling this merge-ready, run a
live-Electron E2E smoke test of the Capture Scan happy path (start →
progress → complete → verify banner) — unit/mocked tests cannot see
Chromium-specific IPC/custom-protocol behavior, per this project's own
prior incident on IPC-adjacent work.

## Risks / Trade-offs

- Wave-scoped verify-plates (D2) changes lookup precision for the one
  real caller (Tier 4) but is additive at the API boundary — low risk to
  existing callers/tests, which pass no `waveNumber` today.
- The `dirty`-set override mechanism (D3) adds modest state-tracking
  complexity to `usePlateAssignments` beyond the reference's simpler (but
  data-loss-prone) unconditional-overwrite approach — judged worth it for
  operator data safety in a lab setting.
- Session-restore Non-Goal (D4) is an honest scope limitation, not a
  technical blocker — a future tier could add it if an operator incident
  demonstrates the need.

## Open Questions

None outstanding — both roadmap-flagged questions (issue #162 threading,
PR #212-informed auto-fill scope) and two design ambiguities surfaced
during research (session-restore scope, cadence-calc accuracy) were
resolved with the user during this design's clarifying-questions phase.
