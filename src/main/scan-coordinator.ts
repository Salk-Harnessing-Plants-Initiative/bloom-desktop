/**
 * Scan Coordinator
 *
 * Orchestrates multiple ScannerSubprocess instances for parallel scanning.
 * Handles parallel subprocess initialization, simultaneous scan triggers,
 * interval/continuous mode timing, and cleanup.
 *
 * Usage:
 *   const coordinator = new ScanCoordinator(pythonPath, workerPath, mock);
 *   await coordinator.initialize(scanners);
 *   await coordinator.scanOnce(platesPerScanner);
 *   // or
 *   coordinator.scanInterval(platesPerScanner, intervalMs, durationMs);
 *   // ...
 *   await coordinator.shutdown();
 */

import { EventEmitter } from 'events';
import {
  ScannerSubprocess,
  PlateConfig,
  ScanWorkerEvent,
  ScanWorkerPlate,
} from './scanner-subprocess';

// =============================================================================
// Types
// =============================================================================

export interface ScannerConfig {
  scannerId: string;
  saneName: string;
  plates: PlateConfig[];
}

export interface CoordinatorEvent {
  type: string;
  scannerId?: string;
  [key: string]: unknown;
}

type CoordinatorState =
  | 'idle'
  | 'initializing'
  | 'scanning'
  | 'waiting'
  | 'shutting-down';

// =============================================================================
// ScanCoordinator
// =============================================================================

export class ScanCoordinator extends EventEmitter {
  private pythonPath: string;
  private isPackaged: boolean;
  private mock: boolean;
  private subprocesses: Map<string, ScannerSubprocess> = new Map();
  private initErrors: Map<string, string> = new Map();
  private state: CoordinatorState = 'idle';
  private intervalTimer: ReturnType<typeof setTimeout> | null = null;
  private cancelled = false;
  private currentCycle = 0;
  private totalCycles = 0;
  private startedAt: number | null = null;
  // Per-grid timestamps (set during scanOnce, injected into scan events)
  private currentGridStartedAt: string | null = null;
  private currentGridEndedAt: string | null = null;

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
   * Parallel initialization: spawn all subprocesses concurrently.
   * Each subprocess is an independent OS process with its own SANE context
   * targeting a distinct physical USB device, so no sequential ordering is needed.
   * Reuse/cleanup of existing subprocesses is done first (sequential, fast).
   */
  async initialize(scanners: ScannerConfig[]): Promise<void> {
    this.state = 'initializing';
    this.cancelled = false;

    // Shut down subprocesses for scanners NOT in the new config (e.g., user removed a scanner)
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

    // Clear previous init errors
    this.initErrors.clear();

    // Phase 1: Reuse ready subprocesses, clean up dead ones (sequential, fast)
    const toSpawn: ScannerConfig[] = [];

    for (const scanner of scanners) {
      if (this.cancelled) break;

      const existing = this.subprocesses.get(scanner.scannerId);
      if (existing && existing.isReady) {
        console.log(
          `[ScanCoordinator] Scanner ${scanner.scannerId} already ready, reusing`
        );
        continue;
      }

      if (existing) {
        console.log(
          `[ScanCoordinator] Scanner ${scanner.scannerId} subprocess not ready, respawning`
        );
        existing.removeAllListeners();
        await existing.shutdown(5000);
        this.subprocesses.delete(scanner.scannerId);
      }

      toSpawn.push(scanner);
    }

    // Phase 2: Spawn all new subprocesses in parallel
    if (toSpawn.length > 0 && !this.cancelled) {
      console.log(
        `[ScanCoordinator] Spawning ${toSpawn.length} subprocess(es) in parallel...`
      );

      const spawnResults = await Promise.allSettled(
        toSpawn.map((scanner) => {
          const sub = new ScannerSubprocess(
            this.pythonPath,
            this.isPackaged,
            scanner.scannerId,
            scanner.saneName,
            this.mock
          );

          // Forward all events, injecting cycle number and per-grid timestamps
          sub.on('event', (event: ScanWorkerEvent) => {
            this.emit('scan-event', {
              ...event,
              cycle_number: this.currentCycle,
              scan_started_at: this.currentGridStartedAt,
              scan_ended_at: this.currentGridEndedAt,
            });
          });

          sub.on('exit', (info: { scannerId: string; code: number | null }) => {
            console.log(
              `[ScanCoordinator] Subprocess ${info.scannerId} exited with code ${info.code}`
            );
            this.subprocesses.delete(info.scannerId);
          });

          this.subprocesses.set(scanner.scannerId, sub);

          console.log(
            `[ScanCoordinator] Spawning subprocess for scanner ${scanner.scannerId}...`
          );

          // Emit 'starting' so the UI can show progress while spawn() runs
          // (SANE init can take up to 30s — without this the UI sees no
          // intermediate state between the previous status and 'ready').
          this.emit('scanner-init-status', {
            scannerId: scanner.scannerId,
            status: 'starting',
          });

          return sub
            .spawn()
            .then(() => {
              console.log(
                `[ScanCoordinator] Scanner ${scanner.scannerId} ready`
              );
              this.emit('scanner-init-status', {
                scannerId: scanner.scannerId,
                status: 'ready',
              });
            })
            .catch((error: Error) => {
              console.error(
                `[ScanCoordinator] Scanner ${scanner.scannerId} init failed: ${error.message}`
              );
              this.subprocesses.delete(scanner.scannerId);
              this.initErrors.set(scanner.scannerId, error.message);
              this.emit('scanner-init-status', {
                scannerId: scanner.scannerId,
                status: 'error',
                error: error.message,
              });
              throw error; // Re-throw so Promise.allSettled sees it as rejected
            });
        })
      );

      const succeeded = spawnResults.filter(
        (r) => r.status === 'fulfilled'
      ).length;
      const failed = spawnResults.filter((r) => r.status === 'rejected').length;

      if (failed > 0) {
        console.warn(
          `[ScanCoordinator] ${succeeded}/${toSpawn.length} scanners initialized (${failed} failed)`
        );
      }
    }

    this.state = 'idle';
    console.log(`[ScanCoordinator] ${this.subprocesses.size} scanner(s) ready`);
  }

  /**
   * Returns true iff a subprocess for `scannerId` is in the map AND
   * in the ready state (#234 dependency). Used by `save-scanners-db`
   * to skip already-running scanners before calling `addScanner`.
   */
  hasWorker(scannerId: string): boolean {
    const sub = this.subprocesses.get(scannerId);
    return !!sub && sub.isReady;
  }

  /**
   * Spawn a single new scanner subprocess and add it to the map.
   * No-op if a ready worker for `scannerId` already exists.
   *
   * Called from `graviscan:save-scanners-db` for newly-created /
   * re-enabled scanner rows (#234) so the operator does not need to
   * restart the app to bring a new scanner online.
   *
   * Mid-scan safety: if `isScanning === true` this method queues the
   * spawn for after the next `cycle-complete` event. The Promise
   * resolves once the queued spawn actually runs.
   *
   * Does not throw on spawn failure — errors are surfaced via the
   * `scanner-init-status` event matching the existing initialize()
   * pattern.
   */
  async addScanner(config: ScannerConfig): Promise<void> {
    if (this.hasWorker(config.scannerId)) {
      return; // idempotent — already ready
    }

    // If a scan is in flight, queue the spawn until after the cycle
    // completes (do NOT disturb the event loop mid-cycle).
    if (this.isScanning) {
      return new Promise<void>((resolve) => {
        const handler = () => {
          this.off('cycle-complete', handler);
          // Re-enter addScanner so the hasWorker idempotency guard
          // re-runs. Without this, two queued addScanner calls for
          // the same scanner_id (e.g., operator clicks Detect twice
          // mid-scan) would each spawn a duplicate subprocess and
          // overwrite the map entry. Per Copilot PR #237 review.
          this.addScanner(config)
            .catch(() => {
              // already logged inside spawnSingleScanner
            })
            .finally(() => resolve());
        };
        this.on('cycle-complete', handler);
      });
    }

    await this.spawnSingleScanner(config);
  }

  /**
   * Stop a single scanner subprocess and remove it from the map.
   *
   * Called from `graviscan:disable-scanner` (Task 9) when an operator
   * removes a scanner via the Configure Scanner page. No-op if no
   * worker exists for `scannerId`.
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
   * Used by `addScanner()` for the single-scanner-spawn case.
   *
   * NOTE: `initialize()` has its OWN per-scanner spawn implementation
   * because it uses `Promise.allSettled()` to spawn all subprocesses
   * in parallel — the concurrency model differs from this method's
   * sequential single-spawn. The two implementations are kept in
   * sync by convention (mirroring event listeners + error handling),
   * not by code sharing. Per Copilot PR #237 review.
   *
   * On spawn failure, removes the entry from the map and records the
   * error in `initErrors` for `getScannerStatuses()` to surface. Does
   * NOT throw — the caller decides whether to propagate.
   */
  private async spawnSingleScanner(config: ScannerConfig): Promise<void> {
    const sub = new ScannerSubprocess(
      this.pythonPath,
      this.isPackaged,
      config.scannerId,
      config.saneName,
      this.mock,
    );

    sub.on('event', (event: ScanWorkerEvent) => {
      this.emit('scan-event', {
        ...event,
        cycle_number: this.currentCycle,
        scan_started_at: this.currentGridStartedAt,
        scan_ended_at: this.currentGridEndedAt,
      });
    });

    sub.on('exit', (info: { scannerId: string; code: number | null }) => {
      console.log(
        `[ScanCoordinator] Subprocess ${info.scannerId} exited with code ${info.code}`,
      );
      this.subprocesses.delete(info.scannerId);
    });

    this.subprocesses.set(config.scannerId, sub);

    this.emit('scanner-init-status', {
      scannerId: config.scannerId,
      status: 'starting',
    });

    try {
      await sub.spawn();
      this.emit('scanner-init-status', {
        scannerId: config.scannerId,
        status: 'ready',
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      console.error(
        `[ScanCoordinator] Scanner ${config.scannerId} init failed: ${message}`,
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
   * Scan all plates once across all scanners (in parallel).
   * Resolves when all scanners have reported cycle-done.
   */
  /**
   * Scan all plates once, orchestrated per-grid.
   *
   * Instead of sending all plates to each scanner at once, this iterates
   * grids sequentially: for each grid index, all scanners scan that grid
   * in parallel (with USB stagger), then we wait for all to finish before
   * moving to the next grid. This ensures consistent per-grid timestamps
   * across all scanners.
   *
   * Emits 'grid-start', 'grid-complete', and 'cycle-complete' events.
   */
  async scanOnce(platesPerScanner: Map<string, PlateConfig[]>): Promise<void> {
    this.state = 'scanning';
    this.currentCycle++;

    // The epkowa SANE backend uses shared USB resources; simultaneous
    // device.start() calls on the same USB bus cause "Invalid argument".
    const STAGGER_DELAY_MS = 5000;

    // Extract unique grid indices across all scanners, preserving order
    const gridIndices: string[] = [];
    for (const plates of platesPerScanner.values()) {
      for (const plate of plates) {
        if (!gridIndices.includes(plate.plate_index)) {
          gridIndices.push(plate.plate_index);
        }
      }
    }

    console.log(
      `[ScanCoordinator] Cycle ${this.currentCycle}: scanning ${gridIndices.length} grid(s) [${gridIndices.join(', ')}] across ${this.subprocesses.size} scanner(s)`
    );

    // Iterate grids sequentially — each plate scans at its exact grid ROI
    for (const gridIndex of gridIndices) {
      const rowGrids = [gridIndex];
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

      console.log(
        `[ScanCoordinator] Row [${rowGrids.join(',')}]: starting (st_${stTimestamp})`
      );

      // For each scanner, find all plates in this row and send them together.
      // Promises resolve when each scanner reports cycle-done; only the
      // arrival of cycle-done matters, so the resolved value is void.
      const rowDonePromises: Promise<void>[] = [];
      let isFirst = true;

      for (const [scannerId, sub] of this.subprocesses) {
        const allPlates = platesPerScanner.get(scannerId);
        if (!allPlates) continue;

        const rowPlates = allPlates.filter((p) =>
          rowGrids.includes(p.plate_index)
        );
        if (rowPlates.length === 0) continue;

        if (!isFirst) {
          await new Promise((r) => setTimeout(r, STAGGER_DELAY_MS));
        }
        isFirst = false;

        // Forward components to Python — no composition in TS. The worker
        // builds the final filename (including `_et_`) at save time, since
        // `et` is only knowable then.
        const platesToScan: ScanWorkerPlate[] = rowPlates.map((plate) => ({
          plate_index: plate.plate_index,
          grid_mode: plate.grid_mode,
          resolution: plate.resolution,
          output_dir: plate.output_dir,
          exp_name: plate.exp_name,
          st_timestamp: stTimestamp,
          wave_number: plate.wave_number,
          scanner_tag: plate.scanner_tag,
          system_prefix: plate.system_prefix,
          cycle: this.currentCycle,
          phenotyper_name: plate.phenotyper_name,
        }));

        const promise = new Promise<void>((resolve) => {
          const onCycleDone = () => {
            sub.removeListener('cycle-done', onCycleDone);
            sub.removeListener('exit', onExit);
            resolve();
          };
          const onExit = () => {
            sub.removeListener('cycle-done', onCycleDone);
            sub.removeListener('exit', onExit);
            resolve();
          };
          sub.on('cycle-done', onCycleDone);
          sub.on('exit', onExit);
        });

        rowDonePromises.push(promise);
        sub.scan(platesToScan); // Send all row plates
      }

      // Wait for ALL scanners to complete this row
      await Promise.all(rowDonePromises);

      const gridEndedAt = new Date();
      this.currentGridEndedAt = gridEndedAt.toISOString();

      console.log(
        `[ScanCoordinator] Row [${rowGrids.join(',')}]: complete`
      );

      // The Python worker composed the final filename (including `_et_`)
      // at save time. The actual paths on disk are emitted via
      // scan-complete events.

      // Emit grid-complete per grid with shared row timestamps
      for (const gridIndex of rowGrids) {
        this.emit('grid-complete', {
          cycle: this.currentCycle,
          gridIndex,
          scanStartedAt: gridStartedAt.toISOString(),
          scanEndedAt: gridEndedAt.toISOString(),
        });
      }
    }

    this.emit('cycle-complete', { cycle: this.currentCycle });
    this.state = 'idle';
  }

  /**
   * Repeated scanning at intervals.
   *
   * Scans all plates, waits intervalMs, scans again, repeating until
   * all expected cycles are completed or cancelled. If the total scan
   * time exceeds durationMs (because each scan takes real hardware time),
   * scanning continues and an 'overtime' event is emitted.
   *
   * This is non-blocking — returns immediately. Listen to events for progress.
   * Call cancelAll() to stop.
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

    for (const sub of this.subprocesses.values()) {
      sub.cancel();
    }

    this.state = 'idle';
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
      this.intervalTimer = setTimeout(() => {
        this.intervalTimer = null;
        resolve();
      }, ms);
    });
  }
}
