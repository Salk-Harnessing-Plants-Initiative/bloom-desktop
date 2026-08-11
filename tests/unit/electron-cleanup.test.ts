import { describe, it, expect, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'child_process';
import {
  closeElectronApp,
  snapshotDescendants,
  killDescendants,
  isProcessRunning,
  isBootloaderLike,
} from '../e2e/helpers/electron-cleanup';

/**
 * Run by each direct child of the synthetic root. Takes the number of its
 * own children ("grandchildren" of the root) to spawn as its first CLI arg.
 * If that count is > 0, it spawns them, reports their PIDs on one JSON
 * stdout line, and idles; otherwise it just idles with no stdout output.
 * Models a PyInstaller onefile executable (like the real `bloom-hardware`)
 * whose bootloader can itself run the real interpreter as a further child
 * process, not just a direct child of Electron's main PID.
 */
const CHILD_SCRIPT = `
  const { spawn } = require('child_process');
  const grandchildCount = Number(process.argv[1] || 0);
  const grandchildren = [];
  for (let i = 0; i < grandchildCount; i++) {
    grandchildren.push(
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }).pid
    );
  }
  if (grandchildCount > 0) {
    process.stdout.write(JSON.stringify(grandchildren) + '\\n');
  }
  setInterval(() => {}, 1000);
`;

/**
 * Builds the root process's script: spawns `childCount` direct children
 * (each running CHILD_SCRIPT), where the first child is also told to spawn
 * `grandchildCount` of its own children. Reports {pid, children,
 * grandchildren} as one JSON stdout line once everything is up.
 */
function buildRootScript(childCount: number, grandchildCount: number): string {
  const childScriptLiteral = JSON.stringify(CHILD_SCRIPT);
  return `
    const { spawn } = require('child_process');
    const childScript = ${childScriptLiteral};
    const children = [];
    let grandchildren = [];
    let pending = 0;

    function report() {
      process.stdout.write(JSON.stringify({ pid: process.pid, children, grandchildren }) + '\\n');
    }

    for (let i = 0; i < ${childCount}; i++) {
      const isFirst = i === 0;
      const gcCount = isFirst ? ${grandchildCount} : 0;
      const c = spawn(process.execPath, ['-e', childScript, String(gcCount)], {
        stdio: isFirst && gcCount > 0 ? ['ignore', 'pipe', 'ignore'] : 'ignore',
      });
      children.push(c.pid);
      if (isFirst && gcCount > 0) {
        pending++;
        let buf = '';
        c.stdout.on('data', (chunk) => {
          buf += chunk.toString();
          const idx = buf.indexOf('\\n');
          if (idx === -1) return;
          grandchildren = JSON.parse(buf.slice(0, idx));
          pending--;
          if (pending === 0) report();
        });
      }
    }
    if (pending === 0) report();
    setInterval(() => {}, 1000);
  `;
}

/**
 * Spawns a synthetic process tree (root + `childCount` direct children, all
 * plain `node -e` processes) matching the real fan-out of the Electron main
 * process (Electron Helper + the Python `bloom-hardware` subprocess).
 *
 * When `grandchildCount` > 0, the FIRST child also spawns that many of its
 * own children — see `CHILD_SCRIPT`.
 */
function spawnSyntheticTree(
  childCount: number,
  grandchildCount = 0
): Promise<{
  rootPid: number;
  childPids: number[];
  grandchildPids: number[];
  rootProcess: ChildProcess;
}> {
  return new Promise((resolve, reject) => {
    const rootProcess = spawn(process.execPath, [
      '-e',
      buildRootScript(childCount, grandchildCount),
    ]);
    let buffer = '';
    const onData = (chunk: Buffer) => {
      buffer += chunk.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) return;
      rootProcess.stdout?.off('data', onData);
      try {
        const parsed = JSON.parse(buffer.slice(0, newlineIdx));
        resolve({
          rootPid: parsed.pid,
          childPids: parsed.children,
          grandchildPids: parsed.grandchildren ?? [],
          rootProcess,
        });
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

describe('isBootloaderLike', () => {
  it('matches the real bloom-hardware process name on both platforms', () => {
    expect(isBootloaderLike('bloom-hardware')).toBe(true);
    expect(isBootloaderLike('bloom-hardware.exe')).toBe(true);
    expect(isBootloaderLike('BLOOM-HARDWARE.EXE')).toBe(true);
  });

  it("does not match Electron's own direct children", () => {
    expect(isBootloaderLike('Electron Helper')).toBe(false);
    expect(isBootloaderLike('Electron Helper (GPU)')).toBe(false);
    expect(isBootloaderLike('Electron Helper (Renderer)')).toBe(false);
    expect(isBootloaderLike('electron.exe')).toBe(false);
    expect(isBootloaderLike('node')).toBe(false);
  });
});

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

  it('1.1b captures transitive descendants (grandchildren), not just direct children', async () => {
    const { rootPid, childPids, grandchildPids, rootProcess } =
      await spawnSyntheticTree(2, 2);
    spawnedPids.push(rootPid, ...childPids, ...grandchildPids);
    expect(grandchildPids).toHaveLength(2);

    // The synthetic first child is just a plain "node" process, standing
    // in for the real bloom-hardware bootloader -- so recursion has to be
    // permitted explicitly here, since the default only recurses into
    // names matching /bloom-hardware/i.
    const snapshot = await snapshotDescendants(rootPid, false, () => true);
    const snapshotPids = snapshot.map((d) => d.pid).sort((a, b) => a - b);
    const expectedPids = [...childPids, ...grandchildPids].sort(
      (a, b) => a - b
    );

    expect(snapshotPids).toEqual(expectedPids);

    forceKill(rootProcess.pid!);
  });

  it('1.1c does NOT recurse into a non-bootloader-like child by default (scoped, not fully transitive)', async () => {
    const { rootPid, childPids, grandchildPids, rootProcess } =
      await spawnSyntheticTree(2, 2);
    spawnedPids.push(rootPid, ...childPids, ...grandchildPids);
    expect(grandchildPids).toHaveLength(2);

    // Default shouldRecurse (isBootloaderLike) only matches names
    // containing "bloom-hardware" -- these synthetic children are plain
    // "node" processes, so the grandchildren must NOT be found. This is
    // the actual safety property: Electron's own direct children (Helper,
    // GPU, ...) never have their own sub-processes walked into.
    const snapshot = await snapshotDescendants(rootPid);
    const snapshotPids = snapshot.map((d) => d.pid).sort((a, b) => a - b);

    expect(snapshotPids).toEqual([...childPids].sort((a, b) => a - b));
    for (const gcPid of grandchildPids) {
      expect(snapshotPids).not.toContain(gcPid);
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

    // SIGKILL delivery isn't synchronous with process.kill() returning —
    // poll briefly rather than asserting immediately, to avoid a race on a
    // loaded CI runner (this doesn't affect production correctness: the
    // real closeElectronApp() has its own unconditional sleep(500) after
    // killDescendants(), which already provides this grace period).
    for (const pid of childPids) {
      await waitUntil(() => !isProcessRunning(pid));
      expect(isProcessRunning(pid)).toBe(false);
    }
  });

  it('1.2b kills transitive descendants (grandchildren), not just direct children', async () => {
    const { rootPid, childPids, grandchildPids } = await spawnSyntheticTree(
      2,
      2
    );
    spawnedPids.push(rootPid, ...childPids, ...grandchildPids);

    const snapshot = await snapshotDescendants(rootPid, false, () => true);
    expect(snapshot).toHaveLength(childPids.length + grandchildPids.length);

    forceKill(rootPid);
    await waitUntil(() => !isProcessRunning(rootPid));

    await killDescendants(snapshot);

    for (const pid of [...childPids, ...grandchildPids]) {
      await waitUntil(() => !isProcessRunning(pid));
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
    await waitUntil(() => !isProcessRunning(childPids[1]));
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
          pid === mismatched.pid
            ? `${mismatched.name}-not-the-same`
            : matched.name
        );
      }
      return result;
    };

    await killDescendants(snapshot, false, { readCurrentNames });

    await waitUntil(() => !isProcessRunning(matched.pid));
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
      await waitUntil(() => !isProcessRunning(pid));
      expect(isProcessRunning(pid)).toBe(false);
    }
  });

  it('1.7a closeElectronApp still kills descendants when electronApp.close() rejects', async () => {
    const { rootPid, childPids } = await spawnSyntheticTree(2);
    spawnedPids.push(rootPid, ...childPids);

    const stubApp = {
      process: () =>
        ({ pid: rootPid }) as ReturnType<
          NonNullable<Parameters<typeof closeElectronApp>[0]>['process']
        >,
      close: () => Promise.reject(new Error('boom')),
    } as unknown as Parameters<typeof closeElectronApp>[0];

    await expect(
      closeElectronApp(stubApp, { timeout: 1000 })
    ).resolves.toBeUndefined();

    for (const pid of childPids) {
      await waitUntil(() => !isProcessRunning(pid));
      expect(isProcessRunning(pid)).toBe(false);
    }

    forceKill(rootPid);
  });

  it('1.7c closeElectronApp proceeds to kill descendants even if electronApp.close() never resolves', async () => {
    const { rootPid, childPids } = await spawnSyntheticTree(2);
    spawnedPids.push(rootPid, ...childPids);

    const stubApp = {
      process: () =>
        ({ pid: rootPid }) as ReturnType<
          NonNullable<Parameters<typeof closeElectronApp>[0]>['process']
        >,
      close: () => new Promise<void>(() => {}), // never resolves
    } as unknown as Parameters<typeof closeElectronApp>[0];

    const start = Date.now();
    await expect(
      closeElectronApp(stubApp, { timeout: 1000, closeTimeout: 300 })
    ).resolves.toBeUndefined();
    // Proves closeElectronApp itself doesn't block indefinitely on a hung
    // close() -- it should return in roughly closeTimeout + the other
    // (short, timeout: 1000) steps, not hang forever.
    expect(Date.now() - start).toBeLessThan(5000);

    for (const pid of childPids) {
      await waitUntil(() => !isProcessRunning(pid));
      expect(isProcessRunning(pid)).toBe(false);
    }

    forceKill(rootPid);
  });

  it('1.7b closeElectronApp still tears down the main process when snapshotting throws', async () => {
    const { rootPid } = await spawnSyntheticTree(0);
    spawnedPids.push(rootPid);

    const stubApp = {
      process: () =>
        ({ pid: rootPid }) as ReturnType<
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
      closeElectronApp(
        stubApp,
        { timeout: 2000 },
        { snapshotDescendants: throwingSnapshot, killDescendants }
      )
    ).resolves.toBeUndefined();

    expect(isProcessRunning(rootPid)).toBe(false);
  });
});
