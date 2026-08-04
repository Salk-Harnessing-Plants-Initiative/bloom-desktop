## Why

Today, when the `WedgeDetector` (`src/main/wedge-detector.ts`) detects a V600
USB wedge, the **only** thing that happens is a Slack post
(`setupWedgeDetection()`, `src/main/graviscan/wiring.ts:253-339`). Nothing
reaches the renderer, and nothing stops the wedged scanner: the subprocess
"stays alive in a broken state and re-hits the wedge every subsequent
cycle" (issue #228, the root-cause investigation this detector was built
from) — `ScanCoordinator.scanOnce()` keeps re-scanning it every cycle for
the rest of the session.

This is a real, filed, P0 gap. Issue #228 recommends the app "stop using
that scanner automatically... continue with remaining scanners... auto-
resume when the scanner re-enumerates fresh." Issue #244 documents the
consequence as "permanent data loss, no recovery": these are continuous
time-lapse experiments, so a missed cycle on a wedged scanner cannot be
recovered later — a "re-scan" would capture a different plant growth
timepoint, not the missed one — and lists a per-scanner pause indicator
with a `Power-Cycled & Resume` button as its highest-value proposed fix.
Issue #240 documents the narrower problem that an operator physically at
the rig, not watching Slack, has no in-app indication a wedge even
happened.

Roadmap Tier 3 (`docs/superpowers/plans/2026-07-30-graviscan-renderer-roadmap.md`)
scopes this as its own fast-tracked tier, pulled out of the larger Tier 4
scan-operation screen specifically so a safety fix isn't coupled to the
tier most likely to slip. It depends only on Tier 2 (merged, PR #274),
whose granular per-job event model made coordinator-originated errors
visible to wedge detection for the first time — the prerequisite question
this raised in Tier 2's design doc was backtested against the production
rig's logs and signed off 2026-08-03: zero wedge alerts and zero zero-byte
files across ~10 weeks, so this change proceeds without further gating on
that question.

## What Changes

An earlier draft of this proposal made the operator manually click a
"Skip" action to exclude a wedged scanner from future cycles, leaving it
re-failing every cycle until someone noticed. Adversarial review against
the actual source issues (#228, #244) surfaced that both describe
**auto-pause by default** instead — this revision adopts that, since it's
both safer for the unattended multi-day runs #244 is about and, once
adopted, simpler (two operator actions instead of three; no separate
"Skip" handler needed since pausing no longer waits on a human). The two
issues diverge on the _resume_ half, though: #228 wants a fully automatic
resume triggered by USB re-enumeration, which would need new hotplug-
detection infrastructure this codebase doesn't have; this proposal follows
#244's simpler manual-confirmed-retry design instead (see design.md
Decision 1 for the full reasoning).

- **Auto-pause on wedge detection.** `setupWedgeDetection()`'s `onWedge`
  callback now calls `coordinator.stopScanner(scanner_id)` immediately
  when a wedge fires — fire-and-forget, not gated behind the (network-
  bound, potentially slow) Slack notification — in addition to, not
  instead of, the existing `SlackNotifier.notify()` call. Because
  `scanOnce()` iterates live over `this.subprocesses`
  (`scan-coordinator.ts:479`), this excludes the scanner from all later
  cycles in the session with no separate "exclusion" bookkeeping needed,
  until a subsequent Retry re-adds it. Accepted tradeoff: calling
  `stopScanner()` at detection time — rather than waiting for the
  in-flight row to finish — can occasionally force that one row to fall
  back to its existing 90-second timeout instead of resolving faster via
  its own listeners (see design.md Decision 1 for why this bounded cost is
  preferable to deferring the pause). A durable `scanLog()` line records
  the auto-pause (scanner_id, session_id, cycle_number, signature),
  alongside — not replacing — the pre-existing wedge-detected log line,
  so the action has a forensic trail beyond the transient UI, addressing a
  traceability gap the scientific-rigor review flagged.
- **Forward wedge events to the renderer.** The same `onWedge` callback
  sends `graviscan:wedge-detected` (the enriched payload already sent to
  Slack — `scanner_id`, `signature`, `session_id`, `cycle_number`,
  `timestamp`, `error_message`, `display_name`, `usb_port`) to the
  renderer via an optional new `getMainWindow` parameter on
  `setupWedgeDetection()`. Best-effort: a missing/destroyed window never
  blocks the Slack path or the auto-pause.
- **Add one new IPC handler, `graviscan:retry-scanner`**, backed by
  `ScanCoordinator`'s existing `addScanner()` (no new coordinator methods).
  Given a `scannerId`, it stops any worker defensively (idempotent no-op
  in the normal case, since auto-pause already tore it down) and respawns
  using a `saneName` rebuilt from a **fresh** database read of the
  scanner's current `usb_bus`/`usb_device` (not a value cached from
  session start — a `reset-usb` performed after auto-pause would otherwise
  make a stale value wrong), reusing the exact construction already
  inlined in the save-scanners-db handler (`register-handlers.ts:166`),
  extracted into a shared `buildSaneName()` helper. The handler checks the
  scanner row's `enabled` flag and fails without respawning if it's
  `false` — a scanner an operator explicitly disabled via ConfigureScanner
  should not be silently brought back by a stale wedge banner's Retry
  button. The action requires an active session and a live coordinator. A
  durable `scanLog()` line records the retry attempt and its outcome.
- **Two operator actions per banner entry, not three:**
  - **Dismiss** — hides that banner entry. Makes no backend call; the
    scanner is already paused (by auto-pause, not by this click) and
    stays paused regardless of whether the operator dismisses.
  - **Power-Cycled & Retry** — gated behind an explicit confirmation step
    ("I have power-cycled this scanner" → "Confirm Retry") before calling
    `retry-scanner`, so a click before the physical power-cycle is done
    doesn't blindly respawn into an immediate re-wedge. If a _new_ wedge
    event for the same scanner arrives while a confirmation is pending,
    the confirmation resets to unconfirmed — confirming a retry meant for
    an already-superseded wedge would be misleading.
- **Add an app-wide `WedgeBanner`**, mounted in `Layout.tsx` gated on
  `mode === 'graviscan'` (not scoped to any one screen), so an operator
  browsing scans or editing metadata still sees an active wedge. One
  banner entry per wedged `scanner_id` (a new wedge for an
  already-shown scanner replaces, not stacks); all entries clear on
  `interval-complete`/`cancelled` (Retry is meaningless once the session
  has ended). Alongside the per-scanner entries, a small, non-dismissible
  session indicator tracks two numbers — total wedge events and distinct
  scanners affected (e.g. "3 auto-pause events across 1 scanner this
  session") — since a flat event count alone would overstate how systemic
  a problem is when it's really one unit repeatedly re-wedging after
  failed retries. Auto-pause removes the natural check-in point an
  operator got for free under the old manual-Skip design (having to click
  Skip N times made "this is happening a lot" obvious; a dismissed banner
  doesn't), so this restores that visibility cheaply and accurately, without adding
  any new automatic policy.
- **In-memory only, no DB.** The banner itself is not persisted — lost on
  app restart, matching `WedgeDetector`'s existing in-memory-only
  lifecycle. Unlike the earlier draft, the auto-pause _action_ itself now
  has a durable trail via `scanLog()` (see above), even though the banner
  UI state does not. Issue #244's `wedge_event` DB-table idea (item 2) and
  wedge-skip placeholder-row idea (item 3) are both explicitly deferred to
  a future tier/ticket — a `scanLog()` line is a meaningfully smaller
  commitment than either and doesn't preempt that future work.
- **No new route, no placeholder scan-state screen.** The roadmap's
  original framing ("rendered against a minimal placeholder scan-state
  view") is refined here: because the banner is app-wide and
  self-contained, it doesn't need a host screen. Tier 4 still builds the
  real scan-operation screen; this tier adds zero new routes or nav links.
- **Explicitly out of scope, named rather than silently dropped:** #244's
  item 4 (auto-cancel-on-N-wedges policy) and item 5 (cancel + full-session
  auto-restart with the same parameters) are not implemented by this
  change. Auto-pause (this proposal) already gives an operator the
  information and the manual lever item 4 would otherwise need to be
  automatic about; item 5 is a session-level action orthogonal to
  per-scanner wedge response and would need its own scoping.
- **Share the wedge-event type with the renderer** via a type-only
  re-export (`GraviWedgeEvent` in `src/types/graviscan.ts`, sourced from
  `wedge-detector.ts`'s existing `WedgeDetectedEvent`) rather than a
  duplicate interface, so the two can't drift.

## Impact

- Affected specs: `scanning` (ADDED — wedge auto-pause, wedge-event
  forwarding, retry-scanner requirements), `ui-management-pages` (ADDED —
  wedge banner and wedge-response-actions UI requirements).
- Affected code: `src/main/graviscan/wiring.ts`, `src/main/graviscan/
session-handlers.ts`, `src/main/graviscan/register-handlers.ts`,
  `src/main/graviscan/scanner-handlers.ts` (new `buildSaneName()` helper),
  `src/types/graviscan.ts`, `src/types/electron.d.ts`, `src/main/
preload.ts`, `src/renderer/hooks/useWedgeEvents.ts` (new),
  `src/renderer/components/WedgeBanner.tsx` (new), `src/renderer/
Layout.tsx`. No Prisma schema changes. No changes to `App.tsx` (no new
  route). No changes to `python/graviscan/scan_worker.py` — this change
  consumes existing wedge-detector output; it does not touch detection
  logic or hardware-facing code.
- Also affected (existing tests that must be updated, not just new tests
  added): `tests/unit/graviscan/register-handlers.test.ts` (its hardcoded
  channel count changes), `tests/unit/pages/Layout.test.tsx` and
  `tests/unit/pages/App.test.tsx` (their graviscan-mode `window.electron`
  mocks currently omit `gravi.onWedgeDetected`/`onIntervalComplete`/
  `onCancelled`; both files render `Layout`/`App` in `mode: 'graviscan'`
  today and will throw once `WedgeBanner` mounts unconditionally in that
  mode unless their mocks are extended first), `tests/unit/preload-gravi.test.ts`
  (the dedicated preload channel-mapping test; extending it is how a
  channel-name typo in the real `preload.ts` implementation gets caught,
  since the renderer-side tests only exercise a mock), and
  `tests/unit/graviscan/main-wiring.test.ts` (its 13 independently-declared
  mock coordinators in the `setupWedgeDetection` describe block have no
  `stopScanner` method today; they need a shared factory refactor before
  `onWedge` is updated to call it, or those 13 tests throw).
- **Coordination note:** this change touches two of the four files that
  have needed rebase coordination between parallel GraviScan tracks before
  (`src/main/preload.ts` — new `onWedgeDetected`/`retryScanner` entries on
  the `graviAPI` object — and `src/renderer/Layout.tsx` — new
  `<WedgeBanner />` mount). `src/types/electron.d.ts` is also touched (new
  `GraviAPI` members), which is not one of the four named files but is the
  direct type counterpart of the `preload.ts` change. `App.tsx` is **not**
  touched. Two other tracks are running in parallel right now, each in its
  own worktree/branch off `main`: a wave-scoped-metadata-linking backend
  change (confirmed unrelated — schema + `database-handlers.ts` only, no
  renderer code) and a CylinderScan finalization effort (scope still being
  figured out as of this writing — cannot yet confirm whether it touches
  `Layout.tsx`/`preload.ts`/`electron.d.ts`). Whoever merges second among
  any of these should rebase onto the other rather than assume
  independence, per the roadmap's existing coordination convention.
- Downstream: none of Tiers 4/5 depend on this change's specific handlers —
  Tier 4 will integrate this tier's `WedgeBanner`/`useWedgeEvents` rather
  than rebuilding wedge-response UI, per the roadmap.
