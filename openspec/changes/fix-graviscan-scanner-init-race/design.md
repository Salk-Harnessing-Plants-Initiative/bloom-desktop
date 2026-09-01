## Context

`ScanCoordinator.spawnSingleScanner()` (private, `src/main/graviscan/scan-coordinator.ts:301-406`) is the single choke point both `initialize()` (line 148-182, called from `scanner-handlers.ts`'s Reset USB flow and `session-handlers.ts`'s start-scan flow) and `addScanner()` (line 228-268, the retry-scanner UI flow) funnel through. It currently:

1. Reads `this.subprocesses.get(scannerId)`.
2. If `existing.isReady`, reuses it and returns.
3. Otherwise, if `existing` is present at all, calls `existing.shutdown(5000)` and deletes it, then unconditionally constructs a new `ScannerSubprocess` and spawns it.

The bug: `this.subprocesses.set(scannerId, sub)` happens **synchronously at line 375**, before `await sub.spawn()` (line 387) resolves. For the ~30 seconds a worker spends inside `sane.open()`, `this.subprocesses` already contains it in `'starting'` state (`isReady === false`). A second, concurrent call to `spawnSingleScanner()` for the same `scannerId` — from a second `initialize()` call, from `addScanner()`, or from both — sees `existing` with `isReady === false` and takes the respawn branch, calling `existing.shutdown(5000)` on a subprocess that's blocked inside a libusb device-open call. `shutdown()` can't reclaim it in 5s (see below), so a second, independent `ScannerSubprocess` gets constructed and spawned alongside the first. Both survive; half never connect and leak forever.

Separately, `ScannerSubprocess.shutdown()` (`src/main/graviscan/scanner-subprocess.ts:360-381`) resolves as soon as `kill()` is called on timeout — `kill()` sets `this.state = 'dead'` synchronously (line 354) regardless of whether the OS process has actually exited, and `shutdown()`'s promise resolves in the same tick without waiting for the real `'exit'` event. For a process stuck in an uninterruptible libusb ioctl (D-state), `SIGKILL` does not reliably reap it — issue #125's rig history confirms processes survived days after being "killed." The coordinator deletes the slot from its map believing it's free.

`initialize()` also spawns scanners sequentially (`for (const scanner of scanners) { ...; await this.spawnSingleScanner(scanner); }`), a deliberate but since-reconsidered choice (`openspec/changes/archive/2026-04-14-add-graviscan-coordinator-subprocess/design.md:45-47`, "Decision 4... kept, with tracked issue" — that tracked issue is #144). Each subprocess already runs in its own OS process with its own SANE context, so the original SANE-global-state-contention concern doesn't apply across processes.

## Goals / Non-Goals

- Goals:
  - No two concurrent spawn attempts for the same `scannerId` can ever independently decide to respawn a subprocess that is still connecting.
  - `shutdown()` never reports a slot as freed unless the process's actual `exit` event was observed (directly, or after a bounded post-`SIGKILL` confirmation window).
  - A spawn attempt that can neither confirm readiness nor confirm a reclaim within bounded time reports failure for that scanner through the existing error-reporting channel, without spawning a duplicate.
  - `initialize()` spawns all scanners concurrently; one scanner's failure does not block the others; total wall-clock is dominated by the slowest scanner, not the sum.
- Non-Goals:
  - Recovering a genuinely hardware-wedged scanner. Per issue #125's documented rig history, a kernel-level USB reset makes V600 wedges *worse*, not better, and was deliberately removed (commit `48ac5d8`/#228); the only documented recovery is a physical AC power-cycle (`openspec/specs/scanning/spec.md:2371`'s Slack alert copy). This change stops the app from *misdiagnosing* a healthy, still-connecting worker as one of these — it cannot and does not attempt to fix a real wedge.
  - Cleaning up OS-level processes orphaned by killing the Electron app itself (`pkill`-pattern gap, noted as separable in #350).
  - Changing the 5-second USB stagger inside `scanOnce()` (a distinct, valid constraint per #144's own text).
  - Guarding `stopScanner()` against racing a concurrent in-flight spawn for the same `scannerId`. This is a pre-existing gap (not introduced or worsened by this change — `stopScanner()` already reads/deletes `this.subprocesses` without any coordination with `spawnSingleScanner()`) and is a different call path (an explicit manual "stop this scanner" action) than either issue describes. Left as a known, documented limitation rather than expanded scope.
  - Any renderer/UI changes or new user-facing error copy.

## Decisions

### Decision 1: Per-scannerId in-flight-spawn guard, at the shared `spawnSingleScanner()` choke point

Add `private spawnInFlight = new Map<string, Promise<void>>();` to `ScanCoordinator`. Restructure `spawnSingleScanner()` into a thin public-facing wrapper and a private worker:

```ts
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
  // existing body of today's spawnSingleScanner(), plus Decision 3's timeout handling
}
```

A second call for the same `scannerId` — whether from a second `initialize()`, from `addScanner()`, or any interleaving of the two — finds the in-flight promise and awaits *that* rather than reading `this.subprocesses` and making an independent decision. This is the same promise-memoization shape already used at a different layer in `wiring.ts:386-429`'s `getOrCreateCoordinator()`.

**Why guard at `spawnSingleScanner()` rather than only at `initialize()`** (as issue #350's own suggested `initPromise` snippet does): `initialize()`-level memoization would cover `initialize()` vs. `initialize()`, but not `initialize()` vs. `addScanner()` — and `addScanner()` (used by the retry-scanner UI) calls `spawnSingleScanner()` directly for the same `scannerId` an in-flight `initialize()` might be spawning. Guarding at the shared choke point is one mechanism instead of two, and closes that adjacent race instead of leaving it for a future report.

**Consequence — the `isAlive`/`isReady` distinction becomes structural, not a new check.** Because no two `doSpawnSingleScanner()` executions for the same `scannerId` ever run concurrently, by the time a *new* invocation begins, `this.subprocesses.get(scannerId)` is guaranteed to be either absent or in `'ready'` state — never `'starting'`. (A `'starting'` entry only exists between line 375's synchronous `set()` and `sub.spawn()`'s settlement inside the *currently in-flight* `doSpawnSingleScanner()` call, which the guard ensures is the only one running.) The existing `if (existing && existing.isReady)` reuse check therefore remains correct as-is; no new state-inspection logic is needed in the reuse/respawn branch itself. `ScannerSubprocess.isAlive` is not consulted by this fix — it was a red herring surfaced during scoping, not the actual mechanism.

### Decision 2: Bounded wait on `sub.spawn()` inside `doSpawnSingleScanner()`

`ScannerSubprocess.spawn()` deliberately has no internal timeout ("SANE open can be slow with some backends" — `scanner-subprocess.ts:278`), and that choice is not being revisited here. But `doSpawnSingleScanner()` needs to give up *from the coordinator's perspective* if a worker never signals ready or dies, or every current and future caller sharing the Decision 1 guard's promise hangs forever (turning #350's "duplicate processes" bug into a worse "the whole init call, and everyone waiting on it, hangs forever" bug).

Add a module-level constant `SPAWN_READY_TIMEOUT_MS = 45_000` (the observed device-open budget is a flat 30.0s per #350's log evidence; 15s margin for scheduling jitter). Race `sub.spawn()` against this timeout:

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

**Pitfall this must guard against**: if the timeout wins the race, `sub.spawn()`'s own promise is still pending and will eventually settle (most likely *reject*, once `reclaimUnresponsive()`'s `kill()` call — see Decision 3 — triggers the process's `'exit'`/`'process-error'` listeners `spawn()` already wires). Nothing will be attached to that promise's eventual rejection at that point, which Node treats as an unhandled rejection. `withTimeout()`'s implementation must attach a no-op `.catch(() => {})` to the raced-away promise before returning, so its eventual settlement — whenever it comes — is silently absorbed instead of crashing the process.

### Decision 3: Confirmed (honest) `shutdown()`, and no duplicate spawn when it can't confirm

Change `ScannerSubprocess.shutdown()`'s return type from `Promise<void>` to `Promise<boolean>` (`true` = the process's `exit` event was actually observed, or it was already gone; `false` = force-killed but exit could not be confirmed within a further bounded window). Two-phase timeout:

```ts
async shutdown(timeoutMs = 5000): Promise<boolean> {
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

`KILL_CONFIRM_TIMEOUT_MS = 2_000` — a live process should be reaped within milliseconds of `SIGKILL`; a longer wait doesn't help a genuinely D-state process, so this window only needs to be long enough to observe a *normal* kill's exit event, not to try to outlast a real wedge.

`kill()`'s own contract (sets `state = 'dead'` immediately, used by `killAll()`'s app-quit fast path where confirmation genuinely doesn't matter) is intentionally left unchanged — only `shutdown()`'s caller-facing signal changes.

**`reclaimUnresponsive(scannerId, sub)`** (Decision 2's timeout path): calls `existing.removeAllListeners()`, `await existing.shutdown(SHUTDOWN_TIMEOUT_MS)`, deletes the entry from `this.subprocesses` regardless of the result (the coordinator stops tracking it as active either way — see Non-Goals), and reports through the *existing* error channel: `this.initErrors.set(scannerId, message)` + `this.emit('scanner-init-status', { scannerId, status: 'error', error: message })`, using the same plain-diagnostic-string style already used for other init failures (e.g. exception messages) — not new user-facing copy. It does **not** attempt to spawn a replacement in the same cycle, regardless of whether `shutdown()` returned `true` or `false`: even a confirmed-exited worker that still took 45s+ to fail is worth surfacing as a failure for this cycle rather than silently retrying once more against a device that has already shown itself to be slow/unhealthy; a future `initialize()`/`addScanner()` call will naturally retry from a clean slate since the entry is gone.

**Consistency fix at the same primitive**: `initialize()`'s existing stale-subprocess cleanup (line 152-159, `for (const [id, sub] of this.subprocesses) { if (not in new config) { await sub.shutdown(5000); this.subprocesses.delete(id); } }`) has the identical "delete regardless of confirmation" shape. Since `shutdown()`'s signature is changing anyway, this call site is updated to log a warning when `shutdown()` returns `false`, rather than silently treating the slot as freed. It still deletes from `this.subprocesses` either way (the scanner is not in the new config, so the coordinator has nothing further to do with it) — only the honesty of the log changes, not the control flow.

### Decision 4: Parallelize `initialize()`'s per-scanner loop

```ts
const results = await Promise.allSettled(
  scanners.map((scanner) => this.spawnSingleScanner(scanner))
);
```

`spawnSingleScanner()` (via `doSpawnSingleScanner()`) already never throws — every failure path (`ENOENT`/exit-before-ready/init-error, and the new Decision 3 timeout path) catches internally and records into `initErrors` instead of rejecting. `Promise.allSettled` is used anyway (matching #144's explicit ask) as defense-in-depth against a future regression reintroducing a throw; any unexpectedly-`'rejected'` entry is defensively logged, since none is currently expected.

The `if (this.cancelled) break;` check inside the old sequential loop (line 172) no longer applies per-iteration under `Promise.allSettled` — `cancelAll()`/`this.cancelled` govern `scanOnce()`/`scanInterval()`, not `initialize()`, and no existing test exercises cancellation during `initialize()` itself, so this is a no-op removal, not a behavior change.

## Risks / Trade-offs

- **Residual OS-level leaked processes for a truly wedged scanner** → Accepted (Non-Goal). Each failed attempt across repeated `initialize()` calls can still leave one orphaned process behind if the scanner is genuinely wedged (not just slow) — this change stops the app's *own bookkeeping* from ever tracking more than one worker per `scannerId` at a time, and stops it from hanging, but it cannot force an OS-level D-state process to exit. Cleaning up real orphans is the separable, explicitly out-of-scope "killing the app orphans workers" problem.
- **`SPAWN_READY_TIMEOUT_MS = 45_000` is a judgment call** → based on a single rig's observed flat 30.0s device-open cost plus margin; if a different backend/scanner model is slower, a healthy-but-slower worker could be misclassified as unresponsive. Mitigate by keeping it a named, easily-tunable constant, and revisit if a slower device model is ever added.
- **`shutdown()`'s return-type change from `Promise<void>` to `Promise<boolean>`** is a private-internal-API change (not part of any public IPC contract) — existing call sites (`stopScanner()`, `coordinator.shutdown()`'s bulk loop, `killAll()`) that `await` it without using the return value continue to compile and behave identically; only the two call sites this change touches (Decision 3's reclaim path, and `initialize()`'s stale-subprocess cleanup) consume the new signal.
