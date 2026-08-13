import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import type {
  GridMode,
  PlateAssignment,
  QRVerifyPlateInput,
  QRVerifyPlateResult,
  ScanSessionJob,
  ScanSessionState,
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
  durationMinutes: number;
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

/** `scan-coordinator.ts`'s forwarded scan-complete event only ever carries
 * the image location as `path` (spread verbatim from the worker's own
 * `ScanWorkerEvent`) — it is never duplicated as camelCase `imagePath` the
 * way `scanner_id`/`plate_index` are. Resolving both anyway, dual-casing-
 * style, is deliberate defense against a future relay change, not evidence
 * `imagePath` is expected today. */
function resolveImagePath(event: Record<string, unknown>): string {
  return (event.path as string) ?? (event.imagePath as string) ?? '';
}

/** Mirrors `resolveImagePath()` — the coordinator only ever adds
 * `cycle_number` (snake_case) to the forwarded event, never a `cycleNumber`
 * duplicate. */
function resolveCycleNumber(event: Record<string, unknown>): number | null {
  const snake = event.cycle_number;
  if (typeof snake === 'number') return snake;
  const camel = event.cycleNumber;
  if (typeof camel === 'number') return camel;
  return null;
}

/** The Python worker emits `achieved_resolution` only on `scan-complete` —
 * the SANE device's actually-applied resolution, which may differ from the
 * pre-scan requested value (`database-handlers.ts:123-136`'s doc comment on
 * `graviscansCreate()`). No camelCase dual exists for this field either. */
function resolveAchievedResolution(
  event: Record<string, unknown>
): number | undefined {
  return typeof event.achieved_resolution === 'number'
    ? event.achieved_resolution
    : undefined;
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

  const runVerification = useCallback(
    async (jobsSnapshot: Record<string, ScanSessionJob>) => {
      const ctx = sessionContextRef.current;
      if (!ctx?.experimentId) return;

      const plates: QRVerifyPlateInput[] = [];
      for (const job of Object.values(jobsSnapshot)) {
        if (!job.imagePath || !job.plantBarcode) continue;
        plates.push({
          scannerId: job.scannerId,
          plateIndex: job.plateIndex,
          imagePath: job.imagePath,
          assignedPlateId: job.plantBarcode,
        });
      }
      if (plates.length === 0) return;

      dispatch({ type: 'VERIFY_STARTED' });
      try {
        const result = await window.electron.gravi.verifyPlates(
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

  const recordCompletedJob = useCallback(
    async (
      job: ScanSessionJob,
      imagePath: string,
      cycleNumber: number | null,
      achievedResolution: number | undefined
    ) => {
      const ctx = sessionContextRef.current;
      if (!ctx?.experimentId || !ctx.phenotyperId) return;
      await window.electron.database.graviscans.create({
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
        // The scan's actually-achieved resolution (design.md Decision 15),
        // not the pre-scan requested value — falls back to the requested
        // value only if a given event genuinely omits the field.
        resolution: achievedResolution ?? ctx.resolution,
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
        await window.electron.database.graviscanSessions.complete({
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
      // finishSession after cycle 1 while the backend kept scanning cycles
      // 2+ independently, silently overwriting each cycle's images).
      if (isContinuousRef.current) return;
      if (!allDoneFiredRef.current) {
        allDoneFiredRef.current = true;
        dispatch({ type: 'SCAN_ENDED' });
        void finishSession(false);
      }
    };

    const cleanupComplete = gravi.onScanComplete(
      (data: Record<string, unknown>) => {
        const scannerId = resolveScannerId(data);
        const plateIndex = resolvePlateIndex(data);
        const key = jobKey(scannerId, plateIndex);
        const job = jobTemplateRef.current[key];
        if (!job) return; // unknown job key — nothing to record

        const imagePath = resolveImagePath(data);
        const cycleNumber = resolveCycleNumber(data);
        const achievedResolution = resolveAchievedResolution(data);

        completedJobsRef.current[key] = {
          ...job,
          status: 'complete',
          imagePath,
        };
        dispatch({ type: 'JOB_COMPLETE', payload: { key, imagePath } });

        // Always recorded, even on a duplicated/retried event for a job
        // already removed from `pendingJobs` — the backend's own upsert is
        // what makes the repeat safe (tasks.md 12.3), not a hook-side guard.
        void recordCompletedJob(job, imagePath, cycleNumber, achievedResolution)
          .then(() => {
            // Advances the backend's own per-job status past 'pending' so a
            // later remount's RESTORE effect can tell this job apart from
            // one still genuinely in flight (design.md Decision 14). A
            // failure here only risks this specific job not being
            // recognized as already-done on a *future* remount — the
            // completed-job record itself already landed via
            // recordCompletedJob above, so it's a quieter, non-blocking
            // failure mode, not a data-loss one.
            void gravi.markJobRecorded?.(key).catch(() => {});
          })
          .catch((err: unknown) => {
            dispatch({
              type: 'ERROR',
              payload: {
                error: `Failed to save captured plate ${key}: ${err instanceof Error ? err.message : String(err)}`,
              },
            });
          });

        markJobAccountedFor(key);
      }
    );

    const cleanupError = gravi.onScanError((data: Record<string, unknown>) => {
      const scannerId = resolveScannerId(data);
      const plateIndex = resolvePlateIndex(data);
      if (!scannerId || !plateIndex) return;
      const key = jobKey(scannerId, plateIndex);
      // Mirrors onScanComplete's own unknown-job guard: without this, a
      // stray scan-error for a key outside this session's jobTemplateRef
      // (a leftover event from a prior session, a hardware echo with a
      // mismatched plate index) would inflate completedKeysRef past what
      // this session actually has jobs for, risking a premature
      // finishSession(false) while a real job is still in flight.
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
      // SCAN_ENDED/finishSession would never fire and the session would be
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
      void finishSession(false);
    });

    const cleanupCancelled = gravi.onCancelled(() => {
      dispatch({ type: 'CANCELLED' });
    });

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
    };
  }, [finishSession, recordCompletedJob]);

  // ── On-mount restore (design.md Decision 4) ──────────────────────────

  useEffect(() => {
    (async () => {
      const status = unwrapGraviResult<Partial<ScanSessionState>>(
        await window.electron.gravi.getScanStatus()
      );
      if (!status?.isActive) {
        return;
      }

      const jobs: Record<string, ScanSessionJob> = status.jobs ?? {};
      const pendingJobs: Record<string, ScanSessionJob> = {};
      const restoredCompletedJobs: Record<string, ScanSessionJob> = {};
      for (const [key, job] of Object.entries(jobs)) {
        if (job.status === 'pending' || job.status === 'scanning') {
          pendingJobs[key] = job;
        } else if (job.status === 'recorded' || job.status === 'complete') {
          // markJobRecorded() (design.md Decision 14) is what makes this
          // status reachable at all — without it every job would still
          // report 'pending' here, indistinguishable from one genuinely
          // still in flight. The backend never separately stores the real
          // captured path, only the deterministic path assigned at job
          // creation, which the scanner always writes to.
          restoredCompletedJobs[key] = {
            ...job,
            status: 'complete',
            imagePath: job.imagePath ?? job.outputPath,
          };
        }
      }
      completedJobsRef.current = restoredCompletedJobs;

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
      const status = unwrapGraviResult<Partial<ScanSessionState>>(
        await window.electron.gravi.getScanStatus()
      );
      if (cancelled) return;
      if (status?.isActive) return; // handled by the active-session restore above

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
    // two overlapping setup chains (each calling gravi.startScan() and
    // graviscanSessions.create() independently), with whichever dispatches
    // 'START' last silently clobbering jobTemplateRef/completedJobsRef for
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

      const outputDirResult = unwrapGraviResult<{
        success: boolean;
        path?: string;
        error?: string;
      }>(await window.electron.gravi.getOutputDir());
      if (!outputDirResult?.success || !outputDirResult.path) {
        dispatch({
          type: 'ERROR',
          payload: {
            error:
              outputDirResult?.error ??
              'Could not determine the scan output directory.',
          },
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
        const assignments = (assignmentsByScanner[scannerId] || []).filter(
          (a) => a.selected
        );
        const gridMode = gridModes[scannerId];
        const plates = assignments.map((a) => {
          const outputPath = `${outputDir}/${experimentId}/wave${waveNumber}/${scannerId}/${a.plateIndex}_cy1_${timestamp}.tiff`;
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

      const result = unwrapGraviResult<{ success: boolean; error?: string }>(
        await window.electron.gravi.startScan({
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

      let sessionId: string | null = null;
      const sessionResult =
        await window.electron.database.graviscanSessions.create({
          experiment_id: experimentId,
          phenotyper_id: phenotyperId,
          scan_mode: isContinuous ? 'continuous' : 'single',
          interval_seconds: isContinuous ? intervalSeconds : null,
          duration_seconds: isContinuous ? durationSeconds : null,
          total_cycles: totalCycles,
        });
      if (sessionResult?.success && sessionResult.data) {
        sessionId = (sessionResult.data as { id: string }).id;
      }

      // Snapshot the session's own experiment/phenotyper/wave/resolution
      // once, here — every subsequent recordCompletedJob/runVerification/
      // marker-clearing call for this session reads this snapshot, never
      // the live selectors (design.md Decision 13).
      sessionContextRef.current = {
        experimentId,
        phenotyperId,
        waveNumber,
        resolution,
      };
      completedJobsRef.current = {};
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

      // The coordinator has already physically started scanning by this
      // point (gravi.startScan() above succeeded) — a failure here can't
      // un-start it, but a null sessionId silently degrades
      // graviscansCreate's upsert-based idempotency (task 2.3/2.4) back to
      // a plain create() for every job this session completes. Dispatched
      // AFTER 'START' so it isn't immediately wiped by START's own state
      // reset.
      if (!sessionResult?.success) {
        dispatch({
          type: 'ERROR',
          payload: {
            error: `Scan started, but session tracking failed to save (${sessionResult?.error ?? 'unknown error'}) — duplicate-write protection will not apply this session.`,
          },
        });
      }

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
      await finishSession(true);
    } catch (err) {
      dispatch({
        type: 'ERROR',
        payload: { error: err instanceof Error ? err.message : String(err) },
      });
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
