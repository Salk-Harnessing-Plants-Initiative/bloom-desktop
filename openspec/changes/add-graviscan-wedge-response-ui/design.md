## Context

No backend or renderer surface for wedge response exists today — confirmed
by direct code reading, not assumed from the roadmap doc's "No new backend"
framing (which, read against Tier 1's identical "preload wiring" framing
for a Tier-1-sized change, turns out to describe forwarding/wiring work,
not a full data-layer increment — consistent with what this change actually
does). Specifically:

- `setupWedgeDetection()`'s `onWedge` callback
  (`src/main/graviscan/wiring.ts:265-277`) only calls `SlackNotifier.notify()`
  and a log line. `setupCoordinatorEventForwarding()`'s forwarded-event list
  (`wiring.ts:174-195`) does not include any wedge event, and nothing stops
  the wedged scanner — per issue #228, the wedged subprocess "stays alive
  in a broken state and re-hits the wedge every subsequent cycle."
- `ScanCoordinator`'s public surface
  (`src/main/graviscan/scan-coordinator.ts`) has `cancelAll()` (session-wide)
  and `stopScanner()`/`addScanner()` (single-scanner), and nothing scoped to
  a single job/row/plate.
- `src/main/preload.ts`'s `graviAPI` object has no wedge-related method or
  listener.
- No renderer file references wedge state at all except a static env-config
  label in `ConfigureScanner.tsx:409` ("Slack wedge alerts:
  configured/not configured" — unrelated to a live wedge).

Five questions were resolved with the user before/during drafting this
proposal, since this is a data-loss-prevention safety feature and guessing
wrong here has real consequences. The first four were resolved before the
initial draft; the fifth (Decision 1, auto-pause) was resolved after a
5-agent adversarial review of that draft surfaced a divergence from the
source issues that the initial clarifying questions had not surfaced.

## Decision 1: Auto-pause on wedge, not manual Skip

**When a wedge is detected, the coordinator automatically stops that
scanner's worker — no operator click required.** `setupWedgeDetection()`'s
`onWedge` callback calls `coordinator.stopScanner(evt.scanner_id)`
immediately (fire-and-forget, not awaited, and not gated behind the
network-bound Slack notification), in addition to the existing enrich +
Slack-notify + (new) renderer-forward pipeline.

**Why this superseded an earlier draft.** The first draft of this proposal
made "Skip" a manual operator action and left a wedged scanner in the
active rotation (re-failing every cycle) until someone noticed and clicked
it. Adversarial review checked that draft against the actual source issues
and found it inverted their intent:

- Issue #228 (the P0 root-cause issue `wedge-detector.ts` itself cites)
  recommends: "Stop using that scanner automatically (mark as offline;
  continue with remaining scanners)... Auto-resume when the scanner
  re-enumerates fresh."
- Issue #244 item 1 (the item this proposal implements) recommends: "when
  a wedge fires... disable its inclusion in subsequent cycles, surface a
  `Power-Cycled & Resume` button. On click: spawn a fresh worker."

Both make the initial pause automatic — that half of this design matches
both issues, and is the half that fixes the actual data-loss bug. They
diverge on the _resume_ half, and this proposal follows #244, not #228,
there: #228's step 4 ("Auto-resume when the scanner re-enumerates fresh")
describes a fully automatic resume triggered by the OS detecting the
physical device come back online after a power-cycle — this codebase has
no such capability today (`src/main/lsusb-detection.ts`'s scanner
detection is a one-shot poll, not an event-driven USB hotplug watcher), so
building #228's literal design would mean adding new hotplug-detection
infrastructure as part of a fast-tracked safety-UI tier. #244 item 1's
design — an operator-clicked "Power-Cycled & Resume" button that spawns a
fresh worker — needs no new infrastructure and is what this proposal
implements (as "Power-Cycled & Retry", confirmation-gated per Decision 2).
An earlier draft of this design doc described both issues as wanting "a
manual action only for the respawn step," which is only true of #244; #228
wants that step automatic too. Recorded here accurately rather than
papering over the gap: this proposal's resume step is manual by choice
(no hotplug infra exists to do otherwise), not because #228 asked for it.

The pause half is the one this proposal is confident about regardless: the
consequence of getting _that_ wrong is exactly what #244 is about — for a
multi-day unattended continuous run (the primary use case), "the operator
has to notice and act" is a much weaker safety property than "the app
stops the bleeding immediately." A wedge signature already means "physical
AC power-cycle required" (per #240's own suggested banner text) — the
detector firing at all is already the signal that continuing to scan is
useless, so there is no benefit to waiting for a human before stopping.

**Why acting on the very first occurrence of any of the three signatures
is scientifically justified, not just operationally convenient.** Each
signature in `wedge-detector.ts` already encodes its own confirmation
mechanism, tuned to that failure mode — auto-pausing on the first
occurrence doesn't skip a "wait and see" step, it relies on a step that's
already built into the signature itself:

- `sane_start_invalid` fires on an exact string match
  (`sane_start: Invalid argument`) tied to a specific, investigated root
  cause (issue #228's own investigation) — the specificity is in the
  string, not in repetition.
- `device_io_120s_zero_bytes` requires a compound condition (matching
  error text AND zero bytes received AND ≥120 seconds elapsed) — 120
  continuous seconds of literally zero bytes is itself a conservative
  threshold no ordinary transient hiccup would cross.
- `consecutive_failures` is explicitly count-gated already (`>= 2` within
  one cycle) — it isn't a single-occurrence signature to begin with.
  No additional "wait for a second occurrence before pausing" layer is
  justified on top of these; that would just re-implement, redundantly and
  less precisely, confirmation logic each signature already has, while
  reintroducing the delay-before-stopping problem this decision exists to
  remove.

**Consequence: two operator actions instead of three.** With pausing
automatic, a manual "Skip" action becomes redundant (there's nothing left
for it to do that auto-pause hasn't already done), which is why this
revision has only:

- **Dismiss** — hides the banner entry. No backend call. The scanner stays
  paused regardless of whether or when the operator dismisses; dismissing
  only affects what's shown, never coordinator state.
- **Power-Cycled & Retry** — confirmation-gated respawn (Decision 2).

This is a simplification relative to the first draft (one fewer IPC
handler, one fewer UI action), not an addition — auto-pause replaces what
Skip used to do, it doesn't sit alongside it.

**Explicitly deferred, named rather than silently dropped:** #244 item 4
(auto-cancel-on-N-wedges — an operator-configurable policy to remove a
scanner after N wedges across a session) and item 5 (cancel the whole
session + auto-restart with the same parameters) are not implemented here.
Item 4's per-scanner exclusion already happens automatically and
unconditionally on the _first_ wedge under this design, which is a
stronger response than a configurable N-threshold — the configurable
policy angle (letting an operator choose to tolerate N wedges before
excluding) is a real but separate feature this proposal doesn't build.
Item 5 is a session-level action orthogonal to per-scanner wedge response
and would need its own scoping (what "same parameters" means across a
partially-elapsed interval, whether already-completed cycles' data
factors in, etc.) — out of scope for this fast-tracked tier.

**Dismiss is the de facto "give up on this scanner" action, and that's
intentional, not a gap.** There is no automatic N-failed-retries cutoff: a
scanner that keeps re-wedging after every Retry will simply keep
generating fresh `wedge-detected` events (each auto-pausing it again and
replacing its banner entry, per Decision 4). An operator is never forced
into that loop, though — Dismiss requires no confirmation, makes no
backend call, and is available at any time regardless of retry history;
the scanner stays safely paused either way. So there is always a manual
escape route from a chronically-re-wedging scanner, it's just Dismiss
rather than a separate "give up" button, since auto-pause already did the
one thing a dedicated give-up action would otherwise need to do.

**Accepted, bounded side effect of calling `stopScanner()` from `onWedge`:
a wedge on the in-flight row can force that row to fall back to its
90-second timeout instead of resolving via its own listeners.** A wedge
signature can fire from a subprocess-relayed `scan-error` event while
`scanOnce()`'s row-completion promise for that exact scanner/row is still
awaiting its own `scan-complete`/`cycle-done`/`exit` listeners
(`scan-coordinator.ts:522-562`). `stopScanner()`'s `sub.removeAllListeners()`
(`scan-coordinator.ts:274-281`) strips those listeners as part of tearing
the subprocess down — if this happens before the row's terminal event
arrived, that row's promise can only resolve via `scanOnce()`'s own
existing `SCAN_ROW_TIMEOUT_MS` (90s) fallback, stalling that row group
(and anything sequenced after it in the same cycle) by up to 90 extra
seconds. This is a real, new interaction introduced by making
`stopScanner()` a side effect of detection rather than an operator's later
click — accepted as a bounded, existing-safety-net-bounded cost (the 90s
bound is pre-existing coordinator behavior, not a new unbounded risk;
wedges are rare per the Tier 3 backtest) rather than deferring the
auto-pause call to avoid it, which would reintroduce exactly the
delay-before-stopping problem this decision removes — deferring doesn't
even avoid the worst case, since a genuinely wedged row was headed for the
90s timeout regardless of when `stopScanner()` is called. Not covered by
an integration test in this change (section 2's tests exercise
`setupWedgeDetection()` against a bare `EventEmitter` standing in for the
coordinator, not a real `ScanCoordinator` with an in-flight `scanOnce()`).
**Correction (post-PR-#277-review):** an earlier revision of this section
claimed reproducing this race would need real subprocess timing — that
was wrong. `scan-coordinator.test.ts`'s existing row-timeout test already
reproduces the same class of async-listener/timer race with fake timers
and a mocked `ScannerSubprocess`, and this proposal's own
`stopScanner()`/`addScanner()` retry-integration tests (added in a later
commit on PR #277) prove the same file's mocked `ScannerSubprocess` is
adequate for exactly this kind of test. The actual reason it isn't added
here: this file's shared `createMockSubprocess()` helper stubs
`removeAllListeners()` as a `vi.fn()` no-op rather than delegating to the
real `EventEmitter.prototype.removeAllListeners`, so it can't yet
faithfully reproduce listener-stripping without a small, shared change to
that helper (which every other test in the file also depends on) — an
unstaffed follow-up, not an infrastructure gap. The 90s bound itself is
already covered by `scan-coordinator.test.ts`'s existing row-timeout
tests, unchanged by this proposal.

Retry's respawn is safe to call at any point in a session because
`addScanner()` already handles mid-cycle safety: if `isScanning`, it queues
the spawn until the next `cycle-complete` event rather than disturbing the
active cycle (`scan-coordinator.ts:228-268`, existing behavior, unchanged
by this proposal).

## Decision 2: Retry confirmation gating

**Retry requires an explicit two-step confirmation in the UI before the
respawn IPC call fires** ("Power-Cycled & Retry" → confirmation copy →
"Confirm Retry"). This is UI-only state — no new backend flag or session
field. Rationale: `addScanner()` blindly respawns a subprocess against the
same physical USB port; if the hardware is still wedged, the respawned
worker will very likely re-wedge on its next scan, spending a whole cycle
to learn nothing. Issue #244's own proposed UI text ("Power-Cycled &
Resume") already implies the button should be pressed only after the
physical fix, not as a first response — the confirmation step makes that
implicit precondition explicit rather than trusting the operator to
self-gate. The confirmation sub-state SHALL render explicit explanatory
text describing the precondition (not just two bare buttons) — a
reviewer flagged that the scenarios alone don't force this, so it's called
out here explicitly as an implementation requirement, and codified as its
own spec scenario.

**Confirmation resets if the underlying wedge is superseded.** If a _new_
`wedge-detected` event for the same `scanner_id` arrives while a
confirmation is pending (operator clicked "Power-Cycled & Retry" but
hasn't clicked "Confirm" yet — necessarily a fresh wedge on a scanner that
was itself just re-paused after a prior retry), the entry's confirmation
sub-state resets to unconfirmed along with the entry's data being
replaced (Decision 4). Confirming a retry the operator intended for an
already-superseded wedge context would be misleading — better to make
them re-initiate Retry against the current wedge.

## Decision 3: Persistence scope

**No new DB table — but the auto-pause action itself is durably logged.**
`useWedgeEvents()` holds wedge state in React state local to Layout's
render tree; nothing about the _banner_ is written to the database, and
this matches `WedgeDetector`'s own lifecycle (torn down on
`interval-complete`, nothing persisted — `wiring.ts:280-283`). Issue
#244's item 2 (a `wedge_event` DB table for post-experiment audit) and
item 3 (a `failure_reason=wedge` placeholder row in `GraviScan`) are both
real, independently useful ideas but explicitly **not** part of this
change — either would need its own proposal (new Prisma model/migration
for item 2; a write-path change to the not-yet-built scan-completion
handler for item 3), and bundling either here would contradict the
pre-proposal notes' framing of this tier as UI + wedge-detector
consumption only, no DB schema.

That said, an earlier draft of this decision claimed the _only_ thing lost
by staying in-memory was the transient banner — that undersold the gap.
Before this revision, the operator's _response_ to a wedge (which action
was taken, when) had no record anywhere, not even in a log file, once
auto-pause is the app's own doing rather than an operator's explicit
click that could at least be inferred from an audit trail elsewhere. To
close that gap without taking on a DB table: `stopScanner()` on auto-pause
and the `retry-scanner` handler's outcome both write a `scanLog()` line
(scanner_id, action, session_id, cycle_number, and — for retry — success/
failure) to the existing durable per-day log file
(`src/main/graviscan/scan-logger.ts`, already retained ~180 days). This is
a few lines, not a schema change, and directly serves the "traceability"
value this tier is supposed to advance: a support engineer or PI reading
the log after an incident can now see not just that a wedge was detected,
but that the app paused the scanner and whether/when a retry was attempted
and whether it succeeded.

Consequence: a wedge _banner_ is still lost if the renderer reloads or the
app restarts while it's showing — accepted, since the coordinator-level
pause state and the new log line are both unaffected by losing the
transient UI. `getScannerStatuses()` remains pollable for current state
(a paused scanner is simply absent from the active worker map, same as
any other stopped scanner — no new "paused" status is introduced by this
change; that would be a reasonable follow-up but is out of scope here).

## Decision 4: Banner scope, and no new placeholder route

**App-wide, mounted in `Layout.tsx`, not scoped to a dedicated screen.**
This directly supersedes the roadmap doc's "rendered against a minimal
placeholder scan-state view" framing — recorded here as a deliberate scope
change, not a silent deviation. Rationale: issue #240's actual complaint is
that an operator elsewhere in the app (not watching the scan screen) misses
the alert; a banner scoped to a new placeholder route would only fix that
for operators already on that one screen, i.e. would not actually close the
gap #240 describes. Making the banner app-wide instead means:

- No new route is needed (nothing to navigate away from that would hide the
  banner).
- No new nav link is needed. This is also consistent with the roadmap's own
  cross-cutting nav-ownership section, which does not name Tier 3 as owning
  any workflow-step/nav-link change (only Tiers 1, 4, and 5 are named).
- `App.tsx` is untouched by this change.

Each `WedgeBanner` entry is self-contained (scanner*id/display_name,
signature, error message, Dismiss/Retry buttons, and copy communicating
the scanner has \_already been paused* — not that pausing is pending an
operator action) — it doesn't need a host screen to show useful state,
unlike (say) a live scan-progress view.

**Layout/positioning**: entries render as a fixed, vertically-stacked list
(each entry its own row) below the top nav so multiple entries never
overlap each other or obscure navigation; this is called out explicitly
here because no existing convention in this codebase dictates banner
positioning for a persistent, potentially-multi-entry, app-wide banner
(the existing inline-banner precedents — `ConfigureScanner.tsx`,
`CaptureScan.tsx` — are all single-instance and scoped to one page's own
layout flow).

**Repeated wedges on the same scanner**: a new `wedge-detected` event for a
scanner already showing a banner **replaces** that entry rather than
stacking a second one, and resets its retry-confirmation sub-state to
unconfirmed if one was pending (Decision 2). Rationale: the previous
entry's information (older cycle number, possibly a different signature)
is superseded by the new one; showing both would suggest two independent
problems when it's the same scanner repeatedly failing. A bounded history
list was considered and rejected as unnecessary complexity for what
Decision 3 already treats as ephemeral, non-authoritative UI state — the
durable trail now lives in the log file instead (Decision 3).

**Session-end clearing**: all banner entries clear when `onIntervalComplete`
or `onCancelled` fires. Retry is meaningless once the coordinator has
stopped scanning; leaving a stale actionable button on screen after the
session ended would be actively misleading (a Retry click after the
session ended would respawn a subprocess with no active `scanInterval()`
loop to ever schedule it into a cycle).

**Session-level auto-pause counter, alongside the per-scanner entries.**
Under the earlier manual-Skip draft, an operator's own sense of "this is
the third scanner I've had to Skip this hour, something is systemically
wrong" was an inherent side effect of having to act on each one by hand.
Auto-pause removes that natural check-in point — an operator who
dismisses each entry as it appears (or isn't watching closely) has no
cheap way to notice that an unusually large number of wedges have occurred
this session. `useWedgeEvents()` therefore also tracks two session-scoped
numbers, neither decremented by Dismiss (unlike the per-scanner entries,
these reflect history, not current unacknowledged state):

- a running **event count**, incremented on every `wedge-detected` event,
  including repeats for the same `scanner_id` (e.g. a scanner that
  re-wedges after a failed Retry increments this again); and
- a **distinct-scanner count**, the size of the set of unique `scanner_id`s
  that have wedged at least once this session.

Both are needed, not just one: a flat event count alone would be
genuinely misleading for the exact judgment call this feature exists to
support. A single flaky scanner retried three times and re-wedging each
time produces 3 events but only 1 distinct scanner — a display that only
said "3" (implying 3 units affected, as an earlier draft's example copy
literally read, "3 scanners have auto-paused this session") would
overstate how systemic the problem is. The indicator therefore shows both,
e.g. "3 auto-pause events across 1 scanner this session" — accurate
whether the events are concentrated on one unit or spread across several.
Both numbers reset to zero on the same `interval-complete`/`cancelled`
events that clear the per-scanner entries (Decision 4, above) — they're
per-session figures, not persisted, consistent with Decision 3's
in-memory-only scope. This does not add a policy decision (no threshold,
no automatic action at any count) — it only restores the passive
visibility manual-Skip used to provide for free, accurately.

## Decision 5: Type sharing (no duplicated interface)

`src/types/graviscan.ts` re-exports `wedge-detector.ts`'s existing
`WedgeDetectedEvent` as `GraviWedgeEvent` via a **type-only** import
(`import type { WedgeDetectedEvent } from '../main/wedge-detector'; export
type GraviWedgeEvent = WedgeDetectedEvent;`). `import type` is fully erased
at compile time — this does not pull `wedge-detector.ts`'s runtime code (or
any transitive import) into the renderer bundle. Chosen over duplicating
the interface because the two would otherwise be free to drift silently;
`wedge-detector.ts` already declares itself "Pure logic. No I/O, no
network, no DB," so it has no Electron/native dependency that would make a
type-only cross-reference architecturally awkward.

## Decision 6: `setupWedgeDetection()` signature change

Add an optional third parameter, `getMainWindow: (() => BrowserWindow |
null) | null = null`, mirroring `setupCoordinatorEventForwarding()`'s
existing convention (`wiring.ts:170-172`) rather than reading the
module-level `_getMainWindow` directly inside the function. This keeps
`setupWedgeDetection()` callable in isolation the way `tests/unit/graviscan/
main-wiring.test.ts` already calls it directly without Electron — passing
`null` (or omitting the argument) preserves every existing test unmodified.
The call site in `getOrCreateCoordinator()` (`wiring.ts:382`) passes the
already-available `_getMainWindow`, matching how it's passed one line above
to `setupCoordinatorEventForwarding()` (`wiring.ts:377`).

Inside `onWedge`, the new logic is, in order:

```ts
onWedge: (evt) => {
  // Auto-pause first, fire-and-forget — don't let a slow/failing Slack
  // call or DB enrichment delay stopping the wedged scanner (Decision 1).
  void coordinator.stopScanner(evt.scanner_id).catch((err) => {
    console.error(`[WedgeDetector] Failed to auto-pause ${evt.scanner_id}:`, err);
  });
  // Pre-existing line (unchanged) — keep it; do not replace it with the
  // auto-pause line below. tests/unit/graviscan/main-wiring.test.ts
  // already asserts this exact message.
  scanLog(
    `[WedgeDetector] wedge-detected scanner=${evt.scanner_id} signature=${evt.signature} cycle=${evt.cycle_number}`
  );
  // New second line, added by this proposal, for the auto-pause action
  // itself (Decision 3) — includes session_id to disambiguate cycle
  // numbers across sessions that share a calendar-day log file.
  scanLog(
    `[WedgeDetector] auto-paused scanner=${evt.scanner_id} signature=${evt.signature} session=${evt.session_id} cycle=${evt.cycle_number}`
  );

  void (async () => {
    const enriched = await enrichWedgeEvent(evt, db);
    void slackNotifier.notify(enriched);
    const win = getMainWindow?.();
    if (win && !win.isDestroyed()) {
      win.webContents.send('graviscan:wedge-detected', enriched);
    }
  })();
},
```

`coordinator` is already in scope as `setupWedgeDetection()`'s first
parameter — no new parameter is needed to reach it from `onWedge`. The
enriched (display_name/usb_port-augmented) payload is still what's sent
to both Slack and the renderer, so the renderer gets the same
operator-friendly information Slack does, without a second DB round-trip.
Note this is **two** `scanLog()` calls, not one replacing the other — an
earlier version of this code sample dropped the pre-existing
`wedge-detected` line, which would have broken an existing passing test
if implemented literally; both lines now coexist.

## Decision 7: `retry-scanner`'s saneName reconstruction and enabled check

Extract the `saneName` string-construction (currently inlined at
`register-handlers.ts:166`: `` `epkowa:interpreter:${busPadded}:${devicePadded}` ``)
into an exported `buildSaneName(usbBus: number, usbDevice: number): string`
in `scanner-handlers.ts`, and reuse it from both the existing
spawn-on-discovery call site and the new `retry-scanner` handler.

The retry handler reads `usb_bus`/`usb_device`/`enabled` **fresh from the
DB** at retry-time (not from whatever was passed to `start-scan`, and not
from the wedge event's payload — `WedgeDetectedEvent` doesn't carry USB
fields at all, only `display_name`/`usb_port`), because a `reset-usb`
performed after auto-pause (which clears and re-detects `usb_bus`/
`usb_device`) would otherwise make a stale value wrong. Two failure cases,
both returning an error without calling `addScanner`:

- `usb_bus`/`usb_device` is null (e.g. mid `reset-usb`) — mirrors the
  existing guard at `register-handlers.ts:159-164` for the identical
  condition.
- The scanner row's `enabled` field is `false` — per
  `prisma/schema.prisma`'s own documented policy that scanner reads for
  spawn decisions must filter on `enabled: true`. Without this check, an
  operator who explicitly disabled a scanner (ConfigureScanner's "Remove"
  action, `disable-scanner`) between the wedge firing and clicking Retry
  on a stale banner could have Retry silently bring it back online against
  their own prior action.

`retryScanner()`'s `db` parameter is typed as a narrow interface (not the
full `PrismaClient`), matching `wiring.ts`'s own `ScannerLookupDb`
convention for this exact kind of "read one scanner row for a
spawn-related decision" case, rather than `scanner-handlers.ts`'s
`db: PrismaClient` + cast convention. `session-handlers.ts` currently has
zero DB dependency at all; keeping the new dependency narrow avoids
pulling `@prisma/client`'s types into a module that otherwise doesn't need
them.

`retryScanner()` still calls `stopScanner()` before `addScanner()` even
though auto-pause (Decision 1) should already have torn the worker down by
the time an operator clicks Retry — `stopScanner()` is a no-op if there's
no worker (`scan-coordinator.ts:274-281` returns immediately), so this
costs nothing in the normal case and defends against any timing edge case
(e.g. the auto-pause call in `onWedge` hasn't resolved yet).

**Accepted limitation, not addressed by this change:** `retry-scanner`
resolving `{ success: true }` means the IPC call and the `addScanner()`
call didn't throw — it does not mean the respawned worker actually came
online. `scan-coordinator.ts:224-227` documents that `addScanner()`/
`spawnSingleScanner()` deliberately "does not throw on spawn failure —
errors surface via the `scanner-init-status` event," isolated into
`initErrors`. If a respawned worker silently fails to initialize (as
opposed to successfully spawning and then re-wedging, which _would_
produce a fresh `wedge-detected` event), the banner is dismissed on
apparent success with no further signal tying that failure back to the
retry attempt. `scanner-init-status` is already forwarded to the renderer
by the existing `setupCoordinatorEventForwarding()` (unchanged by this
proposal) — a future tier could correlate it with a just-retried
scanner_id, but this tier does not attempt that correlation.

## Decision 8: Guard rails on `retry-scanner`

`retry-scanner` requires `sessionFns.getScanSession()?.isActive` and a
non-null coordinator; otherwise it returns `{ success: false, error:
'...' }` without throwing. This matches `cancelScan`'s existing
`try`/`catch` → `{ success, error }` **return-shape** convention
(`session-handlers.ts:277-299`) — but, unlike an earlier draft of this
decision claimed, the `isActive` check itself is **new**, not carried over
from `cancelScan`: `cancelScan` guards only on `!coordinator` and
succeeds even when `isActive` is already `false`
(`session-handlers.test.ts` covers this directly). `retry-scanner` is
stricter because respawning a worker with no active `scanInterval()`/
`scanOnce()` loop to ever schedule it into a cycle would just leak a
subprocess with nothing driving it.
