/**
 * Connects the GraviScan recorder and session records to the database,
 * the QR check and the main window.
 *
 * Kept apart from `wiring.ts` so the recording pieces stay testable with a
 * fake database and window.
 */
import type { BrowserWindow } from 'electron';
import type { PrismaClient } from '@prisma/client';
import type { ScanSessionState } from '../../types/graviscan';
import {
  graviscansCreate,
  graviscanSessionsComplete,
  graviscanSessionsCreate,
} from '../database-handlers';
import { scanLog } from './scan-logger';
import { createScanRecorder, type ScanRecorder } from './scan-recorder';
import { createSessionRecords, type SessionRecords } from './session-records';
import {
  verifyPlates,
  type VerifyPlateInput,
  type VerifyProgressEvent,
} from './verify-plates';

export interface GraviScanRecording {
  recorder: ScanRecorder;
  sessionRecords: SessionRecords;
}

/** Sends to the main window if it's open at send time. */
export function windowSender(getMainWindow: () => BrowserWindow | null) {
  return (channel: string, payload?: unknown) => {
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  };
}

/** Forwards QR-check progress to the page on the verify-* channels. */
export function verifyProgressToWindow(
  send: ReturnType<typeof windowSender>
): (event: VerifyProgressEvent) => void {
  return (event) => {
    switch (event.type) {
      case 'verify-started':
        send('graviscan:verify-started');
        break;
      case 'verify-result':
        send('graviscan:verify-result', event.result);
        break;
      case 'verify-complete':
        send('graviscan:verify-complete', {
          results: event.results,
          swaps: event.swaps,
        });
        break;
    }
  };
}

export function createGraviScanRecording(deps: {
  db: PrismaClient;
  getMainWindow: () => BrowserWindow | null;
  getScanSession: () => ScanSessionState | null;
  getOutputDir: () => string | null;
}): GraviScanRecording {
  const send = windowSender(deps.getMainWindow);
  // A late image can arrive just after its session ended; it is still
  // recorded under that session (its folder must match).
  let lastEnded: ScanSessionState | null = null;

  const recorder = createScanRecorder({
    getSession: () => deps.getScanSession() ?? lastEnded,
    getPreviousSession: () => lastEnded,
    createScan: (data) => graviscansCreate(deps.db, { ...data }),
    findImage: (graviscanId, imagePath) =>
      deps.db.graviImage.findFirst({
        where: { graviscan_id: graviscanId, path: imagePath },
      }),
    createImage: (data) => deps.db.graviImage.create({ data }),
    updateRowTimes: ({ scan_started_at, scan_ended_at, ...row }) =>
      deps.db.graviScan.updateMany({
        where: row,
        data: {
          scan_started_at: new Date(scan_started_at),
          scan_ended_at: new Date(scan_ended_at),
        },
      }),
    logProblem: (message) => {
      scanLog(`[GraviScan:RECORD] ${message}`);
      console.error('[GraviScan:RECORD]', message);
    },
    reportError: (scannerId, plateIndex, message) => {
      scanLog(`[GraviScan:RECORD] ${scannerId}:${plateIndex} ${message}`);
      console.error('[GraviScan:RECORD]', scannerId, plateIndex, message);
      send('graviscan:scan-error', {
        scannerId,
        plateIndex,
        jobId: `${scannerId}:${plateIndex}`,
        error: message,
      });
    },
  });

  const sessionRecords = createSessionRecords({
    createSession: (data) => graviscanSessionsCreate(deps.db, data),
    completeSession: (args) => graviscanSessionsComplete(deps.db, args),
    waitForRecordings: () => recorder.idle(),
    verify: (plates: VerifyPlateInput[], experimentId, waveNumber) => {
      const outputDir = deps.getOutputDir();
      if (!outputDir) {
        throw new Error('the scan folder is not known');
      }
      return verifyPlates(
        deps.db,
        plates,
        experimentId,
        outputDir,
        verifyProgressToWindow(send),
        waveNumber
      );
    },
    reportError: (message) => {
      scanLog(`[GraviScan:RECORD] ${message}`);
      console.error('[GraviScan:RECORD]', message);
      send('graviscan:scan-error', {
        scannerId: null,
        plateIndex: null,
        error: message,
      });
    },
  });

  const onSessionEnd = sessionRecords.hooks.onSessionEnd;
  sessionRecords.hooks.onSessionEnd = (session, outcome) => {
    // A test scan is never recorded, so it never replaces the session a
    // late image may still belong to.
    if (!session.isTest) lastEnded = session;
    return onSessionEnd(session, outcome);
  };

  return { recorder, sessionRecords };
}
