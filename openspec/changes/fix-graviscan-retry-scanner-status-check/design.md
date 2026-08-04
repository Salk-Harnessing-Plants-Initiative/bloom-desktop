## Context

`retryScanner()` was shipped in PR #277 (Tier 3 of the GraviScan renderer roadmap) with a known, explicitly-documented gap: `design.md` Decision 7 of that proposal (archived at `openspec/changes/archive/2026-08-04-add-graviscan-wedge-response-ui/design.md:459-472`) accepted that a respawned worker's actual online/dead state is never checked before reporting success. Two independent reviewers in PR #277's post-implementation review round flagged this as more severe than originally scoped — for a continuous, often-unattended, multi-day time-lapse run, an operator dismissing a wedge banner on a false "recovered" signal can mean a scanner sits dead, undetected, for the rest of the run.

## Goals / Non-Goals

- Goal: `retryScanner()` accurately reports `{ success: false, error }` when the respawned worker does not reach the `'ready'` state, without changing its external IPC contract shape.
- Goal: no renderer changes — `WedgeBanner.tsx` already handles `{ success: false, error }`.
- Non-goal: correlating a stray `scanner-init-status` event back to a specific retry attempt (that's the "future tier" idea design.md Decision 7 explicitly deferred, and issue #283 doesn't ask for it — the status check below is synchronous and self-contained, no correlation needed).
- Non-goal: the three other coordinator/subprocess risks tracked in issue #281 — separate, larger scope.
- Non-goal: hardening the `scannerId` join key this fix relies on (`getScannerStatuses()` results matched against the DB row's id) against the coordinator/DB-id divergence issue #243 describes. This fix doesn't introduce that trust assumption — `retryScanner()` already keyed off `scannerId` this way before this change (e.g. in its `stopScanner(scannerId)` call) — it just adds one more read that shares it.

## Decisions

### Decision 1: Poll `getScannerStatuses()` synchronously after `addScanner()` resolves

`startScan()` already establishes this exact pattern for the same class of problem: `initialize()` doesn't throw on a per-scanner spawn failure, so `startScan()`'s "final-review fix #3" calls `coordinator.hasWorker()` right after `initialize()` resolves and fails the whole call if no scanner came online. `retryScanner()` adopts the equivalent check via `getScannerStatuses()` (used instead of `hasWorker()` because the failure detail — `status.error` — is needed for the returned error message, and `hasWorker()` only returns a boolean):

```ts
await coordinator.addScanner({ scannerId, saneName, plates: [] });

const status = coordinator
  .getScannerStatuses()
  .find((s) => s.scannerId === scannerId);
if (!status || status.status !== 'ready') {
  const message =
    status?.error ?? `Scanner ${scannerId} did not come online after retry`;
  scanLog(
    `[WedgeResponse] retry failed scanner=${scannerId} session=${session.sessionId} cycle=${session.currentCycle} error=${message}`
  );
  return { success: false, error: message };
}

scanLog(
  `[WedgeResponse] retry succeeded scanner=${scannerId} session=${session.sessionId} cycle=${session.currentCycle}`
);
return { success: true };
```

(`session` above refers to the `sessionFns.getScanSession()` result — but the _current_ code (`session-handlers.ts:359`) calls `getScanSession()` inline and discards it, inside the function's `try { ... }` block: `if (!sessionFns.getScanSession()?.isActive) { ... }`. There is no `session` local today, and the fix must be careful about _where_ it declares one: the success-path log line (line 31 above) is reachable from inside `try`, but the failure-path log line at line 27 above corresponds to the pre-existing `catch (error) { ... }` block (`session-handlers.ts:386-391`) — a sibling scope to `try`, not nested inside it. A `session` declared with `const`/`let` inside `try` is NOT visible inside `catch`. The correct fix declares `session` _before_ the `try`/`catch` split:

```ts
let session: ReturnType<SessionFns['getScanSession']> | undefined;
try {
  session = sessionFns.getScanSession();
  if (!session?.isActive) {
    return { success: false, error: 'No active scan session' };
  }
  // ...existing body...
  scanLog(
    `[WedgeResponse] retry succeeded scanner=${scannerId} session=${session.sessionId} cycle=${session.currentCycle}`
  );
  return { success: true };
} catch (error) {
  const message = error instanceof Error ? error.message : 'Retry failed';
  scanLog(
    `[WedgeResponse] retry failed scanner=${scannerId} session=${session?.sessionId} cycle=${session?.currentCycle} error=${message}`
  );
  return { success: false, error: message };
} finally {
  retriesInFlight.delete(scannerId);
}
```

Note the `session?.` (not `session.`) in the catch-block log line: `SessionFns['getScanSession']` is typed `() => any` (`session-handlers.ts:65`), so this isn't strictly compiler-enforced, but it's the semantically correct choice regardless — it guards the one path where `getScanSession()` itself throws before the assignment runs, which the try-block's own `session.` (no `?.`, safe there because the preceding `if (!session?.isActive) return` guard already narrows it) doesn't need to worry about. See Decision 2 and tasks.md 3.1, both corrected to specify this exact scoping rather than a vaguer "capture it at the top of the function.")

**Load-bearing assumption, verified against the current implementation (not carried over from `startScan()`'s case unexamined):** `addScanner()`'s returned promise never resolves until `spawnSingleScanner()` has fully settled and updated `this.subprocesses`/`this.initErrors`, on _both_ code paths through `addScanner()`:

- **Idle path** (`isScanning === false`, `scan-coordinator.ts:267`): `await this.spawnSingleScanner(config)` — a direct await, settles before `addScanner()` returns. This is the same path `startScan()`'s existing check relies on.
- **Mid-cycle queued path** (`isScanning === true`, the path `retryScanner()` actually exercises in practice — a retry happens in response to a wedge auto-pause, which fires _during_ an active scan session): the `queued` promise (`scan-coordinator.ts:244-261`) only calls `resolve()` inside `spawnSingleScanner(config).catch(...).finally(...)` — i.e. also only after `spawnSingleScanner()` fully settles, not merely after it's scheduled.

`spawnSingleScanner()` itself (`scan-coordinator.ts:301-406`) updates `this.subprocesses` / `this.initErrors` and emits `scanner-init-status` synchronously relative to its own `await sub.spawn()` — no gap where the promise resolves before state is written. On success, `sub.spawn()` resolves from its `onReady` handler, which runs after `handleLine()`'s `case 'ready'` has already set `this.state = 'ready'` synchronously (`scanner-subprocess.ts:414-416`) — so `isReady` is correct by the time `spawn()`'s promise settles. On failure, `spawnSingleScanner()`'s `catch` block (`scan-coordinator.ts:393-404`) unconditionally deletes the entry from `this.subprocesses` and records `initErrors`, regardless of what `sub.state` happens to be left at — this is what actually matters for `getScannerStatuses()`'s correctness, not the subprocess's own `isReady`/`isAlive` getters. (One specific edge, noted for completeness: `handleLine()`'s `case 'error'` branch, `scanner-subprocess.ts:419-426`, never updates `this.state`, so a subprocess that emits an init-time error keeps `state === 'starting'` — `isAlive` would misreport `true` if read directly. It's harmless here only because `getScannerStatuses()` never reads a subprocess's own getters once `spawnSingleScanner()`'s catch block has removed it from `this.subprocesses` and populated `initErrors` instead.)

Net: there is no async gap between "`addScanner()` resolved" and "the `subprocesses`/`initErrors` state `getScannerStatuses()` reads is accurate" on either path. Calling `getScannerStatuses()` immediately after `await coordinator.addScanner(...)` is safe.

### Decision 2: Log the new failure path, matching the "rejected respawn" precedent — and include `session_id`/`cycle_number`

The existing spec's "A rejected respawn is caught and surfaced, not left unhandled" scenario requires a log entry when `addScanner()` throws. The new silent-failure path (status check fails, no throw) is the same operational event from an operator's perspective — a retry that didn't actually bring the scanner back — so it gets the same `scanLog()` treatment for consistency and rig-log traceability. The five early-return guard-rail failures (no active session, no live coordinator, scanner not found, missing USB identity, disabled) are unchanged and still don't log, since those are input-validation rejections that never touch the coordinator, not spawn failures.

All three `retryScanner()` log lines (success, the pre-existing caught-rejection failure, and the new status-check failure) now also include `session=${session.sessionId} cycle=${session.currentCycle}`, matching the precedent set by `WedgeDetector`'s auto-pause log line (`[WedgeDetector] auto-paused scanner=... session=${evt.session_id} cycle=${evt.cycle_number}`, from the archived wedge-response-ui proposal). That line added those fields specifically to disambiguate cycle numbers across sessions that share a calendar-day log file — the same ambiguity otherwise applies to retry-outcome lines. This requires declaring `session` _before_ the function's `try`/`catch` split (not merely "at the top of the `try` block"), since the failure-path log line lives in the `catch` block, a sibling scope — see the code sample in Decision 1 above for the exact shape.

## Risks / Trade-offs

- The verified settle-timing assumption is specific to the current `ScanCoordinator`/`ScannerSubprocess` implementation, not an invariant enforced by an interface or test. If either module's internal timing changes in the future (e.g. `spawnSingleScanner()` starts resolving before fully updating state), this check would silently stop being trustworthy. Mitigation: the new unit test asserts the failure path end-to-end through the mock, which will catch a regression in `retryScanner()`'s own logic, but not a regression in the real coordinator's timing — that would need an integration/E2E test, which is out of scope for this fix (matches the existing test pyramid: `session-handlers.test.ts` mocks the coordinator entirely, same as its `startScan()` tests).
- **Pre-existing, undisclosed-until-now latency hazard (not introduced by this fix, but surfaced by this fix's own analysis of the code path):** `retryScanner()` directly `await`s `coordinator.addScanner(...)`. A wedge auto-pause stops only the one wedged worker (`coordinator.stopScanner()`) — it never touches `coordinator.state`, so `isScanning` stays `true` for the rest of an active session. That means the retry an operator triggers after power-cycling a wedged scanner almost always exercises `addScanner()`'s **mid-cycle queued path**, not the idle path: the returned promise only resolves on the _next_ `cycle-complete` event. `register-handlers.ts` already documents this exact hazard elsewhere in its own words ("hold this IPC response open for a full scan interval... potentially hours for a continuous session") but works around it with a fire-and-forget pattern; `retryScanner()` does not. Net effect: an operator who confirms a retry mid-cycle can see the "Confirm Retry" button's loading state (and the `retriesInFlight` guard) hang for up to a full scan interval before getting _any_ answer — success or the newly-accurate failure this proposal adds. This fix makes the eventual answer more trustworthy; it does not make the answer arrive faster. Fixing the latency itself (e.g. adopting `register-handlers.ts`'s fire-and-forget pattern for `retryScanner()`) is a larger behavioral change to the IPC contract and is out of scope here — flagged for a follow-up issue, not blocking this fix.

## Open Questions

None. The fix, its logging behavior, and the settle-timing assumption are all verified against the current code. The latency hazard above is a known, disclosed limitation, not an open question — it doesn't affect the correctness of this fix's success/failure reporting, only how quickly that reporting can arrive on the queued path.
