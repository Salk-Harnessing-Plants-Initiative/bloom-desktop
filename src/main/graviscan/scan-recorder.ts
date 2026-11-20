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
 * When a grid row completes, its shared start and end times are written
 * onto every scan of that row, for every scanner, as on the rig.
 *
 * Events are recorded one at a time, so a repeated event can't race its
 * twin into a second image row, and a row's times are written after its
 * images. A failure is logged and reported for that
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
  /** Set a row's start and end times on its scans; returns how many. */
  updateRowTimes: (args: RowTimesUpdate) => Promise<{ count: number }>;
  /** Log a problem the operator doesn't need to act on. */
  logProblem: (message: string) => void;
  now?: () => Date;
}

/** One grid row's shared times, for the scans of one session and cycle. */
export interface RowTimesUpdate {
  session_id: string;
  plate_index: string;
  cycle_number: number;
  scan_started_at: string;
  scan_ended_at: string;
}

/** The coordinator's `grid-complete` event. */
export interface GridCompleteEvent {
  cycle?: unknown;
  gridIndex?: unknown;
  scanStartedAt?: unknown;
  scanEndedAt?: unknown;
}

/** The fields of a coordinator `scan-complete` event the recorder reads. */
export interface RecordableScanEvent {
  scanner_id?: unknown;
  scannerId?: unknown;
  plate_index?: unknown;
  plateIndex?: unknown;
  path?: unknown;
  achieved_resolution?: unknown;
}

export interface ScanRecorder {
  /** Queue `event` for recording; resolves once it has been handled. */
  record: (event: RecordableScanEvent) => Promise<void>;
  /** Queue a row's times, after the images queued before it. */
  recordRowTimes: (event: GridCompleteEvent) => Promise<void>;
  /** Resolves once every queued event has been handled. */
  idle: () => Promise<void>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** "20260809T190946" (UTC, from a file name) as an ISO time. */
function stToIso(st: string): string {
  return new Date(
    `${st.slice(0, 4)}-${st.slice(4, 6)}-${st.slice(6, 8)}T` +
      `${st.slice(9, 11)}:${st.slice(11, 13)}:${st.slice(13, 15)}Z`
  ).toISOString();
}

/** An ISO time string, or null if `value` isn't one. */
function isoTime(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? null : t.toISOString();
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
        // The row's own start time: a late image keeps its row's, not the
        // current row's. The row's end is set when the row completes.
        scan_started_at: stToIso(parsed.stTimestamp),
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

  async function recordRowTimesOne(event: GridCompleteEvent): Promise<void> {
    const session = deps.getSession();
    if (!session || session.isTest || !session.sessionId) return;
    const plateIndex = text(event.gridIndex);
    const started = isoTime(event.scanStartedAt);
    const ended = isoTime(event.scanEndedAt);
    if (!plateIndex || typeof event.cycle !== 'number' || !started || !ended) {
      return;
    }
    try {
      await deps.updateRowTimes({
        session_id: session.sessionId,
        plate_index: plateIndex,
        cycle_number: event.cycle,
        scan_started_at: started,
        scan_ended_at: ended,
      });
    } catch (error) {
      deps.logProblem(
        `Row times for plate ${plateIndex}, cycle ${event.cycle} weren't saved (${errorText(error)}).`
      );
    }
  }

  function enqueue(task: () => Promise<void>): Promise<void> {
    // Each task catches its own failures; this keeps the queue alive if
    // anything unexpected still throws.
    queue = queue.then(task).catch((): void => undefined);
    return queue;
  }

  return {
    record: (event) => enqueue(() => recordOne(event)),
    recordRowTimes: (event) => enqueue(() => recordRowTimesOne(event)),
    idle: () => queue,
  };
}
