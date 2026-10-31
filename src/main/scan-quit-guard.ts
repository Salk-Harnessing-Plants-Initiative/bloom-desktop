/**
 * Asks before the app closes during a scan. A scan holds its frames in memory until the
 * turn finishes, so quitting loses them, and the plant needs rescanning.
 */

export interface ScanQuitGuardDeps {
  isScanInProgress: () => boolean;
  /** Returns whether the operator chose to quit anyway. */
  askToQuit: () => boolean;
}

export function createScanQuitGuard(deps: ScanQuitGuardDeps) {
  // Closing the window also quits the app, so one answer has to cover both.
  let quitConfirmed = false;

  return {
    mayQuit(): boolean {
      if (quitConfirmed || !deps.isScanInProgress()) return true;
      quitConfirmed = deps.askToQuit();
      return quitConfirmed;
    },
  };
}
