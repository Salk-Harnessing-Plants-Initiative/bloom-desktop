/**
 * GraviScan Wiring Module
 *
 * Owns all GraviScan wiring state and orchestration. Free of Electron
 * or native-module side effects at load time — heavier dependencies
 * (register-handlers and its transitive sharp/native deps, the
 * ScanCoordinator subprocess machinery, electron itself) are only
 * ever dynamic-imported inside functions. The static imports at the
 * top of this file (WedgeDetector, SlackNotifier, scan-logger) are
 * plain TS/Node modules with no native or Electron dependencies, so
 * they're safe to import eagerly.
 *
 * Extracted from main.ts (#190, PR #191) so that tests can import and exercise the
 * real production code without triggering Electron side effects.
 */

import type { SessionFns } from './session-handlers';
import type { ScanSessionState } from '../../types/graviscan';
import type { ScanCoordinator } from './scan-coordinator';
import type { BrowserWindow } from 'electron';
import { WedgeDetector, type WedgeDetectedEvent } from '../wedge-detector';
import { SlackNotifier } from '../slack-notifier';
import { scanLog } from './scan-logger';

// =============================================================================
// Module-level state (not exported — accessed via functions)
// =============================================================================

/**
 * Minimal shape `setupWedgeDetection()` needs to enrich a wedge event
 * with the scanner's operator-friendly display name / USB path (final-
 * review fix #4). Deliberately narrower than `PrismaClient` so this
 * module doesn't take on a hard dependency on `@prisma/client`'s types —
 * matches the loose `db: any` shape `initGraviScan()` already accepts.
 */
interface ScannerLookupDb {
  graviScanner: {
    findUnique: (args: { where: { id: string } }) => Promise<{
      display_name: string | null;
      usb_port: string | null;
    } | null>;
  };
}

let scanSession: ScanSessionState | null = null;
let scanCoordinator: ScanCoordinator | null = null;
let _getMainWindow: (() => BrowserWindow | null) | null = null;
let _coordinatorCreating: Promise<ScanCoordinator> | null = null;
let wedgeDetector: WedgeDetector | null = null;
let lastSeenCycleNumber = -1;
/** Set by `initGraviScan()`; used by `setupWedgeDetection()` to look up
 * a scanner's display_name/usb_port for Slack alert enrichment (#4). */
let _db: ScannerLookupDb | null = null;

/**
 * Look up the `GraviScanner` row for `evt.scanner_id` and merge its
 * `display_name`/`usb_port` into the wedge event before it reaches
 * Slack. Per Copilot PR #237 review: operators need to be able to
 * locate the physical scanner from the alert alone, without cross-
 * referencing logs or the DB.
 *
 * Best-effort: a missing `db` (not yet wired), an unknown scanner_id,
 * or a DB error all fall back to the original, unenriched event rather
 * than blocking or dropping the Slack notification.
 */
/**
 * Shape of the payloads arriving on the three granular per-job channels
 * (`scan-started`/`scan-complete`/`scan-error`, design.md Decision 2).
 *
 * Two distinct origins feed these channels, with two distinct field
 * casings:
 *  - Subprocess-relayed events (`ScanCoordinator`'s `sub.on('event', ...)`
 *    listener) spread the original worker payload (snake_case
 *    `scanner_id`/`plate_index`, plus `job_id`/`error`/`bytes_received`/
 *    `wall_seconds` on error) AND add camelCase `scannerId`/`plateIndex`/
 *    `jobId` — both casings are present.
 *  - Coordinator-originated `scan-error` events (row-timeout, missing-
 *    output-file, cannot-stat-file, zero-size-file — `scanOnce()`'s 4
 *    direct `this.emit('scan-error', ...)` call sites) use ONLY the
 *    camelCase `scannerId`/`plateIndex`/`jobId` shape — they never went
 *    through the subprocess relay, so they have no snake_case fields at
 *    all. This is exactly the design.md Decision 2 "found bug": these
 *    events were previously invisible to wedge detection because
 *    `setupWedgeDetection()` only listened on the old generic
 *    `scan-event` bus, which they were never emitted on either.
 *
 * `resolveScannerId()`/`resolvePlateIndex()` below accept either shape.
 */
interface GranularScanEvent {
  scanner_id?: string;
  scannerId?: string;
  plate_index?: string;
  plateIndex?: string;
  job_id?: string;
  jobId?: string;
  error?: string;
  bytes_received?: number;
  wall_seconds?: number;
  cycle_number?: number;
}

function resolveScannerId(event: GranularScanEvent): string {
  return event.scanner_id ?? event.scannerId ?? '';
}

function resolvePlateIndex(event: GranularScanEvent): string {
  return event.plate_index ?? event.plateIndex ?? '';
}

/**
 * Coordinator-originated `scan-error` events (row-timeout, missing/cannot-
 * stat/zero-size output file) only ever set camelCase `jobId`, never
 * snake_case `job_id` — see the GranularScanEvent doc comment above.
 * Reading `event.job_id` alone left the Slack alert's job_id confusingly
 * blank for exactly the failure class this granular event model was
 * built to surface (#245 review finding).
 */
function resolveJobId(event: GranularScanEvent): string {
  return event.job_id ?? event.jobId ?? '';
}

async function enrichWedgeEvent(
  evt: WedgeDetectedEvent,
  db: ScannerLookupDb | null
): Promise<WedgeDetectedEvent> {
  if (!db) return evt;
  try {
    const row = await db.graviScanner.findUnique({
      where: { id: evt.scanner_id },
    });
    if (!row) return evt;
    return {
      ...evt,
      display_name: row.display_name ?? undefined,
      usb_port: row.usb_port ?? undefined,
    };
  } catch (err) {
    console.error(
      '[WedgeDetector] Failed to look up scanner for Slack enrichment:',
      err
    );
    return evt;
  }
}

// =============================================================================
// Session state management
// =============================================================================

export const graviSessionFns: SessionFns = {
  getScanSession: () => scanSession,
  setScanSession: (s: ScanSessionState | null) => {
    scanSession = s;
  },
  markScanJobRecorded: (key: string) => {
    // `key` reaches here from an untrusted renderer IPC call
    // (`graviscan:mark-job-recorded`) with no shape validation upstream.
    // `scanSession.jobs` is a plain object literal — a bracket-access
    // truthiness check alone (`scanSession?.jobs[key]`) would resolve
    // `key: '__proto__'` through the prototype chain to `Object.prototype`
    // itself (truthy), then mutate it, polluting every plain object in
    // this process for the rest of its lifetime. `hasOwnProperty` only
    // ever matches a key this module itself wrote via `jobs[key] = {...}`
    // (`session-handlers.ts`'s job-creation loop), never an inherited one.
    if (
      scanSession &&
      Object.prototype.hasOwnProperty.call(scanSession.jobs, key)
    ) {
      scanSession.jobs[key].status = 'recorded';
    }
  },
};

// =============================================================================
// Coordinator event forwarding
// =============================================================================

/**
 * Set up coordinator event forwarding to renderer.
 * Called when a new ScanCoordinator is created.
 */
export function setupCoordinatorEventForwarding(
  coordinator: ScanCoordinator,
  getMainWindow: () => BrowserWindow | null
): void {
  const events = [
    // Granular per-job channels (design.md Decision 2) — replace the
    // retired generic 'scan-event' bus.
    'scan-started',
    'scan-complete',
    'grid-start',
    'grid-complete',
    'cycle-complete',
    'interval-start',
    'interval-waiting',
    'interval-complete',
    'overtime',
    'cancelled',
    'scan-error',
    // Final-review fix #3: per-scanner init/spawn failures are recorded
    // in ScanCoordinator's initErrors and emitted on this event, but
    // were never forwarded to the renderer — silently dropped. Without
    // this, an operator has no way to learn which specific scanner
    // failed to come online (e.g. after the #3 startScan fix reports
    // "no scanners came online" but doesn't say why).
    'scanner-init-status',
  ];

  for (const eventName of events) {
    coordinator.on(eventName, (payload: unknown) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send(`graviscan:${eventName}`, payload);
      }
    });
  }
}

// =============================================================================
// Wedge detection + Slack notification wiring
// =============================================================================

/**
 * Wire wedge detection + Slack notification into a coordinator's own
 * event stream (#236). Ported from `main.ts`'s old inline
 * `initializeScanCoordinator()` (`git show 2edf981 -- src/main/main.ts`)
 * to this module, which is where "listen to the coordinator's own
 * emitted events from outside the coordinator class" now lives —
 * kept separate from `setupCoordinatorEventForwarding()` since that
 * function is stateless IPC-forwarding while this one needs per-session
 * state (the module-level `wedgeDetector` / `lastSeenCycleNumber`).
 *
 * Called once per coordinator lifetime (same as
 * `setupCoordinatorEventForwarding()`), from `getOrCreateCoordinator()`.
 *
 * - A single `SlackNotifier` is constructed here, reading the webhook
 *   URL from `process.env.BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL` (hydrated
 *   by `main.ts`'s `app.on('ready', ...)` from `~/.bloom/.env`). Absent
 *   URL ⇒ no-op (notifier is disabled).
 * - The `WedgeDetector` is (re)created per scan session on
 *   `interval-start`, using the active `GraviScanSession.id` if
 *   available or a `startedAt`-based fallback, and torn down on
 *   `interval-complete` so a fresh detector starts each session with
 *   clean per-scanner-per-cycle counters.
 * - `scan-started` routes cycle_number changes to `onCycleStart`, and
 *   `scan-error`/`scan-complete` to `onScanError`/`onScanEnd`, with
 *   defensive type-guard defaults for `bytes_received`/`wall_seconds`
 *   (a worker could in theory emit a legacy event without them). The
 *   old generic `scan-event` bus (an embedded `type` field) is retired
 *   (design.md Decision 2) — `scan-error` now unifies BOTH subprocess-
 *   originated errors and the coordinator's own directly-emitted ones
 *   (row-timeout, file-verification failures), which were previously
 *   invisible to wedge detection (the found-bug fix this migration
 *   closes).
 * - `onWedge` enriches the event with the scanner's `display_name`/
 *   `usb_port` (looked up via `db`, final-review fix #4) before handing
 *   it to the `SlackNotifier` — see `enrichWedgeEvent()` above.
 *
 * @param db Optional DB handle used to enrich wedge events with the
 *   scanner's display_name/usb_port. Passed by `getOrCreateCoordinator()`
 *   from the module-level `_db` set in `initGraviScan()`. Omit (or pass
 *   `null`) to skip enrichment — used by tests that exercise this
 *   function directly without a DB.
 */
export function setupWedgeDetection(
  coordinator: ScanCoordinator,
  db: ScannerLookupDb | null = null,
  getMainWindow: (() => BrowserWindow | null) | null = null
): void {
  const slackNotifier = new SlackNotifier({
    webhookUrl: process.env.BLOOM_GRAVISCAN_SLACK_WEBHOOK_URL,
  });

  coordinator.on('interval-start', (data: { startedAt: number }) => {
    const sessionId =
      graviSessionFns.getScanSession()?.sessionId ??
      `session-${data.startedAt}`;
    wedgeDetector = new WedgeDetector({
      sessionId,
      onWedge: (evt) => {
        // Auto-pause first, fire-and-forget — don't let a slow/failing
        // Slack call or DB enrichment delay stopping the wedged scanner
        // (design.md Decision 1). `coordinator` is already in scope as
        // this function's first parameter.
        void coordinator.stopScanner(evt.scanner_id).catch((err) => {
          console.error(
            `[WedgeDetector] Failed to auto-pause ${evt.scanner_id}:`,
            err
          );
        });
        // Pre-existing line — unchanged.
        scanLog(
          `[WedgeDetector] wedge-detected scanner=${evt.scanner_id} signature=${evt.signature} cycle=${evt.cycle_number}`
        );
        // New line for the auto-pause action itself (design.md Decision
        // 3) — includes session_id to disambiguate cycle numbers across
        // sessions that share a calendar-day log file.
        scanLog(
          `[WedgeDetector] auto-paused scanner=${evt.scanner_id} signature=${evt.signature} session=${evt.session_id} cycle=${evt.cycle_number}`
        );

        void (async () => {
          const enriched = await enrichWedgeEvent(evt, db);
          void slackNotifier.notify(enriched);
          const win = getMainWindow?.();
          if (win && !win.isDestroyed()) {
            win.webContents.send('graviscan:wedge-detected', enriched);
          }
        })();
      },
    });
    lastSeenCycleNumber = -1;
  });

  coordinator.on('interval-complete', () => {
    wedgeDetector = null;
    lastSeenCycleNumber = -1;
  });

  // Cycle tracking: driven by scan-started (subprocess-relayed, always
  // carries cycle_number — see ScanCoordinator's sub.on('event', ...)
  // listener). Coordinator-originated scan-error events don't carry
  // cycle_number at all; they don't need to — they only fire mid-cycle,
  // after a scan-started for that cycle has already updated it.
  coordinator.on('scan-started', (event: GranularScanEvent) => {
    if (!wedgeDetector) return;
    if (
      typeof event.cycle_number === 'number' &&
      event.cycle_number !== lastSeenCycleNumber
    ) {
      wedgeDetector.onCycleStart(event.cycle_number);
      lastSeenCycleNumber = event.cycle_number;
    }
  });

  // Unified scan-error channel — both subprocess-originated errors AND
  // the coordinator's own directly-emitted ones (row-timeout, missing-
  // output-file, cannot-stat-file, zero-size-file) now reach wedge
  // detection (design.md Decision 2's found-bug fix).
  coordinator.on('scan-error', (event: GranularScanEvent) => {
    if (!wedgeDetector) return;

    const scannerId = resolveScannerId(event);
    const plateIndex = resolvePlateIndex(event);

    // Worker emits scan-error with bytes_received/wall_seconds (Task 0).
    // Coordinator-originated scan-error events never carry these —
    // defensive defaults cover both cases.
    wedgeDetector.onScanError({
      scanner_id: scannerId,
      plate_index: plateIndex,
      job_id: resolveJobId(event),
      error: event.error ?? '',
      bytes_received:
        typeof event.bytes_received === 'number' ? event.bytes_received : 0,
      wall_seconds:
        typeof event.wall_seconds === 'number' ? event.wall_seconds : 0,
    });
    wedgeDetector.onScanEnd({
      scanner_id: scannerId,
      plate_index: plateIndex,
      success: false,
    });
  });

  coordinator.on('scan-complete', (event: GranularScanEvent) => {
    if (!wedgeDetector) return;
    wedgeDetector.onScanEnd({
      scanner_id: resolveScannerId(event),
      plate_index: resolvePlateIndex(event),
      success: true,
    });
  });
}

// =============================================================================
// Coordinator lazy instantiation
// =============================================================================

/**
 * Get or create the ScanCoordinator (lazy instantiation).
 * Creates the coordinator on first call and wires event forwarding.
 * Uses promise memoization to prevent duplicate creation from concurrent calls.
 * Matches the CylinderScan pattern where ScannerProcess is created on demand.
 */
export async function getOrCreateCoordinator(): Promise<ScanCoordinator> {
  if (scanCoordinator) return scanCoordinator;
  if (_coordinatorCreating) return _coordinatorCreating;

  _coordinatorCreating = (async () => {
    // Lazy imports to avoid loading subprocess modules in cylinderscan mode
    const { ScanCoordinator: ScanCoordinatorClass } = await import(
      './scan-coordinator'
    );
    const { getPythonExecutablePath } = await import('../python-paths');
    const { app } = await import('electron');

    const pythonPath = getPythonExecutablePath();
    const isPackaged = app.isPackaged;

    const mockMode =
      process.env.GRAVISCAN_MOCK?.trim().toLowerCase() === 'true';
    scanCoordinator = new ScanCoordinatorClass(
      pythonPath,
      isPackaged,
      mockMode
    );
    console.log(`[Main] ScanCoordinator created (lazy, mock=${mockMode})`);

    // Wire event forwarding to renderer
    if (_getMainWindow) {
      setupCoordinatorEventForwarding(scanCoordinator, _getMainWindow);
    }

    // Wire wedge detection + Slack notification (#236), enriched with
    // scanner display_name/usb_port when a db handle is available (#4),
    // and forwarded to the renderer + auto-pausing the wedged scanner
    // when a main window getter is available (Tier 3 wedge-response UI)
    setupWedgeDetection(scanCoordinator, _db, _getMainWindow);

    return scanCoordinator;
  })();

  try {
    return await _coordinatorCreating;
  } finally {
    _coordinatorCreating = null;
  }
}

// =============================================================================
// Initialization
// =============================================================================

/**
 * Initialize GraviScan IPC handlers conditionally based on scanner mode.
 */
export async function initGraviScan(
  scannerMode: string,
  ipcMainRef: Electron.IpcMain,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  getMainWindow: () => BrowserWindow | null
): Promise<void> {
  if (scannerMode !== 'graviscan') return;

  console.log('[Main] GraviScan mode detected, registering handlers...');

  // Cache for coordinator event forwarding
  _getMainWindow = getMainWindow;
  // Cache for wedge-event Slack enrichment (display_name/usb_port, #4)
  _db = db;

  // Lazy import to avoid loading sharp/native modules in cylinderscan mode
  const { registerGraviScanHandlers } = await import('./register-handlers');
  const { cleanupOldLogs } = await import('./scan-logger');

  // Clean up old scan logs on startup
  cleanupOldLogs();

  registerGraviScanHandlers(
    ipcMainRef,
    db,
    getMainWindow,
    graviSessionFns,
    () => scanCoordinator,
    getOrCreateCoordinator
  );

  console.log('[Main] GraviScan handlers registered');
}

// =============================================================================
// Shutdown
// =============================================================================

/**
 * Shut down GraviScan gracefully: coordinator shutdown + scan log close.
 * Called from main.ts during the before-quit handler.
 */
export async function shutdownGraviScan(): Promise<void> {
  // Await in-flight coordinator creation if pending
  if (_coordinatorCreating) {
    try {
      scanCoordinator = await _coordinatorCreating;
    } catch (err) {
      console.error('Error during in-flight coordinator creation:', err);
      // Creation failed — nothing to shut down
    }
    _coordinatorCreating = null;
  }

  // Shut down coordinator if active
  if (scanCoordinator) {
    console.log('Shutting down GraviScan coordinator...');
    try {
      await scanCoordinator.shutdown();
    } catch (coordErr) {
      console.error('Error shutting down coordinator:', coordErr);
    }
    scanCoordinator = null;
    console.log('GraviScan coordinator shut down');
  }

  // Close scan log stream
  try {
    const { closeScanLog } = await import('./scan-logger');
    closeScanLog();
  } catch {
    // scan-logger not loaded — nothing to close
  }
}

// =============================================================================
// Test helper
// =============================================================================

/**
 * Reset all module state for test isolation.
 * @internal Test-only — prefixed with underscore by convention.
 */
export async function _resetWiringState(): Promise<void> {
  scanSession = null;
  scanCoordinator = null;
  _getMainWindow = null;
  _coordinatorCreating = null;
  wedgeDetector = null;
  lastSeenCycleNumber = -1;
  _db = null;
  // Dynamic import to avoid pulling in register-handlers (and its transitive
  // sharp/native dependencies) at module load time.
  const { _resetRegistration } = await import('./register-handlers');
  _resetRegistration();
}
