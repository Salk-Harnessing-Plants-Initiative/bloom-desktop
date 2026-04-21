/**
 * GraviScan Session Handlers
 *
 * Extracted from Ben's monolithic graviscan-handlers.ts.
 * Manages scan lifecycle: start, status, mark-recorded, cancel.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { PlateConfig, ScannerConfig } from '../../types/graviscan';

// ---------------------------------------------------------------------------
// Interface types
// ---------------------------------------------------------------------------

export interface ScanCoordinatorLike {
  readonly isScanning: boolean;
  initialize(scanners: ScannerConfig[]): Promise<void>;
  scanOnce(platesPerScanner: Map<string, PlateConfig[]>): Promise<void>;
  scanInterval(
    platesPerScanner: Map<string, PlateConfig[]>,
    intervalMs: number,
    durationMs: number
  ): Promise<void>;
  cancelAll(): void;
  shutdown(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
  setSessionContext?(context: unknown): void;
}

export interface SessionFns {
  getScanSession: () => any;
  setScanSession: (session: any) => void;
  markScanJobRecorded: (jobKey: string) => void;
}

/**
 * Optional persistence callbacks for creating/completing GraviScanSession
 * records in the DB. Injected by register-handlers.ts when db is available.
 */
export interface SessionPersistence {
  createSession: (session: any) => Promise<string | null>;
  completeSession: (sessionId: string, cancelled: boolean) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Param types
// ---------------------------------------------------------------------------

interface StartScanParams {
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
  persistence?: SessionPersistence
): Promise<{ success: boolean; error?: string }> {
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

    // Build jobs map
    const jobs: Record<
      string,
      {
        scannerId: string;
        plateIndex: string;
        outputPath: string;
        plantBarcode: string | null;
        transplantDate: string | null;
        customNote: string | null;
        gridMode: string;
        status: 'pending' | 'scanning' | 'complete' | 'error';
        imagePath?: string;
        error?: string;
        durationMs?: number;
      }
    > = {};

    for (const s of params.scanners) {
      for (const plate of s.plates) {
        const key = `${s.scannerId}:${plate.plate_index}`;
        jobs[key] = {
          scannerId: s.scannerId,
          plateIndex: plate.plate_index,
          outputPath: plate.output_path,
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

    // Build session state
    const sessionState = {
      isActive: true,
      isContinuous: !!params.interval,
      experimentId: params.metadata?.experimentId || '',
      phenotyperId: params.metadata?.phenotyperId || '',
      resolution: params.metadata?.resolution || 300,
      sessionId: params.metadata?.sessionId || null,
      jobs,
      currentCycle: 0,
      totalCycles:
        sessIntervalMs > 0 ? Math.ceil(sessDurationMs / sessIntervalMs) : 1,
      intervalMs: sessIntervalMs,
      scanStartedAt: Date.now(),
      scanEndedAt: null as number | null,
      scanDurationMs: sessDurationMs,
      coordinatorState: 'scanning' as const,
      nextScanAt: null as number | null,
      waveNumber: params.metadata?.waveNumber || 0,
    };

    // Create GraviScanSession DB record BEFORE setting session state
    // so GraviScan records created on grid-complete have a valid session_id.
    // Per-sessionId is only populated if persistence is wired and the write succeeds.
    if (persistence && !sessionState.sessionId) {
      const createdSessionId = await persistence.createSession(sessionState);
      if (createdSessionId) {
        sessionState.sessionId = createdSessionId;
      }
    }

    // Only set session state AFTER initialize succeeds — avoids briefly
    // reporting an active scan while the coordinator is still starting up.
    sessionFns.setScanSession(sessionState);
    sessionSet = true;

    // Populate coordinator session context for metadata.json writer (task 8b.5)
    if (coordinator.setSessionContext) {
      const scannerNames = new Map<string, string>();
      const plateBarcodes = new Map<string, string | null>();
      const transplantDates = new Map<string, string | null>();
      const customNotes = new Map<string, string | null>();
      for (const s of params.scanners) {
        scannerNames.set(s.scannerId, s.scannerId); // fallback to ID; display_name requires DB lookup
        for (const plate of s.plates) {
          const key = `${s.scannerId}:${plate.plate_index}`;
          plateBarcodes.set(key, plate.plate_barcode ?? null);
          transplantDates.set(key, plate.transplant_date ?? null);
          customNotes.set(key, plate.custom_note ?? null);
        }
      }
      coordinator.setSessionContext({
        experiment_id: params.metadata?.experimentId || '',
        phenotyper_id: params.metadata?.phenotyperId || '',
        wave_number: params.metadata?.waveNumber || 0,
        session_id: params.metadata?.sessionId || null,
        resolution: params.metadata?.resolution || 300,
        scannerNames,
        plateBarcodes,
        transplantDates,
        customNotes,
        intervalSeconds: params.interval?.intervalSeconds ?? null,
        durationSeconds: params.interval?.durationSeconds ?? null,
      });
    }

    // Build plates map for scanning
    const platesPerScanner = new Map<string, PlateConfig[]>();
    for (const s of params.scanners) {
      platesPerScanner.set(s.scannerId, s.plates);
    }

    const handleError = async (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      const currentSession = sessionFns.getScanSession();
      if (persistence && currentSession?.sessionId) {
        await persistence.completeSession(currentSession.sessionId, false);
      }
      sessionFns.setScanSession(null);
      onError?.(message);
    };

    const handleComplete = async () => {
      const currentSession = sessionFns.getScanSession();
      if (persistence && currentSession?.sessionId) {
        await persistence.completeSession(currentSession.sessionId, false);
      }
      sessionFns.setScanSession(null);
    };

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

    return { success: true };
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

export function getScanStatus(sessionFns: SessionFns): Record<string, any> {
  const session = sessionFns.getScanSession();
  if (!session) {
    return { isActive: false };
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
  persistence?: SessionPersistence
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!coordinator) {
      return { success: false, error: 'ScanCoordinator not initialized' };
    }

    coordinator.cancelAll();
    // Await shutdown FIRST — this lets in-flight grid-complete handlers
    // finish running (they read getScanSession() at handler start and will
    // find the session still valid). If we cleared session first, race
    // conditions would drop completed cycles. Fixes B6 from PR #196 review.
    await coordinator.shutdown();

    // Complete the session record with cancelled=true BEFORE clearing
    // the session state (persistence reads getScanSession() which gives
    // us the active sessionId).
    const currentSession = sessionFns.getScanSession();
    if (persistence && currentSession?.sessionId) {
      await persistence.completeSession(currentSession.sessionId, true);
    }

    sessionFns.setScanSession(null);
    return { success: true };
  } catch (error) {
    // Always clear session — even if shutdown fails, the scan is cancelled
    sessionFns.setScanSession(null);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Cancel failed',
    };
  }
}
