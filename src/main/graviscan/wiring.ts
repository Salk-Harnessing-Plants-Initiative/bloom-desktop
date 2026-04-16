/**
 * GraviScan Wiring Module
 *
 * Owns all GraviScan wiring state and orchestration. Side-effect-free at
 * load time — no code runs on import, only declarations and type-only imports.
 *
 * Extracted from main.ts (#190, PR #191) so that tests can import and exercise the
 * real production code without triggering Electron side effects.
 */

import type { SessionFns } from './session-handlers';
import type { ScanSessionState } from '../../types/graviscan';
import type { ScanCoordinator } from './scan-coordinator';
import type { BrowserWindow } from 'electron';

// =============================================================================
// Module-level state (not exported — accessed via functions)
// =============================================================================

let scanSession: ScanSessionState | null = null;
let scanCoordinator: ScanCoordinator | null = null;
let _getMainWindow: (() => BrowserWindow | null) | null = null;
let _coordinatorCreating: Promise<ScanCoordinator> | null = null;

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
    'rename-error',
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
  // Dynamic import to avoid pulling in register-handlers (and its transitive
  // sharp/native dependencies) at module load time.
  const { _resetRegistration } = await import('./register-handlers');
  _resetRegistration();
}
