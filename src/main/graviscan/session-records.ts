/**
 * A GraviScan session's own database row, and its end-of-session QR check.
 *
 * Builds the `StartScanHooks` that `startScan` uses: the session row is
 * created before the scanners start and marked complete when the session
 * ends (cancelled for a cancel or a failure). A completed session's plates
 * are then QR-checked, and the last session's outcome and QR result are
 * kept so the scan page can show them when the operator returns.
 *
 * Database and QR-check access are injected, so this module has no
 * Electron or Prisma dependency. Test scans are never recorded.
 */
import type { DatabaseResponse } from '../../types/database';
import type { ScanSessionState } from '../../types/graviscan';
import type {
  GraviScanSessionCompleteInput,
  GraviScanSessionCreateInput,
} from '../database-handlers';
import type {
  OpenSessionResult,
  SessionOutcome,
  SessionRecordInfo,
  StartScanHooks,
} from './session-lifecycle';
import type { VerifyPlateInput, VerifyPlatesResult } from './verify-plates';

export interface SessionRecordsDeps {
  createSession: (
    data: GraviScanSessionCreateInput
  ) => Promise<DatabaseResponse>;
  completeSession: (
    args: GraviScanSessionCompleteInput
  ) => Promise<DatabaseResponse>;
  /** Run the QR check; sends the verify-* events to the page. */
  verify: (
    plates: VerifyPlateInput[],
    experimentId: string,
    waveNumber: number
  ) => Promise<VerifyPlatesResult>;
  /** Log the problem and show it on the scan page. */
  reportError: (message: string) => void;
  /** Resolves once images still being recorded are in the database. */
  waitForRecordings?: () => Promise<void>;
}

/** The last session that ended, for the scan page when it returns. */
export interface LastSessionSummary {
  sessionId: string;
  experimentId: string;
  waveNumber: number;
  outcome: SessionOutcome;
  /** The QR result; null when the check didn't run or failed. */
  verification: VerifyPlatesResult | null;
}

export interface SessionRecords {
  hooks: Required<StartScanHooks>;
  getLastSession: () => LastSessionSummary | null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

/** Recorded plates with a barcode and an image: what the QR check reads. */
function platesToVerify(session: ScanSessionState): VerifyPlateInput[] {
  const plates: VerifyPlateInput[] = [];
  for (const job of Object.values(session.jobs)) {
    if (!job.imagePath || !job.plantBarcode) continue;
    plates.push({
      scannerId: job.scannerId,
      plateIndex: job.plateIndex,
      imagePath: job.imagePath,
      assignedPlateId: job.plantBarcode,
    });
  }
  return plates;
}

export function createSessionRecords(deps: SessionRecordsDeps): SessionRecords {
  let lastSession: LastSessionSummary | null = null;

  async function openSessionRecord(
    info: SessionRecordInfo
  ): Promise<OpenSessionResult> {
    try {
      const result = await deps.createSession({
        experiment_id: info.experimentId,
        phenotyper_id: info.phenotyperId,
        scan_mode: info.scanMode,
        interval_seconds: info.intervalSeconds,
        duration_seconds: info.durationSeconds,
        total_cycles: info.totalCycles,
      });
      const id = (result.data as { id?: unknown } | undefined)?.id;
      if (!result.success || typeof id !== 'string') {
        return { ok: false, error: result.error ?? 'no session id returned' };
      }
      return { ok: true, sessionId: id };
    } catch (error) {
      return { ok: false, error: errorText(error) };
    }
  }

  async function completeRow(sessionId: string, cancelled: boolean) {
    try {
      const result = await deps.completeSession({
        session_id: sessionId,
        cancelled,
      });
      if (!result.success) throw new Error(result.error ?? 'unknown reason');
    } catch (error) {
      deps.reportError(
        `The session's end couldn't be saved to the database (${errorText(error)}). The scans themselves are saved.`
      );
    }
  }

  async function runQrCheck(
    session: ScanSessionState
  ): Promise<VerifyPlatesResult | null> {
    const plates = platesToVerify(session);
    if (plates.length === 0) return null;
    try {
      return await deps.verify(
        plates,
        session.experimentId,
        session.waveNumber
      );
    } catch (error) {
      deps.reportError(
        `The QR check after the scan didn't run (${errorText(error)}).`
      );
      return null;
    }
  }

  async function onSessionEnd(
    session: ScanSessionState,
    outcome: SessionOutcome
  ): Promise<void> {
    if (session.isTest || !session.sessionId) return;
    // The last plate's rows may still be in flight; the QR check reads them.
    await deps.waitForRecordings?.();
    await completeRow(session.sessionId, outcome !== 'completed');
    const verification =
      outcome === 'completed' ? await runQrCheck(session) : null;
    lastSession = {
      sessionId: session.sessionId,
      experimentId: session.experimentId,
      waveNumber: session.waveNumber,
      outcome,
      verification,
    };
  }

  return {
    hooks: { openSessionRecord, onSessionEnd },
    getLastSession: () => lastSession,
  };
}
