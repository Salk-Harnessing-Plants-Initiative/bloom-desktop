/**
 * GraviScan Session Handlers
 *
 * Extracted from Ben's monolithic graviscan-handlers.ts.
 * Manages scan lifecycle: start, status, mark-recorded, cancel.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type {
  PlateConfig,
  ScannerConfig,
  ScanSessionJob,
  ScanSessionState,
} from '../../types/graviscan';
import { buildSaneName } from './scanner-handlers';
import { scanLog } from './scan-logger';
import { plannedPlatePath } from './scan-filename';
import {
  endScanSession,
  sessionNotSavedMessage,
  type StartScanHooks,
} from './session-lifecycle';
import type { LastSessionSummary } from './session-records';

// ---------------------------------------------------------------------------
// Interface types
// ---------------------------------------------------------------------------

/**
 * Minimal shape `retryScanner()` needs to read a scanner's current USB
 * identity and enabled state. Deliberately narrower than `PrismaClient`
 * (design.md Decision 7) — `session-handlers.ts` otherwise has zero DB
 * dependency, matching `wiring.ts`'s `ScannerLookupDb` convention for the
 * same kind of "read one scanner row for a spawn-related decision" case.
 */
export interface ScannerRetryLookupDb {
  graviScanner: {
    findUnique: (args: { where: { id: string } }) => Promise<{
      usb_bus: number | null;
      usb_device: number | null;
      enabled: boolean;
    } | null>;
  };
}

export interface ScanCoordinatorLike {
  readonly isScanning: boolean;
  initialize(scanners: ScannerConfig[]): Promise<void>;
  /** Start counting cycles from 1 again; called once per session (#498). */
  startNewSession(): void;
  scanOnce(platesPerScanner: Map<string, PlateConfig[]>): Promise<void>;
  scanInterval(
    platesPerScanner: Map<string, PlateConfig[]>,
    intervalMs: number,
    durationMs: number
  ): Promise<void>;
  cancelAll(): void;
  shutdown(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
  // Task 7 (#234) — single-scanner spawn/stop, added for the
  // save-scanners-db / disable-scanner handlers (stage 3) so they can
  // bring a scanner online/offline without a full re-initialize().
  // Matching the concrete ScanCoordinator class's public signatures.
  hasWorker(scannerId: string): boolean;
  addScanner(config: ScannerConfig): Promise<void>;
  stopScanner(scannerId: string): Promise<void>;
  // Increment 4 — live subprocess status for the `graviscan:get-scanner-status`
  // handler (scanner-handlers.ts's getScannerStatus()). Matching the
  // concrete ScanCoordinator class's public signature.
  getScannerStatuses(): Array<{
    scannerId: string;
    status: 'ready' | 'starting' | 'error' | 'dead';
    error?: string;
  }>;
}

export interface SessionFns {
  getScanSession: () => any;
  setScanSession: (session: any) => void;
  markScanJobRecorded: (jobKey: string) => void;
}

// ---------------------------------------------------------------------------
// Param types
// ---------------------------------------------------------------------------

interface StartScanParams {
  /** A test scan: no session row, nothing recorded. */
  test?: boolean;
  scanners: Array<{
    scannerId: string;
    saneName: string;
    plates: (PlateConfig & {
      plate_barcode?: string | null;
      transplant_date?: string | null;
      custom_note?: string | null;
    })[];
  }>;
  interval?: { intervalSeconds: number; durationSeconds: number };
  metadata?: {
    experimentId: string;
    phenotyperId: string;
    resolution: number;
    sessionId?: string;
    waveNumber?: number;
  };
}

// ---------------------------------------------------------------------------
// startScan
// ---------------------------------------------------------------------------

export async function startScan(
  coordinator: ScanCoordinatorLike | null,
  params: StartScanParams,
  sessionFns: SessionFns,
  onError?: (error: string) => void,
  hooks?: StartScanHooks
): Promise<{ success: boolean; error?: string; sessionId?: string }> {
  let sessionSet = false;
  try {
    if (!coordinator) {
      return { success: false, error: 'ScanCoordinator not initialized' };
    }

    if (coordinator.isScanning) {
      return { success: false, error: 'Scan already in progress' };
    }

    if (params.interval) {
      if (
        params.interval.intervalSeconds <= 0 ||
        params.interval.durationSeconds <= 0
      ) {
        return {
          success: false,
          error: 'Interval and duration must be positive',
        };
      }
    }

    // Build jobs map. Imports the canonical `ScanSessionJob` type rather
    // than a locally-duplicated one — a prior inline copy of this type was
    // missing the `'recorded'` status literal that `markScanJobRecorded()`
    // (`wiring.ts`) makes a real, live value for the first time, and only
    // happened to compile because a narrower union is structurally
    // assignable to the wider one it was drifting from.
    const jobs: Record<string, ScanSessionJob> = {};

    for (const s of params.scanners) {
      for (const plate of s.plates) {
        const key = `${s.scannerId}:${plate.plate_index}`;
        jobs[key] = {
          scannerId: s.scannerId,
          plateIndex: plate.plate_index,
          outputPath: plannedPlatePath(plate),
          plantBarcode: plate.plate_barcode ?? null,
          transplantDate: plate.transplant_date ?? null,
          customNote: plate.custom_note ?? null,
          gridMode: plate.grid_mode,
          status: 'pending',
        };
      }
    }

    const sessIntervalMs = params.interval
      ? params.interval.intervalSeconds * 1000
      : 0;
    const sessDurationMs = params.interval
      ? params.interval.durationSeconds * 1000
      : 0;

    // Build scanner configs for coordinator initialization
    const scannerConfigs: ScannerConfig[] = params.scanners.map((s) => ({
      scannerId: s.scannerId,
      saneName: s.saneName,
      plates: s.plates,
    }));

    await coordinator.initialize(scannerConfigs);

    // Final-review fix #3: initialize() no longer rejects on a
    // per-scanner spawn failure — stage 2 isolated those failures inside
    // spawnSingleScanner() so one bad USB port doesn't block the others
    // (they're recorded in initErrors and surfaced via a
    // 'scanner-init-status' event instead). That means a session could
    // otherwise start "active" with zero — or only some — scanners
    // actually working, with nothing telling the operator. Verify at
    // least one scanner came online before reporting success.
    const anyScannerReady = scannerConfigs.some((c) =>
      coordinator.hasWorker(c.scannerId)
    );
    if (!anyScannerReady) {
      return {
        success: false,
        error:
          'No scanners came online — check scanner-init-status events for per-scanner failures',
      };
    }

    const isTest = params.test === true;
    const totalCycles =
      sessIntervalMs > 0 ? Math.ceil(sessDurationMs / sessIntervalMs) : 1;

    // The session's database row, once the scanners are up and before
    // anything is scanned. If it can't be saved, nothing is scanned.
    let sessionId: string | null = params.metadata?.sessionId || null;
    if (!isTest && hooks?.openSessionRecord) {
      const opened = await hooks.openSessionRecord({
        experimentId: params.metadata?.experimentId || '',
        phenotyperId: params.metadata?.phenotyperId || '',
        scanMode: params.interval ? 'continuous' : 'single',
        intervalSeconds: params.interval?.intervalSeconds ?? null,
        durationSeconds: params.interval?.durationSeconds ?? null,
        totalCycles,
      });
      if ('error' in opened) {
        return { success: false, error: sessionNotSavedMessage(opened.error) };
      }
      sessionId = opened.sessionId;
    }

    // Only set session state AFTER initialize succeeds — avoids briefly
    // reporting an active scan while the coordinator is still starting up.
    const session: ScanSessionState = {
      isActive: true,
      isContinuous: !!params.interval,
      experimentId: params.metadata?.experimentId || '',
      phenotyperId: params.metadata?.phenotyperId || '',
      resolution: params.metadata?.resolution || 300,
      sessionId,
      jobs,
      currentCycle: 0,
      totalCycles,
      intervalMs: sessIntervalMs,
      scanStartedAt: Date.now(),
      scanEndedAt: null,
      scanDurationMs: sessDurationMs,
      coordinatorState: 'scanning',
      nextScanAt: null,
      waveNumber: params.metadata?.waveNumber || 0,
      isTest,
    };
    sessionFns.setScanSession(session);
    sessionSet = true;

    // Build plates map for scanning
    const platesPerScanner = new Map<string, PlateConfig[]>();
    for (const s of params.scanners) {
      platesPerScanner.set(s.scannerId, s.plates);
    }

    // The session ends exactly once, whichever happens first: it
    // completes, fails, or is cancelled (cancelScan).
    const handleError = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      endScanSession(sessionFns, session, 'failed', hooks);
      onError?.(message);
    };

    const handleComplete = () => {
      endScanSession(sessionFns, session, 'completed', hooks);
    };

    // Every session (single, continuous or test) is saved from cycle 1.
    // Without this a single scan continued the previous session's count
    // until the app restarted (#498).
    coordinator.startNewSession();

    if (params.interval) {
      const intervalMs = params.interval.intervalSeconds * 1000;
      const durationMs = params.interval.durationSeconds * 1000;
      coordinator
        .scanInterval(platesPerScanner, intervalMs, durationMs)
        .then(handleComplete)
        .catch(handleError);
    } else {
      coordinator
        .scanOnce(platesPerScanner)
        .then(handleComplete)
        .catch(handleError);
    }

    return sessionId ? { success: true, sessionId } : { success: true };
  } catch (error) {
    if (sessionSet) {
      sessionFns.setScanSession(null);
    }
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Start scan failed',
    };
  }
}

// ---------------------------------------------------------------------------
// getScanStatus
// ---------------------------------------------------------------------------

export function getScanStatus(
  sessionFns: SessionFns,
  lastSession: LastSessionSummary | null = null
): Record<string, any> {
  const session = sessionFns.getScanSession();
  if (!session) {
    // The last session's outcome and QR result, for a page that returns
    // after the session ended.
    return lastSession ? { isActive: false, lastSession } : { isActive: false };
  }
  return {
    isActive: session.isActive,
    experimentId: session.experimentId,
    phenotyperId: session.phenotyperId,
    resolution: session.resolution,
    sessionId: session.sessionId,
    jobs: session.jobs,
    isContinuous: session.isContinuous,
    currentCycle: session.currentCycle,
    totalCycles: session.totalCycles,
    intervalMs: session.intervalMs,
    scanStartedAt: session.scanStartedAt,
    scanDurationMs: session.scanDurationMs,
    coordinatorState: session.coordinatorState,
    nextScanAt: session.nextScanAt,
    waveNumber: session.waveNumber,
  };
}

// ---------------------------------------------------------------------------
// markJobRecorded
// ---------------------------------------------------------------------------

export function markJobRecorded(sessionFns: SessionFns, jobKey: string): void {
  sessionFns.markScanJobRecorded(jobKey);
}

// ---------------------------------------------------------------------------
// cancelScan
// ---------------------------------------------------------------------------

export async function cancelScan(
  coordinator: ScanCoordinatorLike | null,
  sessionFns: SessionFns,
  hooks?: StartScanHooks
): Promise<{ success: boolean; error?: string }> {
  const session = sessionFns.getScanSession();
  try {
    if (!coordinator) {
      return { success: false, error: 'ScanCoordinator not initialized' };
    }

    coordinator.cancelAll();
    await coordinator.shutdown();
    endScanSession(sessionFns, session, 'cancelled', hooks);
    sessionFns.setScanSession(null);

    return { success: true };
  } catch (error) {
    // Always clear session — even if shutdown fails, the scan is cancelled
    endScanSession(sessionFns, session, 'cancelled', hooks);
    sessionFns.setScanSession(null);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Cancel failed',
    };
  }
}

// ---------------------------------------------------------------------------
// retryScanner
// ---------------------------------------------------------------------------

/**
 * Respawn a scanner after an operator confirms it has been physically
 * power-cycled following a wedge auto-pause (design.md Decisions 1, 2, 7).
 *
 * Stricter than `cancelScan`'s guard: requires an active session, not just
 * a live coordinator — respawning a worker with no active `scanInterval()`/
 * `scanOnce()` loop to schedule it into a cycle would just leak a
 * subprocess with nothing driving it (design.md Decision 8).
 *
 * Reads `usb_bus`/`usb_device`/`enabled` fresh from the database rather
 * than from any value cached at session start, since a `reset-usb`
 * performed after auto-pause would otherwise make a stale value wrong.
 */
// Tracks scanner_ids with a retryScanner() call currently in flight. A
// scanner can re-wedge (and its banner entry remount, resetting the UI's
// own `retrying` guard) before a prior retry's stopScanner()+addScanner()
// pair has resolved — without this guard, a second concurrent retry for
// the same scannerId could race the first (addScanner() only dedupes
// concurrent calls while a cycle is in flight; it does not when idle).
const retriesInFlight = new Set<string>();

export async function retryScanner(
  coordinator: ScanCoordinatorLike | null,
  db: ScannerRetryLookupDb,
  sessionFns: SessionFns,
  scannerId: string
): Promise<{ success: boolean; error?: string }> {
  if (retriesInFlight.has(scannerId)) {
    return {
      success: false,
      error: `Retry already in progress for scanner ${scannerId}`,
    };
  }
  retriesInFlight.add(scannerId);
  let session: ReturnType<SessionFns['getScanSession']> | undefined;
  try {
    session = sessionFns.getScanSession();
    if (!session?.isActive) {
      return { success: false, error: 'No active scan session' };
    }
    if (!coordinator) {
      return { success: false, error: 'ScanCoordinator not initialized' };
    }

    const row = await db.graviScanner.findUnique({ where: { id: scannerId } });
    if (!row) {
      return { success: false, error: `Scanner ${scannerId} not found` };
    }
    if (row.usb_bus == null || row.usb_device == null) {
      return {
        success: false,
        error: `Scanner ${scannerId} is missing usb_bus/usb_device (likely mid reset-usb)`,
      };
    }
    if (!row.enabled) {
      return { success: false, error: `Scanner ${scannerId} is disabled` };
    }

    const saneName = buildSaneName(row.usb_bus, row.usb_device);
    await coordinator.stopScanner(scannerId);
    await coordinator.addScanner({ scannerId, saneName, plates: [] });

    // addScanner() never throws on spawn failure (see scan-coordinator.ts) —
    // a resolved promise alone doesn't mean the worker actually came online.
    const status = coordinator
      .getScannerStatuses()
      .find((s) => s.scannerId === scannerId);
    if (!status || status.status !== 'ready') {
      const message =
        status?.error ?? `Scanner ${scannerId} did not come online after retry`;
      scanLog(
        `[WedgeResponse] retry failed scanner=${scannerId} session=${session.sessionId} error=${message}`
      );
      return { success: false, error: message };
    }

    scanLog(
      `[WedgeResponse] retry succeeded scanner=${scannerId} session=${session.sessionId}`
    );
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Retry failed';
    scanLog(
      `[WedgeResponse] retry failed scanner=${scannerId} session=${session?.sessionId} error=${message}`
    );
    return { success: false, error: message };
  } finally {
    retriesInFlight.delete(scannerId);
  }
}
