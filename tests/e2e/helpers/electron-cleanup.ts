/**
 * E2E Test Helper: Electron Cleanup
 *
 * Provides robust cleanup utilities for E2E tests to prevent race conditions
 * between tests when launching multiple Electron instances.
 *
 * ROOT CAUSE: `electronApp.close()` returns before the Electron process fully
 * terminates. The next test's `electron.launch()` may fail or timeout if the
 * previous instance is still shutting down.
 *
 * SOLUTION: Wait for the process to actually exit before proceeding.
 *
 * See: openspec/changes/fix-e2e-test-cleanup-race-condition/proposal.md
 */

import { ElectronApplication } from '@playwright/test';

/**
 * Safely close an Electron app and wait for the process to fully terminate.
 *
 * @param electronApp - The Playwright ElectronApplication instance
 * @param options - Configuration options
 * @returns Promise that resolves when the app is fully closed
 */
export async function closeElectronApp(
  electronApp: ElectronApplication | undefined,
  options: {
    /** Timeout in ms to wait for graceful close before force killing (default: 5000) */
    timeout?: number;
    /** Whether to log progress (default: false) */
    verbose?: boolean;
  } = {}
): Promise<void> {
  const { timeout = 5000, verbose = false } = options;

  if (!electronApp) {
    if (verbose) console.log('[Cleanup] No Electron app to close');
    return;
  }

  try {
    // Get process info before closing
    const pid = electronApp.process()?.pid;
    if (verbose) console.log(`[Cleanup] Closing Electron app (PID: ${pid})`);

    // Request graceful close
    await electronApp.close();

    // Wait for process to actually exit
    if (pid) {
      await waitForProcessExit(pid, timeout, verbose);
    }

    if (verbose) console.log('[Cleanup] Electron app closed successfully');
  } catch (error) {
    if (verbose) {
      console.warn(
        '[Cleanup] Error during close:',
        error instanceof Error ? error.message : error
      );
    }
    // Continue - process may have already exited
  }

  // Wait for Electron child processes (GPU, Renderer, Utility) to fully terminate.
  // The main process exits first, but child processes may still be shutting down.
  // Without this delay, the next test's electron.launch() can fail due to
  // resource contention (port conflicts, file locks, IPC channel issues).
  // 500ms is sufficient for both local and slower CI runners.
  await sleep(500);
}

/**
 * Wait for a process to exit by polling.
 *
 * @param pid - Process ID to wait for
 * @param timeout - Maximum time to wait in ms
 * @param verbose - Whether to log progress
 */
async function waitForProcessExit(
  pid: number,
  timeout: number,
  verbose: boolean
): Promise<void> {
  const startTime = Date.now();
  const pollInterval = 100; // ms

  while (Date.now() - startTime < timeout) {
    if (!isProcessRunning(pid)) {
      if (verbose) console.log(`[Cleanup] Process ${pid} exited`);
      return;
    }
    await sleep(pollInterval);
  }

  // Process didn't exit in time, try to force kill
  if (verbose) {
    console.warn(
      `[Cleanup] Process ${pid} didn't exit in ${timeout}ms, force killing`
    );
  }
  try {
    process.kill(pid, 'SIGKILL');
    // Wait a bit more for force kill to take effect
    await sleep(500);
  } catch {
    // Process may have already exited
  }
}

/**
 * Check if a process is still running.
 *
 * @param pid - Process ID to check
 * @returns true if process is running, false otherwise
 */
function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 doesn't kill the process but checks if it exists
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sleep for a specified duration.
 *
 * @param ms - Milliseconds to sleep
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
