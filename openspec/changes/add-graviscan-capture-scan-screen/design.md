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
same check — that function is not currently `export`ed
(`database-handlers.ts:900`), so this proposal also exports it as a small,
mechanical prerequisite (task in Section 1).

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

   **This fix requires `GraviScan.wave_number` to actually be populated
   with the wave a scan belongs to, which review found is not true
   anywhere in the codebase today** — `graviscansCreate()`
   (`database-handlers.ts:123-173`) is the only writer of that column and
   has zero callers anywhere in the real scan lifecycle
   (`graviscan:start-scan`/`session-handlers.ts` persist no `GraviScan`
   rows at all today; `session-handlers.ts`'s own header comment
   describes it as having "zero DB dependency"). This isn't a pre-existing
   gap this proposal can ignore — before Tier 4, there was no renderer to
   drive a real capture session at all, so nothing has ever called
   `graviscans.create()` from a live run. **`useScanSession` (this tier)
   SHALL call `database.graviscans.create(...)` with the session's
   `waveNumber` once per completed job/plate**, so real `GraviScan` rows
   with correct `wave_number` values exist for this scoping fix (and the
   existing `experimentId`/`GraviScan` browse-by-experiment features) to
   operate on. This was implicit in the roadmap's own Tier 4 dependency
   note ("DB layer to persist completed scans/sessions") but is made an
   explicit task here since review found the write path doesn't exist yet.

   **Accepted, named trade-off of wave-scoping the write:** if a plate was
   physically mis-loaded and stayed mis-loaded across *several* waves
   before the swap was finally detected, the previous experiment-wide
   write would have corrected every affected wave's historical rows in one
   pass; this wave-scoped write corrects only the wave the verification
   run was for, silently leaving earlier waves' matching rows uncorrected.
   Detecting and warning about that cross-wave case is out of scope for
   this tier — recorded here so it's a named, accepted limitation rather
   than an unconsidered regression.
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
2. **"Override" (operator-corrected) is a derived, not stored, property —
   scoped strictly to same-wave re-fires, never across a wave switch.**
   Rather than an in-memory `Set` that resets on remount (which would
   silently defeat its own purpose the moment the operator navigates away
   and back — a case Decision 4 explicitly supports), `usePlateAssignments`
   tracks the wave number its auto-fill baseline was last computed for
   (`lastAutoFilledWave`, a ref, not state — it must not itself trigger a
   re-render).
   - **When the current wave equals `lastAutoFilledWave`** (an auto-fill
     re-fire caused by something *other* than a wave change — scanner
     reassignment, experiment metadata reload): a position is treated as
     operator-overridden whenever its currently **persisted**
     `GraviScanPlateAssignment` values differ from what a fresh
     recomputation of the wave's auto-fill would produce for that
     position, **and a persisted row for that position already exists**.
     A position with **no persisted row yet** is never treated as
     overridden — it is always populated by the fresh auto-fill
     computation on first load, regardless of whether "no value" trivially
     "differs" from a computed one. A match (persisted equals freshly
     computed) means it's safe to overwrite with the — possibly
     unchanged — fresh value; a mismatch means the operator changed it
     after the last auto-fill and it is left untouched.
   - **When the current wave differs from `lastAutoFilledWave`** (a real
     wave switch): every position for the newly-selected wave is
     **unconditionally** overwritten by the fresh auto-fill computation
     (or left empty, if the new wave has no link) — the persisted-vs-
     computed comparison above is not applied at all for a wave switch.
     `lastAutoFilledWave` is then updated to the new wave. This is the fix
     for a gap review found in an earlier draft of this design: comparing
     a *different* wave's own genuinely different auto-fill values against
     stale, persisted data left over from a *previous* wave would
     otherwise misclassify the stale data as "operator override" and
     preserve it — reproducing PR #216's exact symptom (a previous wave's
     values bleeding into the new wave's grid) through a path a simpler
     "just compare persisted vs. computed" rule doesn't catch. Requiring
     an unconditional reset on every wave change, and reserving the
     persisted-vs-computed comparison for same-wave re-fires only, closes
     this regardless of whether the new wave has its own metadata link, no
     link at all, or a link to a different accession than the previous
     wave.
   This makes the override survive remounts/navigation for free (the
   comparison is recomputed fresh from persisted DB state on every mount,
   not from in-memory-only state a remount would reset), without a second
   persistence mechanism.
3. **Avoids PR #216's stale-cross-wave-assignment bug, including the
   different-metadata variant.** #216 documents that
   `usePlateAssignments`'s reference/draft-PR ancestor loads persisted
   `GraviScanPlateAssignment` rows keyed only on `(experiment_id,
   scanner_id)` — no wave — so switching wave still displays the
   *previous* wave's persisted assignments as if they belonged to the
   current one. Point 2's wave-switch hard-reset closes this for **every**
   wave-switch case (no link, same link, or a different link) — not only
   the no-link case an earlier draft of this design handled.
4. **Avoids PR #223's dropped-metadata bug via an explicit re-lookup, not
   merely "fields are editable."** #223 found that picking a plate barcode
   manually dropped `transplant_date`/`custom_note` (never captured for a
   manual pick, only for an auto-filled one). Making all three fields
   editable (point 1) is necessary but not sufficient by itself — the fix
   also requires that entering/changing `plantBarcode` in **either** mode
   triggers a lookup against the currently-loaded `AvailablePlate[]` list
   (from `graviPlateAccessions.list()`) for a case-insensitive `plate_id`
   match, and on a match, auto-populates `transplantDate`/`customNote`
   from that plate's row (still overridable afterward, per points 1-2).
   This mirrors #223's own actual fix (an explicit match-and-populate
   step), not just a side effect of making fields editable.

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

Decision 4 correctly declines to *restore* an in-progress scan after a
full app quit, but leaving the operator with a blank screen and zero
indication that "wave 3, cycle 4 of 12 may be incomplete" is a real,
cheaply-avoidable traceability gap.

An earlier draft of this design proposed answering this by querying the
most recent `GraviScanSession` row for the experiment (using its existing
`completed_at`/`cancelled` columns as the abandoned-session signal).
Review found two problems with that approach: (a) no caller anywhere
writes `GraviScanSession` rows today — `graviscanSessionsCreate()`/
`graviscanSessionsComplete()` exist and are fully wired but have zero
callers in the real scan lifecycle, so a query would find nothing without
this tier separately taking on that write-wiring; and (b) `GraviScanSession`
has no `wave_number` column, so "the most recent session for this
experiment" can silently reference a wave other than the one currently on
screen — a genuinely confusing, misattributed banner, not merely an
incomplete one.

**Revised decision:** use a renderer-local marker instead of a DB query.
When `useScanSession` successfully calls `startScan()`, it writes a small
marker to `localStorage` keyed by `(experimentId, waveNumber)`
(`graviscan:session-in-progress:${experimentId}:${waveNumber}`) containing
the session's expected total cycle count. The marker is removed when
`cancelScan()` or the session's natural completion succeeds. On mount,
if `getScanStatus()` returns `isActive: false`, the hook checks
`localStorage` for a marker matching the **currently selected**
`(experimentId, waveNumber)`; if one is present, the prior session for
*this exact wave* never cleanly finished, and the screen shows a
non-blocking informational banner naming the expected cycle count so the
operator knows to check completeness before trusting that data downstream
(e.g. before upload). This is read-only with respect to scan state — it
does not restore anything, does not conflict with Decision 4's Non-Goal,
requires no new backend query or schema change, and is inherently scoped
to the wave the operator is actually viewing (the localStorage key itself
encodes wave and experiment, sidestepping the "most recent across which
wave" ambiguity entirely).

`useScanSession` separately calls `database.graviscanSessions.create()` at
scan start and `.complete()` at scan end/cancel regardless of this
banner — these already-wired handlers exist for real audit/history
purposes (browsing past sessions), independent of the banner mechanism
above, which does not depend on them.

**Alternatives considered:** query `GraviScanSession` by experiment (the
original draft). Rejected once review found neither the write-path nor
the wave-scoping needed to make it correct existed — the localStorage
marker achieves the same operator-facing signal without either gap, at
the cost of only covering sessions started from this same browser
profile/machine (an accepted, narrower scope, consistent with this
tier's other renderer-local, non-DB-backed choices like Decision 4).

### Decision 6 — Start Scan is blocked while any assigned scanner has an active wedge

Design research left this as a hedge ("`GraviScan.tsx` ... may call
`useWedgeEvents()` a second time ... if it needs wedge state inline, e.g.
disabling 'Start Scan'") rather than a decision, which is inconsistent
with claiming no open questions remain.

An earlier draft of this design proposed closing the hedge by having
`GraviScan.tsx` simply call `useWedgeEvents()` a second, independent time.
Review found this doesn't actually work: `useWedgeEvents()`
(`src/renderer/hooks/useWedgeEvents.ts`) is purely event-driven — it has
no "fetch current active wedges" query, only a subscription to
`onWedgeDetected` going forward from whenever it mounts. `WedgeBanner`'s
own instance, mounted continuously in `Layout.tsx` across navigation,
correctly accumulates wedge state over the whole session; a *second*,
independent instance mounted fresh inside `GraviScan.tsx` starts empty
every time the operator navigates to the screen, so a wedge that occurred
while the operator was elsewhere would correctly show in the (already
-mounted) `WedgeBanner` but be invisible to `GraviScan.tsx`'s own
instance — silently leaving "Start Scan" enabled despite a real, visible,
active wedge. There is no backend "list active wedges" query to fall back
on either (confirmed: only the event subscription is exposed).

**Revised decision:** lift wedge state one level, to a small
`WedgeContext` provided by `Layout.tsx` (the component that already
mounts `WedgeBanner` and already owns the one long-lived
`useWedgeEvents()` call for the whole graviscan-mode session). Both
`WedgeBanner` and `GraviScan.tsx` consume this context instead of each
calling `useWedgeEvents()` independently, so there is exactly one
subscription instance per app session and both consumers always observe
the same, consistently-accumulated wedge state regardless of which one
mounted more recently. `GraviScan.tsx` disables "Start Scan" whenever the
context reports an active, unacknowledged wedge for any scanner currently
assigned to this session. Safety-first default: starting a new scan while
a scanner is jammed/paused is more likely to compound the problem (e.g.
queuing more cycles against a scanner that needs physical intervention)
than to help. `WedgeBanner` remains the operator's mechanism to
acknowledge/retry the wedge; once cleared in the shared context, "Start
Scan" re-enables.

**Alternatives considered:** a second, independent `useWedgeEvents()` call
in `GraviScan.tsx` (the original draft). Rejected once review found it
produces a real functional bug on the exact navigate-away-and-back
pattern Decision 4 is built around. Also considered: a new backend "get
active wedges" IPC query. Rejected as unnecessary — lifting the existing,
already-correct `Layout`-level state via context is strictly simpler and
needs no backend change.

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
embed a second wedge banner. Per Decision 6, `Layout.tsx` provides a
`WedgeContext` (wrapping its existing single `useWedgeEvents()` call);
`WedgeBanner` and `GraviScan.tsx` both consume it, so wedge state is
shared and consistent regardless of which one mounted more recently, and
`GraviScan.tsx` disables "Start Scan" while any assigned scanner has an
active, unacknowledged wedge in that shared state.

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
- Avoids PR #223's dropped-metadata-on-manual-pick bug via an explicit
  re-lookup, not just editable fields (Decision 3, point 4).
- Wave-scoped verify-plates writes stay scoped to the same wave as its
  lookup (Decision 2, point 4) — a wave-scoped read is never paired with
  an experiment-wide write. This depends on `useScanSession` actually
  persisting `GraviScan` rows with real `wave_number` values (Decision 2,
  point 4's write-wiring addition) — without it, the scoping fix has
  nothing correct to filter on.
- `isValidWaveNumber()` is exported from `database-handlers.ts` (it isn't
  today) so `verify-plates.ts` can import rather than duplicate it
  (Decision 2).
- The auto-fill override comparison never misclassifies a
  never-before-persisted position as "overridden," and a wave switch
  always hard-resets rather than comparing against a different wave's
  stale data (Decision 3, point 2 — the fix for the PR #216 variant round
  2 of review found).
- "Start Scan" wedge-blocking reads from one shared, `Layout`-level wedge
  subscription via context, not a second independent
  `useWedgeEvents()` instance that would start blank on every remount
  (Decision 6 — the fix for the round-2-found navigation gap).

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
  incident demonstrates the need. Decision 5's localStorage marker
  mitigates the sharpest edge of this (silent data-completeness ambiguity
  after a crash) cheaply, without taking on full restoration — accepted
  narrower scope: it only covers sessions started from the same browser
  profile/machine, not sessions visible from a different machine
  reading the same shared database.
- **Accepted, named trade-off:** wave-scoping the swap-correction write
  (Decision 2, point 4) means a plate mis-load that persisted across
  multiple waves before detection is corrected only for the wave the
  verification run was for, not retroactively for earlier waves sharing
  the same stale `(scanner_id, plate_index, plate_barcode)` — a real,
  if narrow, regression relative to today's experiment-wide (but
  wave-imprecise) write. No warning is raised for this case; revisit if
  it proves to be a real operational problem.
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

None outstanding. Both roadmap-flagged questions (issue #162 threading,
PR #212-informed auto-fill scope), two design ambiguities surfaced during
initial research (session-restore scope, cadence-calc accuracy), and the
gaps found during round 1 of proposal review (wave-scoped write
consistency, the wedge/Start-Scan interaction, three related open draft
PRs) are resolved above with an explicit Decision. Round 2 of review then
found that two of round 1's own fixes needed further correction — the
wedge-blocking mechanism (Decision 6, now context-based rather than a
second independent hook instance) and the auto-fill override's wave-switch
behavior (Decision 3 point 2, now an unconditional hard-reset on wave
change rather than a comparison that could misclassify a different wave's
genuinely different data) — both now resolved above as well, plus the
abnormal-termination signal was redesigned (Decision 5, now a
renderer-local marker rather than a DB query that depended on a write path
this proposal wasn't otherwise adding). This history is left visible here,
rather than edited away, per this repo's own convention of naming
corrections rather than silently smoothing over them.
