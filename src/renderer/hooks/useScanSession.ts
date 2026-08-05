/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  GetScanStatusResult,
  GridMode,
  PlateAssignment,
  QRVerifyPlateInput,
  QRVerifyPlateResult,
  ScanSessionJob,
} from '../../types/graviscan';
import { useWedgeContext } from '../contexts/WedgeContext';
import { unwrapGraviResult } from '../utils/graviIpc';

export interface UseScanSessionParams {
  experimentId: string | null;
  phenotyperId: string | null;
  waveNumber: number;
  resolution: number;
  scannerIds: string[];
  gridModes: Record<string, GridMode>;
  saneNames: Record<string, string>;
  assignmentsByScanner: Record<string, PlateAssignment[]>;
  isContinuous: boolean;
  intervalMinutes: number;
  durationHours: number;
  /** Called when on-mount restore (design.md Decision 4) finds an active
   * session whose waveNumber differs from the caller's own — `waveNumber`
   * is owned by `useWaveNumber`, not this hook, so restoration is surfaced
   * via callback rather than this hook silently taking ownership of it. */
  onRestoreWaveNumber?: (waveNumber: number) => void;
}

export interface UseScanSessionResult {
  isScanning: boolean;
  pendingJobs: Record<string, ScanSessionJob>;
  progressByScanner: Record<string, number>;
  currentCycle: number;
  totalCycles: number;
  coordinatorState: 'idle' | 'scanning' | 'waiting';
  verificationStatus: 'idle' | 'verifying' | 'complete';
  verificationResults: Record<string, QRVerifyPlateResult>;
  error: string | null;
  scanStartedAt: number | null;
  nextScanAt: number | null;
  /** Non-blocking signal that a prior session for this exact
   * (experimentId, waveNumber) never cleanly finished (design.md Decision
   * 5). `null` when no such marker applies. */
  abnormalTermination: { expectedCycles: number } | null;
  /** False while any assigned scanner has an active, unacknowledged wedge
   * (design.md Decision 6). */
  canStartScan: boolean;
  startScan: () => Promise<void>;
  cancelScan: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Dual-casing event payload resolution — matches wiring.ts's
// resolveScannerId()/resolvePlateIndex()/resolveJobId() fallback pattern.
// Duplicated locally rather than imported: shared/renderer code may not
// import from src/main/graviscan/ (no-restricted-imports ESLint rule).
// ---------------------------------------------------------------------------

function resolveScannerId(event: Record<string, unknown>): string {
  return (event.scanner_id as string) ?? (event.scannerId as string) ?? '';
}

function resolvePlateIndex(event: Record<string, unknown>): string {
  return (event.plate_index as string) ?? (event.plateIndex as string) ?? '';
}

function jobKey(scannerId: string, plateIndex: string): string {
  return `${scannerId}:${plateIndex}`;
}

function abnormalMarkerKey(experimentId: string, waveNumber: number): string {
  return `graviscan:session-in-progress:${experimentId}:${waveNumber}`;
}

// ---------------------------------------------------------------------------
// Reducer core (design.md Decision 1) — no ref-mirroring/lag-compensation.
// Every derived value (per-scanner progress) is computed here, from the
// state this same action just produced, never from a separately-lagging
// ref.
// ---------------------------------------------------------------------------

interface ScanState {
  isScanning: boolean;
  pendingJobs: Record<string, ScanSessionJob>;
  scannerTotals: Record<string, number>;
  progressByScanner: Record<string, number>;
  currentCycle: number;
  totalCycles: number;
  coordinatorState: 'idle' | 'scanning' | 'waiting';
  verificationStatus: 'idle' | 'verifying' | 'complete';
  verificationResults: Record<string, QRVerifyPlateResult>;
  error: string | null;
  sessionId: string | null;
  scanStartedAt: number | null;
  nextScanAt: number | null;
}

const initialState: ScanState = {
  isScanning: false,
  pendingJobs: {},
  scannerTotals: {},
  progressByScanner: {},
  currentCycle: 0,
  totalCycles: 0,
  coordinatorState: 'idle',
  verificationStatus: 'idle',
  verificationResults: {},
  error: null,
  sessionId: null,
  scanStartedAt: null,
  nextScanAt: null,
};

type Action =
  | {
      type: 'START';
      payload: {
        jobs: Record<string, ScanSessionJob>;
        scannerTotals: Record<string, number>;
        totalCycles: number;
        sessionId: string | null;
        scanStartedAt: number;
      };
    }
  | { type: 'JOB_COMPLETE'; payload: { key: string; imagePath?: string } }
  | { type: 'JOB_ERROR'; payload: { key: string; error: string } }
  | { type: 'CANCELLED' }
  | { type: 'SCAN_ENDED' }
  | { type: 'ERROR'; payload: { error: string } }
  | {
      type: 'RESTORE';
      payload: {
        pendingJobs: Record<string, ScanSessionJob>;
        currentCycle: number;
        totalCycles: number;
        coordinatorState: 'idle' | 'scanning' | 'waiting';
        sessionId: string | null;
        scanStartedAt: number | null;
        nextScanAt: number | null;
      };
    }
  | { type: 'VERIFY_STARTED' }
  | { type: 'VERIFY_RESULT'; payload: QRVerifyPlateResult }
  | { type: 'VERIFY_COMPLETE' };

function reducer(state: ScanState, action: Action): ScanState {
  switch (action.type) {
    case 'START':
      return {
        ...initialState,
        isScanning: true,
        pendingJobs: action.payload.jobs,
        scannerTotals: action.payload.scannerTotals,
        totalCycles: action.payload.totalCycles,
        currentCycle: action.payload.totalCycles > 0 ? 1 : 0,
        coordinatorState: 'scanning',
        sessionId: action.payload.sessionId,
        scanStartedAt: action.payload.scanStartedAt,
      };
    case 'JOB_COMPLETE': {
      const { key } = action.payload;
      const job = state.pendingJobs[key];
      if (!job) return state; // already removed — duplicated event, no-op
      const nextPendingJobs = { ...state.pendingJobs };
      delete nextPendingJobs[key];
      const total = state.scannerTotals[job.scannerId] ?? 1;
      const remaining = Object.values(nextPendingJobs).filter(
        (j) => j.scannerId === job.scannerId
      ).length;
      const completed = total - remaining;
      return {
        ...state,
        pendingJobs: nextPendingJobs,
        progressByScanner: {
          ...state.progressByScanner,
          [job.scannerId]: Math.round((completed / total) * 100),
        },
      };
    }
    case 'JOB_ERROR': {
      const { key, error } = action.payload;
      if (!(key in state.pendingJobs)) return state;
      const nextPendingJobs = { ...state.pendingJobs };
      delete nextPendingJobs[key];
      return { ...state, pendingJobs: nextPendingJobs, error };
    }
    case 'CANCELLED':
      return {
        ...state,
        isScanning: false,
        pendingJobs: {},
        progressByScanner: {},
        coordinatorState: 'idle',
        currentCycle: 0,
      };
    case 'SCAN_ENDED':
      return {
        ...state,
        isScanning: false,
        coordinatorState: 'idle',
        currentCycle: 0,
      };
    case 'ERROR':
      return { ...state, error: action.payload.error };
    case 'RESTORE':
      return {
        ...state,
        isScanning: true,
        pendingJobs: action.payload.pendingJobs,
        currentCycle: action.payload.currentCycle,
        totalCycles: action.payload.totalCycles,
        coordinatorState: action.payload.coordinatorState,
        sessionId: action.payload.sessionId,
        scanStartedAt: action.payload.scanStartedAt,
        nextScanAt: action.payload.nextScanAt,
      };
    case 'VERIFY_STARTED':
      return { ...state, verificationStatus: 'verifying' };
    case 'VERIFY_RESULT':
      return {
        ...state,
        verificationResults: {
          ...state.verificationResults,
          [jobKey(action.payload.scannerId, action.payload.plateIndex)]:
            action.payload,
        },
      };
    case 'VERIFY_COMPLETE':
      return { ...state, verificationStatus: 'complete' };
    default:
      return state;
  }
}

/**
 * Session-lifecycle state for the Capture Scan screen (design.md
 * Decisions 1, 2, 4, 5, 6). Combines the reducer core, backend
 * persistence wiring, the abnormal-termination localStorage marker, and
 * wedge-blocked-start — see tasks.md Section 12.
 */
export function useScanSession(params: UseScanSessionParams): UseScanSessionResult {
  const {
    experimentId,
    phenotyperId,
    waveNumber,
    resolution,
    scannerIds,
    gridModes,
    saneNames,
    assignmentsByScanner,
    isContinuous,
    intervalMinutes,
    durationHours,
    onRestoreWaveNumber,
  } = params;

  const [state, dispatch] = useReducer(reducer, initialState);
  const [abnormalTermination, setAbnormalTermination] = useState<{
    expectedCycles: number;
  } | null>(null);

  const { entries: wedgeEntries } = useWedgeContext();
  const canStartScan = !scannerIds.some((id) => id in wedgeEntries);

  // Stable-identity refs for the IPC-listener effect (deps: []) to read
  // current values without becoming stale closures — design.md Decision 1
  // still keeps a single stateRef for this, not per-field mirrors.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const contextRef = useRef({
    experimentId,
    phenotyperId,
    waveNumber,
    resolution,
    assignmentsByScanner,
  });
  useEffect(() => {
    contextRef.current = {
      experimentId,
      phenotyperId,
      waveNumber,
      resolution,
      assignmentsByScanner,
    };
  }, [experimentId, phenotyperId, waveNumber, resolution, assignmentsByScanner]);

  const clearAbnormalMarker = useCallback(() => {
    if (!experimentId) return;
    localStorage.removeItem(abnormalMarkerKey(experimentId, waveNumber));
  }, [experimentId, waveNumber]);

  const runVerification = useCallback(
    async (jobsSnapshot: Record<string, ScanSessionJob>) => {
      const ctx = contextRef.current;
      if (!ctx.experimentId) return;

      const plates: QRVerifyPlateInput[] = [];
      for (const job of Object.values(jobsSnapshot)) {
        if (!job.imagePath) continue;
        const assignment = (ctx.assignmentsByScanner[job.scannerId] || []).find(
          (a) => a.plateIndex === job.plateIndex
        );
        if (!assignment?.plantBarcode) continue;
        plates.push({
          scannerId: job.scannerId,
          plateIndex: job.plateIndex,
          imagePath: job.imagePath,
          assignedPlateId: assignment.plantBarcode,
        });
      }
      if (plates.length === 0) return;

      dispatch({ type: 'VERIFY_STARTED' });
      try {
        const result = await (window as any).electron.gravi.verifyPlates(
          plates,
          ctx.experimentId,
          ctx.waveNumber
        );
        if (result?.results) {
          for (const r of result.results as QRVerifyPlateResult[]) {
            dispatch({ type: 'VERIFY_RESULT', payload: r });
          }
        }
      } finally {
        dispatch({ type: 'VERIFY_COMPLETE' });
      }
    },
    []
  );

  const completedJobsRef = useRef<Record<string, ScanSessionJob>>({});
  // Immutable per-session job metadata, set once at START — unlike
  // `state.pendingJobs`, this is never pruned, so a duplicated/retried
  // scan-complete event can still look up the job it refers to after the
  // first delivery already removed it from `pendingJobs`. The backend's
  // own upsert (task 2.3/2.4) is what makes a repeated
  // `database.graviscans.create()` call actually idempotent — this hook
  // does not try to suppress the repeat call itself (tasks.md 12.3).
  const jobTemplateRef = useRef<Record<string, ScanSessionJob>>({});

  const recordCompletedJob = useCallback(
    async (job: ScanSessionJob, imagePath: string, cycleNumber: number | null) => {
      const ctx = contextRef.current;
      if (!ctx.experimentId || !ctx.phenotyperId) return;
      await (window as any).electron.database.graviscans.create({
        experiment_id: ctx.experimentId,
        phenotyper_id: ctx.phenotyperId,
        scanner_id: job.scannerId,
        plate_index: job.plateIndex,
        wave_number: ctx.waveNumber,
        session_id: stateRef.current.sessionId,
        cycle_number: cycleNumber,
        plate_barcode: job.plantBarcode ?? null,
        transplant_date: job.transplantDate ?? null,
        custom_note: job.customNote ?? null,
        path: imagePath,
        grid_mode: job.gridMode,
        resolution: ctx.resolution,
        format: 'tiff',
      });
    },
    []
  );

  const finishSession = useCallback(
    async (cancelled: boolean) => {
      const sessionId = stateRef.current.sessionId;
      clearAbnormalMarker();
      if (sessionId) {
        await (window as any).electron.database.graviscanSessions.complete({
          session_id: sessionId,
          cancelled,
        });
      }
      if (!cancelled) {
        await runVerification(completedJobsRef.current);
      }
      completedJobsRef.current = {};
    },
    [clearAbnormalMarker, runVerification]
  );

  // ── IPC event listeners ──────────────────────────────────────────────

  useEffect(() => {
    const gravi = (window as any).electron.gravi;

    const cleanupComplete = gravi.onScanComplete((data: Record<string, unknown>) => {
      const scannerId = resolveScannerId(data);
      const plateIndex = resolvePlateIndex(data);
      const key = jobKey(scannerId, plateIndex);
      const job = jobTemplateRef.current[key];
      if (!job) return; // unknown job key — nothing to record

      const imagePath = (data.imagePath as string) ?? '';
      const cycleNumber =
        typeof data.cycleNumber === 'number' ? (data.cycleNumber as number) : null;

      completedJobsRef.current[key] = { ...job, status: 'complete', imagePath };
      dispatch({ type: 'JOB_COMPLETE', payload: { key, imagePath } });

      // Always recorded, even on a duplicated/retried event for a job
      // already removed from `pendingJobs` — the backend's own upsert is
      // what makes the repeat safe (tasks.md 12.3), not a hook-side guard.
      void recordCompletedJob(job, imagePath, cycleNumber);

      if (stateRef.current.isScanning) {
        const stillPending = Object.keys(stateRef.current.pendingJobs).filter(
          (k) => k !== key
        );
        if (stillPending.length === 0) {
          dispatch({ type: 'SCAN_ENDED' });
          void finishSession(false);
        }
      }
    });

    const cleanupError = gravi.onScanError((data: Record<string, unknown>) => {
      const scannerId = resolveScannerId(data);
      const plateIndex = resolvePlateIndex(data);
      if (!scannerId || !plateIndex) return;
      dispatch({
        type: 'JOB_ERROR',
        payload: { key: jobKey(scannerId, plateIndex), error: (data.error as string) ?? 'Scan error' },
      });
    });

    const cleanupCycleComplete = gravi.onCycleComplete?.(() => {
      // Continuous-mode cycle bookkeeping is intentionally minimal here —
      // the per-plate state above already reflects real progress.
    });

    const cleanupIntervalComplete = gravi.onIntervalComplete(() => {
      dispatch({ type: 'SCAN_ENDED' });
      void finishSession(false);
    });

    const cleanupCancelled = gravi.onCancelled(() => {
      dispatch({ type: 'CANCELLED' });
    });

    const cleanupStarted = gravi.onScanStarted(() => {
      // No renderer-owned state currently derives from scan-started;
      // listener kept (and dual-casing-safe) for future per-plate "now
      // scanning" display without another event-wiring pass.
    });

    return () => {
      cleanupComplete();
      cleanupError();
      cleanupCycleComplete?.();
      cleanupIntervalComplete();
      cleanupCancelled();
      cleanupStarted();
    };
  }, [finishSession, recordCompletedJob]);

  // ── On-mount restore (design.md Decision 4) ──────────────────────────

  useEffect(() => {
    (async () => {
      const status = unwrapGraviResult<GetScanStatusResult & Record<string, any>>(
        await (window as any).electron.gravi.getScanStatus()
      );
      if (!status?.isActive) {
        if (experimentId) {
          const marker = localStorage.getItem(abnormalMarkerKey(experimentId, waveNumber));
          if (marker) {
            try {
              const parsed = JSON.parse(marker);
              setAbnormalTermination({ expectedCycles: parsed.expectedCycles });
            } catch {
              // Corrupt marker — treat as absent rather than throwing.
            }
          }
        }
        return;
      }

      const jobs: Record<string, ScanSessionJob> = status.jobs ?? {};
      const pendingJobs: Record<string, ScanSessionJob> = {};
      for (const [key, job] of Object.entries(jobs)) {
        if (job.status === 'pending' || job.status === 'scanning') {
          pendingJobs[key] = job;
        }
      }

      if (typeof status.waveNumber === 'number' && status.waveNumber !== waveNumber) {
        onRestoreWaveNumber?.(status.waveNumber);
      }

      jobTemplateRef.current = jobs;
      dispatch({
        type: 'RESTORE',
        payload: {
          pendingJobs,
          currentCycle: status.currentCycle ?? 0,
          totalCycles: status.totalCycles ?? 0,
          coordinatorState: status.coordinatorState ?? 'scanning',
          sessionId: status.sessionId ?? null,
          scanStartedAt: typeof status.scanStartedAt === 'number' ? status.scanStartedAt : null,
          nextScanAt: typeof status.nextScanAt === 'number' ? status.nextScanAt : null,
        },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    })().catch((err: any) => {
      dispatch({ type: 'ERROR', payload: { error: err instanceof Error ? err.message : String(err) } });
    });
    // Intentionally runs once on mount only — restoration is a one-time
    // reconciliation against main-process state, not a reactive sync.
  }, []);

  // ── startScan / cancelScan ────────────────────────────────────────────

  const startScan = useCallback(async () => {
    if (!canStartScan) {
      dispatch({
        type: 'ERROR',
        payload: { error: 'Cannot start — an assigned scanner has an active wedge.' },
      });
      return;
    }
    if (!experimentId || !phenotyperId) {
      dispatch({ type: 'ERROR', payload: { error: 'Select an experiment and phenotyper first.' } });
      return;
    }

    const outputDirResult = unwrapGraviResult<{
      success: boolean;
      path?: string;
      error?: string;
    }>(await (window as any).electron.gravi.getOutputDir());
    if (!outputDirResult?.success || !outputDirResult.path) {
      dispatch({
        type: 'ERROR',
        payload: { error: outputDirResult?.error ?? 'Could not determine the scan output directory.' },
      });
      return;
    }
    const outputDir = outputDirResult.path;

    const timestamp = Date.now();
    const jobs: Record<string, ScanSessionJob> = {};
    const scannerTotals: Record<string, number> = {};
    const scanners: Array<{
      scannerId: string;
      saneName: string;
      plates: Array<{
        plate_index: string;
        grid_mode: GridMode;
        resolution: number;
        output_path: string;
        wave_number: number;
        plate_barcode?: string | null;
      }>;
    }> = [];

    for (const scannerId of scannerIds) {
      const assignments = (assignmentsByScanner[scannerId] || []).filter((a) => a.selected);
      const gridMode = gridModes[scannerId];
      const plates = assignments.map((a) => {
        const outputPath = `${outputDir}/${experimentId}/wave${waveNumber}/${scannerId}/${a.plateIndex}_${timestamp}.tiff`;
        jobs[jobKey(scannerId, a.plateIndex)] = {
          scannerId,
          plateIndex: a.plateIndex,
          outputPath,
          plantBarcode: a.plantBarcode,
          transplantDate: a.transplantDate,
          customNote: a.customNote,
          gridMode,
          status: 'pending',
        };
        return {
          plate_index: a.plateIndex,
          grid_mode: gridMode,
          resolution,
          output_path: outputPath,
          wave_number: waveNumber,
          plate_barcode: a.plantBarcode,
        };
      });
      if (plates.length > 0) {
        scannerTotals[scannerId] = plates.length;
        scanners.push({ scannerId, saneName: saneNames[scannerId] ?? '', plates });
      }
    }

    if (scanners.length === 0) {
      dispatch({ type: 'ERROR', payload: { error: 'No plates selected for scanning.' } });
      return;
    }

    const intervalSeconds = Math.round(intervalMinutes * 60);
    const durationSeconds = Math.round(durationHours * 3600);
    const totalCycles = isContinuous
      ? intervalSeconds > 0
        ? Math.ceil(durationSeconds / intervalSeconds)
        : 1
      : 1;

    const result = unwrapGraviResult<{ success: boolean; error?: string }>(
      await (window as any).electron.gravi.startScan({
        scanners,
        interval: isContinuous ? { intervalSeconds, durationSeconds } : undefined,
        metadata: { experimentId, phenotyperId, resolution, waveNumber },
      })
    );

    if (!result?.success) {
      dispatch({ type: 'ERROR', payload: { error: result?.error ?? 'Failed to start scan.' } });
      return;
    }

    let sessionId: string | null = null;
    const sessionResult = await (window as any).electron.database.graviscanSessions.create({
      experiment_id: experimentId,
      phenotyper_id: phenotyperId,
      scan_mode: isContinuous ? 'continuous' : 'single',
      interval_seconds: isContinuous ? intervalSeconds : null,
      duration_seconds: isContinuous ? durationSeconds : null,
      total_cycles: totalCycles,
    });
    if (sessionResult?.success && sessionResult.data) {
      sessionId = sessionResult.data.id;
    }

    completedJobsRef.current = {};
    jobTemplateRef.current = jobs;
    dispatch({
      type: 'START',
      payload: { jobs, scannerTotals, totalCycles, sessionId, scanStartedAt: Date.now() },
    });

    if (experimentId) {
      localStorage.setItem(
        abnormalMarkerKey(experimentId, waveNumber),
        JSON.stringify({ expectedCycles: totalCycles })
      );
    }
  }, [
    canStartScan,
    experimentId,
    phenotyperId,
    waveNumber,
    resolution,
    scannerIds,
    gridModes,
    saneNames,
    assignmentsByScanner,
    isContinuous,
    intervalMinutes,
    durationHours,
  ]);

  const cancelScan = useCallback(async () => {
    try {
      const result = unwrapGraviResult<{ success: boolean; error?: string }>(
        await (window as any).electron.gravi.cancelScan()
      );
      if (!result?.success) {
        dispatch({ type: 'ERROR', payload: { error: result?.error ?? 'Cancel failed.' } });
        return;
      }
      dispatch({ type: 'CANCELLED' });
      await finishSession(true);
    } catch (err) {
      dispatch({ type: 'ERROR', payload: { error: err instanceof Error ? err.message : String(err) } });
    }
  }, [finishSession]);

  return {
    isScanning: state.isScanning,
    pendingJobs: state.pendingJobs,
    progressByScanner: state.progressByScanner,
    currentCycle: state.currentCycle,
    totalCycles: state.totalCycles,
    coordinatorState: state.coordinatorState,
    verificationStatus: state.verificationStatus,
    verificationResults: state.verificationResults,
    error: state.error,
    scanStartedAt: state.scanStartedAt,
    nextScanAt: state.nextScanAt,
    abnormalTermination,
    canStartScan,
    startScan,
    cancelScan,
  };
}
