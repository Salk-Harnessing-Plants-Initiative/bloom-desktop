/**
 * Browse Scans' "Upload all" (#449): finds every scan with frames still waiting to
 * upload, within the page's filters, and uploads them to Bloom one after another,
 * oldest first, with one login. Progress is sent after each scan, and a run can be
 * stopped after the scan in progress. Only Bloom Desktop's own statuses count as
 * waiting ('pending', 'failed'), so a pilot database whose statuses weren't
 * converted (UPLOADED, CAPTURED) is never sent again in bulk (#448).
 */

import type { BrowserWindow, IpcMain } from 'electron';
import type { DatabaseResponse } from '../types/database';
import type {
  ScanListFilters,
  UploadAllProgress,
  UploadAllResult,
} from '../types/upload-all';
import { scanListWhere, type ScanWhere } from './scan-filters';

/** Frame statuses that mean "not uploaded yet". */
export const WAITING_STATUSES = ['pending', 'failed'];

/** How many failures the result lists, so a long run's message stays readable. */
export const MAX_LISTED_ERRORS = 5;

export const UPLOAD_ALL_PROGRESS_CHANNEL = 'db:scans:upload-all-progress';

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
  let running = false;
  let stopRequested = false;

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
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }
  );

  deps.ipcMain.handle(
    'db:scans:uploadAll',
    async (
      _event,
      filters?: ScanListFilters
    ): Promise<DatabaseResponse<UploadAllResult>> => {
      if (running) {
        return { success: false, error: 'An upload is already running.' };
      }
      running = true;
      stopRequested = false;
      try {
        const query = scanListWhere(filters);
        if ('error' in query) return { success: false, error: query.error };
        const scans = await waitingScans(deps.db, query.where);
        const result: UploadAllResult = {
          total: scans.length,
          uploadedScans: 0,
          failedScans: 0,
          stopped: false,
          errors: [],
        };
        if (scans.length === 0) return { success: true, data: result };

        const uploader = deps.createUploader();
        await uploader.authenticate();
        for (const scan of scans) {
          if (stopRequested) {
            result.stopped = true;
            break;
          }
          let problem: string | null = null;
          try {
            const scanResult = await uploader.uploadScan(scan.id);
            if (!scanResult.success || scanResult.failed > 0) {
              problem = scanResult.errors[0] ?? 'Some frames did not upload';
            }
          } catch (error) {
            problem = error instanceof Error ? error.message : 'Unknown error';
          }
          if (problem) {
            result.failedScans += 1;
            if (result.errors.length < MAX_LISTED_ERRORS) {
              result.errors.push(`${scan.plant_id}: ${problem}`);
            }
          } else {
            result.uploadedScans += 1;
          }
          const progress: UploadAllProgress = {
            done: result.uploadedScans + result.failedScans,
            total: result.total,
            uploadedScans: result.uploadedScans,
            failedScans: result.failedScans,
          };
          deps
            .getMainWindow()
            ?.webContents.send(UPLOAD_ALL_PROGRESS_CHANNEL, progress);
        }
        console.log(
          `[Upload all] ${result.uploadedScans} uploaded, ${result.failedScans} failed, of ${result.total}${result.stopped ? ' (stopped)' : ''}`
        );
        return { success: true, data: result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      } finally {
        running = false;
      }
    }
  );

  deps.ipcMain.handle('db:scans:stopUploadAll', (): DatabaseResponse => {
    stopRequested = running;
    return { success: true };
  });
}
