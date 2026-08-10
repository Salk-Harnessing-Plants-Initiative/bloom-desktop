/**
 * E2E Test Helper: Electron Cleanup
 *
 * Provides robust cleanup utilities for E2E tests to prevent race conditions
 * between tests when launching multiple Electron instances.
 *
 * ROOT CAUSE (main process): `electronApp.close()` returns before the
 * Electron process fully terminates. The next test's `electron.launch()` may
 * fail or timeout if the previous instance is still shutting down.
 *
 * SOLUTION: Wait for the process to actually exit before proceeding.
 *
 * See: openspec/changes/fix-e2e-test-cleanup-race-condition/proposal.md
 *
 * ROOT CAUSE (descendants): the above only ever tracked the main Electron
 * PID. Its direct children (Electron Helper processes, and the Python
 * `bloom-hardware` subprocess) were never tracked or killed, so they could
 * outlive the test that spawned them and accumulate across a long-running
 * Playwright worker.
 *
 * SOLUTION: snapshot the main process's direct children *before* it closes
 * (their parent-child relationship becomes unrecoverable once the main
 * process exits — POSIX reparents them, and Windows' PID-based tree lookups
 * stop working), then force-kill the previously-snapshotted PIDs after the
 * main process's own teardown completes, unconditionally (even if that
 * teardown itself threw), guarding against a snapshotted PID having been
 * recycled for an unrelated process in the interim.
 *
 * See: openspec/changes/fix-e2e-worker-teardown-flake/design.md
 */

import { ElectronApplication } from '@playwright/test';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export interface DescendantProcess {
  pid: number;
  name: string;
}

/**
 * Safely close an Electron app and wait for the process to fully terminate.
 * Also snapshots and force-kills its direct child processes (Electron
 * Helper, the Python subprocess), which the main process's own close/exit
 * handling does not clean up on its own.
 *
 * @param electronApp - The Playwright ElectronApplication instance
 * @param options - Configuration options
 * @param deps - Overridable dependencies, for testing only. Production
 *   callers should omit this.
 * @returns Promise that resolves when the app is fully closed
 */
export async function closeElectronApp(
  electronApp: ElectronApplication | undefined,
  options: {
    /** Timeout in ms to wait for graceful close before force killing (default: 5000) */
    timeout?: number;
    /** Whether to log progress (default: false) */
    verbose?: boolean;
  } = {},
  deps: {
    snapshotDescendants: typeof snapshotDescendants;
    killDescendants: typeof killDescendants;
  } = { snapshotDescendants, killDescendants }
): Promise<void> {
  const { timeout = 5000, verbose = false } = options;

  if (!electronApp) {
    if (verbose) console.log('[Cleanup] No Electron app to close');
    return;
  }

  // Snapshot descendants FIRST, in their own try/catch, separate from and
  // preceding the main-process teardown below. A failure here (missing
  // `ps`/`powershell.exe`, permission error, malformed output) must never
  // prevent electronApp.close() from being attempted.
  let descendants: DescendantProcess[] = [];
  try {
    const snapshotPid = electronApp.process()?.pid;
    if (snapshotPid) {
      descendants = await deps.snapshotDescendants(snapshotPid, verbose);
    }
  } catch (error) {
    // Defensive only — snapshotDescendants() already swallows its own
    // errors and returns []. This guards against a bug in that swallowing.
    if (verbose) {
      console.warn(
        '[Cleanup] Unexpected error while snapshotting descendants:',
        error instanceof Error ? error.message : error
      );
    }
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

  // Kill descendants UNCONDITIONALLY — regardless of whether the
  // main-process teardown above (or the snapshot above) threw.
  await deps.killDescendants(descendants, verbose);

  // Wait for Electron child processes (GPU, Renderer, Utility) to fully terminate.
  // The main process exits first, but child processes may still be shutting down.
  // Without this delay, the next test's electron.launch() can fail due to
  // resource contention (port conflicts, file locks, IPC channel issues).
  // 500ms is sufficient for both local and slower CI runners.
  await sleep(500);
}

/**
 * Snapshot the direct child processes of `pid` (name + PID), while `pid` is
 * still alive. Must be called BEFORE the main process exits — once it's
 * gone, POSIX reparents its children and this lookup can no longer find
 * them. Never throws: any failure is logged (if verbose) and swallowed,
 * returning an empty list.
 *
 * @param pid - The parent PID whose direct children to enumerate
 * @param verbose - Whether to log progress (default: false)
 */
export async function snapshotDescendants(
  pid: number,
  verbose = false
): Promise<DescendantProcess[]> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}" | Select-Object ProcessId, Name | ConvertTo-Json`,
      ]);
      return parseWindowsProcessJson(stdout);
    }

    const { stdout } = await execFileAsync('ps', ['-eo', 'pid,ppid,comm']);
    const result: DescendantProcess[] = [];
    for (const line of stdout.trim().split('\n').slice(1)) {
      const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
      if (!match) continue;
      const [, pidStr, ppidStr, name] = match;
      if (Number(ppidStr) === pid) {
        result.push({ pid: Number(pidStr), name: name.trim() });
      }
    }
    return result;
  } catch (error) {
    if (verbose) {
      console.warn(
        '[Cleanup] Failed to snapshot descendant processes:',
        error instanceof Error ? error.message : error
      );
    }
    return [];
  }
}

/**
 * Force-kill every previously-snapshotted descendant that is still running.
 * Re-verifies each still-running PID's current process name in one batched
 * query immediately before killing, skipping any PID whose current name no
 * longer matches its snapshotted name (it has been recycled by the OS for
 * an unrelated process). Never throws: per-PID failures are logged (if
 * verbose) and swallowed so one failure doesn't block the rest.
 *
 * @param descendants - The previously-snapshotted {pid, name} list
 * @param verbose - Whether to log progress (default: false)
 * @param deps - Overridable dependencies, for testing only.
 */
export async function killDescendants(
  descendants: DescendantProcess[],
  verbose = false,
  deps: { readCurrentNames: typeof readCurrentNames } = { readCurrentNames }
): Promise<void> {
  if (descendants.length === 0) return;

  const stillRunning = descendants.filter((d) => isProcessRunning(d.pid));
  if (stillRunning.length === 0) return;

  const currentNames = await deps.readCurrentNames(
    stillRunning.map((d) => d.pid),
    verbose
  );

  for (const descendant of stillRunning) {
    const currentName = currentNames.get(descendant.pid);
    if (currentName === undefined || currentName !== descendant.name) {
      if (verbose) {
        console.log(
          `[Cleanup] Skipping PID ${descendant.pid}: name no longer matches snapshot (expected "${descendant.name}", found ${
            currentName === undefined ? 'nothing' : `"${currentName}"`
          })`
        );
      }
      continue;
    }
    try {
      process.kill(descendant.pid, 'SIGKILL');
      if (verbose) {
        console.log(
          `[Cleanup] Killed descendant PID ${descendant.pid} (${descendant.name})`
        );
      }
    } catch (error) {
      if (verbose) {
        console.warn(
          `[Cleanup] Failed to kill descendant PID ${descendant.pid}:`,
          error instanceof Error ? error.message : error
        );
      }
      // Continue with remaining descendants — one failure must not block the rest.
    }
  }
}

/**
 * Re-read the current process name for each of `pids` in a single batched
 * query (not one call per PID). Never throws: on failure, returns whatever
 * was successfully read (possibly an empty map) — callers treat a missing
 * entry the same as a name mismatch (skip, don't kill).
 */
async function readCurrentNames(
  pids: number[],
  verbose = false
): Promise<Map<number, string>> {
  const result = new Map<number, string>();
  if (pids.length === 0) return result;

  try {
    if (process.platform === 'win32') {
      const filter = pids.map((p) => `ProcessId=${p}`).join(' or ');
      const { stdout } = await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId, Name | ConvertTo-Json`,
      ]);
      for (const { pid, name } of parseWindowsProcessJson(stdout)) {
        result.set(pid, name);
      }
      return result;
    }

    const { stdout } = await execFileAsync('ps', [
      '-o',
      'pid,comm',
      '-p',
      pids.join(','),
    ]);
    for (const line of stdout.trim().split('\n').slice(1)) {
      const match = line.trim().match(/^(\d+)\s+(.+)$/);
      if (!match) continue;
      result.set(Number(match[1]), match[2].trim());
    }
    return result;
  } catch (error) {
    if (verbose) {
      console.warn(
        '[Cleanup] Failed to re-verify descendant process names:',
        error instanceof Error ? error.message : error
      );
    }
    return result;
  }
}

function parseWindowsProcessJson(stdout: string): DescendantProcess[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .filter(
      (row): row is { ProcessId: number; Name: string } =>
        typeof row?.ProcessId === 'number'
    )
    .map((row) => ({ pid: row.ProcessId, name: String(row.Name) }));
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
export function isProcessRunning(pid: number): boolean {
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
