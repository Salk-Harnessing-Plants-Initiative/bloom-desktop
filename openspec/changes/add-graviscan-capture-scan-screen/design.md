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

Issue #162 has two asks: wave-scoping the plate lookup, and
case-insensitive `plate_id` comparison. Only the first is this proposal's
concern — the second was already fixed on `main` by PR #270 (confirmed via
`git log -- src/main/graviscan/verify-plates.ts`, the only commit touching
that file; all plate-id comparisons already lower-case both sides), so
Decision 2 below scopes to wave-scoping alone.

Three open draft PRs were found during review to target files this
proposal rebuilds from scratch, and are triaged into the relevant
Decisions/checklist below rather than silently left unaddressed: **#216**
("stale plate assignments shown on wave with no linked metadata" —
`usePlateAssignments`, see Decision 3), **#213** ("scanner status stuck on
'Connecting...' until tab switch" — `useScannerStatus`, see Known-bug
avoidance checklist), and **#223** ("transplant_date/custom_note dropped
on manual barcode pick" — `usePlateAssignments`, see Decision 3).

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

`verify-plates()`, its IPC handler, and the preload binding all gain an
**optional** `waveNumber?: number` parameter, appended as the **last**
parameter (after `onProgress`) in every one of these signatures — not
grouped conceptually next to `experimentId`. This is a deliberate,
non-obvious placement: `verifyPlates()` is called positionally, never via
an options object, at roughly 50 sites in
`tests/unit/graviscan/verify-plates.test.ts` plus an exact positional
mock-assertion in `tests/unit/graviscan/register-handlers.test.ts`
(`toHaveBeenCalledWith(mockDb, plates, 'exp-1', outputDir, expect.any(Function))`).
Inserting `waveNumber` any earlier than the end would silently rebind an
existing positional argument (e.g. `scanOutputDir` sliding into the
`waveNumber` slot) and break every one of those call sites — appending it
last is the only placement that is genuinely additive for a
positionally-called function. Validation reuses
`database-handlers.ts`'s existing `isValidWaveNumber()` helper (non-negative
32-bit integer) rather than a second, potentially divergent copy of the
same check.

This keeps the existing "experimentId scopes both the plate lookup and
every DB write" scenario (`scanning/spec.md:2888`) true, unmodified, for
any caller that omits `waveNumber`.

When Tier 4 (the first and only renderer caller) passes `waveNumber`:

1. Resolve `accessionId` via
   `db.graviExperimentWaveMetadata.findUnique({ where: {
   experiment_id_wave_number: { experiment_id: experimentId, wave_number:
   waveNumber } } })` — the same lookup `usePlateAssignments` already
   performs for auto-fill (Decision 3).
2. Scope the `GraviPlateSectionMapping` **lookup** (read side) to
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
4. **Scope the swap-correction `GraviScan` write to the same wave.**
   Making the lookup wave-precise while leaving its downstream writes
   experiment-wide (as they are today, `verify-plates.ts:665-730`) creates
   a new risk this proposal would otherwise introduce, not just inherit: a
   swap detected using wave 3's roster could rewrite `GraviScan` rows from
   wave 1 or 2 that happen to share the same `(scanner_id, plate_index,
   plate_barcode)` — plate labels are grid-position names
   (`"Plate_13"`-style), not globally unique across waves, and `GraviScan`
   already has its own `wave_number` column (`schema.prisma:116`). When
   `waveNumber` is supplied, every `GraviScan` swap-correction
   `updateMany`'s `where` clause SHALL also filter on
   `wave_number: waveNumber`, so a wave-scoped verification run can only
   ever touch that wave's own scan history.
5. **`GraviScanPlateAssignment.verification_status` is accepted as
   current-state-only, not wave-historical** — this table has no
   `wave_number` column (`schema.prisma:169-196`) and is already, by
   existing design (predating this proposal), a "current assignment for
   this position" record that gets overwritten wave-to-wave (this is the
   same table PR #216 found stale-data bugs in). Adding a `wave_number`/
   `verified_against_accession_id` column to make a verification result
   wave-attributable after the fact would require a schema migration and
   is judged out of scope for this tier; it is recorded as an explicit,
   accepted limitation (see Risks/Trade-offs) rather than silently
   reproduced without comment.

**Alternatives considered:** defer again (as `add-wave-scoped-metadata-
linking` did), tracked as a follow-up. Rejected per this proposal's user
decision — Tier 4 is exactly the caller that was missing, and the
addition is small and additive. Also considered: add a `wave_number`
column to `GraviScanPlateAssignment` now to close the provenance gap in
point 5 fully. Rejected for this tier — it's a schema migration for a
table whose "current state only" semantics are an existing, separate
design decision predating this proposal; worth its own follow-up if a
real incident demonstrates the need.

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
2. **"Dirty" (operator-overridden) is a derived, not stored, property.**
   Rather than an in-memory `Set` that resets on remount (which would
   silently defeat its own purpose the moment the operator navigates away
   and back — a case Decision 4 explicitly supports), a position is
   treated as operator-overridden whenever its currently **persisted**
   `GraviScanPlateAssignment` values differ from what a fresh recomputation
   of the wave's auto-fill would produce for that position. On mount and
   on every auto-fill re-run (wave/experiment/scanner change), each
   position's persisted values are compared against the freshly computed
   auto-fill values; a mismatch means the operator changed it after the
   last auto-fill and it is left untouched, a match means it's safe to
   overwrite with the (possibly unchanged) fresh value. This makes the
   override survive remounts/navigation for free, without a second
   persistence mechanism — it falls out of comparing two already-available
   values. Switching wave or experiment recomputes the auto-fill baseline
   from scratch, so a new wave's positions are never compared against the
   previous wave's persisted values.
3. **Avoids PR #216's stale-cross-wave-assignment bug.** #216 documents
   that `usePlateAssignments`'s reference/draft-PR ancestor loads
   persisted `GraviScanPlateAssignment` rows keyed only on
   `(experiment_id, scanner_id)` — no wave — so switching to a wave with no
   linked metadata still displays the *previous* wave's persisted
   assignments as if they belonged to the current one. This
   rebuild-from-scratch instead exposes a `waveMissingMetadata` flag and,
   when true, SHALL NOT load or display any previously-persisted
   assignment for the current scanner/position — the grid renders empty
   and editable (per the "No linked metadata falls back to manual, empty
   entry" scenario), never a stale wave's data.
4. **Avoids PR #223's dropped-metadata bug incidentally.** #223 found that
   picking a plate barcode manually dropped `transplant_date`/
   `custom_note` (never captured for a manual pick, only for an
   auto-filled one). Since point 1 makes all three fields editable
   together in both modes, a manual pick and a manual date/note edit are
   the same code path — there is no separate "manual barcode, no
   date/note" path left for this bug to hide in.

**Alternatives considered:** manual-entry-only, deferring all auto-fill to
Tier 5. Rejected per user decision — `listGraviMetadata` is already fully
wired with no caller, and manual-only would be a real UX regression for
the first working Capture Scan screen. Also considered: an in-memory
`dirty: Set<string>` (the originally-drafted approach). Rejected once
review found it does not survive the renderer remount Decision 4 requires
this screen to handle gracefully — the derived-comparison approach above
achieves the same protection without that gap.

**Accepted limitation:** neither approach labels *which* field was
overridden or distinguishes "operator correction" from "auto-fill result"
in the database itself — `GraviScanPlateAssignment` has no
`is_manual_override`/`source` column (see Risks/Trade-offs). A future
researcher querying the table directly cannot tell provenance; only the
live session's own comparison can reconstruct it, and only until the next
auto-fill baseline changes it again.

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

### Decision 5 — Surface abnormal session termination (crash/quit) without restoring it

`GraviScanSession` already has `completed_at` (nullable) and `cancelled`
(boolean) (`schema.prisma:149-167`) — a row with `completed_at: null` and
`cancelled: false` is an existing, unused signal that a session was
abandoned mid-run rather than finished or explicitly cancelled. Decision 4
correctly declines to *restore* such a session, but leaving the operator
with a blank screen and zero indication that "wave 3, cycle 4 of 12 may be
incomplete" is a real, cheaply-avoidable traceability gap.

**Decision:** on mount, when `getScanStatus()` returns `isActive: false`,
`useScanSession` additionally queries the most recent `GraviScanSession`
for the current experiment. If it has `completed_at: null` and
`cancelled: false`, the screen shows a non-blocking informational banner
naming that session and its last-known cycle count, so the operator knows
to check completeness (e.g. before uploading) rather than assuming a clean
slate. This is a read-only addition — it does not restore anything, and
does not conflict with Decision 4's Non-Goal.

### Decision 6 — Start Scan is blocked while any assigned scanner has an active wedge

Design research left this as a hedge ("`GraviScan.tsx` ... may call
`useWedgeEvents()` a second time ... if it needs wedge state inline, e.g.
disabling 'Start Scan'") rather than a decision, which is inconsistent
with claiming no open questions remain.

**Decision:** the screen calls `useWedgeEvents()` and disables "Start
Scan" whenever any scanner currently assigned to this session has an
active, unacknowledged wedge entry. Safety-first default: starting a new
scan while a scanner is jammed/paused is more likely to compound the
problem (e.g. queuing more cycles against a scanner that needs physical
intervention) than to help. The existing `WedgeBanner` (globally mounted,
Tier 3) remains the operator's mechanism to acknowledge/retry the wedge;
once cleared, "Start Scan" re-enables.

### Decision 7 — Cadence warning: real per-scanner calculation

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
src/renderer/hooks/useScanSession.ts                         — reducer-based session state (Decision 1), start/cancel/verify, restore-on-mount (Decision 4), abnormal-termination signal (Decision 5), wedge-blocks-start (Decision 6)
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
embed a second wedge banner. Per Decision 6, `GraviScan.tsx` calls
`useWedgeEvents()` a second time to read wedge state inline and disable
"Start Scan" while any assigned scanner has an active, unacknowledged
wedge.

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
- A new renderer-facing `VerificationStatus` type is **created** in
  `src/types/graviscan.ts` (no such type exists in this repo today — it
  exists only on the external reference branch; this codebase has nothing
  to "unify" or "replace"). It matches `verify-plates.ts`'s real
  `VerifyStatus` union exactly — `verified | incorrect | unreadable |
  needs_review | duplicate_qr | swapped | lookup_failed` (7 values) — plus
  the DB column's own pre-verification default, `'pending'`
  (`schema.prisma:178`, `@default("pending")`), which `verifyPlates()`
  itself never emits but a freshly-created `GraviScanPlateAssignment` row
  can carry before any verification has run. `'skipped'` is **not**
  included: it was deliberately removed from `VerifyStatus` itself as dead
  code (`openspec/changes/archive/2026-07-30-add-verify-plates-handler/
  tasks.md:157-158`, "never produced, never consumed") and reintroducing
  it here would recreate exactly that anti-pattern in the renderer type.
  Every live-emitted and DB-persisted value is consumed identically by
  both the live-event and DB-read paths — no renderer surface silently
  misses `incorrect` or `lookup_failed` the way the reference branch's
  banner/label logic did.
- Avoids PR #216's stale-cross-wave-assignment bug (Decision 3, point 3).
- Avoids PR #213's lost-scanner-init-event bug: `useScannerStatus` does
  not rely solely on `webContents.send` events for initial state (which
  can fire before the renderer subscribes and are never replayed) — it
  polls `getScannerStatus()` on an interval until every assigned scanner
  leaves the `starting` state, the same fix PR #213 proposes.
- Avoids PR #223's dropped-metadata-on-manual-pick bug (Decision 3,
  point 4).
- Wave-scoped verify-plates writes stay scoped to the same wave as its
  lookup (Decision 2, point 4) — a wave-scoped read is never paired with
  an experiment-wide write.

## Risks / Trade-offs

- Wave-scoped verify-plates (Decision 2) changes lookup precision for the
  one real caller (Tier 4) but is additive at the API boundary → low risk
  to existing callers/tests, which pass no `waveNumber` today. The
  parameter's position (appended last) is deliberate and must not move —
  any earlier position risks silently rebinding an existing positional
  argument in ~50 existing test call sites.
- **Accepted, named limitation:** `GraviScanPlateAssignment.
  verification_status` still has no column recording which wave/accession
  a given verification run checked it against (Decision 2, point 5). A
  second verification run for the same scanner/position under a different
  wave overwrites the first run's result with no trace of the earlier
  one. Closing this fully needs a schema migration (a `wave_number` or
  `verified_against_accession_id` column); judged out of scope for this
  tier since the table's "current-state-only" semantics predate this
  proposal. Revisit if this becomes a real problem in practice.
- **Accepted, named limitation:** the derived-dirty comparison (Decision
  3) tells the *current* session whether a position was operator-
  overridden, but nothing is persisted to distinguish "auto-filled" from
  "manually corrected" in the database itself — a future query against
  `GraviScanPlateAssignment` cannot recover that distinction once the
  live comparison's baseline (the wave's auto-fill computation) is no
  longer available to compare against.
- Session-restore Non-Goal (Decision 4) is an honest scope limitation, not
  a technical blocker → a future tier could add it if an operator
  incident demonstrates the need. Decision 5 mitigates the sharpest edge
  of this (silent data-completeness ambiguity after a crash) cheaply,
  without taking on full restoration.
- This is the largest tier in the roadmap by file count (6 hooks + 5
  components + screen + backend change) → mitigated by TDD per unit and
  the standard multi-round review-cycling process (see roadmap's
  "Process per tier").

## Migration Plan

No Prisma schema migration needed — `GraviExperimentWaveMetadata` already
exists (added by PR #278), and `GraviScan.wave_number` already exists for
Decision 2's write-scoping fix. No data backfill required: `waveNumber` is
optional everywhere it's added, so existing rows/callers are unaffected.
Rollout is a single PR; rollback is a plain revert (no schema or data
changes to unwind).

## Open Questions

None outstanding — both roadmap-flagged questions (issue #162 threading,
PR #212-informed auto-fill scope), two design ambiguities surfaced during
initial research (session-restore scope, cadence-calc accuracy), and the
additional gaps found during this proposal's own review cycle (wave-scoped
write consistency, the wedge/Start-Scan interaction, three related open
draft PRs) are all resolved above with an explicit Decision.
