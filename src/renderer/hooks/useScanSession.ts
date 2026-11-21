import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  GridMode,
  PlateAssignment,
  QRVerifyPlateResult,
  ScanSessionJob,
  ScanSessionState,
} from '../../types/graviscan';
import type { GraviLastSession } from '../../types/electron';
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
  durationMinutes: number;
  /** Called when on-mount restore (design.md Decision 4) finds an active
   * session whose waveNumber differs from the caller's own — `waveNumber`
   * is owned by `useWaveNumber`, not this hook, so restoration is surfaced
   * via callback rather than this hook silently taking ownership of it. */
  onRestoreWaveNumber?: (waveNumber: number) => void;
}

export interface UseScanSessionResult {
  isScanning: boolean;
  /** Start Scan was pressed and the session is being set up. */
  isStarting: boolean;
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

/** The coordinator's scan-complete event carries the saved file as `path`. */
function resolveImagePath(event: Record<string, unknown>): string {
  return (event.path as string) ?? (event.imagePath as string) ?? '';
}

/** "YYYY-MM-DD" for Start Scan. Plate assignments are typed as that
 * string but hold a `Date` at runtime when loaded from the database
 * (#315), so both are accepted. */
export function toPlateDate(value: unknown): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? null
      : value.toISOString().slice(0, 10);
  }
  return typeof value === 'string' && value !== '' ? value.slice(0, 10) : null;
}

/** Each scanner's plate count, from a session's jobs. */
function totalsByScanner(
  jobs: Record<string, ScanSessionJob>
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const job of Object.values(jobs)) {
    totals[job.scannerId] = (totals[job.scannerId] ?? 0) + 1;
  }
  return totals;
}

/** Percent of each scanner's plates no longer pending. */
function progressFor(
  totals: Record<string, number>,
  pending: Record<string, ScanSessionJob>
): Record<string, number> {
  const progress: Record<string, number> = {};
  for (const [scannerId, total] of Object.entries(totals)) {
    const remaining = Object.values(pending).filter(
      (j) => j.scannerId === scannerId
    ).length;
    progress[scannerId] = Math.round(((total - remaining) / total) * 100);
  }
  return progress;
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
  | {
      type: 'CYCLE_ADVANCE';
      payload: { jobs: Record<string, ScanSessionJob>; cycle: number };
    }
  | { type: 'INTERVAL_WAITING' }
  | { type: 'INTERVAL_RESUMED' }
  | { type: 'ERROR'; payload: { error: string } }
  | {
      type: 'RESTORE';
      payload: {
        pendingJobs: Record<string, ScanSessionJob>;
        scannerTotals: Record<string, number>;
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
  | { type: 'VERIFY_COMPLETE' }
  | { type: 'VERIFY_RESTORED'; payload: QRVerifyPlateResult[] };

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
      // An error for a plate already done (its image saved but not
      // recorded) is still shown.
      if (!(key in state.pendingJobs)) return { ...state, error };
      const nextPendingJobs = { ...state.pendingJobs };
      delete nextPendingJobs[key];
      return { ...state, pendingJobs: nextPendingJobs, error };
    }
    case 'CYCLE_ADVANCE':
      // Continuous mode only (design.md/tasks.md 12.x's job-keying is
      // scanner+plateIndex only, not cycle-scoped, so each new cycle's
      // fresh job set must explicitly replace the just-finished one —
      // without this, `pendingJobs` would stay permanently empty after
      // cycle 1 and the "all done" count would never reset).
      return {
        ...state,
        pendingJobs: action.payload.jobs,
        progressByScanner: Object.fromEntries(
          Object.keys(state.scannerTotals).map((scannerId) => [scannerId, 0])
        ),
        currentCycle: action.payload.cycle,
      };
    case 'INTERVAL_WAITING':
      // Guards against a stray/late `interval-waiting` event arriving
      // after the session has already ended (design.md Decision 17) —
      // these IPC-listener callbacks have no ordering guarantee relative
      // to `onIntervalComplete`/`onCancelled` reaching the same effect.
      if (!state.isScanning) return state;
      return { ...state, coordinatorState: 'waiting' };
    case 'INTERVAL_RESUMED':
      if (!state.isScanning) return state;
      return { ...state, coordinatorState: 'scanning' };
    // A cancel and a clean natural completion leave identical state behind
    // — the only real difference between them is the `cancelled` flag
    // the main process records, not what a session-ending action
    // resets here. Sharing one case avoids two copies that could silently
    // drift apart again (design.md Decision 17 found and fixed exactly
    // that drift once already).
    case 'CANCELLED':
    case 'SCAN_ENDED':
      return {
        ...state,
        isScanning: false,
        pendingJobs: {},
        progressByScanner: {},
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
        // Rebuilt from the session's jobs, so per-scanner progress is right
        // after returning to the page (#314).
        scannerTotals: action.payload.scannerTotals,
        progressByScanner: progressFor(
          action.payload.scannerTotals,
          action.payload.pendingJobs
        ),
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
    case 'VERIFY_RESTORED':
      return {
        ...state,
        verificationStatus: 'complete',
        verificationResults: Object.fromEntries(
          action.payload.map((r) => [jobKey(r.scannerId, r.plateIndex), r])
        ),
      };
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
export function useScanSession(
  params: UseScanSessionParams
): UseScanSessionResult {
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
    durationMinutes,
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

  // Read by the IPC-listener effect (deps: []) below to tell single-mode
  // (one cycle, job-completion IS session-completion) from continuous mode
  // (many cycles, job-completion only means "this cycle" — the backend's
  // own interval-complete event is the sole session-end signal).
  const isContinuousRef = useRef(isContinuous);
  useEffect(() => {
    isContinuousRef.current = isContinuous;
  }, [isContinuous]);

  // Frozen once per session — NOT continuously mirrored like the old
  // `contextRef` was (design.md Decision 13). Set once in `startScan()`
  // (before dispatching `START`) and once in the on-mount restore effect
  // (from the backend's own `ScanSessionState`), so a mid-scan change to
  // the live experiment/phenotyper/wave/resolution selectors can never
  // retroactively change which experiment/wave an in-flight job's DB write
  // or QR verification gets attributed to.
  const sessionContextRef = useRef<{
    experimentId: string;
    phenotyperId: string;
    waveNumber: number;
    resolution: number;
  } | null>(null);

  const clearAbnormalMarker = useCallback(() => {
    const ctx = sessionContextRef.current;
    if (!ctx) return;
    localStorage.removeItem(
      abnormalMarkerKey(ctx.experimentId, ctx.waveNumber)
    );
    // Only blank the displayed banner if it's still showing for this same
    // session's own wave — otherwise this session ending under wave A would
    // wipe a banner correctly showing an unrelated marker for wave B that
    // the operator has since switched to.
    if (ctx.experimentId === experimentId && ctx.waveNumber === waveNumber) {
      setAbnormalTermination(null);
    }
  }, [experimentId, waveNumber]);

  // Immutable per-session job metadata, set once at START — unlike
  // `state.pendingJobs`, this is never pruned, so a duplicated/retried
  // scan-complete event can still look up the job it refers to after the
  // first delivery already removed it from `pendingJobs`.
  const jobTemplateRef = useRef<Record<string, ScanSessionJob>>({});
  // Synchronous, ref-based completion tracking for the "are all jobs done"
  // decision inside the onScanComplete handler. `stateRef.current` is only
  // refreshed by a useEffect that runs after a render commits — if two
  // scan-complete events for the last two remaining jobs are delivered
  // within the same render/effect cycle (React 18 batches dispatches from
  // any source), both handler invocations would read the same stale
  // `stateRef.current.pendingJobs` and neither would see 0 remaining. A
  // plain Set mutated synchronously has no such lag: the second call always
  // sees the first call's addition, regardless of render timing.
  const completedKeysRef = useRef<Set<string>>(new Set());
  const allDoneFiredRef = useRef(false);
  // Re-entrancy guard for startScan() — see its own comment at the call site.
  const isStartingRef = useRef(false);
  const [isStarting, setIsStarting] = useState(false);

  // The main process records every image, marks the session row complete
  // and runs the QR check, whether or not this page is open. The page only
  // clears its own abnormal-termination marker.
  const endSession = clearAbnormalMarker;

  // ── IPC event listeners ──────────────────────────────────────────────

  useEffect(() => {
    const gravi = window.electron.gravi;

    // Shared by both onScanComplete and onScanError — a job is "accounted
    // for" (no longer something the session is waiting on) whether it
    // completed or errored. See the onScanError call site for why errored
    // jobs must count too.
    const markJobAccountedFor = (key: string) => {
      completedKeysRef.current.add(key);
      const totalJobs = Object.keys(jobTemplateRef.current).length;
      if (completedKeysRef.current.size < totalJobs) return;
      // In continuous mode, "this cycle's jobs are all in" is not "the
      // session is done" — the backend keeps scanning further cycles
      // regardless of what this hook thinks. `onCycleComplete`/
      // `onIntervalComplete` below are the sole authority on continuous-
      // mode session end (round-4 regression: this used to fire
      // the session end after cycle 1 while the backend kept scanning cycles
      // 2+ independently, silently overwriting each cycle's images).
      if (isContinuousRef.current) return;
      if (!allDoneFiredRef.current) {
        allDoneFiredRef.current = true;
        dispatch({ type: 'SCAN_ENDED' });
        endSession();
      }
    };

    const cleanupComplete = gravi.onScanComplete(
      (data: Record<string, unknown>) => {
        const scannerId = resolveScannerId(data);
        const plateIndex = resolvePlateIndex(data);
        const key = jobKey(scannerId, plateIndex);
        if (!(key in jobTemplateRef.current)) return; // not this session's

        const imagePath = resolveImagePath(data);
        dispatch({ type: 'JOB_COMPLETE', payload: { key, imagePath } });
        markJobAccountedFor(key);
      }
    );

    const cleanupError = gravi.onScanError((data: Record<string, unknown>) => {
      const scannerId = resolveScannerId(data);
      const plateIndex = resolvePlateIndex(data);
      if (!scannerId || !plateIndex) {
        // A session-wide problem from the main process (the scan failed,
        // or the session's end or QR check couldn't be saved).
        if (typeof data.error === 'string' && data.error) {
          dispatch({ type: 'ERROR', payload: { error: data.error } });
        }
        return;
      }
      const key = jobKey(scannerId, plateIndex);
      // Mirrors onScanComplete's own unknown-job guard: without this, a
      // stray scan-error for a key outside this session's jobTemplateRef
      // (a leftover event from a prior session, a hardware echo with a
      // mismatched plate index) would inflate completedKeysRef past what
      // this session actually has jobs for, risking a premature
      // session end while a real job is still in flight.
      if (!(key in jobTemplateRef.current)) return;
      dispatch({
        type: 'JOB_ERROR',
        payload: {
          key,
          error: (data.error as string) ?? 'Scan error',
        },
      });
      // An errored job is done being waited on just as much as a completed
      // one — JOB_ERROR already removes it from state.pendingJobs. Without
      // also counting it here, a single-mode session where any one job
      // errors (the rest completing normally) would never reach "all done":
      // completedKeysRef could never reach the full job count, so
      // SCAN_ENDED would never fire and the session would be
      // stuck showing isScanning: true forever.
      markJobAccountedFor(key);
    });

    const cleanupCycleComplete = gravi.onCycleComplete?.(
      (data: Record<string, unknown>) => {
        if (!isContinuousRef.current) return;
        const cycle = typeof data?.cycle === 'number' ? data.cycle : null;
        if (cycle === null) return;
        // The final cycle's cycle-complete is immediately followed by
        // interval-complete, which ends the session — resetting to a
        // nonexistent "next cycle" here would just flash stale UI state
        // right before that.
        if (cycle >= stateRef.current.totalCycles) return;
        completedKeysRef.current = new Set();
        dispatch({
          type: 'CYCLE_ADVANCE',
          payload: { jobs: jobTemplateRef.current, cycle: cycle + 1 },
        });
      }
    );

    const cleanupIntervalComplete = gravi.onIntervalComplete(() => {
      dispatch({ type: 'SCAN_ENDED' });
      endSession();
    });

    const cleanupCancelled = gravi.onCancelled(() => {
      dispatch({ type: 'CANCELLED' });
    });

    // The QR check runs in the main process when a session completes.
    const cleanupVerifyStarted = gravi.onVerifyStarted(() =>
      dispatch({ type: 'VERIFY_STARTED' })
    );
    const cleanupVerifyResult = gravi.onVerifyResult((r) =>
      dispatch({ type: 'VERIFY_RESULT', payload: r })
    );
    const cleanupVerifyComplete = gravi.onVerifyComplete(() =>
      dispatch({ type: 'VERIFY_COMPLETE' })
    );

    const cleanupStarted = gravi.onScanStarted(() => {
      // The first per-plate scan-started event of a new cycle is exactly
      // the signal that scanning has resumed after an interval-waiting
      // pause (design.md Decision 12) — harmless to dispatch on every
      // scan-started, not just the first per cycle, since it's a no-op
      // once coordinatorState is already 'scanning'.
      dispatch({ type: 'INTERVAL_RESUMED' });
    });

    const cleanupIntervalWaiting = gravi.onIntervalWaiting?.(() => {
      dispatch({ type: 'INTERVAL_WAITING' });
    });

    return () => {
      cleanupComplete();
      cleanupError();
      cleanupCycleComplete?.();
      cleanupIntervalComplete();
      cleanupCancelled();
      cleanupStarted();
      cleanupIntervalWaiting?.();
      cleanupVerifyStarted();
      cleanupVerifyResult();
      cleanupVerifyComplete();
    };
  }, [endSession]);

  // ── On-mount restore (design.md Decision 4) ──────────────────────────

  useEffect(() => {
    (async () => {
      const status = unwrapGraviResult<Partial<ScanSessionState>>(
        await window.electron.gravi.getScanStatus()
      );
      if (!status?.isActive) {
        return;
      }

      // The main process marks each job recorded (or error) itself, so a
      // job still 'pending' or 'scanning' is genuinely in flight.
      const jobs: Record<string, ScanSessionJob> = status.jobs ?? {};
      const pendingJobs: Record<string, ScanSessionJob> = {};
      for (const [key, job] of Object.entries(jobs)) {
        if (job.status === 'pending' || job.status === 'scanning') {
          pendingJobs[key] = job;
        }
      }

      if (
        typeof status.waveNumber === 'number' &&
        status.waveNumber !== waveNumber
      ) {
        onRestoreWaveNumber?.(status.waveNumber);
      }

      // The backend's own record of what this already-in-progress session
      // started under is strictly more authoritative than this hook's own
      // first-render closure — `experimentId`/`waveNumber` can still be
      // null/stale at this point (design.md Decision 10), and even once
      // resolved, the renderer's restored selection is not guaranteed to
      // match the session's actual wave until `onRestoreWaveNumber` above
      // takes effect on a later render.
      sessionContextRef.current = {
        experimentId:
          typeof status.experimentId === 'string'
            ? status.experimentId
            : (experimentId ?? ''),
        phenotyperId:
          typeof status.phenotyperId === 'string'
            ? status.phenotyperId
            : (phenotyperId ?? ''),
        waveNumber:
          typeof status.waveNumber === 'number'
            ? status.waveNumber
            : waveNumber,
        resolution:
          typeof status.resolution === 'number'
            ? status.resolution
            : resolution,
      };

      jobTemplateRef.current = jobs;
      completedKeysRef.current = new Set(
        Object.keys(jobs).filter((k) => !(k in pendingJobs))
      );
      allDoneFiredRef.current = false;
      dispatch({
        type: 'RESTORE',
        payload: {
          pendingJobs,
          scannerTotals: totalsByScanner(jobs),
          currentCycle: status.currentCycle ?? 0,
          totalCycles: status.totalCycles ?? 0,
          coordinatorState: status.coordinatorState ?? 'scanning',
          sessionId: status.sessionId ?? null,
          scanStartedAt:
            typeof status.scanStartedAt === 'number'
              ? status.scanStartedAt
              : null,
          nextScanAt:
            typeof status.nextScanAt === 'number' ? status.nextScanAt : null,
        },
      });
    })().catch((err: unknown) => {
      dispatch({
        type: 'ERROR',
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
    });
    // Intentionally runs once on mount only — restoration is a one-time
    // reconciliation against main-process state, not a reactive sync.
  }, []);

  // ── Abnormal-termination marker check (design.md Decision 10) ─────────
  //
  // Deliberately its own effect, not folded into the mount-once restore
  // above: `experimentId` is always `null` on this hook's very first
  // render (GraviScan.tsx's own state starts there, populated only
  // asynchronously — via the cross-navigation session restore, or an
  // operator picking from the experiment/wave selectors), so a `[]`-deps
  // effect can never correctly check a marker keyed by it. This effect
  // instead depends on `[experimentId, waveNumber]`, re-checking whenever
  // either becomes known or changes — including reactively clearing a
  // previously-shown banner when the operator switches to a wave with no
  // marker of its own, not just leaving it stuck from the prior wave.
  useEffect(() => {
    if (!experimentId) return;
    let cancelled = false;
    (async () => {
      const status = unwrapGraviResult<
        Partial<ScanSessionState> & { lastSession?: GraviLastSession }
      >(await window.electron.gravi.getScanStatus());
      if (cancelled) return;
      if (status?.isActive) return; // handled by the active-session restore above

      // A session for this experiment and wave that ended while the page
      // was closed ended normally: clear its marker and show its QR result.
      const last = status?.lastSession;
      if (
        last &&
        last.experimentId === experimentId &&
        last.waveNumber === waveNumber
      ) {
        localStorage.removeItem(abnormalMarkerKey(experimentId, waveNumber));
        setAbnormalTermination(null);
        if (last.verifying) {
          // Its QR check is still running; results arrive as live events.
          dispatch({ type: 'VERIFY_STARTED' });
        } else if (last.verification?.results) {
          dispatch({
            type: 'VERIFY_RESTORED',
            payload: last.verification.results,
          });
        }
        return;
      }

      const marker = localStorage.getItem(
        abnormalMarkerKey(experimentId, waveNumber)
      );
      if (!marker) {
        setAbnormalTermination(null);
        return;
      }
      try {
        setAbnormalTermination({
          expectedCycles: JSON.parse(marker).expectedCycles,
        });
      } catch {
        // Corrupt marker — treat as absent rather than throwing.
        setAbnormalTermination(null);
      }
    })().catch((err: unknown) => {
      // A status-check failure here shouldn't surface as a blocking
      // ERROR — this banner is an informational, non-blocking signal —
      // but it should still be logged, matching GraviScan.tsx's own
      // sibling catches for this screen's other non-blocking async effects.
      console.error(
        'Failed to check abnormal-termination marker:',
        err instanceof Error ? err.message : err
      );
    });
    return () => {
      cancelled = true;
    };
  }, [experimentId, waveNumber]);

  // ── startScan / cancelScan ────────────────────────────────────────────

  const startScan = useCallback(async () => {
    // Re-entrancy guard: a fast double-click on Start would otherwise run
    // two overlapping setup chains, with whichever dispatches
    // 'START' last silently clobbering jobTemplateRef for
    // a physical scan the first call's hardware may still be running.
    // `isScanning` alone doesn't cover this — it stays false for this
    // entire async setup, only flipping true once 'START' dispatches.
    if (isStartingRef.current || stateRef.current.isScanning) {
      dispatch({
        type: 'ERROR',
        payload: { error: 'A scan is already in progress.' },
      });
      return;
    }
    isStartingRef.current = true;
    setIsStarting(true);
    try {
      if (!canStartScan) {
        dispatch({
          type: 'ERROR',
          payload: {
            error: 'Cannot start — an assigned scanner has an active wedge.',
          },
        });
        return;
      }
      if (!experimentId || !phenotyperId) {
        dispatch({
          type: 'ERROR',
          payload: { error: 'Select an experiment and phenotyper first.' },
        });
        return;
      }

      // The main process builds every output path (the rig's folder and
      // file names) and returns them; this hook sends only the choices.
      const jobs: Record<string, ScanSessionJob> = {};
      const scannerTotals: Record<string, number> = {};
      const scanners: Array<{
        scannerId: string;
        saneName: string;
        plates: Array<{
          plate_index: string;
          grid_mode: GridMode;
          resolution: number;
          plate_barcode: string | null;
          transplant_date: string | null;
          custom_note: string | null;
        }>;
      }> = [];

      for (const scannerId of scannerIds) {
        const assignments = (assignmentsByScanner[scannerId] || []).filter(
          (a) => a.selected
        );
        const gridMode = gridModes[scannerId];
        const plates = assignments.map((a) => {
          const transplantDate = toPlateDate(a.transplantDate);
          jobs[jobKey(scannerId, a.plateIndex)] = {
            scannerId,
            plateIndex: a.plateIndex,
            outputPath: '',
            plantBarcode: a.plantBarcode,
            transplantDate,
            customNote: a.customNote,
            gridMode,
            status: 'pending',
          };
          // Each plate's details go to the main process once, here; it
          // records them on every image of the plate.
          return {
            plate_index: a.plateIndex,
            grid_mode: gridMode,
            resolution,
            plate_barcode: a.plantBarcode ?? null,
            transplant_date: transplantDate,
            custom_note: a.customNote ?? null,
          };
        });
        if (plates.length > 0) {
          scannerTotals[scannerId] = plates.length;
          scanners.push({
            scannerId,
            saneName: saneNames[scannerId] ?? '',
            plates,
          });
        }
      }

      if (scanners.length === 0) {
        dispatch({
          type: 'ERROR',
          payload: { error: 'No plates selected for scanning.' },
        });
        return;
      }

      const intervalSeconds = Math.round(intervalMinutes * 60);
      const durationSeconds = Math.round(durationMinutes * 60);
      const totalCycles = isContinuous
        ? intervalSeconds > 0
          ? Math.ceil(durationSeconds / intervalSeconds)
          : 1
        : 1;

      const result = unwrapGraviResult<{
        success: boolean;
        error?: string;
        sessionId?: string;
        outputPaths?: Record<string, string>;
      }>(
        await window.electron.gravi.startScan({
          scannerOrder: scannerIds,
          scanners,
          interval: isContinuous
            ? { intervalSeconds, durationSeconds }
            : undefined,
          metadata: { experimentId, phenotyperId, resolution, waveNumber },
        })
      );

      if (!result?.success) {
        dispatch({
          type: 'ERROR',
          payload: { error: result?.error ?? 'Failed to start scan.' },
        });
        return;
      }
      for (const [key, job] of Object.entries(jobs)) {
        job.outputPath = result.outputPaths?.[key] ?? '';
      }

      // The main process created the session row before scanning started.
      const sessionId = result.sessionId ?? null;

      // Snapshot the session's own experiment/phenotyper/wave/resolution
      // once, here — marker clearing for this session reads this snapshot,
      // never the live selectors (design.md Decision 13).
      sessionContextRef.current = {
        experimentId,
        phenotyperId,
        waveNumber,
        resolution,
      };
      jobTemplateRef.current = jobs;
      completedKeysRef.current = new Set();
      allDoneFiredRef.current = false;
      setAbnormalTermination(null);
      dispatch({
        type: 'START',
        payload: {
          jobs,
          scannerTotals,
          totalCycles,
          sessionId,
          scanStartedAt: Date.now(),
        },
      });

      if (experimentId) {
        localStorage.setItem(
          abnormalMarkerKey(experimentId, waveNumber),
          JSON.stringify({ expectedCycles: totalCycles })
        );
      }
    } catch (err) {
      dispatch({
        type: 'ERROR',
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
    } finally {
      isStartingRef.current = false;
      setIsStarting(false);
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
    durationMinutes,
  ]);

  const cancelScan = useCallback(async () => {
    try {
      const result = unwrapGraviResult<{ success: boolean; error?: string }>(
        await window.electron.gravi.cancelScan()
      );
      if (!result?.success) {
        dispatch({
          type: 'ERROR',
          payload: { error: result?.error ?? 'Cancel failed.' },
        });
        return;
      }
      dispatch({ type: 'CANCELLED' });
      endSession();
    } catch (err) {
      dispatch({
        type: 'ERROR',
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }, [endSession]);

  return {
    isScanning: state.isScanning,
    isStarting,
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
