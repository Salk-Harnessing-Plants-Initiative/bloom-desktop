/**
 * Hooks for a GraviScan session's database records, and its single end.
 *
 * The main process writes every record of a session (record-graviscan-
 * scans-in-main-process): the session row is opened through
 * `openSessionRecord` once the scanners are up and before scanning starts,
 * and `onSessionEnd` runs exactly once when the session completes, is
 * cancelled or fails, whether or not the scan page is open. Kept apart from
 * `session-handlers.ts` so that module stays free of database access.
 */
import type { ScanSessionState } from '../../types/graviscan';
import type { SessionFns } from './session-handlers';

/** How a session ended. A failure is recorded like a cancel. */
export type SessionOutcome = 'completed' | 'cancelled' | 'failed';

/** What the session row is created from. */
export interface SessionRecordInfo {
  experimentId: string;
  phenotyperId: string;
  scanMode: 'single' | 'continuous';
  intervalSeconds: number | null;
  durationSeconds: number | null;
  totalCycles: number;
}

export type OpenSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: string };

export interface StartScanHooks {
  /** Create the session's database row. Not called for a test scan. */
  openSessionRecord?: (info: SessionRecordInfo) => Promise<OpenSessionResult>;
  /**
   * Runs exactly once, when the session ends. It may be async; the caller
   * doesn't wait for it, so it must handle its own errors.
   */
  onSessionEnd?: (
    session: ScanSessionState,
    outcome: SessionOutcome
  ) => void | Promise<void>;
}

/** The message shown when the session row can't be created. */
export function sessionNotSavedMessage(reason: string): string {
  return (
    `The scan didn't start: the session couldn't be saved to the database ` +
    `(${reason}). Nothing was scanned. Try again; if it keeps happening, ` +
    `restart the app.`
  );
}

/**
 * End `session` once: clear the current session unless a newer one has
 * replaced it, then run `onSessionEnd`. Later calls for the same session
 * (for example the scan finishing after a cancel) do nothing.
 */
export function endScanSession(
  sessionFns: SessionFns,
  session: ScanSessionState | null,
  outcome: SessionOutcome,
  hooks?: StartScanHooks
): void {
  if (!session || session.ended) return;
  session.ended = true;
  const current = sessionFns.getScanSession();
  if (!current || current === session) {
    sessionFns.setScanSession(null);
  }
  void hooks?.onSessionEnd?.(session, outcome);
}

/**
 * Start cycle `cycle` of `session`: its jobs go back to pending, so a page
 * that returns mid-cycle shows this cycle's progress (#314). Earlier or
 * repeated cycle numbers do nothing.
 */
export function advanceSessionCycle(
  session: ScanSessionState | null,
  cycle: unknown
): void {
  if (!session || typeof cycle !== 'number' || cycle <= session.currentCycle) {
    return;
  }
  session.currentCycle = cycle;
  for (const job of Object.values(session.jobs)) {
    job.status = 'pending';
    delete job.error;
  }
}
