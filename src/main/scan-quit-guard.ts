/**
 * Asks before the app closes during a scan. A scan holds its frames in memory until the
 * turn finishes, so quitting loses them, and the plant needs rescanning.
 *
 * Asks without blocking: the main process has to keep reading the scan's output, or a
 * good scan could time out behind the question.
 */

export interface ScanQuitGuardDeps {
  isScanInProgress: () => boolean;
  /** Resolves to whether the operator chose to quit anyway. */
  askToQuit: () => Promise<boolean>;
  quit: () => void;
  log?: (message: string) => void;
}

export function createScanQuitGuard(deps: ScanQuitGuardDeps) {
  const log = deps.log ?? console.error;
  let asking = false;
  let quitConfirmed = false;

  const ask = async (): Promise<void> => {
    asking = true;
    try {
      quitConfirmed = await deps.askToQuit();
    } catch (error) {
      log(
        `[Scan] Couldn't ask before quitting: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      );
    } finally {
      asking = false;
    }
    if (quitConfirmed) deps.quit();
  };

  return {
    /** Whether the app may close now. If not, it asks, and quits if the operator says so. */
    mayQuit(): boolean {
      if (quitConfirmed || !deps.isScanInProgress()) return true;
      if (!asking) void ask();
      return false;
    },
  };
}
