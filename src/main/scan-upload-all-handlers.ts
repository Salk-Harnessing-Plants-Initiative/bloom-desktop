/**
 * Browse Scans' "Upload all" (#449): finds every scan with frames still waiting to
 * upload, within the page's filters, and uploads them to Bloom one after another,
 * oldest first, with one login. A run goes on in the main process: starting it
 * returns at once, progress and the end are sent to the window, and the state (is a
 * run going, its progress, how the last one ended) is kept here, so Browse Scans
 * shows it again after the page is left and opened. A run can be stopped after the
 * scan in progress. Only Bloom Desktop's own statuses count as waiting ('pending',
 * 'failed'), so a pilot database whose statuses weren't converted (UPLOADED,
 * CAPTURED) is never sent again in bulk (#448).
 */

import type { BrowserWindow, IpcMain } from 'electron';
import type { DatabaseResponse } from '../types/database';
import type {
  ScanListFilters,
  UploadAllDone,
  UploadAllResult,
  UploadAllStatus,
} from '../types/upload-all';
import { scanListWhere, type ScanWhere } from './scan-filters';

/** Frame statuses that mean "not uploaded yet". */
export const WAITING_STATUSES = ['pending', 'failed'];

/** How many failures the result lists, so a long run's message stays readable. */
export const MAX_LISTED_ERRORS = 5;

export const UPLOAD_ALL_PROGRESS_CHANNEL = 'db:scans:upload-all-progress';
export const UPLOAD_ALL_DONE_CHANNEL = 'db:scans:upload-all-done';

export interface ScanUploadDbLike {
  scan: {
    findMany(args: {
      where: ScanWhere & {
        images: { some: { status: { in: string[] } } };
      };
      select: { id: true; plant_id: true };
      orderBy: { capture_date: 'asc' };
    }): Promise<{ id: string; plant_id: string }[]>;
  };
}

export interface UploaderLike {
  authenticate(): Promise<void>;
  uploadScan(scanId: string): Promise<{
    success: boolean;
    failed: number;
    errors: string[];
  }>;
}

export interface ScanUploadAllDeps {
  ipcMain: Pick<IpcMain, 'handle'>;
  db: ScanUploadDbLike;
  createUploader: () => UploaderLike;
  getMainWindow: () => BrowserWindow | null;
}

/** The scans with frames waiting to upload, oldest first. */
export async function waitingScans(
  db: ScanUploadDbLike,
  where: ScanWhere
): Promise<{ id: string; plant_id: string }[]> {
  return db.scan.findMany({
    where: { ...where, images: { some: { status: { in: WAITING_STATUSES } } } },
    select: { id: true, plant_id: true },
    orderBy: { capture_date: 'asc' },
  });
}

export function registerScanUploadAllHandlers(deps: ScanUploadAllDeps) {
  const status: UploadAllStatus = {
    running: false,
    progress: null,
    last: null,
  };
  let stopRequested = false;

  const send = (channel: string, payload: unknown) => {
    const win = deps.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };

  const finish = (done: UploadAllDone) => {
    status.running = false;
    status.progress = null;
    status.last = done;
    send(UPLOAD_ALL_DONE_CHANNEL, done);
  };

  const run = async (scans: { id: string; plant_id: string }[]) => {
    const result: UploadAllResult = {
      total: scans.length,
      uploadedScans: 0,
      failedScans: 0,
      stopped: false,
      errors: [],
    };
    try {
      // Nothing waiting: no need to log in.
      const uploader = scans.length > 0 ? deps.createUploader() : null;
      await uploader?.authenticate();
      for (const scan of uploader ? scans : []) {
        if (stopRequested) {
          result.stopped = true;
          break;
        }
        let problem: string | null = null;
        try {
          const scanResult = await uploader!.uploadScan(scan.id);
          if (!scanResult.success || scanResult.failed > 0) {
            problem = scanResult.errors[0] ?? 'Some frames did not upload';
          }
        } catch (error) {
          problem = error instanceof Error ? error.message : 'Unknown error';
        }
        if (problem) {
          result.failedScans += 1;
          console.warn(`[Upload all] ${scan.plant_id}: ${problem}`);
          if (result.errors.length < MAX_LISTED_ERRORS) {
            result.errors.push(`${scan.plant_id}: ${problem}`);
          }
        } else {
          result.uploadedScans += 1;
        }
        status.progress = {
          done: result.uploadedScans + result.failedScans,
          total: result.total,
          uploadedScans: result.uploadedScans,
          failedScans: result.failedScans,
        };
        send(UPLOAD_ALL_PROGRESS_CHANNEL, status.progress);
      }
      console.log(
        `[Upload all] ${result.uploadedScans} uploaded, ${result.failedScans} failed, of ${result.total}${result.stopped ? ' (stopped)' : ''}`
      );
      finish({ result });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[Upload all] Couldn't upload: ${message}`);
      finish({ error: message });
    }
  };

  deps.ipcMain.handle(
    'db:scans:pendingUploads',
    async (
      _event,
      filters?: ScanListFilters
    ): Promise<DatabaseResponse<{ count: number }>> => {
      try {
        const query = scanListWhere(filters);
        if ('error' in query) return { success: false, error: query.error };
        const scans = await waitingScans(deps.db, query.where);
        return { success: true, data: { count: scans.length } };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        console.error(
          `[Upload all] Couldn't count scans to upload: ${message}`
        );
        return { success: false, error: message };
      }
    }
  );

  /**
   * Starts a run and returns at once with how many scans it will upload; progress and
   * the end arrive on UPLOAD_ALL_PROGRESS_CHANNEL and UPLOAD_ALL_DONE_CHANNEL.
   */
  deps.ipcMain.handle(
    'db:scans:uploadAll',
    async (
      _event,
      filters?: ScanListFilters
    ): Promise<DatabaseResponse<{ total: number }>> => {
      if (status.running) {
        return { success: false, error: 'An upload is already running.' };
      }
      try {
        const query = scanListWhere(filters);
        if ('error' in query) return { success: false, error: query.error };
        const scans = await waitingScans(deps.db, query.where);
        if (status.running) {
          return { success: false, error: 'An upload is already running.' };
        }
        status.running = true;
        status.progress = {
          done: 0,
          total: scans.length,
          uploadedScans: 0,
          failedScans: 0,
        };
        status.last = null;
        stopRequested = false;
        void run(scans);
        return { success: true, data: { total: scans.length } };
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown error';
        console.error(`[Upload all] Couldn't start: ${message}`);
        return { success: false, error: message };
      }
    }
  );

  deps.ipcMain.handle(
    'db:scans:uploadAllStatus',
    (): DatabaseResponse<UploadAllStatus> => ({
      success: true,
      data: { ...status },
    })
  );

  /** Forget the last run's result once the operator has closed it. */
  deps.ipcMain.handle(
    'db:scans:dismissUploadAllResult',
    (): DatabaseResponse => {
      status.last = null;
      return { success: true };
    }
  );

  deps.ipcMain.handle('db:scans:stopUploadAll', (): DatabaseResponse => {
    stopRequested = status.running;
    return { success: true };
  });
}
