import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import {
  closeElectronApp,
  snapshotDescendants,
  killDescendants,
  isProcessRunning,
} from '../e2e/helpers/electron-cleanup';

/**
 * Spawns a synthetic 3-process tree (root + `childCount` direct children, all
 * plain `node -e` processes) matching the real flat fan-out of the Electron
 * main process (Electron Helper + the Python `bloom-hardware` subprocess).
 */
function spawnSyntheticTree(
  childCount: number
): Promise<{ rootPid: number; childPids: number[]; rootProcess: ChildProcess }> {
  return new Promise((resolve, reject) => {
    const script = `
      const { spawn } = require('child_process');
      const children = [];
      for (let i = 0; i < ${childCount}; i++) {
        const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
        children.push(c.pid);
      }
      process.stdout.write(JSON.stringify({ pid: process.pid, children }) + '\\n');
      setInterval(() => {}, 1000);
    `;
    const rootProcess = spawn(process.execPath, ['-e', script]);
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) return;
      rootProcess.stdout?.off('data', onData);
      try {
        const parsed = JSON.parse(buffer.slice(0, newlineIdx));
        resolve({ rootPid: parsed.pid, childPids: parsed.children, rootProcess });
      } catch (err) {
        reject(err);
      }
    };
    rootProcess.stdout?.on('data', onData);
    rootProcess.on('error', reject);
  });
}

function forceKill(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // already gone
  }
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 3000,
  intervalMs = 50
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe('electron-cleanup: descendant snapshot/kill', () => {
  const spawnedPids: number[] = [];

  afterEach(() => {
    // Defensive cleanup so a failing assertion never leaks a real OS process.
    for (const pid of spawnedPids) forceKill(pid);
    spawnedPids.length = 0;
  });

  it('1.1 snapshots direct children while the root is alive', async () => {
    const { rootPid, childPids, rootProcess } = await spawnSyntheticTree(2);
    spawnedPids.push(rootPid, ...childPids);

    expect(isProcessRunning(rootPid)).toBe(true);
    for (const pid of childPids) expect(isProcessRunning(pid)).toBe(true);

    const snapshot = await snapshotDescendants(rootPid);

    expect(snapshot.map((d) => d.pid).sort()).toEqual([...childPids].sort());
    for (const d of snapshot) {
      expect(d.name.length).toBeGreaterThan(0);
    }

    forceKill(rootProcess.pid!);
  });

  it('1.2 kills pre-snapshotted descendants after the root has already died (production order)', async () => {
    const { rootPid, childPids } = await spawnSyntheticTree(2);
    spawnedPids.push(rootPid, ...childPids);

    const snapshot = await snapshotDescendants(rootPid);
    expect(snapshot).toHaveLength(2);

    // Simulate the main process's own teardown completing (gracefully or via
    // force-kill) BEFORE the descendant-kill step runs — the real
    // closeElectronApp() ordering.
    forceKill(rootPid);
    await waitUntil(() => !isProcessRunning(rootPid));

    await killDescendants(snapshot);

    for (const pid of childPids) {
      expect(isProcessRunning(pid)).toBe(false);
    }
  });

  it('1.3 does not throw when a descendant already exited on its own before the kill step', async () => {
    const { rootPid, childPids } = await spawnSyntheticTree(2);
    spawnedPids.push(rootPid, ...childPids);

    const snapshot = await snapshotDescendants(rootPid);
    expect(snapshot).toHaveLength(2);

    forceKill(rootPid);
    // One descendant exits on its own between snapshot and kill.
    forceKill(childPids[0]);
    await waitUntil(() => !isProcessRunning(childPids[0]));

    await expect(killDescendants(snapshot)).resolves.toBeUndefined();

    // The other, still-running descendant must still be killed.
    expect(isProcessRunning(childPids[1])).toBe(false);
  });

  it('1.4 skips a descendant whose current name no longer matches its snapshotted name', async () => {
    const { rootPid, childPids } = await spawnSyntheticTree(2);
    spawnedPids.push(rootPid, ...childPids);

    const snapshot = await snapshotDescendants(rootPid);
    expect(snapshot).toHaveLength(2);
    const [matched, mismatched] = snapshot;

    forceKill(rootPid);

    const readCurrentNames = async (pids: number[]) => {
      const result = new Map<number, string>();
      for (const pid of pids) {
        result.set(
          pid,
          pid === mismatched.pid ? `${mismatched.name}-not-the-same` : matched.name
        );
      }
      return result;
    };

    await killDescendants(snapshot, false, { readCurrentNames });

    expect(isProcessRunning(matched.pid)).toBe(false);
    expect(isProcessRunning(mismatched.pid)).toBe(true);
  });

  it('1.5 resolves without error when there are zero descendants', async () => {
    const { rootPid } = await spawnSyntheticTree(0);
    spawnedPids.push(rootPid);

    const snapshot = await snapshotDescendants(rootPid);
    expect(snapshot).toEqual([]);

    forceKill(rootPid);
    await expect(killDescendants(snapshot)).resolves.toBeUndefined();
  });

  it('1.6 still kills pre-snapshotted descendants after an unrelated rejection elsewhere', async () => {
    const { rootPid, childPids } = await spawnSyntheticTree(2);
    spawnedPids.push(rootPid, ...childPids);

    const snapshot = await snapshotDescendants(rootPid);

    const rejectingRootKill = async () => {
      throw new Error('boom');
    };
    await rejectingRootKill().catch(() => {
      // Mirrors closeElectronApp's own try/catch swallowing a thrown close().
    });
    forceKill(rootPid);

    await killDescendants(snapshot);

    for (const pid of childPids) {
      expect(isProcessRunning(pid)).toBe(false);
    }
  });

  it('1.7a closeElectronApp still kills descendants when electronApp.close() rejects', async () => {
    const { rootPid, childPids } = await spawnSyntheticTree(2);
    spawnedPids.push(rootPid, ...childPids);

    const stubApp = {
      process: () => ({ pid: rootPid }) as ReturnType<
        NonNullable<Parameters<typeof closeElectronApp>[0]>['process']
      >,
      close: () => Promise.reject(new Error('boom')),
    } as unknown as Parameters<typeof closeElectronApp>[0];

    await expect(
      closeElectronApp(stubApp, { timeout: 1000 })
    ).resolves.toBeUndefined();

    for (const pid of childPids) {
      expect(isProcessRunning(pid)).toBe(false);
    }

    forceKill(rootPid);
  });

  it('1.7b closeElectronApp still tears down the main process when snapshotting throws', async () => {
    const { rootPid } = await spawnSyntheticTree(0);
    spawnedPids.push(rootPid);

    const stubApp = {
      process: () => ({ pid: rootPid }) as ReturnType<
        NonNullable<Parameters<typeof closeElectronApp>[0]>['process']
      >,
      close: async () => {
        process.kill(rootPid, 'SIGTERM');
      },
    } as unknown as Parameters<typeof closeElectronApp>[0];

    const throwingSnapshot = async (): Promise<
      Array<{ pid: number; name: string }>
    > => {
      throw new Error('snapshot boom');
    };

    await expect(
      closeElectronApp(stubApp, { timeout: 2000 }, { snapshotDescendants: throwingSnapshot, killDescendants })
    ).resolves.toBeUndefined();

    expect(isProcessRunning(rootPid)).toBe(false);
  });
});
