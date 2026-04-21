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
 * - Rename failures surfaced as events
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

  // Session context for metadata.json writer (set by session handler at scan start)
  private sessionContext: {
    experiment_id: string;
    phenotyper_id: string;
    wave_number: number;
    session_id: string | null;
    resolution: number;
    scannerNames: Map<string, string>;
    plateBarcodes: Map<string, string | null>; // key: `${scannerId}:${plateIndex}`
    transplantDates: Map<string, string | null>;
    customNotes: Map<string, string | null>;
    intervalSeconds: number | null;
    durationSeconds: number | null;
  } | null = null;

  setSessionContext(context: typeof this.sessionContext): void {
    this.sessionContext = context;
  }

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

    try {
      for (const scanner of scanners) {
        if (this.cancelled) break;

        // Reuse existing subprocess if it's still alive and ready
        const existing = this.subprocesses.get(scanner.scannerId);
        if (existing && existing.isReady) {
          console.log(
            `[ScanCoordinator] Scanner ${scanner.scannerId} already ready, reusing`
          );
          continue;
        }

        // Shut down dead/stuck subprocess before respawning
        if (existing) {
          console.log(
            `[ScanCoordinator] Scanner ${scanner.scannerId} subprocess not ready, respawning`
          );
          existing.removeAllListeners();
          await existing.shutdown(5000);
          this.subprocesses.delete(scanner.scannerId);
        }

        const sub = new ScannerSubprocess(
          this.pythonPath,
          this.isPackaged,
          scanner.scannerId,
          scanner.saneName,
          this.mock
        );

        // Forward all events, injecting cycle number and grid start time.
        // scan_ended_at is NOT included here — it is unknown until the row
        // completes. It is available in the grid-complete event instead.
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

        this.subprocesses.set(scanner.scannerId, sub);

        console.log(
          `[ScanCoordinator] Spawning subprocess for scanner ${scanner.scannerId}...`
        );
        await sub.spawn();
        console.log(`[ScanCoordinator] Scanner ${scanner.scannerId} ready`);
      }
    } finally {
      this.state = 'idle';
    }

    console.log(
      `[ScanCoordinator] All ${scanners.length} scanner(s) initialized`
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
          };
        });

        // Write metadata.json before each scan (task 8b.5 / #194).
        // Failures logged but do not abort the scan.
        if (this.sessionContext) {
          try {
            const { writeGraviMetadataJson } = await import(
              './scan-metadata-json'
            );
            const ctx = this.sessionContext;
            for (const plate of platesToScan) {
              const jobKey = `${scannerId}:${plate.plate_index}`;
              const metadataDir = path.dirname(plate.output_path);
              await writeGraviMetadataJson(metadataDir, {
                experiment_id: ctx.experiment_id,
                phenotyper_id: ctx.phenotyper_id,
                scanner_id: scannerId,
                scanner_name: ctx.scannerNames.get(scannerId) || scannerId,
                grid_mode: plate.grid_mode,
                resolution_dpi: plate.resolution,
                format: 'tiff',
                plate_index: plate.plate_index,
                plate_barcode: ctx.plateBarcodes.get(jobKey) ?? null,
                transplant_date: ctx.transplantDates.get(jobKey) ?? null,
                custom_note: ctx.customNotes.get(jobKey) ?? null,
                wave_number: ctx.wave_number,
                cycle_number: this.currentCycle,
                session_id: ctx.session_id,
                scan_started_at:
                  this.currentGridStartedAt || gridStartedAt.toISOString(),
                interval_seconds: ctx.intervalSeconds,
                duration_seconds: ctx.durationSeconds,
              });
            }
          } catch (err) {
            console.warn(
              `[ScanCoordinator] metadata.json write failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
            );
          }
        }

        const promise = new Promise<{
          scannerId: string;
          outputPaths: { plateIndex: string; path: string }[];
        } | null>((resolve) => {
          const cleanup = () => {
            clearTimeout(rowTimeout);
            sub.removeListener('cycle-done', onCycleDone);
            sub.removeListener('exit', onExit);
          };
          const onCycleDone = () => {
            cleanup();
            resolve({
              scannerId,
              outputPaths: platesToScan.map((p) => ({
                plateIndex: p.plate_index,
                path: p.output_path,
              })),
            });
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
          sub.on('cycle-done', onCycleDone);
          sub.on('exit', onExit);
        });

        rowDonePromises.push(promise);
        sub.scan(platesToScan);
      }

      // Wait for ALL scanners to complete this row
      const results = await Promise.all(rowDonePromises);

      // Check cancelled after await — if cancel fired during the scan,
      // skip file verification and renaming for this row
      if (this.cancelled) break;

      const gridEndedAt = new Date();
      const etTimestamp = gridEndedAt
        .toISOString()
        .replace(/[-:]/g, '')
        .slice(0, 15);
      this.currentGridEndedAt = gridEndedAt.toISOString();

      scanLog(
        `Cycle ${this.currentCycle}: row [${rowGrids.join(',')}] complete (et_${etTimestamp})`
      );

      // Verify output files and rename with end timestamps
      const renamedByGrid: Map<
        string,
        { oldPath: string; newPath: string; scannerId: string }[]
      > = new Map();
      const renameErrors: {
        scannerId: string;
        filePath: string;
        error: string;
      }[] = [];
      for (const gridIndex of rowGrids) renamedByGrid.set(gridIndex, []);

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

          // Rename to include end timestamp
          try {
            const dir = path.dirname(outputPath);
            const ext = path.extname(outputPath);
            const base = path.basename(outputPath, ext);

            const newBase = base.replace(
              /(_st_\d{8}T\d{6})/,
              `$1_et_${etTimestamp}`
            );
            const newPath = path.join(dir, newBase + ext);

            await fs.promises.rename(outputPath, newPath);
            scanLog(
              `[${result.scannerId}] Renamed: ${path.basename(outputPath)} → ${path.basename(newPath)}`
            );
            renamedByGrid.get(plateIndex)?.push({
              oldPath: outputPath,
              newPath,
              scannerId: result.scannerId,
            });
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            scanLog(
              `[${result.scannerId}] Failed to rename ${outputPath}: ${errMsg}`
            );
            renameErrors.push({
              scannerId: result.scannerId,
              filePath: outputPath,
              error: errMsg,
            });
            this.emit('rename-error', {
              scannerId: result.scannerId,
              filePath: outputPath,
              error: errMsg,
            });
          }
        }
      }

      // Emit grid-complete per grid with shared row timestamps
      for (const gridIndex of rowGrids) {
        this.emit('grid-complete', {
          cycle: this.currentCycle,
          renamedFiles: renamedByGrid.get(gridIndex) || [],
          renameErrors,
          gridIndex,
          scanStartedAt: gridStartedAt.toISOString(),
          scanEndedAt: gridEndedAt.toISOString(),
        });
        scanLog(
          `Cycle ${this.currentCycle}: grid ${gridIndex} complete — ${(renamedByGrid.get(gridIndex) || []).length} files renamed`
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
