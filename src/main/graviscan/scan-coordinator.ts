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
   * Staggered initialization: spawn subprocesses one at a time,
   * waiting for each to signal ready before starting the next.
   * This prevents SANE init contention.
   *
   * NOTE: Issue #144 argues that subprocess isolation makes sequential
   * init unnecessary. Kept sequential for now; parallel init deferred
   * to a future increment that designs partial-failure error semantics.
   */
  async initialize(scanners: ScannerConfig[]): Promise<void> {
    this.state = 'initializing';
    this.cancelled = false;

    // Shut down subprocesses for scanners NOT in the new config
    for (const [id, sub] of this.subprocesses) {
      if (!scanners.find((s) => s.scannerId === id)) {
        console.log(`[ScanCoordinator] Shutting down stale subprocess ${id}`);
        await sub.shutdown(5000);
        this.subprocesses.delete(id);
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
      for (const scanner of scanners) {
        if (this.cancelled) break;
        await this.spawnSingleScanner(scanner);
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
    const sub = this.subprocesses.get(scannerId);
    if (!sub) return;
    sub.removeAllListeners();
    await sub.shutdown(5000);
    this.subprocesses.delete(scannerId);
    this.initErrors.delete(scannerId);
  }

  /**
   * Internal: spawn one ScannerSubprocess and wire its events.
   * Shared by both `initialize()`'s per-scanner loop and
   * `addScanner()` (closes task 7.3 — these used to be two parallel,
   * duplicated implementations).
   *
   * Carries the same reuse-existing-ready / shut-down-dead-before-
   * respawn checks `initialize()` used to run inline, so both call
   * sites get identical semantics from one place.
   *
   * Does not throw on spawn failure — the entry is removed from the
   * map, the error recorded in `initErrors`, and a `scanner-init-status`
   * event emitted. This isolates one scanner's spawn failure from the
   * others (fixes a latent bug: previously an exception from
   * `sub.spawn()` inside `initialize()`'s loop propagated out of the
   * whole method uncaught, so remaining scanners in the list never
   * got spawned).
   */
  private async spawnSingleScanner(config: ScannerConfig): Promise<void> {
    // Reuse existing subprocess if it's still alive and ready
    const existing = this.subprocesses.get(config.scannerId);
    if (existing && existing.isReady) {
      console.log(
        `[ScanCoordinator] Scanner ${config.scannerId} already ready, reusing`
      );
      return;
    }

    // Shut down dead/stuck subprocess before respawning
    if (existing) {
      console.log(
        `[ScanCoordinator] Scanner ${config.scannerId} subprocess not ready, respawning`
      );
      existing.removeAllListeners();
      await existing.shutdown(5000);
      this.subprocesses.delete(config.scannerId);
    }

    const sub = new ScannerSubprocess(
      this.pythonPath,
      this.isPackaged,
      config.scannerId,
      config.saneName,
      this.mock
    );

    // Forward all events, injecting cycle number and grid start time.
    // scan_ended_at is NOT included here — it is unknown until the row
    // completes. currentGridEndedAt is null for the entire duration of
    // a row's actual scanning (it's only assigned right after
    // Promise.all(rowDonePromises) resolves in scanOnce()) — by the
    // time that happens, any per-plate scan-event this listener
    // forwards for that row has already fired. It IS available in the
    // grid-complete event instead.
    sub.on('event', (event: ScanWorkerEvent) => {
      const forwarded: Record<string, unknown> = {
        ...event,
        cycle_number: this.currentCycle,
        scan_started_at: this.currentGridStartedAt,
      };
      this.emit('scan-event', forwarded);
    });

    sub.on('exit', (info: { scannerId: string; code: number | null }) => {
      console.log(
        `[ScanCoordinator] Subprocess ${info.scannerId} exited with code ${info.code}`
      );
      this.subprocesses.delete(info.scannerId);
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
      await sub.spawn();
      console.log(`[ScanCoordinator] Scanner ${config.scannerId} ready`);
      this.emit('scanner-init-status', {
        scannerId: config.scannerId,
        status: 'ready',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[ScanCoordinator] Scanner ${config.scannerId} init failed: ${message}`
      );
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

      // For each scanner, find all plates in this row and send them together
      const rowDonePromises: Promise<{
        scannerId: string;
        outputPaths: { plateIndex: string; path: string }[];
      } | null>[] = [];
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

        // Accumulate the REAL per-plate paths from each plate's own
        // scan-complete event. The worker now composes the final filename
        // (including `_et_`) at save time, so the path we sent above is no
        // longer guaranteed to be the path on disk — we must learn it from
        // the event, not assume it.
        const outputPaths: { plateIndex: string; path: string }[] = [];

        const promise = new Promise<{
          scannerId: string;
          outputPaths: { plateIndex: string; path: string }[];
        } | null>((resolve) => {
          const cleanup = () => {
            clearTimeout(rowTimeout);
            sub.removeListener('scan-complete', onScanComplete);
            sub.removeListener('cycle-done', onCycleDone);
            sub.removeListener('exit', onExit);
          };
          const onScanComplete = (event: ScanWorkerEvent) => {
            if (event.plate_index && event.path) {
              outputPaths.push({
                plateIndex: event.plate_index,
                path: event.path,
              });
            }
          };
          const onCycleDone = () => {
            cleanup();
            resolve({ scannerId, outputPaths });
          };
          const onExit = () => {
            cleanup();
            resolve(null);
          };
          const rowTimeout = setTimeout(() => {
            cleanup();
            scanLog(
              `[${scannerId}] Row scan timeout after ${SCAN_ROW_TIMEOUT_MS}ms`
            );
            this.emit('scan-error', {
              scannerId,
              error: `Row scan timeout after ${SCAN_ROW_TIMEOUT_MS}ms`,
            });
            resolve(null);
          }, SCAN_ROW_TIMEOUT_MS);
          sub.on('scan-complete', onScanComplete);
          sub.on('cycle-done', onCycleDone);
          sub.on('exit', onExit);
        });

        rowDonePromises.push(promise);
        sub.scan(platesToScan);
      }

      // Wait for ALL scanners to complete this row
      const results = await Promise.all(rowDonePromises);

      // Check cancelled after await — if cancel fired during the scan,
      // skip file verification for this row
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
      for (const gridIndex of rowGrids) verifiedByGrid.set(gridIndex, 0);

      for (const result of results) {
        if (!result) continue;
        for (const { plateIndex, path: outputPath } of result.outputPaths) {
          // Verify file existence and non-zero size
          try {
            await fs.promises.access(outputPath);
          } catch {
            const msg = `Output file missing after scan-complete: ${outputPath}`;
            scanLog(`[${result.scannerId}] ${msg}`);
            this.emit('scan-error', {
              scannerId: result.scannerId,
              plateIndex,
              error: msg,
            });
            continue;
          }

          let fileSize: number;
          try {
            fileSize = (await fs.promises.stat(outputPath)).size;
          } catch (statErr) {
            const msg = `Cannot stat output file: ${outputPath}: ${statErr instanceof Error ? statErr.message : String(statErr)}`;
            scanLog(`[${result.scannerId}] ${msg}`);
            this.emit('scan-error', {
              scannerId: result.scannerId,
              plateIndex,
              error: msg,
            });
            continue;
          }
          if (fileSize === 0) {
            const msg = `Output file is zero-size: ${outputPath}`;
            scanLog(`[${result.scannerId}] ${msg}`);
            this.emit('scan-error', {
              scannerId: result.scannerId,
              plateIndex,
              error: msg,
            });
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
        scanLog(
          `Cycle ${this.currentCycle}: grid ${gridIndex} complete — ${verifiedByGrid.get(gridIndex) || 0} files verified`
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

    const shutdownPromises = Array.from(this.subprocesses.values()).map((sub) =>
      sub.shutdown(5000)
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
