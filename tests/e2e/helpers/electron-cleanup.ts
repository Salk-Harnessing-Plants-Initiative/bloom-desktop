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
 * PID. Its descendant processes (Electron Helper processes, and the Python
 * `bloom-hardware` subprocess) were never tracked or killed, so they could
 * outlive the test that spawned them and accumulate across a long-running
 * Playwright worker. The descendant tree is NOT reliably one level deep:
 * `bloom-hardware` is a PyInstaller onefile build (see `python/main.spec`),
 * whose bootloader can itself run the real interpreter as a further child
 * process rather than in-process, depending on platform/build — so a
 * direct-children-only enumeration can silently miss it. Enumerate the
 * FULL transitive descendant tree instead.
 *
 * SOLUTION: snapshot the main process's full descendant tree *before* it
 * closes (the parent-child relationships become unrecoverable once the
 * main process exits — POSIX reparents them, and Windows' PID-based tree
 * lookups stop working), then force-kill the previously-snapshotted PIDs
 * after the main process's own teardown completes, unconditionally (even
 * if that teardown itself threw), guarding against a snapshotted PID
 * having been recycled for an unrelated process in the interim.
 *
 * See: openspec/changes/fix-e2e-worker-teardown-flake/design.md
 */

import { ElectronApplication } from '@playwright/test';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// Bounds how long any single process-enumeration/re-verification shell-out
// can block test teardown. Without this, a hung `powershell.exe`/`ps` call
// (e.g. a stalled WMI/CIM service on an overloaded CI runner) would block
// `closeElectronApp()` indefinitely instead of degrading gracefully via the
// existing try/catch around these calls. Kept tight (not e.g. 10s): this
// runs on EVERY test's teardown, added on top of whatever `electronApp
// .close()` itself takes for that specific test — a generous per-call
// budget compounds into enough total overhead to turn an already-slow
// `close()` (e.g. a test with real disk I/O still flushing) into a
// `Test timeout ... afterEach hook` failure that would not have occurred
// pre-fix. A healthy `ps`/`Get-CimInstance` call normally returns in well
// under a second even under load.
const PROCESS_QUERY_TIMEOUT_MS = 3_000;

// Bounds how long `electronApp.close()` itself is awaited before giving up
// and falling through to `waitForProcessExit()`'s own PID-liveness poll
// (which works independently of `close()` ever resolving). Without this, a
// slow-to-quit Electron instance (e.g. flushing pending disk I/O) could
// hold `closeElectronApp()` open indefinitely, with no fallback -- the
// existing SIGKILL fallback in `waitForProcessExit()` never even gets a
// chance to run if the `await electronApp.close()` line itself never
// returns.
const ELECTRON_CLOSE_TIMEOUT_MS = 15_000;

export interface DescendantProcess {
  pid: number;
  name: string;
}

/**
 * Safely close an Electron app and wait for the process to fully terminate.
 * Also snapshots and force-kills its full descendant process tree
 * (Electron Helper, the Python subprocess, and any of their own children),
 * which the main process's own close/exit handling does not clean up on
 * its own.
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
    /** Timeout in ms to wait for electronApp.close() to resolve before proceeding anyway (default: 15000). Exposed for testing. */
    closeTimeout?: number;
  } = {},
  deps: {
    snapshotDescendants: typeof snapshotDescendants;
    killDescendants: typeof killDescendants;
  } = { snapshotDescendants, killDescendants }
): Promise<void> {
  const {
    timeout = 5000,
    verbose = false,
    closeTimeout = ELECTRON_CLOSE_TIMEOUT_MS,
  } = options;

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

    // Request graceful close, but don't let a slow-to-quit app hold this
    // open indefinitely -- fall through to the PID-liveness poll below
    // either way, since that works independently of close() resolving.
    await Promise.race([
      electronApp.close(),
      sleep(closeTimeout).then(() => {
        if (verbose) {
          console.warn(
            `[Cleanup] electronApp.close() did not resolve within ${closeTimeout}ms, proceeding to check process liveness directly`
          );
        }
      }),
    ]);

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

interface ProcessTableRow {
  pid: number;
  ppid: number;
  name: string;
}

/**
 * Snapshot the FULL transitive descendant tree of `pid` (children,
 * grandchildren, etc. — not just direct children), while `pid` is still
 * alive. Must be called BEFORE the main process exits — once it's gone,
 * POSIX reparents its children and this lookup can no longer find them.
 * Never throws: any failure is logged (if verbose) and swallowed, returning
 * an empty list.
 *
 * @param pid - The ancestor PID whose descendants to enumerate
 * @param verbose - Whether to log progress (default: false)
 */
export async function snapshotDescendants(
  pid: number,
  verbose = false
): Promise<DescendantProcess[]> {
  try {
    const table = await readProcessTable();
    return collectDescendants(pid, table);
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
 * Read the full system process table (pid, ppid, name) in one query.
 */
async function readProcessTable(): Promise<ProcessTableRow[]> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name | ConvertTo-Json',
      ],
      { timeout: PROCESS_QUERY_TIMEOUT_MS }
    );
    const trimmed = stdout.trim();
    if (!trimmed) return [];
    const parsed = JSON.parse(trimmed);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows
      .filter(
        (
          row
        ): row is {
          ProcessId: number;
          ParentProcessId: number;
          Name: string;
        } => typeof row?.ProcessId === 'number'
      )
      .map((row) => ({
        pid: row.ProcessId,
        ppid: row.ParentProcessId,
        name: String(row.Name),
      }));
  }

  const { stdout } = await execFileAsync('ps', ['-eo', 'pid,ppid,comm'], {
    timeout: PROCESS_QUERY_TIMEOUT_MS,
  });
  const result: ProcessTableRow[] = [];
  for (const line of stdout.trim().split('\n').slice(1)) {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (!match) continue;
    const [, pidStr, ppidStr, name] = match;
    result.push({
      pid: Number(pidStr),
      ppid: Number(ppidStr),
      name: name.trim(),
    });
  }
  return result;
}

/**
 * Walk `table` breadth-first from `rootPid`, collecting every transitive
 * descendant (not just direct children).
 */
function collectDescendants(
  rootPid: number,
  table: ProcessTableRow[]
): DescendantProcess[] {
  const childrenByParent = new Map<number, ProcessTableRow[]>();
  for (const row of table) {
    const siblings = childrenByParent.get(row.ppid) ?? [];
    siblings.push(row);
    childrenByParent.set(row.ppid, siblings);
  }

  const result: DescendantProcess[] = [];
  const queue = [rootPid];
  const visited = new Set<number>([rootPid]);
  while (queue.length > 0) {
    const currentPid = queue.shift()!;
    for (const child of childrenByParent.get(currentPid) ?? []) {
      if (visited.has(child.pid)) continue; // guard against a corrupt/cyclic table
      visited.add(child.pid);
      result.push({ pid: child.pid, name: child.name });
      queue.push(child.pid);
    }
  }
  return result;
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
      const { stdout } = await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "${filter}" | Select-Object ProcessId, Name | ConvertTo-Json`,
        ],
        { timeout: PROCESS_QUERY_TIMEOUT_MS }
      );
      for (const { pid, name } of parseWindowsProcessJson(stdout)) {
        result.set(pid, name);
      }
      return result;
    }

    const { stdout } = await execFileAsync(
      'ps',
      ['-o', 'pid,comm', '-p', pids.join(',')],
      { timeout: PROCESS_QUERY_TIMEOUT_MS }
    );
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
