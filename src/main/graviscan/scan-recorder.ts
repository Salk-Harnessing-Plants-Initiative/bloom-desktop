/**
 * Records every finished GraviScan image in the database, from the main
 * process, whether or not the scan page is open.
 *
 * For each `scan-complete` of a job in the session it creates the image's
 * `GraviScan` row (upsert on session, scanner, plate and cycle) and its
 * `GraviImage` row (`pending` for Bloom upload and Box backup), then marks
 * the job recorded with its real saved path. The cycle comes from the file
 * name, so a late image from an earlier cycle keeps its own cycle (#503).
 *
 * Events are recorded one at a time, so a repeated event can't race its
 * twin into a second image row. A failure is logged and reported for that
 * plate; the next event is still recorded.
 */
import * as path from 'path';
import type { DatabaseResponse } from '../../types/database';
import type { ScanSessionState } from '../../types/graviscan';
import type { GraviScanCreateInput } from '../database-handlers';
import { readStAndCycleFromScanFileName } from './scan-filename';

export interface GraviImageCreateInput {
  graviscan_id: string;
  path: string;
  status: 'pending';
  box_status: 'pending';
}

export interface ScanRecorderDeps {
  /** The session the event belongs to (current, or the one just ended). */
  getSession: () => ScanSessionState | null;
  createScan: (data: GraviScanCreateInput) => Promise<DatabaseResponse>;
  findImage: (graviscanId: string, imagePath: string) => Promise<unknown>;
  createImage: (data: GraviImageCreateInput) => Promise<unknown>;
  /** Log the problem and show it on the scan page for that plate. */
  reportError: (scannerId: string, plateIndex: string, message: string) => void;
  now?: () => Date;
}

/** The fields of a coordinator `scan-complete` event the recorder reads. */
export interface RecordableScanEvent {
  scanner_id?: unknown;
  scannerId?: unknown;
  plate_index?: unknown;
  plateIndex?: unknown;
  path?: unknown;
  achieved_resolution?: unknown;
  scan_started_at?: unknown;
}

export interface ScanRecorder {
  /** Queue `event` for recording; resolves once it has been handled. */
  record: (event: RecordableScanEvent) => Promise<void>;
  /** Resolves once every queued event has been handled. */
  idle: () => Promise<void>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export function notRecordedMessage(fileName: string, reason: string): string {
  return (
    `${fileName} was saved on disk but not recorded in the database ` +
    `(${reason}). It won't be uploaded or backed up until it is recorded.`
  );
}

export function createScanRecorder(deps: ScanRecorderDeps): ScanRecorder {
  const now = deps.now ?? (() => new Date());
  let queue: Promise<void> = Promise.resolve();

  async function recordOne(event: RecordableScanEvent): Promise<void> {
    const session = deps.getSession();
    if (!session || typeof event.path !== 'string') return;
    const imagePath = event.path;

    const scannerId = text(event.scanner_id) || text(event.scannerId);
    const plateIndex = text(event.plate_index) || text(event.plateIndex);
    const key = `${scannerId}:${plateIndex}`;
    if (!Object.prototype.hasOwnProperty.call(session.jobs, key)) return;
    const job = session.jobs[key];
    if (path.dirname(imagePath) !== path.dirname(job.outputPath)) return;

    // The planned path never exists on disk (the worker adds `_et_`), so
    // keep the real one; a test scan stops here, as it's never recorded.
    job.imagePath = imagePath;
    if (session.isTest || !session.sessionId) return;

    const parsed = readStAndCycleFromScanFileName(path.basename(imagePath));
    if (!parsed) {
      job.status = 'error';
      job.error = notRecordedMessage(
        path.basename(imagePath),
        'its file name has no cycle'
      );
      deps.reportError(scannerId, plateIndex, job.error);
      return;
    }

    try {
      const created = await deps.createScan({
        experiment_id: session.experimentId,
        phenotyper_id: session.phenotyperId,
        scanner_id: scannerId,
        plate_index: plateIndex,
        wave_number: session.waveNumber,
        session_id: session.sessionId,
        cycle_number: parsed.cycle,
        plate_barcode: job.plantBarcode,
        transplant_date: job.transplantDate,
        custom_note: job.customNote,
        path: imagePath,
        grid_mode: job.gridMode,
        resolution:
          typeof event.achieved_resolution === 'number'
            ? event.achieved_resolution
            : session.resolution,
        format: 'tiff',
        capture_date: now(),
        scan_started_at: text(event.scan_started_at) || null,
      });
      const scanId = (created.data as { id?: unknown } | undefined)?.id;
      if (!created.success || typeof scanId !== 'string') {
        throw new Error(created.error ?? 'no row id returned');
      }
      if (!(await deps.findImage(scanId, imagePath))) {
        await deps.createImage({
          graviscan_id: scanId,
          path: imagePath,
          status: 'pending',
          box_status: 'pending',
        });
      }
      // A late image from an earlier cycle (#503) doesn't mark this
      // cycle's job done.
      if (parsed.cycle === session.currentCycle) job.status = 'recorded';
    } catch (error) {
      job.status = 'error';
      job.error = notRecordedMessage(
        path.basename(imagePath),
        errorText(error)
      );
      deps.reportError(scannerId, plateIndex, job.error);
    }
  }

  return {
    record(event) {
      const next = queue.then(() => recordOne(event));
      // recordOne catches its own failures; this keeps the queue alive
      // if anything unexpected still throws.
      queue = next.catch((): void => undefined);
      return queue;
    },
    idle: () => queue,
  };
}
