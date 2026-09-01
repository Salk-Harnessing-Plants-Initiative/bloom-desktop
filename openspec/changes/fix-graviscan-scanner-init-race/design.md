## Context

`ScanCoordinator.spawnSingleScanner()` (private, `src/main/graviscan/scan-coordinator.ts:301-406`) is the single choke point both `initialize()` (line 148-182, called from `scanner-handlers.ts`'s Reset USB flow and `session-handlers.ts`'s start-scan flow) and `addScanner()` (line 228-268, the retry-scanner UI flow — see `session-handlers.ts`'s `retryScanner()`, line 339-407, and `scanner-upsert.ts:217-219,244-249`) funnel through. `register-handlers.ts` (~line 136) also calls `addScanner()` fire-and-forget when a newly-detected scanner is added.

`spawnSingleScanner()` currently:

1. Reads `this.subprocesses.get(scannerId)`.
2. If `existing.isReady`, reuses it and returns.
3. Otherwise, if `existing` is present at all, calls `existing.shutdown(5000)` and deletes it, then unconditionally constructs a new `ScannerSubprocess` and spawns it.

The bug: `this.subprocesses.set(scannerId, sub)` happens **synchronously at line 375**, before `await sub.spawn()` (line 387) resolves. For the ~30 seconds a worker spends inside `sane.open()`, `this.subprocesses` already contains it in `'starting'` state (`isReady === false`). A second, concurrent call to `spawnSingleScanner()` for the same `scannerId` — from a second `initialize()` call, from `addScanner()`, or both — sees `existing` with `isReady === false` and takes the respawn branch, calling `existing.shutdown(5000)` on a subprocess that's blocked inside a libusb device-open call. `shutdown()` can't reclaim it in 5s (see below), so a second, independent `ScannerSubprocess` gets constructed and spawned alongside the first. Both survive; half never connect and leak forever.

Separately, `ScannerSubprocess.shutdown()` (`src/main/graviscan/scanner-subprocess.ts:360-381`) resolves as soon as `kill()` is called on timeout — `kill()` sets `this.state = 'dead'` synchronously (line 354) regardless of whether the OS process has actually exited, and `shutdown()`'s promise resolves in the same tick without waiting for the real `'exit'` event. For a process stuck in an uninterruptible libusb ioctl (D-state), `SIGKILL` does not reliably reap it — issue #125's rig history confirms processes survived days after being "killed." The coordinator deletes the slot from its map believing it's free. There are exactly four call sites of `ScannerSubprocess.shutdown()` in `scan-coordinator.ts`: line 156 (`initialize()`'s stale-subprocess cleanup), line 278 (`stopScanner()`), line 317 (`spawnSingleScanner()`'s respawn branch), and line 764 (the bulk app-level `shutdown()`'s `Promise.all` loop). `killAll()` does **not** call `shutdown()` — it calls `sub.kill()` directly and is unaffected by this change.

`initialize()` also spawns scanners sequentially (`for (const scanner of scanners) { ...; await this.spawnSingleScanner(scanner); }`), a deliberate but since-reconsidered choice (`openspec/changes/archive/2026-04-14-add-graviscan-coordinator-subprocess/design.md:45-47`, "Decision 4... kept, with tracked issue" — that tracked issue is #144). Each subprocess already runs in its own OS process with its own SANE context, so the original SANE-global-state-contention concern doesn't apply across processes.

**This design.md was revised after adversarial review** (5-subagent `openspec-review`) surfaced a genuine regression in an earlier draft that guarded only at the `spawnSingleScanner()` choke point: `stopScanner()` (used by the retry-scanner flow) was left uncoordinated with the new per-`scannerId` guard, and tracing the actual interleaving showed a retry click could newly hang for the full spawn-ready timeout instead of respawning immediately as it does today. That review also found an untested race in `initialize()`'s own preamble (`initErrors.clear()` and stale-subprocess cleanup) that only a coarser, `initialize()`-level guard closes. Both are fixed below (Decisions 1 and 3).

Related, previously-unreferenced issues this change substantially resolves: **#281** (item 3 asks for exactly this class of guard "moved down into `addScanner()`/`spawnSingleScanner()`"; item 2's "retry spawn has no timeout" is addressed by Decision 2's bound) and **#243** (Part A — a duplicate-spawn race between auto-init and the save-scanners-db path — is the same defect class this fix's guard closes; Part B, a DB-identity issue, is unrelated). An old, apparently-abandoned open PR, **#145** ("Parallelize scanner subprocess initialization", claims `Closes #144`), predates the coordinator/subprocess refactor this design is grounded in and should be reviewed and likely closed as superseded once this change merges, to avoid two conflicting parallelization implementations in the repo's history.

## Goals / Non-Goals

- Goals:
  - No two concurrent spawn attempts for the same `scannerId` can ever independently decide to respawn a subprocess that is still connecting — across `initialize()`, `addScanner()`, and any interleaving of the two.
  - A manual `stopScanner()` call (the retry-scanner flow) continues to work immediately, exactly as it does today, even when a spawn for that `scannerId` is in flight from a different caller.
  - `shutdown()` never reports a slot as freed unless the process's actual `exit` event was observed (directly, or after a bounded post-`SIGKILL` confirmation window), and every real call site of it is updated consistently, not just the ones directly on the bug's critical path.
  - A spawn attempt that can neither confirm readiness nor confirm a reclaim within bounded time reports failure for that scanner through the existing error-reporting channel, with a message specific enough to distinguish "timed out" from "failed immediately" — without adding a new user-facing messaging surface.
  - `initialize()` spawns all scanners concurrently; one scanner's failure does not block the others; total wall-clock is dominated by the slowest scanner, not the sum; and two concurrent `initialize()` calls (even with different scanner lists) cannot race on shared preamble state (`initErrors.clear()`, stale-subprocess cleanup).
- Non-Goals:
  - Recovering a genuinely hardware-wedged scanner. Per issue #125's documented rig history, a kernel-level USB reset makes V600 wedges _worse_, not better, and was deliberately removed (commit `48ac5d8`/#228); the only documented recovery is a physical AC power-cycle (`openspec/specs/scanning/spec.md:2371`'s Slack alert copy). This change stops the app from _misdiagnosing_ a healthy, still-connecting worker as one of these — it cannot and does not attempt to fix a real wedge.
  - Cleaning up OS-level processes orphaned by killing the Electron app itself (`pkill`-pattern gap, noted as separable in #350).
  - Changing the 5-second USB stagger inside `scanOnce()` (a distinct, valid constraint per #144's own text).
  - Any renderer/UI changes or new user-facing error copy (the message-content fix in Decision 3 reuses the existing `initErrors`/`scanner-init-status` field and channel — same surface, more specific text).
  - A fully general cancellation mechanism for an in-flight spawn attempt. Decision 1's fix to the `stopScanner()` interaction makes a _subsequent_ caller start fresh; it does not make the _original_ in-flight attempt exit early — that attempt still runs to its own `SPAWN_READY_TIMEOUT_MS` bound in the background (see Decision 1's residual note).

## Decisions

### Decision 1: Two-layer guard — coarse `initialize()`-level, plus fine-grained per-`scannerId`

**Layer A — coarse, on `initialize()` itself**, serializing (not memoizing) overlapping calls:

```ts
private initQueue: Promise<void> = Promise.resolve();

async initialize(scanners: ScannerConfig[]): Promise<void> {
  const run = this.initQueue.then(
    () => this.doInitialize(scanners),
    () => this.doInitialize(scanners) // run even if the previous call in the chain somehow threw
  );
  this.initQueue = run.catch(() => {}); // keep the chain alive regardless of this run's outcome
  return run;
}

private async doInitialize(scanners: ScannerConfig[]): Promise<void> {
  // existing body of today's initialize(), plus Decision 4's parallelization
}
```

**This is a queue, not the promise-memoization shape used elsewhere in this design (Layer B, `wiring.ts`'s `getOrCreateCoordinator()`) — and that distinction matters.** An earlier version of this design used the same memoized-single-promise shape for Layer A: a second overlapping call would simply be handed the _first_ call's promise. That is correct for Layer B and for `getOrCreateCoordinator()` because those calls are requesting an equivalent thing (spawn/reuse _this_ `scannerId`; get/create _the_ coordinator singleton) — but `initialize()` calls can carry materially different scanner lists, and review of this design caught that memoizing would silently _drop_ a second call's list entirely: it would resolve successfully having never actually spawned any scanner unique to it. The queue above avoids this — every call to `initialize()` gets its own `doInitialize(scanners)` invocation with its own scanner list, strictly ordered after any call already in the chain, so `initErrors.clear()` and the stale-subprocess cleanup loop (today's lines 152-168) only ever run once at a time (closing the untested preamble race an earlier draft of this design missed) without ever silently discarding a caller's request. The trade-off is the same as before — a second caller waits for the first call's entire run to finish before its own begins — acceptable because both real call sites (Reset USB, start-scan) are rare, human-triggered actions, not a hot path. A minor, acceptable cost: two back-to-back calls with the _identical_ scanner list now run `doInitialize()` twice instead of sharing one in-flight promise, but the second run is cheap — by the time it starts, every scanner is already `ready` in `this.subprocesses`, so Layer B's reuse path makes it a fast no-op pass, not a real respawn.

**Layer B — fine-grained, per-`scannerId`, at the shared `spawnSingleScanner()` choke point:**

```ts
private spawnInFlight = new Map<string, Promise<void>>();

private async spawnSingleScanner(config: ScannerConfig): Promise<void> {
  const inFlight = this.spawnInFlight.get(config.scannerId);
  if (inFlight) return inFlight;

  const promise = this.doSpawnSingleScanner(config).finally(() => {
    this.spawnInFlight.delete(config.scannerId);
  });
  this.spawnInFlight.set(config.scannerId, promise);
  return promise;
}

private async doSpawnSingleScanner(config: ScannerConfig): Promise<void> {
  // existing body of today's spawnSingleScanner(), plus Decision 2's timeout handling
}
```

Layer A alone does not cover `addScanner()` (the retry-scanner flow), which is a separate entry point into the same `spawnSingleScanner()` and is not gated by the `initQueue`. Layer B is what prevents `addScanner()` from racing a concurrent `initialize()` (or another `addScanner()`) on the same `scannerId`. This is the same promise-memoization shape already used at a different layer in `wiring.ts:386-429`'s `getOrCreateCoordinator()`.

**Consequence — the `isAlive`/`isReady` distinction becomes structural, not a new check.** Because no two `doSpawnSingleScanner()` executions for the same `scannerId` ever run concurrently, by the time a _new_ invocation begins, `this.subprocesses.get(scannerId)` is guaranteed to be either absent or `'ready'` — never `'starting'`. `ScannerSubprocess.isAlive` is not consulted by this fix — it was a red herring surfaced during scoping, not the actual mechanism. The existing "shut down dead/stuck subprocess before respawning" branch (today's lines 311-319) therefore becomes unreachable in normal operation once both guard layers are in place (see Decision 3's treatment of it — kept as a defensive fallback, not deleted, since this is safety-relevant hardware-control code and a future change could inadvertently violate the invariant).

**Fixing the `stopScanner()` regression an earlier draft of this design introduced.** `stopScanner()` (`scan-coordinator.ts:274-281`, called by `retryScanner()` in `session-handlers.ts` immediately followed by `addScanner()`) reads `this.subprocesses.get(scannerId)`, calls `sub.removeAllListeners()`, `await sub.shutdown(5000)`, then deletes the entry. If a spawn for that `scannerId` is in flight (Layer B) when `stopScanner()` runs, `removeAllListeners()` strips the very listeners the in-flight `sub.spawn()` promise depends on to ever settle via the normal ready/exit path — so without a fix, that in-flight promise would only ever resolve via its own `SPAWN_READY_TIMEOUT_MS` timeout (Decision 2), and the `addScanner()` call `retryScanner()` makes immediately afterward would find the stale entry still in `spawnInFlight` and join it — turning today's immediate retry into a 45-second hang. Fix: `stopScanner()` also deletes any `spawnInFlight` entry for that `scannerId`:

```ts
async stopScanner(scannerId: string): Promise<void> {
  this.spawnInFlight.delete(scannerId);
  const sub = this.subprocesses.get(scannerId);
  if (!sub) return;
  sub.removeAllListeners();
  const confirmed = await sub.shutdown(5000);
  if (!confirmed) {
    console.warn(`[ScanCoordinator] stopScanner(${scannerId}): shutdown could not be confirmed`);
  }
  this.subprocesses.delete(scannerId);
  this.initErrors.delete(scannerId);
}
```

A subsequent `addScanner()`/`initialize()` call for that `scannerId` now finds no `spawnInFlight` entry and starts a genuinely fresh spawn attempt immediately — restoring today's behavior. The _original_ in-flight attempt (whichever caller started it) is not cancelled: its own `doSpawnSingleScanner()` keeps running in the background, its `withTimeout()` race still fires after `SPAWN_READY_TIMEOUT_MS` regardless of the stripped listeners (the timeout side of the race is a plain timer, independent of `sub`'s event listeners), and its own `reclaimUnresponsive()` then runs against a `sub` that `stopScanner()` has typically already shut down (idempotent — `shutdown()`'s already-dead guard returns `true` immediately). **Residual, accepted limitation**: the orphaned original attempt and the fresh retry attempt both eventually write to the same `initErrors` key; whichever settles last wins the displayed message. This is a cosmetic last-write-wins race on a diagnostic string, not a duplicate-worker or hang bug, and is not worth the added complexity of a full cancellation mechanism (see Non-Goals).

### Decision 2: Bounded wait on `sub.spawn()` inside `doSpawnSingleScanner()`

`ScannerSubprocess.spawn()` deliberately has no internal timeout ("SANE open can be slow with some backends" — `scanner-subprocess.ts:278`), and that choice is not being revisited here. But `doSpawnSingleScanner()` needs to give up _from the coordinator's perspective_ if a worker never signals ready or dies, or every current and future caller sharing the Decision 1 guards' promises hangs forever.

Add a module-level constant `SPAWN_READY_TIMEOUT_MS = 45_000` (the observed device-open budget is a flat 30.0s per #350's log evidence — notably measured under _worse_ contention than steady state, 10 concurrent workers fighting for USB — plus 15s margin for scheduling jitter). Race `sub.spawn()` against this timeout:

```ts
try {
  await withTimeout(sub.spawn(), SPAWN_READY_TIMEOUT_MS);
  // ...existing ready-path unchanged...
} catch (err) {
  if (err instanceof SpawnTimeoutError) {
    await this.reclaimUnresponsive(config.scannerId, sub); // Decision 3
    return;
  }
  // ...existing catch-path unchanged (ENOENT / exit-before-ready / init-error)...
}
```

**Corrected note on the abandoned promise** (an earlier draft of this design stated the abandoned `sub.spawn()` promise "will eventually settle, most likely reject" once `reclaimUnresponsive()`'s `kill()` triggers `spawn()`'s own `exit`/`process-error` listeners — this was wrong, per review). `reclaimUnresponsive()` (Decision 3) calls `existing.removeAllListeners()` before `shutdown()`, which strips exactly those listeners first — matching the pre-existing convention already used by today's respawn branch (line 316) for the same reason. So the abandoned `sub.spawn()` promise does not reject; it simply never settles. This is safe (a permanently-pending promise with nothing awaiting it cannot produce an unhandled-rejection warning), and is the same shape already accepted implicitly by the current codebase's respawn path. `withTimeout()`'s implementation should still attach a no-op `.catch(() => {})` to the raced-away promise defensively (in case a future change to `ScannerSubprocess` ever makes it settle after all), but it is not load-bearing for correctness today — it is cheap insurance, not the actual safety mechanism.

### Decision 3: Confirmed (honest) `shutdown()`, consistently applied at all four call sites

Change `ScannerSubprocess.shutdown()`'s return type from `Promise<void>` to `Promise<boolean>` (`true` = the process's `exit` event was actually observed, or it was already gone; `false` = force-killed but exit could not be confirmed within a further bounded window). Two-phase timeout:

```ts
async shutdown(timeoutMs = SHUTDOWN_TIMEOUT_MS): Promise<boolean> {
  if (!this.proc || this.state === 'dead' || this.state === 'idle') return true;

  this.quit();
  this.rl?.close();
  this.stderrRl?.close();

  return new Promise<boolean>((resolve) => {
    const graceTimeout = setTimeout(() => {
      this.kill(); // unchanged: SIGKILL, sets state='dead' immediately (existing callers depend on this for the app-quit fast path)
      const confirmTimeout = setTimeout(() => resolve(false), KILL_CONFIRM_TIMEOUT_MS);
      this.proc!.once('exit', () => {
        clearTimeout(confirmTimeout);
        resolve(true);
      });
    }, timeoutMs);

    this.proc!.once('exit', () => {
      clearTimeout(graceTimeout);
      resolve(true);
    });
  });
}
```

`SHUTDOWN_TIMEOUT_MS = 5_000` (module-level constant in `scanner-subprocess.ts`, matching the value every current call site already passes as a literal default). `KILL_CONFIRM_TIMEOUT_MS = 2_000` — a live process should be reaped within milliseconds of `SIGKILL`; a longer wait doesn't help a genuinely D-state process, so this window only needs to be long enough to observe a _normal_ kill's exit event, not to try to outlast a real wedge. Neither constant has been empirically validated against real rig hardware timing (only against the log evidence and unit tests) — flagged in Risks below.

`kill()`'s own contract (sets `state = 'dead'` immediately, used by `killAll()`'s app-quit fast path where confirmation genuinely doesn't matter) is intentionally left unchanged — only `shutdown()`'s caller-facing signal changes.

**All four real call sites are updated to act on the new signal, not just the two on the bug's critical path** (an earlier draft of this design updated only 2 of 4 and mischaracterized which sites existed — TypeScript gives no compiler error for an ignored boolean return, so this must be done deliberately, not left to be "caught" by type-checking):

- **`initialize()`'s stale-subprocess cleanup** (line 156): log a warning identifying the scanner when `shutdown()` returns `false`. Control flow unchanged — the entry is still deleted from `this.subprocesses` either way, since the scanner isn't in the new config and there's nothing further to do with it.
- **`stopScanner()`** (line 278): see Decision 1 — also logs a warning on `false`.
- **`spawnSingleScanner()`'s respawn branch** (line 317, inside `doSpawnSingleScanner()` post-refactor): per Decision 1's consequence, this branch is unreachable in normal operation once both guard layers are active. It is kept as a defensive fallback (this is safety-relevant hardware-control code; a future change could violate the invariant without anyone noticing immediately) but now logs a loud warning (`console.error`, distinct from the routine warnings above) identifying that the guard invariant was unexpectedly violated, in addition to consuming the confirmed/unconfirmed result the same way.
- **The bulk `shutdown()` method's `Promise.all` loop** (line 764): today the "Graceful shutdown" spec scenario already claims force-killed subprocesses are handled cleanly; this change makes that literally true by checking each `shutdown()` call's result and logging a warning identifying any scanner whose exit could not be confirmed, before clearing the subprocess map.

**`reclaimUnresponsive(scannerId, sub)`** (Decision 2's timeout path): calls `existing.removeAllListeners()`, `await existing.shutdown()` (relying on `shutdown()`'s own `SHUTDOWN_TIMEOUT_MS` default — `SHUTDOWN_TIMEOUT_MS` is a `scanner-subprocess.ts`-local constant, not imported into `scan-coordinator.ts`), deletes the entry from `this.subprocesses` regardless of the result (the coordinator stops tracking it as active either way — see Non-Goals), and reports through the _existing_ error channel: `this.initErrors.set(scannerId, message)` + `this.emit('scanner-init-status', { scannerId, status: 'error', error: message })` + `scanLog()` (added per scientific-rigor review — today's coordinator-level logging is `console.log`/`console.error` only, which is lost in a packaged app; routing this specific failure through `scanLog()` makes it survive in the same durable log file `~/.bloom/logs/graviscan-*.log` that #350's own bug report relied on for forensic diagnosis). The message text is explicit about which failure mode occurred — e.g. `` `Scanner ${scannerId} did not become ready within ${SPAWN_READY_TIMEOUT_MS}ms (spawn-ready timeout)` `` versus the existing ENOENT/exit-before-ready messages — so a researcher reading the log three days later can distinguish "timed out, possibly still running" from "failed immediately, definitely not running." This is still the same field and channel as every other init failure (no new user-facing surface), just specific content within it — directly addresses the scientific-rigor review's finding that a generic, undifferentiated message would erase the one diagnostic signal (#125's central "wedged vs. slow" question) this fix has the information to provide.

It does **not** attempt to spawn a replacement in the same cycle, regardless of whether `shutdown()` returned `true` or `false`: even a confirmed-exited worker that still took 45s+ to fail is worth surfacing as a failure for this cycle rather than silently retrying once more against a device that has already shown itself to be slow/unhealthy; a future `initialize()`/`addScanner()` call will naturally retry from a clean slate since the entry is gone from both `this.subprocesses` and `spawnInFlight`.

### Decision 4: Parallelize `initialize()`'s per-scanner loop

```ts
const results = await Promise.allSettled(
  scanners.map((scanner) => this.spawnSingleScanner(scanner))
);
for (const result of results) {
  if (result.status === 'rejected') {
    console.error(
      '[ScanCoordinator] Unexpected spawn rejection (should be unreachable):',
      result.reason
    );
  }
}
```

`spawnSingleScanner()` (via `doSpawnSingleScanner()`) already never throws — every failure path (`ENOENT`/exit-before-ready/init-error, and the new Decision 2/3 timeout path) catches internally and records into `initErrors` instead of rejecting. `Promise.allSettled` is used anyway (matching #144's explicit ask) as defense-in-depth against a future regression reintroducing a throw; the defensive log above is new — it costs nothing and turns a silently-swallowed future regression into a visible one.

The `if (this.cancelled) break;` check inside the old sequential loop (line 172) no longer applies per-iteration under `Promise.allSettled` — `cancelAll()`/`this.cancelled` govern `scanOnce()`/`scanInterval()`, not `initialize()`, and no existing test exercises cancellation during `initialize()` itself, so this is a no-op removal, not a behavior change.

This is now safe to do concurrently for _different_ `scannerId`s because Decision 1's Layer B guard makes per-scanner spawns non-racing with each other and with any concurrent `addScanner()` call, and Decision 1's Layer A guard means only one `doInitialize()` body — and therefore only one execution of the preamble cleanup/`initErrors.clear()` — ever runs at a time regardless of how many `initialize()` calls overlap.

## Risks / Trade-offs

- **Residual OS-level leaked processes for a truly wedged scanner** → Accepted (Non-Goal). Each failed attempt across repeated `initialize()` calls can still leave one orphaned process behind if the scanner is genuinely wedged (not just slow) — this change stops the app's _own bookkeeping_ from ever tracking more than one worker per `scannerId` at a time, and stops it from hanging, but it cannot force an OS-level D-state process to exit. Cleaning up real orphans is the separable, explicitly out-of-scope "killing the app orphans workers" problem.
- **`SPAWN_READY_TIMEOUT_MS = 45_000` graduates from an edge-case safety margin to a load-bearing constant for every cold start**, since Decision 4 makes 5-way concurrent SANE opens the normal case for every `initialize()` call, not just the rare double-init race #350 hit. The cited 30.0s evidence is unusually strong (consistent to millisecond precision across 5 scanners under worse-than-normal contention — a fixed driver-level timeout, not organic variance), but it's still single-rig, single-backend evidence. **Recommend empirical validation on the real 5-scanner rig timing a normal concurrent `initialize()` call, in addition to unit tests with mocked delays, before or shortly after merge** — not a blocker for merging behind unit-test coverage, but a real hardware-validation follow-up, not optional polish.
- **`KILL_CONFIRM_TIMEOUT_MS = 2_000` is similarly unvalidated against real post-SIGKILL reap latency on this hardware/OS combination.** Lower-stakes than the above: per Decision 2/3, no duplicate spawn occurs regardless of whether this window returns `true` or `false`, so an incorrect value only affects the honesty of the `true`/`false` signal and log wording, not the anti-duplication guarantee itself.
- **`shutdown()`'s return-type change from `Promise<void>` to `Promise<boolean>`** is a private-internal-API change (not part of any public IPC contract) — TypeScript does not flag an ignored boolean return as an error, so all four real call sites are updated deliberately in this change (see Decision 3) rather than relying on the compiler to catch stragglers. A pre-existing, separate test file (`tests/unit/scan-coordinator-add-scanner.test.ts`) has its own hand-rolled `ScannerSubprocess` mock whose `shutdown()` resolves `undefined`; tasks.md updates it explicitly rather than leaving it to silently diverge.
- **Cosmetic last-write-wins race on `initErrors`** between an orphaned original spawn attempt and a fresh retry attempt for the same `scannerId` (Decision 1's `stopScanner()` fix) — accepted, see Decision 1.

## Post-implementation `/review-pr` findings (fixed)

A 5-subagent adversarial review of the implemented diff (not just the proposal) found two genuine, independently-converging bugs the implementation itself introduced, both fixed before merge:

- **BLOCKING — identity mismatch after an await.** `reclaimUnresponsive()` and the generic spawn-failure catch branch in `doSpawnSingleScanner()` originally deleted `this.subprocesses`/reported `initErrors` **unconditionally by `scannerId`**, with no check that the map still held the _same instance_ the stale attempt was tracking. Since an orphaned attempt (Decision 1's accepted residual — the original attempt behind a `stopScanner()`-cleared guard keeps running to its own `SPAWN_READY_TIMEOUT_MS` bound) can settle up to 45s after a `stopScanner()`+`addScanner()` retry already installed a healthy replacement at the same key, the orphaned attempt's own cleanup would silently evict the healthy replacement and falsely report it as failed. **Fix**: both sites now check `this.subprocesses.get(scannerId) === sub` before touching shared state; a mismatch means a newer attempt has already taken over, and the stale attempt only tries to reclaim its own resources without reporting anything. The same identity-guard pattern was applied defensively to the `sub.on('exit', ...)` map-delete and the `spawnInFlight` `.finally()` cleanup, even though those two are not currently reachable by this exact race (every replacement path already strips the old instance's listeners synchronously before a replacement can be constructed) — the guard makes that invariant self-enforcing rather than relying on every future edit preserving it.
- **BLOCKING — stale `isReady` during the shutdown grace window silently drops legitimate spawn requests.** `ScannerSubprocess.isReady` doesn't flip to `false` until the OS process's real `exit` event fires — up to ~7s after `shutdown()` is called (5s grace + 2s kill-confirm). The original `stopScanner()` (and `doInitialize()`'s stale-cleanup loop, and the defensive-fallback branch) deleted the map entry only _after_ awaiting that shutdown. During that multi-second window, a concurrent `addScanner()` call for the same `scannerId` would see `hasWorker()`/`existing.isReady` still `true` and silently no-op, believing the scanner was already up — permanently dropping it with **zero error surfaced anywhere**. This is the mirror-image of #350's original duplicate-spawn bug: instead of two workers, there'd be none, and unlike every other failure path in this design, nothing would report it. **Fix**: all three sites (`stopScanner()`, `doInitialize()`'s stale-cleanup, the defensive-fallback branch) now remove the map entry (and, for `stopScanner()`, the stale `initErrors` entry) _before_ awaiting `shutdown()`, not after — closing the staleness window at its source rather than patching each caller that might observe it.
- **IMPORTANT — bulk `shutdown()` didn't strip listeners before force-killing.** Every other teardown path (`stopScanner()`, the defensive-fallback branch, `reclaimUnresponsive()`) calls `sub.removeAllListeners()` before `sub.shutdown()`; the bulk app-level `shutdown()` loop didn't. A subprocess still mid-spawn has its own `spawn()`-internal `exit` listener still attached, which rejects with "process exited before becoming ready" once a forced kill actually exits the process — surfacing a spurious "init failed" report for a scanner that was in fact cleanly, deliberately shut down (e.g. via a scan cancel). **Fix**: added the same `removeAllListeners()` call, matching every other site's convention.
- **IMPORTANT — the immediate-spawn-failure path (ENOENT/exit-before-ready/init-error) never wrote to `scanLog()`**, only `console.error` (lost in a packaged app) — the exact durability gap this change's own `scanLog()` addition to `reclaimUnresponsive()` was supposed to close, half-closed. **Fix**: added the matching `scanLog()` call to the immediate-failure branch too, so both failure modes are equally durable in `~/.bloom/logs/graviscan-*.log`.

All four fixes are covered by new regression tests, each independently verified to fail red against the pre-fix code before the fix was restored (not merely inspected). See tasks.md's updated section list for the exact test names.
