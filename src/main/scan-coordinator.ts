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
import * as fs from 'fs';
import * as path from 'path';
import {
  ScannerSubprocess,
  PlateConfig,
  ScanWorkerEvent,
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
      // 2grid: each plate is its own row group (no merge benefit)
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

      console.log(
        `[ScanCoordinator] Row [${rowGrids.join(',')}]: starting (st_${stTimestamp})`
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
          await new Promise((r) => setTimeout(r, STAGGER_DELAY_MS));
        }
        isFirst = false;

        // Update timestamps and cycle numbers in output paths
        const platesToScan: PlateConfig[] = rowPlates.map((plate) => ({
          ...plate,
          output_path: plate.output_path
            .replace(/(\d{8}T\d{6})/, stTimestamp)
            .replace(/_cy\d+_/, `_cy${this.currentCycle}_`),
        }));

        const promise = new Promise<{
          scannerId: string;
          outputPaths: { plateIndex: string; path: string }[];
        } | null>((resolve) => {
          const onCycleDone = () => {
            sub.removeListener('cycle-done', onCycleDone);
            sub.removeListener('exit', onExit);
            resolve({
              scannerId,
              outputPaths: platesToScan.map((p) => ({
                plateIndex: p.plate_index,
                path: p.output_path,
              })),
            });
          };
          const onExit = () => {
            sub.removeListener('cycle-done', onCycleDone);
            sub.removeListener('exit', onExit);
            resolve(null);
          };
          sub.on('cycle-done', onCycleDone);
          sub.on('exit', onExit);
        });

        rowDonePromises.push(promise);
        sub.scan(platesToScan); // Send all row plates
      }

      // Wait for ALL scanners to complete this row
      const results = await Promise.all(rowDonePromises);

      const gridEndedAt = new Date();
      const etTimestamp = gridEndedAt
        .toISOString()
        .replace(/[-:]/g, '')
        .slice(0, 15);
      this.currentGridEndedAt = gridEndedAt.toISOString();

      console.log(
        `[ScanCoordinator] Row [${rowGrids.join(',')}]: complete (et_${etTimestamp})`
      );

      // Rename output files and group by grid index
      const renamedByGrid: Map<
        string,
        { oldPath: string; newPath: string; scannerId: string }[]
      > = new Map();
      for (const gridIndex of rowGrids) renamedByGrid.set(gridIndex, []);

      for (const result of results) {
        if (!result) continue;
        for (const { plateIndex, path: outputPath } of result.outputPaths) {
          try {
            const dir = path.dirname(outputPath);
            const ext = path.extname(outputPath);
            const base = path.basename(outputPath, ext);

            const newBase = base.replace(
              /(_st_\d{8}T\d{6})/,
              `$1_et_${etTimestamp}`
            );
            const newPath = path.join(dir, newBase + ext);

            if (fs.existsSync(outputPath)) {
              fs.renameSync(outputPath, newPath);
              console.log(
                `[ScanCoordinator] Renamed: ${path.basename(outputPath)} → ${path.basename(newPath)}`
              );
              renamedByGrid.get(plateIndex)?.push({
                oldPath: outputPath,
                newPath,
                scannerId: result.scannerId,
              });
            }
          } catch (err) {
            console.error(
              `[ScanCoordinator] Failed to rename output file:`,
              err
            );
          }
        }
      }

      // Emit grid-complete per grid with shared row timestamps
      for (const gridIndex of rowGrids) {
        this.emit('grid-complete', {
          cycle: this.currentCycle,
          renamedFiles: renamedByGrid.get(gridIndex) || [],
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
