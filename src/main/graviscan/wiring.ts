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
import type { ScanWorkerEvent } from './scanner-subprocess';
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
    if (scanSession?.jobs[key]) {
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
    'scan-event',
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
 * - `scan-event` routes cycle_number changes to `onCycleStart`, and
 *   `scan-error`/`scan-complete` to `onScanError`/`onScanEnd`, with
 *   defensive type-guard defaults for `bytes_received`/`wall_seconds`
 *   (a worker could in theory emit a legacy event without them).
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
  db: ScannerLookupDb | null = null
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
        void (async () => {
          const enriched = await enrichWedgeEvent(evt, db);
          void slackNotifier.notify(enriched);
        })();
        scanLog(
          `[WedgeDetector] wedge-detected scanner=${evt.scanner_id} signature=${evt.signature} cycle=${evt.cycle_number}`
        );
      },
    });
    lastSeenCycleNumber = -1;
  });

  coordinator.on('interval-complete', () => {
    wedgeDetector = null;
    lastSeenCycleNumber = -1;
  });

  coordinator.on('scan-event', (event: ScanWorkerEvent) => {
    if (!wedgeDetector) return;

    if (
      typeof event.cycle_number === 'number' &&
      event.cycle_number !== lastSeenCycleNumber
    ) {
      wedgeDetector.onCycleStart(event.cycle_number);
      lastSeenCycleNumber = event.cycle_number;
    }

    if (event.type === 'scan-error') {
      // Worker emits scan-error with the new bytes_received and
      // wall_seconds fields (Task 0). Defensive defaults if absent.
      wedgeDetector.onScanError({
        scanner_id: event.scanner_id,
        plate_index: event.plate_index ?? '',
        job_id: event.job_id ?? '',
        error: event.error ?? '',
        bytes_received:
          typeof event.bytes_received === 'number' ? event.bytes_received : 0,
        wall_seconds:
          typeof event.wall_seconds === 'number' ? event.wall_seconds : 0,
      });
      wedgeDetector.onScanEnd({
        scanner_id: event.scanner_id,
        plate_index: event.plate_index ?? '',
        success: false,
      });
    } else if (event.type === 'scan-complete') {
      wedgeDetector.onScanEnd({
        scanner_id: event.scanner_id,
        plate_index: event.plate_index ?? '',
        success: true,
      });
    }
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
    // scanner display_name/usb_port when a db handle is available (#4)
    setupWedgeDetection(scanCoordinator, _db);

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
