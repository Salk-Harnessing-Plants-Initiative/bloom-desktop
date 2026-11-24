/**
 * Keeps each finished plate's real saved path on its session job.
 *
 * The worker builds a plate's file name when it saves (adding `_et_` and
 * the row's own `_st_`), so the planned `outputPath` set at Start Scan never
 * exists on disk. A page that leaves and comes back mid-session restores its
 * jobs from the main process; with the real path here, its end-of-session
 * QR check reads the actual file instead of reporting the plate unreadable.
 */
import * as path from 'path';
import type { ScanSessionState } from '../../types/graviscan';

export interface ScanCompleteLike {
  scanner_id?: string;
  scannerId?: string;
  plate_index?: string;
  plateIndex?: string;
  path?: unknown;
}

/**
 * Record `event.path` as the job's `imagePath`. Only for a job of the
 * current session (own keys only, never inherited ones such as
 * `__proto__`), and only when the file is in that job's session folder,
 * so a late file from an earlier session can't overwrite it.
 */
export function recordJobImagePath(
  getScanSession: () => ScanSessionState | null,
  event: ScanCompleteLike
): void {
  const session = getScanSession();
  if (!session || typeof event.path !== 'string') return;
  const key = `${event.scanner_id ?? event.scannerId ?? ''}:${
    event.plate_index ?? event.plateIndex ?? ''
  }`;
  if (!Object.prototype.hasOwnProperty.call(session.jobs, key)) return;
  const job = session.jobs[key];
  if (path.dirname(event.path) !== path.dirname(job.outputPath)) return;
  job.imagePath = event.path;
}
