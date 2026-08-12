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
- **Rewiring `downloadImages` (`image-handlers.ts`), `box-backup.ts`, and
  `graviscan-upload.ts` to resolve per-wave metadata via
  `GraviExperimentWaveMetadata` instead of the legacy single
  `Experiment.accession_id` relation.** `add-wave-scoped-metadata-linking`
  (PR #278) explicitly deferred this for `box-backup.ts`/
  `graviscan-upload.ts`, naming it as pending "a renderer caller to supply
  `waveNumber`... likely scoped alongside Tier 3 or Tier 4" (its own
  design.md, Open Question 2) — review found `image-handlers.ts`'s
  `downloadImages` has the identical pattern, not previously named at
  all. **This tier is exactly that trigger condition**: once an operator
  links different waves to different accessions (PR #278's entire
  purpose) and this tier starts persisting real, distinct `wave_number`
  values (Decision 2 point 4 / tasks.md Section 12), all three of these existing,
  unrelated-to-this-screen backend files will silently resolve **every**
  wave's exported/uploaded metadata (CSV contents, `accession_name`,
  `transplant_date`, `custom_note`) from whichever single accession the
  legacy relation happens to point at — correctly wave-labeled output
  folders/rows with potentially wrong contents for every wave but one.
  This is a real, now-activated gap, explicitly named rather than
  silently left implicit (per this proposal's own convention elsewhere) —
  but rewiring three existing, working, backend-only files unrelated to
  the Capture Scan screen is a distinct piece of work from this tier's
  renderer build-out, and is out of scope here. **Recommended as an
  immediate, small follow-up change** (each file needs the same
  `GraviExperimentWaveMetadata`-based accession resolution this tier
  already builds for `verify-plates.ts`/`usePlateAssignments` — no new
  concept, just three more call sites), filed once this tier merges.
- **Triaged, deferred without further scope in this tier:** five open,
  unmerged issues touch files this tier rebuilds (`#241` per-cycle
  plate-subset selection, `#250` A/B plate display order vs. physical
  scanner bed layout, `#168` per-scanner reconnect button, `#239`
  surfacing `bytes_received`/`wall_seconds` in `ScannerStatusPanel`,
  `#225` continuous-scan cycle time exceeding the configured interval).
  None describe a bug in behavior this tier itself introduces; each is an
  independent enhancement request. Recorded here, once, so three
  successive review rounds re-flagging their silence can stop doing so.

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
general ref-mirroring shape (and its risk for the _next_ piece of state
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
mechanical prerequisite (tasks.md task 3.1).

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
   imprecise across waves regardless: it would match plates from _any_
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
   explicit task here since review found the write path doesn't exist yet
   (see tasks.md Section 2 for the backend handler change and Section 12
   for the renderer call site).

   **Idempotency:** `GraviScan` has no unique constraint today
   (`schema.prisma:109-147` — only non-unique `@@index`s), so a
   duplicated/retried job-complete event (the same event-duplication risk
   Decision 1 rebuilds `useScanSession` to guard against on the renderer
   side) could create two rows for one physical scan if the per-job
   `create()` call fires twice. This proposal adds
   `@@unique([session_id, scanner_id, plate_index, cycle_number])` to
   `GraviScan` (a small, additive schema change — SQLite treats multiple
   `NULL`s in a unique index as distinct, so one-shot/test scans with no
   `session_id` are unaffected). **The renderer-facing
   `database.graviscans.create(...)` method name and signature are
   unchanged** — no new preload/IPC surface, no new method name — only
   `graviscansCreate()`'s internal implementation
   (`database-handlers.ts:123-173`) changes, from a plain
   `db.graviScan.create(...)` to `db.graviScan.upsert({ where: {
session_id_scanner_id_plate_index_cycle_number: {...} }, create:
{...}, update: {} })`. A retried event becomes a true no-op rather than
   a second row, invisibly to every caller.

   **Named, narrow risk on the `update: {}` no-op:** this assumes a
   retried job-complete event always carries identical data to the first
   attempt (the same physical scan, re-delivered) — reasonable for
   today's actual failure mode (a duplicated IPC event, not a second
   physical capture; `scan-coordinator.ts` has no code path today that
   re-emits `scan-complete` for an already-completed cycle). If a future
   change ever legitimately re-captures under the same
   `(session_id, scanner_id, plate_index, cycle_number)` key (e.g. a
   retry-with-recapture feature), the no-op would silently keep the
   _first_ attempt's data and discard the second's with no warning.
   Out of scope to guard against now since no such feature exists;
   recorded here rather than left implicit.

   **Accepted, named trade-off of wave-scoping the write:** if a plate was
   physically mis-loaded and stayed mis-loaded across _several_ waves
   before the swap was finally detected, the previous experiment-wide
   write would have corrected every affected wave's historical rows in one
   pass; this wave-scoped write corrects only the wave the verification
   run was for, silently leaving earlier waves' matching rows uncorrected.
   Detecting and warning about that cross-wave case is out of scope for
   this tier — recorded here so it's a named, accepted limitation rather
   than an unconsidered regression.

5. **`GraviScanPlateAssignment.verification_status` becomes genuinely
   wave-attributable, via the same schema change Decision 3 makes for a
   different reason.** Decision 3 (below) adds a `wave_number` column to
   `GraviScanPlateAssignment` to fix a real data-loss bug found in this
   proposal's own review history (not primarily for verification's
   sake) — but once that column exists, `verify-plates.ts`'s swap-
   correction and `verification_status` writes to
   `GraviScanPlateAssignment` are scoped by `wave_number` too, when one is
   supplied. This closes what would otherwise be an accepted limitation
   (an earlier draft of this design judged a schema migration for this
   column out of scope and recorded current-state-only semantics as a
   permanent trade-off) — it turns out not to be a separate, deferrable
   concern once Decision 3's own fix requires the same column anyway.

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

Two rounds of review on this decision each found a real bug, both rooted
in the same underlying cause: `GraviScanPlateAssignment` has no
`wave_number` column (`@@unique([experiment_id, scanner_id,
plate_index])`) — it is **one shared row per position across every
wave**, by existing design predating this proposal. Round 1 tried a
purely renderer-side fix (an in-memory `dirty: Set`); review found it
doesn't survive remount. Round 2 tried a derived comparison plus a
`lastAutoFilledWave` ref to distinguish same-wave re-fires from real wave
switches; review found the ref itself doesn't survive remount either —
navigating away and back to the _same_ wave is indistinguishable, to a
fresh hook instance, from switching to a different wave, so that design's
"unconditional reset on wave switch" branch would fire on ordinary
navigation and **silently discard a legitimate, already-persisted
operator override** — a worse bug (silent data loss) than the one it
fixed (stale display).

**Revised decision: give `GraviScanPlateAssignment` a real `wave_number`
column, closing the root cause instead of working around it with
renderer-side heuristics.** Add `wave_number Int @default(0)` and change
the unique constraint to `@@unique([experiment_id, scanner_id,
plate_index, wave_number])` (schema migration, see Migration Plan).
`database-handlers.ts`'s existing `graviscanPlateAssignments.upsertMany`/
`.list` handlers (from Tier 2, already wired end-to-end) gain a
`waveNumber` parameter, scoping reads/writes to that specific wave's own
row.

This eliminates the entire remount-fragility problem, not just patches
around it: each wave now has its own independent, genuinely separate
persisted row per position. There is no "which wave was this ref last set
to" question to get wrong, because there is no shared state to
misattribute in the first place —

1. `ScanFormSection.tsx` renders `plantBarcode`/`transplantDate`/
   `customNote` as editable inputs in **both** gravi-metadata and manual
   modes — auto-fill pre-populates, it does not lock the field.
2. **"Override" (operator-corrected) is now a direct, wave-scoped
   comparison — no ref, no remount-lifecycle dependency.** On mount and
   on every auto-fill re-run, `usePlateAssignments` reads the persisted
   row for `(experimentId, scannerId, plateIndex, waveNumber)` — the
   **current** wave's own row, always, regardless of why the effect
   fired or how many times the hook has (re)mounted. If a row already
   exists and its values differ from a freshly recomputed auto-fill
   baseline, it's treated as operator-overridden and left untouched; if
   no row exists yet for this wave, it is populated by the fresh
   computation (never misclassified as "overridden" merely because
   "no value" trivially differs from a computed one). Switching wave
   simply reads a **different** row (or none) — there is no "was this a
   real wave switch or just a remount" question to answer, because
   "which wave's row to read" is now an explicit query parameter, not an
   inferred fact about render history. A round-trip (wave 2 → wave 3 →
   back to wave 2) correctly restores wave 2's own persisted override,
   because it was never touched by wave 3's auto-fill in the first
   place — they're different rows.
3. **Avoids PR #216's stale-cross-wave-assignment bug, and the
   remount-vs-wave-switch data-loss variant review's own fixes introduced
   along the way.** #216's literal symptom (a previous wave's values
   bleeding into the new wave's grid) cannot occur: each wave reads its
   own row. The round-2 regression (an operator's own override silently
   discarded on ordinary remount) also cannot occur, for the same reason
   — there is no ref-based "was this a wave switch" inference left to get
   wrong.
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
5. **A staleness guard prevents an out-of-order async response from
   resurrecting #216's symptom via a third mechanism.** The wave-scoped
   fetch chain (`listGraviMetadata` → resolve `accessionId` →
   `graviPlateAccessions.list(accessionId)` → merge with
   `graviscanPlateAssignments.list(...)`) is multiple sequential IPC
   round-trips whose latency varies with data volume. If the operator
   switches wave twice in quick succession (e.g. wave A, with many linked
   plates and a slower resolution chain, then wave B, with no linked
   metadata and a fast path) before wave A's fetch resolves, wave A's
   response landing _after_ wave B's would overwrite the just-rendered
   wave B grid with wave A's data — user-visibly identical to PR #216's
   original symptom, caused by an unguarded race rather than the missing
   schema column the rest of this Decision fixes. `usePlateAssignments`
   SHALL track which wave a fetch was issued for and discard (not commit
   to state) a response that resolves after the currently-selected wave
   has since changed — the same `let cancelled = false`-style guard
   already used elsewhere in this codebase's async effects
   (`src/renderer/hooks/useAppMode.ts:12-28`), applied here for the same
   reason.
6. **`usePlateAssignments`'s writes SHALL NOT clobber `verify-plates.ts`'s
   writes to the same row.** Both now write to `GraviScanPlateAssignment`
   for the same `(experiment_id, scanner_id, plate_index, wave_number)`
   key: `verify-plates.ts` sets `verification_status`/
   `previous_plate_barcode` right after a scan completes (Decision 2,
   point 5); `usePlateAssignments` persists plate/note edits via the
   existing Tier-2 `graviscanPlateAssignmentsUpsertMany` handler, whose
   `update:` clause today unconditionally replaces the **entire** row from
   the caller's payload, including defaulting `verification_status`/
   `previous_plate_barcode` to `'pending'`/`null` when the caller's
   payload doesn't carry them (`database-handlers.ts:610-618`) — which it
   never does, since plate assignment is a different concern than
   verification. Concretely: a swap is auto-corrected and flagged
   `'swapped'`; the operator, reacting to exactly that QR banner (a
   plausible real workflow), edits that position's note in the
   still-mounted grid; the resulting `upsertMany` call silently resets
   `verification_status` back to `'pending'` and clears
   `previous_plate_barcode` — erasing the swap-correction audit trail
   Decision 2 point 5 was built to guarantee, with no error or warning.
   **Fix:** `graviscanPlateAssignmentsUpsertMany`'s `update:` clause SHALL
   preserve `verification_status`/`previous_plate_barcode` when the
   caller's payload omits them, rather than defaulting — these two fields
   are owned by the verification flow, not the plate-assignment flow, and
   `usePlateAssignments`'s own writes SHALL never include them.

**Alternatives considered:** manual-entry-only, deferring all auto-fill to
Tier 5. Rejected per user decision — `listGraviMetadata` is already fully
wired with no caller, and manual-only would be a real UX regression for
the first working Capture Scan screen. Also considered, across two
successive review rounds: an in-memory `dirty: Set<string>`, then a
derived comparison gated by a `lastAutoFilledWave` ref. Both rejected —
each is a renderer-side heuristic trying to infer "did the wave actually
change" without a wave-scoped data model to ground the inference in, and
each broke on ordinary remount for that reason. The schema column removes
the need to infer anything.

**Accepted limitation, now narrower:** the DB still does not label
_which_ field within an existing wave-scoped row was auto-filled versus
manually typed (`GraviScanPlateAssignment` has no `is_manual_override`/
`source` column) — a future researcher can tell "this wave's row differs
from what auto-fill would compute today" but not which specific edit made
it differ, or when. This is a narrower gap than round 2's version of this
limitation (which was "no wave attribution at all"): a verification
result or plate assignment is now at least correctly attributed to its
own wave.

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

Decision 4 correctly declines to _restore_ an in-progress scan after a
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
_this exact wave_ never cleanly finished, and the screen shows a
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

**Accepted limitation, two distinct dimensions:** (1) a session started
on one machine/profile is invisible to this check from a different
machine/profile reading the same shared database — a scoping choice the
operator can reason about and work around (check from the same machine).
(2) More sharply: the marker can also be lost on the **same**
machine/profile with no fallback and no indication anything was lost —
cleared browser/app storage, an Electron `userData` reset, storage-quota
eviction. In that case the banner simply does not appear, which is
indistinguishable from "the scan completed cleanly." This is a real,
silent-failure-mode limitation, not merely a scoping choice, and is
recorded here rather than only under the (narrower) cross-machine framing
above so it isn't mistaken for something more benign than it is.

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
correctly accumulates wedge state over the whole session; a _second_,
independent instance mounted fresh inside `GraviScan.tsx` starts empty
every time the operator navigates to the screen, so a wedge that occurred
while the operator was elsewhere would correctly show in the (already
-mounted) `WedgeBanner` but be invisible to `GraviScan.tsx`'s own
instance — silently leaving "Start Scan" enabled despite a real, visible,
active wedge. There is no backend "list active wedges" query to fall back
on either (confirmed: only the event subscription is exposed).

**Revised decision:** lift wedge state one level, to a small
`WedgeContext` provided by `Layout.tsx` (the component that already
mounts `WedgeBanner`, but does **not** itself call `useWedgeEvents()`
today — that call currently lives inside `WedgeBanner.tsx` itself,
confirmed via direct inspection; the fix moves it up to `Layout.tsx` as
part of introducing the provider, it does not merely "wrap an existing
call already there"). Both `WedgeBanner` and `GraviScan.tsx` consume this
context instead of each calling `useWedgeEvents()` independently, so there
is exactly one subscription instance per app session and both consumers
always observe the same, consistently-accumulated wedge state regardless
of which one mounted more recently. `GraviScan.tsx` disables "Start Scan" whenever the
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

### Decision 8 — Cycle-progress visibility during continuous mode

Live manual smoke testing (tasks.md 16.6) surfaced a real operator-facing
blind spot: `useScanSession` already tracks `currentCycle`/`totalCycles`/
`coordinatorState` (added when fixing the round-4 continuous-mode
premature-completion bug — cycle-level "all done" detection was firing
`finishSession()` after the first cycle instead of waiting for the
backend's own `interval-complete` event), but nothing in the UI ever
rendered them. An operator watching per-scanner progress bars reset from
100% back to 0% between cycles had no way to tell "cycle 2 started, this
is correct" from "the session silently reset/broke," short of reading the
main-process terminal log.

**Decision:** `ScanControlSection.tsx` renders two small, purely
state-derived indicators, no new IPC or polling required:

- A `"Cycle {currentCycle} of {totalCycles}"` line, shown only while
  `isScanning && totalCycles > 1` (single-shot sessions always have
  `totalCycles === 1` and gain nothing from a "Cycle 1 of 1" label).
- A `"Waiting for next cycle..."` line, shown while
  `coordinatorState === 'waiting'` (the interval-wait gap between one
  cycle's scans finishing and the next cycle's starting).

**Alternatives considered:** a live-ticking countdown to the next
scheduled scan time, using `nextScanAt`. Rejected for this pass — it
needs a `setInterval` tick (no existing precedent in this codebase) and
locale/timezone-dependent formatting, both of which add real test
surface (fake timers, locale mocking) for a "how in-progress" signal
this simpler static-text version already answers. `nextScanAt` stays
tracked in state for a future countdown if operators want more precision
later.

### Decision 9 — Continuous-scan Duration field: minutes, not hours

Auditing against the production branch
(`fix/v600-wedge-followups-metadata_propogation_followup`) for parity gaps
after Decision 8 surfaced found another real, previously-unexamined one:
production's `useContinuousMode.ts` uses `scanIntervalMinutes` AND
`scanDurationMinutes` — minutes for both fields. Our build's
`useContinuousMode.ts` used `intervalMinutes` but `durationHours`
(defaulting to `1`) — an inconsistent-units UI choice never compared
against the reference implementation, and never called out as a
deliberate divergence anywhere in this file. This directly confused a
live tester: they set only the interval field, left Duration at its
default "1" without registering it meant 1 _hour_, and the resulting
continuous scan ran far longer than they expected.

**Decision:** rename `durationHours`/`setDurationHours` to
`durationMinutes`/`setDurationMinutes` throughout (`useContinuousMode.ts`,
`useScanSession.ts`'s param and `durationSeconds` computation,
`GraviScan.tsx`'s wiring, `ScanControlSection.tsx`'s form field/label).
Default changes from `1` (hour) to `60` (minutes) — the same actual
default duration as before (1 hour) and matching production's own
`scanDurationMinutes` default of `60` (confirmed via
`git show origin/fix/v600-wedge-followups-metadata_propogation_followup:
src/renderer/hooks/useContinuousMode.ts`), so this is a units/label fix
with no change to default session-length behavior.

**Alternatives considered:** leave hours, add a clarifying label/tooltip
instead. Rejected — matching production's unit convention removes the
mismatch entirely rather than papering over it, and this screen's own
Interval field already uses minutes, so hours-for-Duration was
internally inconsistent even setting production aside.

### Decision 10 — Abnormal-termination marker check must be reactive, not mount-once

Live smoke testing found Decision 5's banner never actually appeared,
under any circumstance reachable by an operator. Root cause: the
mount-only restore effect (`useEffect(..., [])`) closes over whatever
`experimentId`/`waveNumber` it received on the render that scheduled it.
`GraviScan.tsx`'s `experimentId` always starts `null`
(`useState<string | null>(null)`) and is only populated asynchronously,
either via the cross-navigation session-restore added in this same tier
(`window.electron.session.get()`) or, before that existed, by the
operator picking from `ExperimentChooser` — either way, strictly after
this effect's synchronous body has already run and permanently missed
the `if (experimentId)` check (empty deps means the callback that
actually executes is fixed to the very first render forever, regardless
of how many times `experimentId` later changes). This is not a
first-launch-only edge case: `GraviScan.tsx` does not remount when the
operator merely switches `waveNumber` via its own selector, so the
existing "different wave, no banner" / "same wave, banner" tests — all
of which construct the hook with `experimentId` already present via
`baseParams()` — never exercised the actual integration timing and so
never caught this.

**Decision:** split the abnormal-marker check out of the mount-once
active-session-restore effect into its own effect depending on
`[experimentId, waveNumber]`. It independently calls `getScanStatus()`
(a second, harmless call — status reads are cheap and idempotent, not
worth threading state between two effects to avoid one duplicate IPC
round trip) and either sets or explicitly clears `abnormalTermination`
based on whether a marker exists for the _current_ `(experimentId,
waveNumber)` pair. Explicit clearing (not just "don't set") matters once
this is reactive: switching from a wave with a marker to one without must
not leave the previous wave's banner visibly stuck. The active-session
restore half of Decision 5's original effect is untouched — it doesn't
depend on `experimentId` at all, so it was never affected by this race,
and stays mount-once per Decision 4's original intent (restoration is a
one-time reconciliation, not a reactive sync — that framing was correct
for that half; it just wasn't correct for the marker-check half sharing
its body).

**Alternatives considered:** widen the _existing_ effect's deps to
`[experimentId, waveNumber]` instead of splitting it. Rejected — that
would also make the active-session restore reactive, re-dispatching
`RESTORE` (and its `jobTemplateRef`/`completedKeysRef` resets) every time
the operator changes wave while a session already has its own live
event-driven state updating via the separate IPC-listener effect,
risking exactly the kind of stale-snapshot-clobbers-live-state race this
tier's Decision 1 reducer rewrite was meant to eliminate.

### Decision 11 — Render per-scanner Test Scan results

A fresh production-branch parity audit found `useTestScan.ts` already
computes per-scanner results (`testResults: Record<string,
TestScanResult>` — `success`/`error`/`imagePath`, populated via
`onScanComplete`/`onScanError` exactly like a real session) but nothing
ever renders them. `ScanControlSection.tsx` only surfaces the hook's
aggregate `error` (e.g. "Could not determine the scan output
directory."); the per-scanner detail is computed, stored in state, and
silently dropped. Production's `ScannerStatusPanel.tsx` renders each
scanner's test outcome inline next to that scanner's own row.

**Decision:** add an optional `testResults` prop to
`ScannerStatusPanel.tsx` (the natural home — it's where every other
per-scanner fact, connectivity/grid-mode/live-progress, already lives),
passed from `GraviScan.tsx` as `testScan.testResults`. Render a
success/failure line per scanner when a result exists for it, styled
like the existing `lastError` line immediately below it.

**Alternatives considered:** render per-scanner results inside
`ScanControlSection.tsx`, next to the Test Scan button itself. Rejected
— that component has no per-scanner rendering today (it's
session/control-level, not per-scanner), and `ScannerStatusPanel.tsx`
already iterates `scanners` once or displaying results there would mean
either duplicating that iteration or awkwardly cross-referencing two
separately-iterated lists.

## Architecture

```
src/renderer/GraviScan.tsx                                  — screen root
src/renderer/hooks/useScannerStatus.ts                       — polls getScannerStatus(), ScannerPanelState[] incl. gridMode
src/renderer/hooks/useWaveNumber.ts                          — wave selection + "suggested next wave" (getMaxWaveNumber)
src/renderer/hooks/usePlateAssignments.ts                    — plate/position state, wave-scoped auto-fill w/ override (Decision 3, schema-backed)
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
  never-before-persisted position as "overridden," and correctly survives
  both a wave switch and an ordinary remount without confusing the two —
  because `GraviScanPlateAssignment` now has a real `wave_number` column
  (Decision 3), so "which wave's row to read" is an explicit parameter,
  not something inferred from render history via a ref that two
  successive review rounds each found a way to get wrong.
- A staleness guard discards an out-of-order async plate-assignment
  fetch response from an earlier, since-abandoned wave selection
  (Decision 3, point 5) — closing a third, independently-found mechanism
  for reproducing PR #216's user-visible symptom, on top of the schema
  fix above.
- `usePlateAssignments`'s writes never clobber `verify-plates.ts`'s
  `verification_status`/`previous_plate_barcode` writes to the same row
  (Decision 3, point 6) — the two features write to the same table from
  independent code paths, and the shared handler now preserves fields a
  given caller doesn't own rather than defaulting them away.
- `GraviScan` gains a unique constraint and an upsert-based write, so a
  duplicated/retried job-complete event cannot create two rows for one
  physical scan (Decision 2, point 4's idempotency fix).
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
- **Schema migration required** (a change from this proposal's first
  draft, which claimed none was needed): `GraviScanPlateAssignment` gains
  a `wave_number` column and a new unique constraint (Decision 3);
  `GraviScan` gains a new unique constraint for upsert-based idempotency
  (Decision 2, point 4). Both are small, additive, `@default`-backed
  changes with no data-loss risk to existing rows (existing
  `GraviScanPlateAssignment` rows default to `wave_number: 0`, matching
  how `GraviScan.wave_number` already defaults) — see Migration Plan.
- **Accepted, named limitation, narrower than an earlier draft of this
  design:** `GraviScanPlateAssignment` still does not label _which field_
  within a wave-scoped row was auto-filled versus manually corrected
  (Decision 3) — only that the row differs from what today's auto-fill
  computation would produce. An earlier draft of this proposal accepted a
  broader limitation here (no wave attribution at all, for both plate
  assignments and verification results); the schema fix in Decision 3
  closes that broader gap as a side effect, leaving only the
  narrower, field-level provenance question open.
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

Two small, additive schema changes are needed (a correction from this
proposal's first draft, which claimed none were required before review
found the data-loss and idempotency gaps above):

1. `GraviScanPlateAssignment`: add `wave_number Int @default(0)`; change
   `@@unique([experiment_id, scanner_id, plate_index])` to
   `@@unique([experiment_id, scanner_id, plate_index, wave_number])`.
   Existing rows default to `wave_number: 0`, matching this schema's
   existing convention for `GraviScan.wave_number` — no data loss, no
   backfill script needed (a `0` default is a correct, meaningful value:
   pre-this-tier, no real scan ever had a wave other than the implicit
   default anyway).
2. `GraviScan`: add `@@unique([session_id, scanner_id, plate_index,
cycle_number])` for upsert-based idempotency (Decision 2, point 4).
   SQLite treats multiple `NULL`s in a unique index as distinct, so
   existing rows with `session_id: null` (one-shot/test scans) are
   unaffected.

No data backfill required beyond the schema defaults above.
`GraviExperimentWaveMetadata` already exists (added by PR #278), and
`waveNumber` is optional everywhere it's added at the API boundary, so
existing callers are unaffected. Rollout is a single PR (schema + code
together, per this repo's convention — see `scripts/verify-migrations.sh`
in tasks.md); rollback is a plain revert plus the standard down-migration.

## Open Questions

None outstanding. Both roadmap-flagged questions (issue #162 threading,
PR #212-informed auto-fill scope) and two design ambiguities surfaced
during initial research (session-restore scope, cadence-calc accuracy)
were resolved before the first review round. Three successive review
rounds each found real, substantive issues in the round before it —
this history is left visible here, rather than edited away, per this
repo's own convention of naming corrections rather than silently
smoothing over them:

- **Round 1** found: wave-scoped verify-plates needed its write scoped
  too, not just its lookup (Decision 2); the wedge/Start-Scan interaction
  was a hedge, not a decision (Decision 6, first draft); three related
  open draft PRs (#216/#213/#223) were unaddressed.
- **Round 2** found that two of round 1's own fixes needed further
  correction: the wedge-blocking mechanism (a second independent
  `useWedgeEvents()` call would start blank on every remount — fixed via
  `WedgeContext`, Decision 6 final) and the auto-fill override's
  wave-switch behavior (an unconditional-reset-via-ref approach, while
  better than round 1's plain comparison, still risked misclassifying an
  ordinary remount as a wave switch). Round 2 also redesigned the
  abnormal-termination signal away from a `GraviScanSession` DB query
  once review found that table has no writer and no wave column.
- **Round 3** found that round 2's own ref-based wave-switch fix
  (`lastAutoFilledWave`) was _itself_ remount-fragile for the same
  reason as round 1's `dirty: Set` — a ref doesn't survive remount either,
  so it could silently discard a real operator override on ordinary
  navigation. This is now fixed at the root cause (Decision 3, final):
  `GraviScanPlateAssignment` gains a real `wave_number` column, so "which
  wave's data to read" is an explicit parameter rather than something
  inferred from render history. Round 3 also found: `graviscans.create()`
  needed additional required fields and an idempotency guard (Decision 2,
  point 4); a factual error in Decision 6's justification (`Layout.tsx`
  did not already call `useWedgeEvents()` — fixed, the wording now
  correctly describes moving that call up from `WedgeBanner.tsx`); a
  same-machine silent-storage-loss gap in the localStorage marker,
  distinct from its already-named cross-machine limitation (Decision 5);
  and a real, now-activated gap in three existing backend files
  (`downloadImages`, `box-backup.ts`, `graviscan-upload.ts`) that resolve
  metadata via the legacy pre-wave-scoping relation — named as a
  recommended immediate follow-up rather than pulled into this tier's own
  scope (Non-Goals).
