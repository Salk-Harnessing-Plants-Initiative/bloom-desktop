/**
 * Scan Coordinator
 *
 * Orchestrates multiple ScannerSubprocess instances for parallel scanning.
 * Handles staggered subprocess startup, simultaneous scan triggers,
 * interval/continuous mode timing, and cleanup.
 *
 * Adapted from Ben's scan-coordinator.ts (PR #138) with:
 * - Types imported from shared types file
 * - Implements ScanCoordinatorLike interface
 * - Real per-plate output paths learned from scan-complete events (the
 *   Python worker composes the final _et_-stamped filename at save time,
 *   so no post-save rename is needed — see #154)
 * - File verification after scan-complete
 * - USB stagger delay logged
 * - Dead CoordinatorEvent type removed
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { ScannerSubprocess, ScanWorkerEvent } from './scanner-subprocess';
import { scanLog } from './scan-logger';
import type { PlateConfig, ScannerConfig } from '../../types/graviscan';
import type { ScanCoordinatorLike } from './session-handlers';

// =============================================================================
// Constants
// =============================================================================

/**
 * USB stagger delay in milliseconds between scanner device.start() calls.
 * The epkowa SANE backend uses shared USB resources; simultaneous
 * device.start() calls on the same USB bus cause "Invalid argument".
 */
export const USB_STAGGER_DELAY_MS = 5000;

/**
 * Per-row scan timeout in milliseconds. If any subprocess does not emit
 * cycle-done or exit within this window, it is treated as failed and
 * the coordinator proceeds to the next row group.
 */
export const SCAN_ROW_TIMEOUT_MS = 90_000;

/**
 * Bound on how long a single scanner's spawn attempt is allowed to run
 * without becoming ready or dying, before the coordinator gives up on it
 * (design.md Decision 2). `ScannerSubprocess.spawn()` itself has no
 * internal timeout — this bound exists so a worker that never signals
 * ready or dies doesn't hang the coordinator (and every caller sharing its
 * in-flight-spawn guard promise) forever. The observed device-open budget
 * on the reference rig was a flat 30.0s under worse-than-normal USB
 * contention; this adds 15s margin for scheduling jitter.
 */
export const SPAWN_READY_TIMEOUT_MS = 45_000;

/** Thrown by `withTimeout()` when the wrapped promise doesn't settle in time. */
class SpawnTimeoutError extends Error {}

/** A plate's real final path, as reported by its own scan-complete event. */
export interface PlateOutputPath {
  plateIndex: string;
  path: string;
}

/**
 * How a single scanner's row group ended.
 *
 * - `done` — the worker reported `cycle-done` for the row.
 * - `exit` — the worker process died mid-row on its own (crash, OOM-kill,
 *   or `killAll()` on app quit).
 * - `stopped` — the coordinator deliberately ended the row via
 *   `stopScanner()`, most commonly from wedge auto-pause.
 * - `timeout` — the row hit `SCAN_ROW_TIMEOUT_MS`; already diagnosed at the
 *   moment it fired, so the verification loop must not re-diagnose it.
 *
 * Every outcome carries BOTH the plates the row asked for and whichever
 * real paths arrived before it ended. A row can end after some of its
 * plates already succeeded, so dropping either half would misreport a
 * known-good plate as unknown and skip its on-disk verification.
 */
export type RowOutcomeKind = 'done' | 'exit' | 'stopped' | 'timeout';

export interface RowOutcome {
  kind: RowOutcomeKind;
  scannerId: string;
  /** Real final paths learned from each plate's own scan-complete event. */
  outputPaths: PlateOutputPath[];
  /** Plates sent for this row, with cycle/timestamp-corrected output paths. */
  rowPlates: PlateConfig[];
}

/**
 * Races `promise` against a timeout. If the timeout wins, rejects with
 * `SpawnTimeoutError` — the original `promise` is left to settle on its
 * own (it is not cancelled); attaching a rejection handler to it here
 * (via the two-argument `.then()` below) ensures its eventual settlement,
 * whenever it comes, is never reported as an unhandled rejection.
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SpawnTimeoutError(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// =============================================================================
// Types
// =============================================================================

type CoordinatorState =
  | 'idle'
  | 'initializing'
  | 'scanning'
  | 'waiting'
  | 'shutting-down';

// =============================================================================
// ScanCoordinator
// =============================================================================

export class ScanCoordinator
  extends EventEmitter
  implements ScanCoordinatorLike
{
  private pythonPath: string;
  private isPackaged: boolean;
  private mock: boolean;
  private subprocesses: Map<string, ScannerSubprocess> = new Map();
  private state: CoordinatorState = 'idle';
  private intervalTimer: ReturnType<typeof setTimeout> | null = null;
  private sleepResolve: (() => void) | null = null;
  private cancelled = false;
  private currentCycle = 0;
  private totalCycles = 0;
  private startedAt: number | null = null;
  // Per-grid timestamps (set during scanOnce, injected into scan events)
  private currentGridStartedAt: string | null = null;
  private currentGridEndedAt: string | null = null;
  // Per-scanner spawn error, keyed by scannerId. Populated by
  // spawnSingleScanner() on spawn failure; cleared by stopScanner()
  // and by initialize() (at the top, before repopulating) so a
  // scanner that failed once and later succeeds doesn't keep a stale
  // error entry forever. Consumed by getScannerStatuses().
  private initErrors: Map<string, string> = new Map();
  // Spawns requested while a scan was in flight, keyed by scannerId and
  // holding the promise the caller is awaiting. Used by addScanner() to
  // collapse concurrent requests for the SAME scanner onto one queued
  // spawn; the entry is removed once that spawn settles.
  private pendingAdds: Map<string, Promise<void>> = new Map();
  // Layer A (design.md Decision 1): serializes overlapping initialize()
  // calls so their shared preamble (initErrors.clear(), stale-subprocess
  // cleanup) never races. This is a QUEUE, not a memoized single promise —
  // each call still gets its own doInitialize() run with its own scanner
  // list, strictly ordered after any call already chained. Memoizing would
  // silently drop a concurrent call's differently-scoped scanner list.
  private initQueue: Promise<void> = Promise.resolve();
  // Layer B (design.md Decision 1): per-scannerId in-flight-spawn guard at
  // the shared spawnSingleScanner() choke point used by both initialize()
  // and addScanner(). While a spawn attempt for a scannerId is in flight,
  // any other caller for that same scannerId awaits this same promise
  // instead of independently inspecting subprocess state and deciding to
  // reuse, respawn, or shut down — this is what prevents a second caller
  // from misdiagnosing a still-connecting worker as dead.
  private spawnInFlight: Map<string, Promise<void>> = new Map();

  /**
   * Per-scanner hook that settles that scanner's in-flight row, if any, as
   * `stopped`. Registered while a row is awaiting and cleared as soon as it
   * settles by any route, so an entry here always refers to a live row.
   * `stopScanner()` calls it before stripping listeners — see the comment
   * at the registration site for why the `exit` event cannot serve.
   */
  private inFlightRowSettlers: Map<string, () => void> = new Map();

  constructor(pythonPath: string, isPackaged: boolean, mock = false) {
    super();
    this.pythonPath = pythonPath;
    this.isPackaged = isPackaged;
    this.mock = mock;
  }

  get isScanning(): boolean {
    return this.state === 'scanning' || this.state === 'waiting';
  }

  /**
   * Get the current status of all managed scanner subprocesses,
   * including ones that failed during initialization.
   *
   * Consumed by `graviscan:get-scanner-status` (image-handlers /
   * scanner-handlers) to merge live subprocess state with saved DB
   * rows, reporting `disconnected` for scanners that are saved but
   * have no running subprocess.
   */
  getScannerStatuses(): Array<{
    scannerId: string;
    status: 'ready' | 'starting' | 'error' | 'dead';
    error?: string;
  }> {
    const statuses: Array<{
      scannerId: string;
      status: 'ready' | 'starting' | 'error' | 'dead';
      error?: string;
    }> = [];

    // Active subprocesses
    for (const [id, sub] of this.subprocesses) {
      statuses.push({
        scannerId: id,
        status: sub.isReady ? 'ready' : sub.isAlive ? 'starting' : 'dead',
      });
    }

    // Failed subprocesses (removed from map but tracked in initErrors)
    for (const [id, error] of this.initErrors) {
      if (!this.subprocesses.has(id)) {
        statuses.push({ scannerId: id, status: 'error', error });
      }
    }

    return statuses;
  }

  /**
   * Concurrent initialization: spawn all subprocesses at once via
   * Promise.allSettled (design.md Decision 4, closes #144) — each runs in
   * its own OS process with its own independent SANE context, so the
   * sequential-init-to-avoid-SANE-contention concern this method used to
   * guard against doesn't apply across processes. One scanner's failure
   * does not block the others.
   *
   * Public entry point only: serializes overlapping calls via `initQueue`
   * (design.md Decision 1, Layer A) so their shared preamble
   * (`initErrors.clear()`, stale-subprocess cleanup) never races — see
   * `doInitialize()` for the actual work.
   */
  async initialize(scanners: ScannerConfig[]): Promise<void> {
    // Layer A: serialize overlapping calls (design.md Decision 1). A
    // queue, not a memoized single promise — every call gets its own
    // doInitialize(scanners) run, strictly ordered after any call already
    // chained, so no caller's scanner list is ever silently dropped.
    const run = this.initQueue.then(
      () => this.doInitialize(scanners),
      () => this.doInitialize(scanners) // run even if the previous call in the chain somehow threw
    );
    this.initQueue = run.catch(() => {}); // keep the chain alive regardless of this run's outcome
    return run;
  }

  private async doInitialize(scanners: ScannerConfig[]): Promise<void> {
    this.state = 'initializing';
    this.cancelled = false;

    // Shut down subprocesses for scanners NOT in the new config
    for (const [id, sub] of this.subprocesses) {
      if (!scanners.find((s) => s.scannerId === id)) {
        console.log(`[ScanCoordinator] Shutting down stale subprocess ${id}`);
        // Remove from the map BEFORE awaiting shutdown, not after — same
        // reasoning as stopScanner(): `sub.isReady` stays stale (true)
        // until the OS process actually exits, which can take several
        // seconds, and a concurrent addScanner()/hasWorker() caller must
        // not see this doomed instance as still healthy during that
        // window (see stopScanner()'s comment for the full failure mode).
        this.subprocesses.delete(id);
        const confirmed = await sub.shutdown();
        if (!confirmed) {
          console.warn(
            `[ScanCoordinator] Stale subprocess ${id} shutdown could not be confirmed`
          );
        }
      }
    }

    console.log(
      `[ScanCoordinator] Initializing ${scanners.length} scanner(s)...`
    );

    // Clear previous init errors — otherwise a scanner that failed once
    // and later succeeds keeps a stale error entry forever, feeding wrong
    // data into getScannerStatuses().
    this.initErrors.clear();

    try {
      const results = await Promise.allSettled(
        scanners.map((scanner) => this.spawnSingleScanner(scanner))
      );
      for (const result of results) {
        if (result.status === 'rejected') {
          // spawnSingleScanner() never throws (it isolates failures into
          // initErrors/scanner-init-status internally) — this should be
          // unreachable. Logged defensively so a future regression that
          // reintroduces a throw is visible instead of silently swallowed.
          console.error(
            '[ScanCoordinator] Unexpected spawn rejection (should be unreachable):',
            result.reason
          );
        }
      }
    } finally {
      this.state = 'idle';
    }

    console.log(
      `[ScanCoordinator] All ${scanners.length} scanner(s) initialized`
    );
  }

  /**
   * Returns true iff a subprocess for `scannerId` is in the map AND
   * in the ready state. Lets callers (e.g. a future save-scanners-db
   * handler) skip already-running scanners before calling
   * `addScanner`.
   */
  hasWorker(scannerId: string): boolean {
    const sub = this.subprocesses.get(scannerId);
    return !!sub && sub.isReady;
  }

  /**
   * Spawn a single new scanner subprocess and add it to the map.
   * Idempotent — no-op if a ready worker for `scannerId` already
   * exists (checked here as an optimization so a mid-scan call
   * doesn't queue a spawn it won't need; `spawnSingleScanner()` below
   * also carries its own reuse check for the `initialize()` call site).
   *
   * Mid-scan safety: if `isScanning === true` this method queues the
   * spawn until the next `cycle-complete` event fires. The returned
   * Promise resolves once the queued spawn actually runs — this
   * avoids disrupting the active cycle's event loop with a fresh
   * subprocess spawn.
   *
   * Concurrent requests for the same `scannerId` while a scan is in
   * flight (e.g. an operator double-clicks "Detect") are collapsed onto
   * the single already-queued spawn via `pendingAdds`, so only one
   * subprocess is ever constructed for them.
   *
   * Deduping through `pendingAdds` — rather than having the queued
   * handler re-enter `addScanner()` — is deliberate: `scanOnce()` emits
   * `cycle-complete` on one line and sets `state = 'idle'` on the next,
   * so `isScanning` is still `true` at the synchronous instant every
   * listener runs. A re-entrant call would therefore hit this same
   * `if (this.isScanning)` branch and queue *another* listener instead
   * of ever spawning, repeating forever on each subsequent cycle: the
   * spawn never happened and the returned Promise never resolved,
   * which also wedged the serialized spawn chain in
   * `register-handlers.ts` behind it for the rest of the session.
   *
   * Does not throw on spawn failure — errors surface via the
   * `scanner-init-status` event and are recorded in `initErrors`,
   * matching `spawnSingleScanner()`'s error-isolation behavior.
   */
  async addScanner(config: ScannerConfig): Promise<void> {
    if (this.hasWorker(config.scannerId)) {
      return; // idempotent — already ready
    }

    // If a scan is in flight, queue the spawn until after the cycle
    // completes (do NOT disturb the event loop mid-cycle).
    if (this.isScanning) {
      const pending = this.pendingAdds.get(config.scannerId);
      if (pending) {
        // Already queued for this scanner — hand back the same promise
        // instead of registering a second listener that would spawn a
        // duplicate subprocess (and shut the first down mid-spawn).
        return pending;
      }

      const queued = new Promise<void>((resolve) => {
        const handler = () => {
          this.off('cycle-complete', handler);
          // Call spawnSingleScanner() directly: it carries its own
          // reuse-if-ready / shut-down-dead-before-respawn checks, so
          // idempotency is preserved without re-entering addScanner()
          // (which would re-queue forever — see the doc comment above).
          void this.spawnSingleScanner(config)
            .catch(() => {
              // already logged inside spawnSingleScanner
            })
            .finally(() => {
              this.pendingAdds.delete(config.scannerId);
              resolve();
            });
        };
        this.on('cycle-complete', handler);
      });

      this.pendingAdds.set(config.scannerId, queued);
      return queued;
    }

    await this.spawnSingleScanner(config);
  }

  /**
   * Stop a single scanner subprocess and remove it from the map.
   * No-op if no worker exists for `scannerId`.
   */
  async stopScanner(scannerId: string): Promise<void> {
    // Clear any in-flight spawn-guard entry for this scannerId FIRST, so a
    // subsequent addScanner()/initialize() call for it starts a genuinely
    // fresh spawn attempt instead of joining the (about-to-be-orphaned)
    // in-flight attempt this call is going to strip listeners from below —
    // design.md Decision 1's fix for the retry-scanner regression.
    this.spawnInFlight.delete(scannerId);

    const sub = this.subprocesses.get(scannerId);
    if (!sub) return;

    // Remove from the map and clear any stale error BEFORE awaiting
    // shutdown (which can take up to ~7s), not after. `sub.isReady`
    // doesn't flip until the OS process's real `exit` event fires, so
    // leaving the old entry in place during that window would let a
    // concurrent addScanner()/hasWorker() caller see a doomed instance as
    // still healthy and silently no-op instead of spawning a
    // replacement — a scanner would vanish with no error ever surfaced.
    this.subprocesses.delete(scannerId);
    this.initErrors.delete(scannerId);

    // Settle this scanner's in-flight row (if it has one) BEFORE stripping
    // listeners — afterwards the row's `exit` handler is gone and the row
    // could only end by burning the full SCAN_ROW_TIMEOUT_MS. This is the
    // wedge auto-pause path: wiring.ts calls stopScanner() on the wedged
    // scanner mid-row, and every other scanner's row waits behind it.
    this.inFlightRowSettlers.get(scannerId)?.();

    sub.removeAllListeners();
    const confirmed = await sub.shutdown();
    if (!confirmed) {
      console.warn(
        `[ScanCoordinator] stopScanner(${scannerId}): shutdown could not be confirmed`
      );
    }
  }

  /**
   * Internal: spawn one ScannerSubprocess and wire its events. Shared by
   * both `initialize()`'s per-scanner spawns and `addScanner()` (closes
   * task 7.3 — these used to be two parallel, duplicated implementations).
   *
   * Public entry point only: guards each `scannerId` against concurrent
   * spawn attempts via `spawnInFlight` (design.md Decision 1, Layer B) —
   * see `doSpawnSingleScanner()` for the actual reuse/respawn/spawn work.
   */
  private async spawnSingleScanner(config: ScannerConfig): Promise<void> {
    // Layer B (design.md Decision 1): a spawn attempt already in flight
    // for this scannerId wins — a second caller awaits its outcome
    // instead of independently inspecting subprocess state and deciding
    // to reuse, respawn, or shut down. This is what prevents a healthy,
    // still-connecting worker from being misdiagnosed as dead.
    const inFlight = this.spawnInFlight.get(config.scannerId);
    if (inFlight) {
      return inFlight;
    }

    const promise = this.doSpawnSingleScanner(config).finally(() => {
      // Identity-guarded: only clear the guard entry if it's still THIS
      // call's promise — stopScanner() can clear it earlier (design.md
      // Decision 1), and without this check a very-late-settling orphaned
      // attempt could otherwise delete a different, newer attempt's
      // still-active guard entry out from under it.
      if (this.spawnInFlight.get(config.scannerId) === promise) {
        this.spawnInFlight.delete(config.scannerId);
      }
    });
    this.spawnInFlight.set(config.scannerId, promise);
    return promise;
  }

  /**
   * Carries the same reuse-existing-ready / shut-down-dead-before-respawn
   * checks `initialize()` used to run inline, so both call sites get
   * identical semantics from one place.
   *
   * Does not throw on spawn failure — the entry is removed from the map,
   * the error recorded in `initErrors`, and a `scanner-init-status` event
   * emitted. This isolates one scanner's spawn failure from the others
   * (fixes a latent bug: previously an exception from `sub.spawn()`
   * inside `initialize()`'s loop propagated out of the whole method
   * uncaught, so remaining scanners in the list never got spawned).
   */
  private async doSpawnSingleScanner(config: ScannerConfig): Promise<void> {
    // Reuse existing subprocess if it's still alive and ready
    const existing = this.subprocesses.get(config.scannerId);
    if (existing && existing.isReady) {
      console.log(
        `[ScanCoordinator] Scanner ${config.scannerId} already ready, reusing`
      );
      return;
    }

    // Shut down dead/stuck subprocess before respawning. Unreachable in
    // normal operation once the spawnInFlight guard above is in place: by
    // the time a new spawn attempt begins here, `existing` is guaranteed
    // to be either absent or ready — never `'starting'` — since no two
    // doSpawnSingleScanner() executions for the same scannerId ever run
    // concurrently. A truthy, not-ready `existing` here means that
    // invariant was violated by something outside this guard. Kept as a
    // defensive fallback (this is safety-relevant hardware-control code)
    // rather than deleted, and logged loudly so an invariant violation is
    // visible instead of silently "working" via the old respawn path
    // (design.md Decision 3).
    if (existing) {
      console.error(
        `[ScanCoordinator] INVARIANT VIOLATION: scanner ${config.scannerId} had a not-ready subprocess with no in-flight spawn guard — respawning via the defensive fallback path`
      );
      // Remove from the map before awaiting shutdown, not after (same
      // reasoning as stopScanner()/doInitialize()'s stale-cleanup): we're
      // already committed to replacing `existing` regardless of the
      // shutdown outcome, so there's no reason to leave a doomed,
      // stale-`isReady` entry visible to a concurrent caller in the
      // meantime.
      this.subprocesses.delete(config.scannerId);
      existing.removeAllListeners();
      const confirmed = await existing.shutdown();
      if (!confirmed) {
        console.warn(
          `[ScanCoordinator] Scanner ${config.scannerId} defensive-fallback shutdown could not be confirmed`
        );
      }
    }

    const sub = new ScannerSubprocess(
      this.pythonPath,
      this.isPackaged,
      config.scannerId,
      config.saneName,
      this.mock
    );

    // Forward per-job events on three granular channels — scan-started,
    // scan-complete, scan-error — injecting cycle number and grid start
    // time. The generic scan-event bus (an embedded `type` field) is
    // retired: see design.md Decision 2. scan_ended_at is NOT included
    // here — it is unknown until the row completes. currentGridEndedAt
    // is null for the entire duration of a row's actual scanning (it's
    // only assigned right after Promise.all(rowDonePromises) resolves in
    // scanOnce()) — by the time that happens, any per-plate event this
    // listener forwards for that row has already fired. It IS available
    // in the grid-complete event instead.
    sub.on('event', (event: ScanWorkerEvent) => {
      const jobId = `${event.scanner_id}:${event.plate_index ?? ''}`;
      const forwarded: Record<string, unknown> = {
        ...event,
        jobId,
        scannerId: event.scanner_id,
        plateIndex: event.plate_index,
        cycle_number: this.currentCycle,
        scan_started_at: this.currentGridStartedAt,
      };
      switch (event.type) {
        case 'scan-started':
          this.emit('scan-started', forwarded);
          break;
        case 'scan-complete':
          this.emit('scan-complete', forwarded);
          break;
        case 'scan-error':
          this.emit('scan-error', forwarded);
          break;
        default:
          // ready / scan-cancelled / other worker-internal event types
          // are not part of the granular per-job model and have no
          // listener today — the old generic scan-event bus that used
          // to relay them is intentionally retired, not replaced.
          break;
      }
    });

    sub.on('exit', (info: { scannerId: string; code: number | null }) => {
      console.log(
        `[ScanCoordinator] Subprocess ${info.scannerId} exited with code ${info.code}`
      );
      // Identity-guarded: only remove the map entry if it still points at
      // THIS instance. A natural exit racing a concurrent replacement is
      // not currently reachable (every path that replaces an entry always
      // strips the old instance's listeners first, synchronously, before
      // any replacement can be constructed) but this guard makes that
      // invariant self-enforcing rather than relying on reasoning about
      // every call site staying that way under future changes.
      if (this.subprocesses.get(info.scannerId) === sub) {
        this.subprocesses.delete(info.scannerId);
      }
    });

    this.subprocesses.set(config.scannerId, sub);

    this.emit('scanner-init-status', {
      scannerId: config.scannerId,
      status: 'starting',
    });

    console.log(
      `[ScanCoordinator] Spawning subprocess for scanner ${config.scannerId}...`
    );

    try {
      await withTimeout(sub.spawn(), SPAWN_READY_TIMEOUT_MS);
      console.log(`[ScanCoordinator] Scanner ${config.scannerId} ready`);
      this.emit('scanner-init-status', {
        scannerId: config.scannerId,
        status: 'ready',
      });
    } catch (error) {
      if (error instanceof SpawnTimeoutError) {
        await this.reclaimUnresponsive(config.scannerId, sub);
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[ScanCoordinator] Scanner ${config.scannerId} init failed: ${message}`
      );
      scanLog(`[${config.scannerId}] init failed: ${message}`);
      if (this.subprocesses.get(config.scannerId) !== sub) {
        // A concurrent stopScanner()+addScanner()/initialize() sequence
        // already replaced this entry (e.g. while `withTimeout`'s own
        // internal await gave a narrow window for it) — don't clobber the
        // newer instance's bookkeeping or falsely report it as failed.
        return;
      }
      this.subprocesses.delete(config.scannerId);
      this.initErrors.set(config.scannerId, message);
      this.emit('scanner-init-status', {
        scannerId: config.scannerId,
        status: 'error',
        error: message,
      });
    }
  }

  /**
   * Called when a spawn attempt's `withTimeout()` race times out
   * (design.md Decisions 2 & 3): the worker neither became ready nor
   * died within `SPAWN_READY_TIMEOUT_MS`. Attempts to reclaim it, but
   * regardless of whether that reclaim confirms the process actually
   * exited, does NOT spawn a replacement in this cycle — a future
   * initialize()/addScanner() call will retry from a clean slate since
   * the entry is removed from both `this.subprocesses` and (by the
   * caller's `finally`) `this.spawnInFlight`. Reports through the same
   * `initErrors`/`scanner-init-status`/`scanLog()` channels used for
   * every other spawn failure, with message text that explicitly names
   * this as a timeout so it's distinguishable from an immediate failure.
   *
   * Identity-guarded (BLOCKING finding from review): this attempt can be
   * orphaned by a concurrent `stopScanner()` call (design.md Decision 1's
   * residual note) and only settle here up to ~45s later, by which point
   * a fresh `addScanner()`/`initialize()` retry may have already
   * installed a healthy replacement at the same `scannerId`. This method
   * still attempts to reclaim ITS OWN `sub`'s resources unconditionally,
   * but only touches `this.subprocesses`/`initErrors`/the emitted event
   * if the map still points at `sub` — otherwise it would evict a
   * healthy replacement and falsely report it as failed.
   */
  private async reclaimUnresponsive(
    scannerId: string,
    sub: ScannerSubprocess
  ): Promise<void> {
    sub.removeAllListeners();
    const confirmed = await sub.shutdown();

    if (this.subprocesses.get(scannerId) !== sub) {
      if (!confirmed) {
        console.warn(
          `[ScanCoordinator] Orphaned spawn attempt for ${scannerId} could not confirm its own subprocess exited (a newer attempt has since taken over that scannerId)`
        );
      }
      return;
    }

    this.subprocesses.delete(scannerId);
    const message = `Scanner ${scannerId} did not become ready within ${SPAWN_READY_TIMEOUT_MS}ms (spawn-ready timeout)${
      confirmed ? '' : ' — shutdown could not be confirmed'
    }`;
    console.error(`[ScanCoordinator] ${message}`);
    scanLog(`[${scannerId}] ${message}`);
    this.initErrors.set(scannerId, message);
    this.emit('scanner-init-status', {
      scannerId,
      status: 'error',
      error: message,
    });
  }

  /**
   * Record that a plate ended a cycle with no confirmed image.
   *
   * This line is the ONLY durable record that the plate's outcome is
   * unknown, so it carries enough context to reconstruct the affected wave
   * later without the database: cycle, wave, plate and the full expected
   * path (which itself encodes experiment, wave and scanner).
   *
   * Written for a lab technician rather than an engineer (review round 5,
   * I8):
   *  - leads with `MISSING?`, the same token the grid tally uses, so one
   *    grep finds both halves of the signal;
   *  - states the consequence before the mechanism;
   *  - ends with the action, because "output presence unknown" never got a
   *    plate re-scanned;
   *  - does not label the path `pre-_et_`. No `_et_`-stamped file exists to
   *    look for today (#370), and sending someone hunting for one is worse
   *    than saying nothing.
   *
   * `plate` must come from `platesToScan` where one exists, so its
   * `_cy<N>_` is this cycle's rather than the stale one the row was built
   * from.
   */
  /**
   * Plain-language cause for a row outcome that left a plate unreported.
   *
   * `stopped` covers two very different situations and must not be
   * conflated (review round 6): `stopScanner()` is the wedge auto-pause
   * path and never touches `this.cancelled`, while `cancelAll()` and
   * `shutdown()` both set it before settling the row. Hoisting the
   * diagnostic above the cancel check made the second reachable, so
   * without this split a technician who deliberately pressed Cancel would
   * be told their scanner may have wedged.
   */
  private rowOutcomeCause(kind: RowOutcomeKind): string {
    switch (kind) {
      case 'exit':
        return 'the scanner subprocess exited mid-row';
      case 'stopped':
        return this.cancelled
          ? 'the session was cancelled (or the app quit) mid-row'
          : 'the scanner was stopped mid-row (e.g. wedge auto-pause)';
      case 'timeout':
        return `the row timed out after ${SCAN_ROW_TIMEOUT_MS}ms and the scanner may still have been working`;
      default:
        // 'done' with an unreported plate: the row reported complete
        // without this plate ever arriving.
        return 'the row reported complete without this plate reporting';
    }
  }

  private logUnverifiedPlate(
    scannerId: string,
    plate: PlateConfig,
    cause: string,
    opts: { actionable?: boolean } = {}
  ): void {
    const { actionable = true } = opts;
    const wave = plate.wave_number ?? 'unknown';
    // `actionable: false` for a scanner that never came online — there is
    // nothing for the operator to go and check, and repeating a re-scan
    // instruction once per plate per cycle for a dead USB port would bury
    // the records that do warrant action.
    const action = actionable
      ? `Check for ${plate.output_path} and re-scan this plate if it is absent.`
      : `No image was produced; expected path would have been ${plate.output_path}.`;
    scanLog(
      `[${scannerId}] MISSING? Cycle ${this.currentCycle} wave ${wave} ` +
        `plate ${plate.plate_index} — ${cause}; no completion signal ` +
        `received, so no image is confirmed. ${action}`
    );
  }

  /**
   * Scan all plates once, orchestrated per-grid.
   *
   * Iterates grids sequentially: for each grid index, all scanners scan
   * that grid in parallel (with USB stagger), then we wait for all to
   * finish before moving to the next grid.
   */
  async scanOnce(platesPerScanner: Map<string, PlateConfig[]>): Promise<void> {
    this.state = 'scanning';
    this.currentCycle++;

    // Extract unique grid indices across all scanners, preserving order
    const gridIndices: string[] = [];
    for (const plates of platesPerScanner.values()) {
      for (const plate of plates) {
        if (!gridIndices.includes(plate.plate_index)) {
          gridIndices.push(plate.plate_index);
        }
      }
    }

    // Group grids by row for 4grid mode (same-row grids scanned together)
    const gridMode =
      platesPerScanner.values().next().value?.[0]?.grid_mode || '2grid';
    const rowGroups: string[][] = [];
    if (gridMode === '4grid') {
      const topRow = gridIndices.filter((i) => ['00', '01'].includes(i));
      const bottomRow = gridIndices.filter((i) => ['10', '11'].includes(i));
      if (topRow.length > 0) rowGroups.push(topRow);
      if (bottomRow.length > 0) rowGroups.push(bottomRow);
    } else {
      // 2grid: each plate is its own row group
      for (const gi of gridIndices) rowGroups.push([gi]);
    }

    console.log(
      `[ScanCoordinator] Cycle ${this.currentCycle}: scanning ${gridIndices.length} grid(s) [${gridIndices.join(', ')}] in ${rowGroups.length} row group(s) across ${this.subprocesses.size} scanner(s)`
    );

    // Iterate row groups sequentially
    for (const rowGrids of rowGroups) {
      if (this.cancelled) break;

      const gridStartedAt = new Date();
      const stTimestamp = gridStartedAt
        .toISOString()
        .replace(/[-:]/g, '')
        .slice(0, 15);
      this.currentGridStartedAt = gridStartedAt.toISOString();
      this.currentGridEndedAt = null;

      // Emit grid-start for each grid in the row
      for (const gridIndex of rowGrids) {
        this.emit('grid-start', {
          cycle: this.currentCycle,
          gridIndex,
          scanStartedAt: gridStartedAt.toISOString(),
        });
      }

      scanLog(
        `Cycle ${this.currentCycle}: row [${rowGrids.join(',')}] starting (st_${stTimestamp})`
      );

      // For each scanner, find all plates in this row and send them together.
      // A row's outcome is tagged (see `RowOutcome`) so the verification loop
      // below can tell a deliberate stop and a spontaneous subprocess death
      // apart from a row timeout, which is already fully diagnosed at the
      // moment it fires — conflating them would double-log the timed-out case.
      const rowDonePromises: Promise<RowOutcome>[] = [];
      // Scanners that actually received this row. Anything in
      // `platesPerScanner` but NOT here produced no result at all, and is
      // reconciled into per-plate diagnostics after the results loop.
      const dispatchedScannerIds = new Set<string>();
      let isFirst = true;

      for (const [scannerId, sub] of this.subprocesses) {
        const allPlates = platesPerScanner.get(scannerId);
        if (!allPlates) continue;

        const rowPlates = allPlates.filter((p) =>
          rowGrids.includes(p.plate_index)
        );
        if (rowPlates.length === 0) continue;

        if (!isFirst) {
          scanLog(
            `USB stagger: delaying scanner ${scannerId} by ${USB_STAGGER_DELAY_MS}ms`
          );
          await new Promise((r) => setTimeout(r, USB_STAGGER_DELAY_MS));
        }
        isFirst = false;

        // The stagger above yields for seconds, and it is precisely the
        // window in which USB contention makes a wedge most likely. If this
        // scanner was stopped while we waited, its row promise does not exist
        // yet, so stopScanner() had no settler to call — attaching listeners
        // to the dead subprocess now would leave the row to burn the full
        // SCAN_ROW_TIMEOUT_MS and stall every other scanner behind it.
        if (this.subprocesses.get(scannerId) !== sub) {
          scanLog(
            `[${scannerId}] Cycle ${this.currentCycle}: skipped this row — scanner was stopped during the USB stagger window`
          );
          continue;
        }

        dispatchedScannerIds.add(scannerId);

        // Update timestamps and cycle numbers in output filenames only
        // (apply regex to basename to avoid mangling date-like directory names)
        const platesToScan: PlateConfig[] = rowPlates.map((plate) => {
          const dir = path.dirname(plate.output_path);
          const basename = path
            .basename(plate.output_path)
            .replace(/(\d{8}T\d{6})/, stTimestamp)
            .replace(/_cy\d+_/, `_cy${this.currentCycle}_`);
          return {
            ...plate,
            output_path: path.join(dir, basename),
            st_timestamp: stTimestamp,
          };
        });

        // The exact basename dispatched for each plate of this row, keyed by
        // plate index. `onScanComplete` compares against it so a late
        // completion from an earlier cycle cannot be counted here — see the
        // comment there for why plate_index alone is insufficient.
        const expectedBasenames = new Map(
          platesToScan.map((p) => [p.plate_index, path.basename(p.output_path)])
        );

        // Accumulate the REAL per-plate paths from each plate's own
        // scan-complete event. The worker composes the final filename at
        // save time, so we learn the path from the event rather than
        // assuming the one we sent.
        //
        // Today those are in fact identical, because the renderer no longer
        // emits an `_st_` segment for `compose_output_path()` to stamp
        // `_et_` into (#370) — so this is currently a design stance rather
        // than a live necessity. It is still the right stance: it is what
        // makes the coordinator correct again the moment #370 restores the
        // stamped convention, and the cycle guard below is written
        // to compare correctly under both.
        const outputPaths: PlateOutputPath[] = [];

        const promise = new Promise<RowOutcome>((resolve) => {
          const cleanup = () => {
            clearTimeout(rowTimeout);
            // Identity-guarded, matching `spawnInFlight`'s `finally` above:
            // an orphaned row (one whose listeners were stripped by a
            // teardown path) can settle long after a LATER row registered
            // under the same scannerId, and an unconditional delete would
            // then destroy the live row's settler — silently restoring the
            // very gap this map exists to close.
            if (this.inFlightRowSettlers.get(scannerId) === settleStopped) {
              this.inFlightRowSettlers.delete(scannerId);
            }
            sub.removeListener('scan-complete', onScanComplete);
            sub.removeListener('cycle-done', onCycleDone);
            sub.removeListener('exit', onExit);
          };
          const settle = (kind: RowOutcomeKind) => {
            cleanup();
            // `platesToScan`, not `rowPlates`: the former carries the
            // rewritten `_st_` timestamp and the current `_cy<N>_` in its
            // basename, which the diagnostic quotes so a missing plate names
            // the cycle it belonged to rather than the stale one this row was
            // built from.
            resolve({
              kind,
              scannerId,
              outputPaths,
              rowPlates: platesToScan,
            });
          };
          const settleStopped = () => settle('stopped');
          const onScanComplete = (event: ScanWorkerEvent) => {
            if (!event.plate_index || !event.path) return;
            // Only accept a completion for a plate of THIS row of THIS
            // cycle. A row that timed out leaves its worker still running,
            // so its late `scan-complete` would otherwise land on a later
            // listener and be counted against the wrong grid.
            //
            // Matching on plate_index alone is NOT enough: `rowGrids` holds
            // the same grid indices on every cycle, so it separates rows
            // within a cycle but cannot separate cycle N's row ['00'] from
            // cycle N+1's row ['00'] — and with one row group per cycle it
            // discriminates nothing at all. The stale event would then be
            // verified against the PREVIOUS cycle's file (which really does
            // exist) and logged as this cycle's `1/1 files verified`, an
            // affirmative false completeness claim, while the dedupe below
            // silently dropped this cycle's genuine event.
            //
            // So discriminate on the cycle token. `scanOnce()` rewrites
            // `_cy<N>_` into every dispatched basename each cycle, and
            // nothing downstream touches it: `compose_output_path()` only
            // inserts `_et_`. Deliberately NOT a whole-basename comparison —
            // the worker may legitimately report a different path than the
            // one sent (that is why we learn it from the event at all), and
            // the coordinator itself also rewrites the `_st_` stamp.
            //
            // Enforced only when the dispatched name actually carries a
            // cycle token, so a naming scheme without one degrades to
            // today's behaviour rather than silently dropping every event.
            const expected = expectedBasenames.get(event.plate_index);
            if (!expected) return;
            const cycleToken = `_cy${this.currentCycle}_`;
            if (
              expected.includes(cycleToken) &&
              !path.basename(event.path).includes(cycleToken)
            ) {
              scanLog(
                `[${scannerId}] Cycle ${this.currentCycle}: ignored a ` +
                  `scan-complete for plate ${event.plate_index} belonging ` +
                  `to a different cycle — got ${path.basename(event.path)}, ` +
                  `expected ${cycleToken}. The worker is running behind ` +
                  `after an earlier row timed out; that file belongs to the ` +
                  `earlier cycle and is counted there, not here.`
              );
              return;
            }
            // Dedupe for the same reason the tally is now load-bearing: a
            // repeated event must not inflate it.
            if (outputPaths.some((o) => o.plateIndex === event.plate_index)) {
              return;
            }
            outputPaths.push({
              plateIndex: event.plate_index,
              path: event.path,
            });
          };
          const onCycleDone = () => settle('done');
          const onExit = () => settle('exit');
          const rowTimeout = setTimeout(() => {
            scanLog(
              `[${scannerId}] Row scan timeout after ${SCAN_ROW_TIMEOUT_MS}ms`
            );
            // Bare scannerId jobId — no single plateIndex applies to a
            // whole-row timeout (see the "ScanCoordinator Multi-Scanner
            // Orchestration" spec requirement's note on this shape).
            this.emit('scan-error', {
              scannerId,
              jobId: scannerId,
              error: `Row scan timeout after ${SCAN_ROW_TIMEOUT_MS}ms`,
            });
            settle('timeout');
          }, SCAN_ROW_TIMEOUT_MS);

          // Let stopScanner() end this row explicitly. It strips the
          // subprocess's listeners before awaiting shutdown, so the later
          // `exit` can never reach onExit above — without this hook the row
          // could only settle by burning the full SCAN_ROW_TIMEOUT_MS,
          // stalling every other scanner's row behind it (Promise.all) and
          // leaving no per-plate record at all. Resolve is once-only, so a
          // settle here races harmlessly with any other path.
          this.inFlightRowSettlers.set(scannerId, settleStopped);

          sub.on('scan-complete', onScanComplete);
          sub.on('cycle-done', onCycleDone);
          sub.on('exit', onExit);
        });

        rowDonePromises.push(promise);
        sub.scan(platesToScan);
      }

      // Wait for ALL scanners to complete this row
      const results = await Promise.all(rowDonePromises);

      // Diagnose the plates this row never heard back about, BEFORE the
      // cancel check below. A row can end after some of its plates already
      // succeeded, so this is driven by which plates actually reported, not
      // by the outcome alone.
      //
      // This must sit above the `break` (review round 5, I3). Both
      // deliberate mid-row stops — Cancel Scan and app quit — go through
      // `shutdown()`, which sets `this.cancelled = true` BEFORE invoking
      // the in-flight row settler. So a diagnostic placed after the break
      // could never fire for either of them, and the `stopped` outcome
      // delivered only half its stated value: it suppressed the spurious
      // row-timeout scan-error, but produced no durable per-plate record.
      // In practice the record only ever appeared on the `stopScanner()`
      // wedge path, which is the one that happened to be hardware-validated.
      //
      // Safe to run on a cancelled session: the line is log-only and emits
      // no scan-error, so it cannot feed WedgeDetector. Only file
      // verification is skipped on cancel, which is what the "Cancel during
      // active scanOnce aborts cleanly" scenario actually asks for.
      // One rule, every outcome: any plate that did not report gets a line.
      //
      // Round 5 gated this on `exit`/`stopped`, excluding `timeout` because
      // it was "already fully diagnosed at the moment the row timeout
      // fired". Round 6 pointed out that diagnosis is the row-level
      // `Row scan timeout after ...ms` line plus a `scan-error` carrying
      // `jobId: scannerId` — no plate index, no wave, no path. That is the
      // same aggregate-only shortfall the reconciliation below exists to
      // fix, so excluding timeout here contradicted this change's own
      // argument, and left the hole exactly where the hardware fails most
      // often: a row timeout is the commonest symptom of a wedged scanner,
      // and it neither evicts the scanner nor goes through stopScanner().
      //
      // `done` matters too. The worker is strictly serial and a row timeout
      // does not abort it, so a stale `cycle-done` from the previous row
      // can settle this row as `done` with nothing reported — the pairing
      // then stays off by one for the rest of the session. The cycle guard
      // on `scan-complete` stops that being counted as a false COMPLETE,
      // but the row still reports short. Including `done` here means such a
      // plate is at least never lost silently. The underlying desync is
      // tracked separately; it needs a coordinator-assigned row token
      // echoed by the worker, because the worker's own `cycle` counter
      // increments per scan command (twice per coordinator cycle in 4grid).
      for (const result of results) {
        const reported = new Set(result.outputPaths.map((o) => o.plateIndex));
        const unreported = result.rowPlates.filter(
          (p) => !reported.has(p.plate_index)
        );
        if (unreported.length === 0) continue;
        for (const plate of unreported) {
          // Log-only, not a filesystem check: scan-complete never arrived,
          // so the coordinator has no reported path to verify.
          this.logUnverifiedPlate(
            result.scannerId,
            plate,
            this.rowOutcomeCause(result.kind)
          );
        }
      }

      // Reconcile what this row was ASKED to scan against what actually got
      // dispatched. A scanner can be absent from `this.subprocesses`
      // entirely — it never came online at session start, its worker died
      // in an earlier row and the `exit` handler evicted it, or it was
      // stopped during the USB stagger window — in which case it produces
      // no row, no result, and none of the per-plate diagnostics above.
      //
      // Without this, the diagnostic invariant held only for the row the
      // failure happened in: every LATER row group in the same cycle went
      // completely unrecorded at plate level, which is the larger half of
      // the loss. The grid tally still counted them (its denominator comes
      // from `platesPerScanner`), but a bare `1 MISSING` does not say which
      // plate or which wave, which is the whole point of the per-plate line.
      //
      // This sits ABOVE the cancel break for the same reason the row
      // diagnostic does (round 6): `shutdown()` sets `cancelled` before
      // settling, and it can land during the USB stagger await, leaving
      // later scanners in this row group never dispatched. Leaving it below
      // meant the dispatched half of one row group got records and the
      // undispatched half got none. Bounded: the break means only the
      // current row group is affected.
      for (const [scannerId, platesForScanner] of platesPerScanner) {
        if (dispatchedScannerIds.has(scannerId)) continue;
        const rowPlates = platesForScanner.filter((p) =>
          rowGrids.includes(p.plate_index)
        );
        // Distinguish the three ways a scanner can be missing. A scanner
        // that never came online is NOT a plate to go re-scan — telling an
        // operator to check for a file on a scanner with a dead USB port,
        // once per plate per cycle for the length of the session, buries
        // the records that do matter.
        const neverCameOnline = this.initErrors.has(scannerId);
        const cause = this.cancelled
          ? 'the session was cancelled before this row was dispatched'
          : neverCameOnline
            ? 'this scanner never came online for this session'
            : 'the scanner was not running when this row was dispatched ' +
              '(its worker exited, or it was stopped earlier in this session)';
        for (const plate of rowPlates) {
          // Correct the quoted path exactly as the dispatch path would
          // have, BOTH rewrites — no `platesToScan` exists for a scanner
          // that never received a row. Omitting the `_st_` rewrite would
          // make two lines in the same cycle quote different filename
          // conventions once #370 restores the stamped names.
          const dir = path.dirname(plate.output_path);
          const basename = path
            .basename(plate.output_path)
            .replace(/(\d{8}T\d{6})/, stTimestamp)
            .replace(/_cy\d+_/, `_cy${this.currentCycle}_`);
          this.logUnverifiedPlate(
            scannerId,
            { ...plate, output_path: path.join(dir, basename) },
            cause,
            { actionable: !neverCameOnline }
          );
        }
      }

      // Check cancelled after await — if cancel fired during the scan,
      // skip file verification for this row. The per-plate diagnostic above
      // deliberately already ran.
      if (this.cancelled) break;

      const gridEndedAt = new Date();
      this.currentGridEndedAt = gridEndedAt.toISOString();

      scanLog(
        `Cycle ${this.currentCycle}: row [${rowGrids.join(',')}] complete`
      );

      // Verify output files. The Python worker composed the final filename
      // (including `_et_`) at save time, so the paths from the scan-complete
      // events above are already final — no rename is needed here.
      const verifiedByGrid: Map<string, number> = new Map();
      const expectedByGrid: Map<string, number> = new Map();
      for (const gridIndex of rowGrids) {
        verifiedByGrid.set(gridIndex, 0);
        expectedByGrid.set(gridIndex, 0);
      }
      // The denominator comes from what this cycle was ASKED to scan
      // (`platesPerScanner`), never from the rows that happened to be
      // dispatched. A scanner removed mid-cycle by stopScanner() produces no
      // result, so counting results would shrink both sides of the ratio in
      // lockstep and report a short grid as "3/3 complete" — an affirmative
      // completeness claim that is false, and strictly worse than the bare
      // count this replaced, which claimed nothing.
      for (const platesForScanner of platesPerScanner.values()) {
        for (const plate of platesForScanner) {
          if (!rowGrids.includes(plate.plate_index)) continue;
          expectedByGrid.set(
            plate.plate_index,
            (expectedByGrid.get(plate.plate_index) || 0) + 1
          );
        }
      }

      for (const result of results) {
        // A timed-out row ALREADY emitted its own row-level `scan-error` at
        // the moment the timeout fired. A second, plate-level one here would
        // double-count into WedgeDetector's `confirmedFailures`, where two is
        // enough to trip `consecutive_failures` and auto-pause a scanner that
        // was merely slow. For that outcome the verification result is
        // recorded to the log only — the plate is still checked and still
        // counted, just not re-reported as a new error.
        const reportVerificationFailure = (
          plateIndex: string,
          msg: string
        ): void => {
          scanLog(`[${result.scannerId}] ${msg}`);
          if (result.kind === 'timeout') return;
          this.emit('scan-error', {
            scannerId: result.scannerId,
            plateIndex,
            jobId: `${result.scannerId}:${plateIndex}`,
            error: msg,
          });
        };

        // Verify whatever DID report a real path, whatever the outcome —
        // a plate that completed before its row ended still has a file on
        // disk that deserves the same existence/size check as any other.
        for (const { plateIndex, path: outputPath } of result.outputPaths) {
          // Verify file existence and non-zero size
          try {
            await fs.promises.access(outputPath);
          } catch {
            reportVerificationFailure(
              plateIndex,
              `Output file missing after scan-complete: ${outputPath}`
            );
            continue;
          }

          let fileSize: number;
          try {
            fileSize = (await fs.promises.stat(outputPath)).size;
          } catch (statErr) {
            reportVerificationFailure(
              plateIndex,
              `Cannot stat output file: ${outputPath}: ${statErr instanceof Error ? statErr.message : String(statErr)}`
            );
            continue;
          }
          if (fileSize === 0) {
            reportVerificationFailure(
              plateIndex,
              `Output file is zero-size: ${outputPath}`
            );
            continue;
          }

          verifiedByGrid.set(
            plateIndex,
            (verifiedByGrid.get(plateIndex) || 0) + 1
          );
        }
      }

      // Emit grid-complete per grid with shared row timestamps
      for (const gridIndex of rowGrids) {
        this.emit('grid-complete', {
          cycle: this.currentCycle,
          gridIndex,
          scanStartedAt: gridStartedAt.toISOString(),
          scanEndedAt: gridEndedAt.toISOString(),
        });
        // Report the expected denominator, not just the count: "4 files
        // verified" reads identically whether the grid produced 4 of 4 or
        // 4 of 5, which makes a short grid indistinguishable from a
        // complete one in the log — the cheapest completeness check the
        // system has.
        const verified = verifiedByGrid.get(gridIndex) || 0;
        const expected = expectedByGrid.get(gridIndex) || 0;
        const shortfall =
          verified < expected ? ` — ${expected - verified} MISSING` : '';
        scanLog(
          `Cycle ${this.currentCycle}: grid ${gridIndex} complete — ${verified}/${expected} files verified${shortfall}`
        );
      }
    }

    this.emit('cycle-complete', { cycle: this.currentCycle });
    this.state = 'idle';
  }

  /**
   * Repeated scanning at intervals.
   *
   * Scans all plates, waits intervalMs, scans again, repeating until
   * all expected cycles are completed or cancelled.
   */
  async scanInterval(
    platesPerScanner: Map<string, PlateConfig[]>,
    intervalMs: number,
    durationMs: number
  ): Promise<void> {
    this.cancelled = false;
    this.currentCycle = 0;
    this.totalCycles = Math.ceil(durationMs / intervalMs);
    this.startedAt = Date.now();

    this.emit('interval-start', {
      totalCycles: this.totalCycles,
      intervalMs,
      durationMs,
      startedAt: this.startedAt,
    });

    while (!this.cancelled && this.currentCycle < this.totalCycles) {
      const cycleStartMs = Date.now();
      await this.scanOnce(platesPerScanner);
      const scanDurationMs = Date.now() - cycleStartMs;

      if (this.cancelled || this.currentCycle >= this.totalCycles) break;

      // Emit overtime event if we've exceeded the original duration
      const elapsed = Date.now() - this.startedAt;
      if (elapsed > durationMs) {
        this.emit('overtime', {
          cycle: this.currentCycle,
          totalCycles: this.totalCycles,
          overtimeMs: elapsed - durationMs,
        });
      }

      // Wait for remaining time: interval is st→st, so subtract scan duration
      const remainingMs = Math.max(0, intervalMs - scanDurationMs);
      this.state = 'waiting';
      this.emit('interval-waiting', {
        cycle: this.currentCycle,
        totalCycles: this.totalCycles,
        nextScanMs: remainingMs,
      });

      if (remainingMs > 0) {
        await this.sleep(remainingMs);
      }
    }

    this.state = 'idle';
    const elapsed = Date.now() - this.startedAt;
    this.emit('interval-complete', {
      cyclesCompleted: this.currentCycle,
      totalCycles: this.totalCycles,
      cancelled: this.cancelled,
      overtimeMs: Math.max(0, elapsed - durationMs),
    });
  }

  /**
   * Cancel all scanning. Stops interval timer and sends cancel to all subprocesses.
   */
  cancelAll(): void {
    this.cancelled = true;

    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    }
    // Resolve any pending sleep so scanInterval loop can exit
    if (this.sleepResolve) {
      this.sleepResolve();
      this.sleepResolve = null;
    }

    for (const sub of this.subprocesses.values()) {
      sub.cancel();
    }

    // Don't set state to idle here — scanOnce() or scanInterval() will
    // set it when they exit after checking this.cancelled. Setting it
    // prematurely would make isScanning return false while work is in-flight.
    this.emit('cancelled');
  }

  /**
   * Graceful shutdown: quit all subprocesses, force-kill after timeout.
   */
  async shutdown(): Promise<void> {
    this.state = 'shutting-down';
    this.cancelled = true;

    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.sleepResolve) {
      this.sleepResolve();
      this.sleepResolve = null;
    }

    const shutdownPromises = Array.from(this.subprocesses.entries()).map(
      async ([scannerId, sub]) => {
        // Clear any in-flight spawn-guard entry FIRST (matches
        // stopScanner()'s convention) — found via a real E2E failure
        // (graviscan-ipc.e2e.ts's "Reset All USB Connections" test): if a
        // scanner was still mid-spawn when this bulk shutdown ran, its
        // original spawnSingleScanner() call is still holding the
        // spawnInFlight entry for that scannerId. Without clearing it
        // here, a caller that re-initializes right after this shutdown
        // (e.g. resetUsb()'s own coordinator.initialize() call) would be
        // handed that same orphaned promise instead of starting fresh —
        // and since the line below now strips its listeners, that
        // orphaned promise can only settle via its own
        // SPAWN_READY_TIMEOUT_MS bound, stalling the new caller for the
        // full 45s instead of respawning immediately.
        this.spawnInFlight.delete(scannerId);
        // Settle this scanner's in-flight row, if any, BEFORE stripping its
        // listeners — same reasoning as stopScanner(). This path is reached
        // by the Cancel Scan button (`cancelScan` calls cancelAll() then
        // shutdown() in the same tick, and cancelAll() only writes to stdin,
        // which the worker cannot read until its current blocking save
        // returns). Without this the row is orphaned and can only settle at
        // SCAN_ROW_TIMEOUT_MS, 90s later, emitting a spurious row-timeout
        // scan-error for a scan the operator deliberately cancelled.
        this.inFlightRowSettlers.get(scannerId)?.();
        // Strip listeners first (matches stopScanner()'s convention):
        // without this, a subprocess still mid-spawn has its own
        // spawn()-internal 'exit' listener still attached, which rejects
        // with "process exited before becoming ready" once this forced
        // shutdown kills it — surfacing a spurious "init failed" report
        // for a scanner that was deliberately, cleanly shut down.
        sub.removeAllListeners();
        const confirmed = await sub.shutdown();
        if (!confirmed) {
          console.warn(
            `[ScanCoordinator] shutdown(): scanner ${scannerId} could not be confirmed stopped`
          );
        }
      }
    );

    await Promise.all(shutdownPromises);
    this.subprocesses.clear();
    this.state = 'idle';
  }

  /**
   * Force-kill all subprocesses (for app quit fallback).
   */
  killAll(): void {
    for (const sub of this.subprocesses.values()) {
      sub.kill();
    }
    // Clear any in-flight spawn-guard entries too — matching the bulk
    // shutdown() fix above, so nothing left in spawnInFlight can strand a
    // future caller on an instance this method just discarded. killAll()
    // is the app-quit fallback, so this is defensive rather than a
    // reproduced failure, but the invariant should hold everywhere the
    // subprocess map is torn down.
    this.spawnInFlight.clear();
    this.subprocesses.clear();
    this.state = 'idle';
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.sleepResolve = resolve;
      this.intervalTimer = setTimeout(() => {
        this.intervalTimer = null;
        this.sleepResolve = null;
        resolve();
      }, ms);
    });
  }
}
