// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import path from 'path';

// Mock ScannerSubprocess
vi.mock('../../../src/main/graviscan/scanner-subprocess', () => {
  return {
    ScannerSubprocess: vi.fn(),
  };
});

vi.mock('../../../src/main/graviscan/scan-logger', () => ({
  scanLog: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: {
    access: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 1024 }),
  },
  // Keep existsSync for any other code that might use it
  existsSync: vi.fn().mockReturnValue(true),
  statSync: vi.fn().mockReturnValue({ size: 1024 }),
}));

import * as fs from 'fs';
import { ScannerSubprocess } from '../../../src/main/graviscan/scanner-subprocess';
import { scanLog } from '../../../src/main/graviscan/scan-logger';
import { SPAWN_READY_TIMEOUT_MS } from '../../../src/main/graviscan/scan-coordinator';
import type { PlateConfig, ScannerConfig } from '../../../src/types/graviscan';

// Helper to create a mock subprocess instance
function createMockSubprocess(scannerId: string): EventEmitter & {
  scannerId: string;
  isReady: boolean;
  isAlive: boolean;
  spawn: ReturnType<typeof vi.fn>;
  scan: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
  shutdown: ReturnType<typeof vi.fn>;
  removeAllListeners: ReturnType<typeof vi.fn>;
} {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    scannerId,
    isReady: true,
    isAlive: true,
    spawn: vi.fn().mockResolvedValue(undefined),
    scan: vi.fn(),
    cancel: vi.fn(),
    quit: vi.fn(),
    kill: vi.fn(),
    // Resolves `true` (confirmed exit) by default — the new
    // `if (!confirmed) warn(...)` logic (design.md Decision 3) would
    // otherwise treat every healthy mock's `undefined`/void return as an
    // unconfirmed shutdown and spuriously warn across unrelated tests.
    shutdown: vi.fn().mockResolvedValue(true),
    removeAllListeners: vi.fn().mockReturnThis(),
  });
}

// Helper to emit a scan-complete event per plate, as the real
// ScannerSubprocess does when the Python worker reports each plate's final
// (already-_et_-stamped) path. `sub` is whatever mock subprocess received
// the `scan()` call; `plates` is the array `scan()` was called with.
function emitScanCompleteForPlates(
  sub: EventEmitter,
  plates: PlateConfig[]
): void {
  for (const plate of plates) {
    sub.emit('scan-complete', {
      type: 'scan-complete',
      scanner_id: 'test-scanner',
      plate_index: plate.plate_index,
      path: plate.output_path,
    });
  }
}

// A controllable-delay mock subprocess for exercising the concurrency
// guards (design.md Decision 1): `isReady` starts `false` (a real worker
// mid-`sane.open()` is not ready yet) and `spawn()` returns a promise that
// stays pending until the test explicitly resolves or rejects it via the
// returned `resolveSpawn`/`rejectSpawn` helpers. This MUST start
// `isReady: false` — a fixture that copies `createMockSubprocess()`'s
// hardcoded `isReady: true` would make the guard tests below pass by
// accident against unguarded code too, since both `addScanner()`'s
// `hasWorker()` check and `spawnSingleScanner()`'s reuse check key off
// `isReady`.
function createPendingMockSubprocess(scannerId: string) {
  const emitter = new EventEmitter();
  let resolveSpawnFn: () => void = () => {};
  let rejectSpawnFn: (err: Error) => void = () => {};
  const spawnPromise = new Promise<void>((resolve, reject) => {
    resolveSpawnFn = resolve;
    rejectSpawnFn = reject;
  });
  const mock = Object.assign(emitter, {
    scannerId,
    isReady: false,
    isAlive: true,
    spawn: vi.fn().mockReturnValue(spawnPromise),
    scan: vi.fn(),
    cancel: vi.fn(),
    quit: vi.fn(),
    kill: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(true),
    removeAllListeners: vi.fn().mockReturnThis(),
  });
  return {
    mock,
    resolveSpawn: () => {
      mock.isReady = true;
      resolveSpawnFn();
    },
    rejectSpawn: (err: Error) => {
      rejectSpawnFn(err);
    },
  };
}

// Track created subprocesses
let createdSubprocesses: ReturnType<typeof createMockSubprocess>[];

describe('ScanCoordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createdSubprocesses = [];

    // Each time ScannerSubprocess is constructed, return a mock
    vi.mocked(ScannerSubprocess).mockImplementation(
      (_pythonPath, _isPackaged, scannerId) => {
        const mock = createMockSubprocess(scannerId as string);
        createdSubprocesses.push(mock);
        return mock as unknown as ScannerSubprocess;
      }
    );

    // Mock fs.promises
    vi.mocked(fs.promises.access).mockResolvedValue(undefined);
    vi.mocked(fs.promises.stat).mockResolvedValue({ size: 1024 } as fs.Stats);

    // Suppress console
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  // Helper to import fresh module (avoids state leaks between tests)
  async function createCoordinator() {
    // Dynamic import to get fresh module state isn't needed since
    // ScanCoordinator is a class — each new instance is fresh
    const { ScanCoordinator } = await import(
      '../../../src/main/graviscan/scan-coordinator'
    );
    return new ScanCoordinator('/usr/bin/python3', false, false);
  }

  function makeScanners(count: number): ScannerConfig[] {
    return Array.from({ length: count }, (_, i) => ({
      scannerId: `scanner-${i + 1}`,
      saneName: `epkowa:interpreter:001:${String(i + 2).padStart(3, '0')}`,
      plates: [],
    }));
  }

  function makePlatesMap(
    scannerIds: string[],
    gridMode = '2grid'
  ): Map<string, PlateConfig[]> {
    const plates: PlateConfig[] =
      gridMode === '4grid'
        ? [
            {
              plate_index: '00',
              grid_mode: '4grid',
              resolution: 600,
              output_path: '/tmp/scan_st_20260410T120000_cy1_S1_00.tif',
            },
            {
              plate_index: '01',
              grid_mode: '4grid',
              resolution: 600,
              output_path: '/tmp/scan_st_20260410T120000_cy1_S1_01.tif',
            },
            {
              plate_index: '10',
              grid_mode: '4grid',
              resolution: 600,
              output_path: '/tmp/scan_st_20260410T120000_cy1_S1_10.tif',
            },
            {
              plate_index: '11',
              grid_mode: '4grid',
              resolution: 600,
              output_path: '/tmp/scan_st_20260410T120000_cy1_S1_11.tif',
            },
          ]
        : [
            {
              plate_index: '00',
              grid_mode: '2grid',
              resolution: 600,
              output_path: '/tmp/scan_st_20260410T120000_cy1_S1_00.tif',
            },
            {
              plate_index: '01',
              grid_mode: '2grid',
              resolution: 600,
              output_path: '/tmp/scan_st_20260410T120000_cy1_S1_01.tif',
            },
          ];

    const map = new Map<string, PlateConfig[]>();
    for (const id of scannerIds) {
      map.set(id, [...plates]);
    }
    return map;
  }

  describe('initialize()', () => {
    it('spawns one subprocess per scanner and results in all of them ready (design.md Decision 4 — no longer sequential, see the concurrency test below)', async () => {
      const coordinator = await createCoordinator();
      const scanners = makeScanners(2);

      await coordinator.initialize(scanners);

      expect(ScannerSubprocess).toHaveBeenCalledTimes(2);
      // Both should have spawn called
      expect(createdSubprocesses[0].spawn).toHaveBeenCalled();
      expect(createdSubprocesses[1].spawn).toHaveBeenCalled();
      expect(coordinator.hasWorker('scanner-1')).toBe(true);
      expect(coordinator.hasWorker('scanner-2')).toBe(true);
    });

    it('spawns all scanners concurrently, not sequentially — none waits for a previous one to finish (design.md Decision 4, closes #144)', async () => {
      const coordinator = await createCoordinator();
      const scanners = makeScanners(3);

      const pending = scanners.map((s) =>
        createPendingMockSubprocess(s.scannerId)
      );
      vi.mocked(ScannerSubprocess)
        .mockImplementationOnce(() => {
          createdSubprocesses.push(
            pending[0].mock as unknown as ReturnType<
              typeof createMockSubprocess
            >
          );
          return pending[0].mock as unknown as ScannerSubprocess;
        })
        .mockImplementationOnce(() => {
          createdSubprocesses.push(
            pending[1].mock as unknown as ReturnType<
              typeof createMockSubprocess
            >
          );
          return pending[1].mock as unknown as ScannerSubprocess;
        })
        .mockImplementationOnce(() => {
          createdSubprocesses.push(
            pending[2].mock as unknown as ReturnType<
              typeof createMockSubprocess
            >
          );
          return pending[2].mock as unknown as ScannerSubprocess;
        });

      const initPromise = coordinator.initialize(scanners);
      await Promise.resolve();

      // A sequential implementation would only have constructed the
      // FIRST subprocess by now, since it awaits each spawn() before
      // moving to the next. A concurrent implementation constructs all
      // three up front, before any of their spawn() calls resolve.
      expect(ScannerSubprocess).toHaveBeenCalledTimes(3);
      expect(pending[0].mock.spawn).toHaveBeenCalled();
      expect(pending[1].mock.spawn).toHaveBeenCalled();
      expect(pending[2].mock.spawn).toHaveBeenCalled();

      // Resolve out of order — a sequential implementation awaiting
      // scanner-1 before ever calling scanner-2's spawn() would make this
      // ordering meaningless; here it proves nothing was blocked on order.
      pending[2].resolveSpawn();
      pending[0].resolveSpawn();
      pending[1].resolveSpawn();
      await initPromise;

      expect(coordinator.hasWorker('scanner-1')).toBe(true);
      expect(coordinator.hasWorker('scanner-2')).toBe(true);
      expect(coordinator.hasWorker('scanner-3')).toBe(true);
    });

    it('reuses ready subprocesses', async () => {
      const coordinator = await createCoordinator();
      const scanners = makeScanners(1);

      // First init
      await coordinator.initialize(scanners);
      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);

      // Second init with same scanner — should reuse
      await coordinator.initialize(scanners);
      // Should NOT create a second subprocess
      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);
    });

    it('shuts down stale subprocesses', async () => {
      const coordinator = await createCoordinator();

      // Initialize with scanner-1 and scanner-2
      await coordinator.initialize(makeScanners(2));
      const sub1 = createdSubprocesses[0];
      const sub2 = createdSubprocesses[1];

      // Re-initialize with only scanner-1
      await coordinator.initialize(makeScanners(1));

      // scanner-2 should be shut down
      expect(sub2.shutdown).toHaveBeenCalled();
      // scanner-1 should be reused (no new spawn)
      expect(sub1.spawn).toHaveBeenCalledTimes(1);
    });

    it('handles zero scanners', async () => {
      const coordinator = await createCoordinator();

      // Initialize with 2 then re-init with 0
      await coordinator.initialize(makeScanners(2));
      const sub1 = createdSubprocesses[0];
      const sub2 = createdSubprocesses[1];

      await coordinator.initialize([]);

      expect(sub1.shutdown).toHaveBeenCalled();
      expect(sub2.shutdown).toHaveBeenCalled();
    });

    it('resets state to idle when spawn fails (does not throw — error isolated via initErrors/scanner-init-status, task 7.3)', async () => {
      const coordinator = await createCoordinator();

      // Make the first subprocess spawn fail
      const failScanner = makeScanners(1);
      vi.mocked(ScannerSubprocess).mockImplementationOnce(
        (_pythonPath, _isPackaged, scannerId) => {
          const mock = createMockSubprocess(scannerId as string);
          mock.spawn.mockRejectedValue(new Error('SANE device not found'));
          createdSubprocesses.push(mock);
          return mock as unknown as ScannerSubprocess;
        }
      );

      const initStatus = vi.fn();
      coordinator.on('scanner-init-status', initStatus);

      // initialize() now isolates a single scanner's spawn failure
      // (via the shared spawnSingleScanner() helper) instead of
      // letting it propagate out of the whole method — see
      // ScanCoordinator.spawnSingleScanner()'s docstring.
      await expect(
        coordinator.initialize(failScanner)
      ).resolves.toBeUndefined();

      // State should be reset to idle, not stuck in 'initializing'
      expect(coordinator.isScanning).toBe(false);
      // The failure is surfaced via scanner-init-status instead
      expect(initStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          error: expect.stringContaining('SANE device not found'),
        })
      );
      expect(coordinator.hasWorker(failScanner[0].scannerId)).toBe(false);
    });

    it('continues spawning remaining scanners after one fails (task 7.3 — closes the parallel-duplicate-loop gap)', async () => {
      const coordinator = await createCoordinator();
      const scanners = makeScanners(2);

      vi.mocked(ScannerSubprocess).mockImplementationOnce(
        (_pythonPath, _isPackaged, scannerId) => {
          const mock = createMockSubprocess(scannerId as string);
          mock.spawn.mockRejectedValue(new Error('boom'));
          createdSubprocesses.push(mock);
          return mock as unknown as ScannerSubprocess;
        }
      );

      await coordinator.initialize(scanners);

      expect(coordinator.hasWorker(scanners[0].scannerId)).toBe(false);
      expect(coordinator.hasWorker(scanners[1].scannerId)).toBe(true);
    });
  });

  describe('concurrency guards (design.md Decision 1)', () => {
    it('a still-connecting worker is awaited, not respawned, by a second overlapping initialize() call for the same scanner', async () => {
      const coordinator = await createCoordinator();
      const scanners = makeScanners(1); // scanner-1

      const { mock: pendingMock, resolveSpawn } =
        createPendingMockSubprocess('scanner-1');
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(
          pendingMock as unknown as ReturnType<typeof createMockSubprocess>
        );
        return pendingMock as unknown as ScannerSubprocess;
      });

      const firstInit = coordinator.initialize(scanners);
      // Let the first call's synchronous prefix run (construct + call
      // spawn()) before the second call is issued.
      await Promise.resolve();
      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);

      const secondInit = coordinator.initialize(scanners);
      await Promise.resolve();
      await Promise.resolve();

      // Still only one subprocess, and it was never shut down as a side
      // effect of the second call.
      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);
      expect(pendingMock.shutdown).not.toHaveBeenCalled();

      resolveSpawn();
      await firstInit;
      await secondInit;

      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);
      expect(coordinator.hasWorker('scanner-1')).toBe(true);
    });

    it('addScanner() racing an in-flight initialize() for the same id spawns exactly one subprocess', async () => {
      const coordinator = await createCoordinator();
      const scanners = makeScanners(1); // scanner-1

      const { mock: pendingMock, resolveSpawn } =
        createPendingMockSubprocess('scanner-1');
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(
          pendingMock as unknown as ReturnType<typeof createMockSubprocess>
        );
        return pendingMock as unknown as ScannerSubprocess;
      });

      const initPromise = coordinator.initialize(scanners);
      await Promise.resolve();
      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);

      // addScanner() does not go through initialize()'s queue — it calls
      // the same shared spawnSingleScanner() choke point directly, so
      // this only proves the guard if it's keyed at that shared choke
      // point (Layer B), not merely at initialize() itself.
      const addPromise = coordinator.addScanner({
        scannerId: 'scanner-1',
        saneName: 'epkowa:interpreter:001:002',
        plates: [],
      });
      await Promise.resolve();
      await Promise.resolve();

      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);
      expect(pendingMock.shutdown).not.toHaveBeenCalled();

      resolveSpawn();
      await initPromise;
      await addPromise;

      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);
      expect(coordinator.hasWorker('scanner-1')).toBe(true);
    });

    it('two concurrent addScanner() calls for a new id while idle spawn exactly one subprocess', async () => {
      const coordinator = await createCoordinator();

      const { mock: pendingMock, resolveSpawn } =
        createPendingMockSubprocess('scanner-new');
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(
          pendingMock as unknown as ReturnType<typeof createMockSubprocess>
        );
        return pendingMock as unknown as ScannerSubprocess;
      });

      const config: ScannerConfig = {
        scannerId: 'scanner-new',
        saneName: 'epkowa:interpreter:001:002',
        plates: [],
      };

      const add1 = coordinator.addScanner(config);
      const add2 = coordinator.addScanner(config);
      await Promise.resolve();
      await Promise.resolve();

      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);
      expect(pendingMock.shutdown).not.toHaveBeenCalled();

      resolveSpawn();
      await add1;
      await add2;

      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);
      expect(coordinator.hasWorker('scanner-new')).toBe(true);
    });

    it('concurrent initialize() calls with DIFFERENT scanner lists do not race preamble state, and neither list is dropped', async () => {
      const coordinator = await createCoordinator();

      const pendingA = createPendingMockSubprocess('scanner-a');
      const pendingB = createPendingMockSubprocess('scanner-b');
      vi.mocked(ScannerSubprocess)
        .mockImplementationOnce(() => {
          createdSubprocesses.push(
            pendingA.mock as unknown as ReturnType<typeof createMockSubprocess>
          );
          return pendingA.mock as unknown as ScannerSubprocess;
        })
        .mockImplementationOnce(() => {
          createdSubprocesses.push(
            pendingB.mock as unknown as ReturnType<typeof createMockSubprocess>
          );
          return pendingB.mock as unknown as ScannerSubprocess;
        });

      const initA = coordinator.initialize([
        {
          scannerId: 'scanner-a',
          saneName: 'epkowa:interpreter:001:002',
          plates: [],
        },
      ]);
      await Promise.resolve();
      // The second call is issued while the first is still in flight
      // (scanner-a's spawn() has not resolved) — a naive implementation
      // that runs both bodies concurrently would race initErrors.clear()
      // and the stale-subprocess cleanup loop.
      const initB = coordinator.initialize([
        {
          scannerId: 'scanner-b',
          saneName: 'epkowa:interpreter:001:003',
          plates: [],
        },
      ]);
      await Promise.resolve();
      await Promise.resolve();

      // The second call's doInitialize() body (and its own initErrors
      // clear) must not have started yet — scanner-b's subprocess is not
      // constructed until scanner-a's entire initialize() run completes.
      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);

      pendingA.resolveSpawn();
      await initA;

      // Only now should the second call's own doInitialize() run.
      pendingB.resolveSpawn();
      await initB;

      expect(ScannerSubprocess).toHaveBeenCalledTimes(2);
      // The critical anti-vacuity assertion (round-2 review finding): a
      // memoized-single-promise implementation would have handed initB
      // the SAME promise as initA and never spawned scanner-b at all.
      // Only a serialization queue passes this. (scanner-a is correctly
      // torn down by initB's own stale-subprocess cleanup, since it's not
      // in scannersB's list — that's initialize()'s pre-existing,
      // intentional "fully replace the roster" semantics, not a bug.)
      expect(coordinator.hasWorker('scanner-b')).toBe(true);
    });

    it('stopScanner() clears an in-flight spawn so a subsequent addScanner() starts fresh instead of hanging', async () => {
      // Fake timers: the original in-flight attempt this test orphans
      // only ever settles via the spawn-ready timeout (its spawn()
      // promise is never resolved/rejected) — without fake timers that
      // would leave a real ~45s timer running past the end of this test.
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      const scanners = makeScanners(1); // scanner-1

      const { mock: pendingMock } = createPendingMockSubprocess('scanner-1');
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(
          pendingMock as unknown as ReturnType<typeof createMockSubprocess>
        );
        return pendingMock as unknown as ScannerSubprocess;
      });

      const initPromise = coordinator.initialize(scanners);
      await Promise.resolve();
      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);

      // Operator retries while scanner-1 is still mid-connect — this is
      // retryScanner()'s exact sequence: stopScanner() then addScanner().
      await coordinator.stopScanner('scanner-1');

      const { mock: freshMock } = createPendingMockSubprocess('scanner-1');
      freshMock.isReady = true;
      vi.mocked(freshMock.spawn).mockResolvedValue(undefined);
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(
          freshMock as unknown as ReturnType<typeof createMockSubprocess>
        );
        return freshMock as unknown as ScannerSubprocess;
      });

      const addPromise = coordinator.addScanner({
        scannerId: 'scanner-1',
        saneName: 'epkowa:interpreter:001:002',
        plates: [],
      });

      // Must resolve promptly — NOT be joined to the original,
      // now-orphaned in-flight spawn, and NOT wait for the spawn-ready
      // timeout to elapse.
      await addPromise;

      expect(ScannerSubprocess).toHaveBeenCalledTimes(2);
      expect(coordinator.hasWorker('scanner-1')).toBe(true);

      // The orphaned original attempt is left to resolve on its own in
      // the background (design.md's accepted residual limitation) — this
      // test only needs to prove the retry itself was prompt, so it must
      // NOT await `initPromise` to completion (it may not settle at all
      // until the spawn-ready timeout exists / fires, which would hang
      // this test rather than fail it cleanly if awaited unconditionally).
      void initPromise.catch(() => {});

      vi.useRealTimers();
    });

    it('addScanner() racing a concurrent stopScanner() for the same id spawns a fresh worker instead of silently dropping it', async () => {
      // Regression test for a bug found in review: ScannerSubprocess.isReady
      // stays `true` for the entire multi-second shutdown() grace window
      // (it only flips once the real OS process exits), so a naive
      // stopScanner() that deletes the map entry only AFTER awaiting
      // shutdown() lets a concurrent addScanner()'s hasWorker() check see
      // the doomed instance as still healthy and no-op — silently dropping
      // the scanner with zero error ever surfaced. The fix: stopScanner()
      // removes the map entry BEFORE awaiting shutdown.
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1)); // scanner-1, ready
      const oldSub = createdSubprocesses[0];

      // Make shutdown() slow (never resolving within this test) so the
      // race window is observable.
      let resolveShutdown: (v: boolean) => void = () => {};
      vi.mocked(oldSub.shutdown).mockReturnValue(
        new Promise<boolean>((resolve) => {
          resolveShutdown = resolve;
        })
      );

      const stopPromise = coordinator.stopScanner('scanner-1');
      // stopScanner()'s synchronous prefix (clearing spawnInFlight and
      // deleting the map entry) has already run by the time the above
      // call returns its promise — no microtask flush needed for that
      // part, only for what follows.

      const freshMock = createMockSubprocess('scanner-1');
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(freshMock);
        return freshMock as unknown as ScannerSubprocess;
      });

      await coordinator.addScanner({
        scannerId: 'scanner-1',
        saneName: 'epkowa:interpreter:001:002',
        plates: [],
      });

      // The scanner must NOT have silently vanished — a fresh subprocess
      // was constructed and is ready, not left as a no-op.
      expect(ScannerSubprocess).toHaveBeenCalledTimes(2);
      expect(coordinator.hasWorker('scanner-1')).toBe(true);

      resolveShutdown(true);
      await stopPromise;
    });
  });

  describe('bounded spawn-ready timeout with no-duplicate reclaim (design.md Decisions 2 & 3)', () => {
    it('a spawn attempt that never confirms readiness triggers a reclaim, reports a distinguishable timeout message, and does not spawn a duplicate', async () => {
      vi.useFakeTimers();
      const coordinator = await createCoordinator();
      const scanners = makeScanners(1); // scanner-1

      const { mock: pendingMock } = createPendingMockSubprocess('scanner-1');
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(
          pendingMock as unknown as ReturnType<typeof createMockSubprocess>
        );
        return pendingMock as unknown as ScannerSubprocess;
      });

      const initStatus = vi.fn();
      coordinator.on('scanner-init-status', initStatus);

      const initPromise = coordinator.initialize(scanners);
      await Promise.resolve();

      await vi.advanceTimersByTimeAsync(SPAWN_READY_TIMEOUT_MS + 1000);
      await initPromise;

      // Reclaim was attempted.
      expect(pendingMock.shutdown).toHaveBeenCalled();
      // No duplicate spawn.
      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);
      expect(coordinator.hasWorker('scanner-1')).toBe(false);

      // The reported message names this as a timeout, distinguishable
      // from an immediate spawn failure's message.
      expect(initStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          scannerId: 'scanner-1',
          status: 'error',
          error: expect.stringMatching(/timeout/i),
        })
      );
      const errorCall = initStatus.mock.calls.find(
        ([e]) => e.status === 'error'
      );
      expect(errorCall![0].error).toContain(String(SPAWN_READY_TIMEOUT_MS));

      // Written via scanLog() (durable in a packaged app), not just
      // console — scientific-rigor review finding.
      expect(scanLog).toHaveBeenCalledWith(expect.stringMatching(/timeout/i));

      vi.useRealTimers();
    });

    it('produces the same no-duplicate outcome regardless of whether the reclaim shutdown confirms exit', async () => {
      vi.useFakeTimers();
      const coordinator = await createCoordinator();
      const scanners = makeScanners(1);

      const { mock: pendingMock } = createPendingMockSubprocess('scanner-1');
      vi.mocked(pendingMock.shutdown).mockResolvedValue(false);
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(
          pendingMock as unknown as ReturnType<typeof createMockSubprocess>
        );
        return pendingMock as unknown as ScannerSubprocess;
      });

      const initStatus = vi.fn();
      coordinator.on('scanner-init-status', initStatus);

      const initPromise = coordinator.initialize(scanners);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(SPAWN_READY_TIMEOUT_MS + 1000);
      await initPromise;

      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);
      expect(coordinator.hasWorker('scanner-1')).toBe(false);
      expect(initStatus).toHaveBeenCalledWith(
        expect.objectContaining({ scannerId: 'scanner-1', status: 'error' })
      );

      vi.useRealTimers();
    });

    it('does not produce an unhandled rejection when the abandoned spawn() promise settles after the timeout wins the race', async () => {
      vi.useFakeTimers();
      const coordinator = await createCoordinator();
      const scanners = makeScanners(1);

      const { mock: pendingMock, rejectSpawn } =
        createPendingMockSubprocess('scanner-1');
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(
          pendingMock as unknown as ReturnType<typeof createMockSubprocess>
        );
        return pendingMock as unknown as ScannerSubprocess;
      });

      const initPromise = coordinator.initialize(scanners);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(SPAWN_READY_TIMEOUT_MS + 1000);
      await initPromise;

      // Switch to real timers: Node's unhandled-rejection detector fires
      // on a genuine event-loop tick, which fake timers/macrotasks do not
      // reliably simulate — a fake-timer version of this assertion could
      // pass vacuously regardless of whether the fix is correct.
      vi.useRealTimers();

      const unhandled = vi.fn();
      process.on('unhandledRejection', unhandled);
      try {
        // Simulate the original spawn() promise settling late — e.g. the
        // real ScannerSubprocess's exit/process-error listeners firing
        // after reclaimUnresponsive()'s kill(), well after this attempt
        // was abandoned by the timeout race.
        rejectSpawn(new Error('late failure after abandonment'));
        await new Promise((r) => setImmediate(r));
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });

    it('an immediate spawn failure and a spawn-ready timeout produce distinguishable initErrors messages', async () => {
      vi.useFakeTimers();
      const coordinator = await createCoordinator();

      // Scanner A: fails immediately (ENOENT-style).
      const scannerA = makeScanners(1)[0];
      vi.mocked(ScannerSubprocess).mockImplementationOnce(
        (_pythonPath, _isPackaged, scannerId) => {
          const mock = createMockSubprocess(scannerId as string);
          mock.spawn.mockRejectedValue(new Error('spawn ENOENT'));
          createdSubprocesses.push(mock);
          return mock as unknown as ScannerSubprocess;
        }
      );
      const initStatusA = vi.fn();
      const coordinatorA = coordinator;
      coordinatorA.on('scanner-init-status', initStatusA);
      await coordinatorA.initialize([scannerA]);

      // Scanner B: never confirms readiness (spawn-ready timeout).
      const { mock: pendingMock } = createPendingMockSubprocess('scanner-b');
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(
          pendingMock as unknown as ReturnType<typeof createMockSubprocess>
        );
        return pendingMock as unknown as ScannerSubprocess;
      });
      const initPromiseB = coordinatorA.initialize([
        {
          scannerId: 'scanner-b',
          saneName: 'epkowa:interpreter:001:009',
          plates: [],
        },
      ]);
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(SPAWN_READY_TIMEOUT_MS + 1000);
      await initPromiseB;

      const messageA = initStatusA.mock.calls.find(
        ([e]) => e.scannerId === scannerA.scannerId && e.status === 'error'
      )![0].error as string;
      const messageB = initStatusA.mock.calls.find(
        ([e]) => e.scannerId === 'scanner-b' && e.status === 'error'
      )![0].error as string;

      expect(messageA).not.toMatch(/timeout/i);
      expect(messageB).toMatch(/timeout/i);
      expect(messageA).not.toBe(messageB);

      vi.useRealTimers();
    });

    it('an orphaned reclaim does not evict or falsely fail-report a healthy replacement installed by a concurrent retry', async () => {
      // BLOCKING regression test from review: reclaimUnresponsive() used to
      // delete this.subprocesses / report initErrors unconditionally by
      // scannerId. If stopScanner()+addScanner() successfully installed a
      // healthy replacement while the original attempt was orphaned
      // (design.md's accepted residual limitation — the original attempt
      // keeps running in the background until its own timeout), the
      // orphaned attempt's eventual reclaim would otherwise silently evict
      // the healthy replacement and falsely report it as failed.
      vi.useFakeTimers();
      const coordinator = await createCoordinator();
      const scanners = makeScanners(1); // scanner-1

      const { mock: pendingMock } = createPendingMockSubprocess('scanner-1');
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(
          pendingMock as unknown as ReturnType<typeof createMockSubprocess>
        );
        return pendingMock as unknown as ScannerSubprocess;
      });

      const orphanedInit = coordinator.initialize(scanners);
      await Promise.resolve();
      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);

      // Operator retries while scanner-1 is still mid-connect.
      await coordinator.stopScanner('scanner-1');

      const freshMock = createMockSubprocess('scanner-1');
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(freshMock);
        return freshMock as unknown as ScannerSubprocess;
      });
      await coordinator.addScanner({
        scannerId: 'scanner-1',
        saneName: 'epkowa:interpreter:001:002',
        plates: [],
      });
      expect(coordinator.hasWorker('scanner-1')).toBe(true); // fresh, healthy

      const initStatus = vi.fn();
      coordinator.on('scanner-init-status', initStatus);

      // Let the ORIGINAL orphaned attempt's own spawn-ready timeout fire.
      await vi.advanceTimersByTimeAsync(SPAWN_READY_TIMEOUT_MS + 1000);
      await orphanedInit;

      // The healthy replacement must survive untouched — not evicted, not
      // falsely reported as failed.
      expect(coordinator.hasWorker('scanner-1')).toBe(true);
      expect(initStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ scannerId: 'scanner-1', status: 'error' })
      );

      vi.useRealTimers();
    });
  });

  describe('all shutdown() call sites act on the confirmed/unconfirmed signal (design.md Decision 3)', () => {
    it("initialize()'s stale-subprocess cleanup logs a warning when shutdown cannot confirm exit", async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(2));
      const sub2 = createdSubprocesses[1];
      vi.mocked(sub2.shutdown).mockResolvedValue(false);

      const warnSpy = vi.spyOn(console, 'warn');

      // Re-initialize with only scanner-1 — scanner-2 is now stale.
      await coordinator.initialize(makeScanners(1));

      expect(sub2.shutdown).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('scanner-2')
      );
    });

    it('stopScanner() logs a warning when shutdown cannot confirm exit, but still resolves and removes the entry', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));
      const sub = createdSubprocesses[0];
      vi.mocked(sub.shutdown).mockResolvedValue(false);

      const warnSpy = vi.spyOn(console, 'warn');

      await coordinator.stopScanner('scanner-1');

      expect(coordinator.hasWorker('scanner-1')).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('scanner-1')
      );
    });

    it('the bulk shutdown() method logs a warning identifying only the scanner whose exit could not be confirmed', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(2));
      const sub1 = createdSubprocesses[0];
      const sub2 = createdSubprocesses[1];
      vi.mocked(sub2.shutdown).mockResolvedValue(false);

      const warnSpy = vi.spyOn(console, 'warn');

      await coordinator.shutdown();

      expect(sub1.shutdown).toHaveBeenCalled();
      expect(sub2.shutdown).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('scanner-2')
      );
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('scanner-1')
      );
    });

    it('the bulk shutdown() method does not report a spurious init failure for a subprocess still mid-spawn', async () => {
      // IMPORTANT regression test from review: bulk shutdown() used to
      // call sub.shutdown() without first removing listeners, unlike
      // every other teardown path (stopScanner(), the defensive
      // fallback). A subprocess still mid-connect has its own spawn()-
      // internal 'exit' listener still attached; without removeAllListeners()
      // first, force-killing it during a bulk shutdown made that listener
      // reject with "process exited before becoming ready", which the
      // generic catch branch then reported as a spurious init-failure —
      // right after a clean, deliberate app shutdown/cancel.
      const coordinator = await createCoordinator();
      const scanners = makeScanners(1);

      const { mock: pendingMock } = createPendingMockSubprocess('scanner-1');
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(
          pendingMock as unknown as ReturnType<typeof createMockSubprocess>
        );
        return pendingMock as unknown as ScannerSubprocess;
      });

      const initStatus = vi.fn();
      const initPromise = coordinator.initialize(scanners);
      await Promise.resolve();
      coordinator.on('scanner-init-status', initStatus);
      initStatus.mockClear(); // ignore the earlier 'starting' event

      await coordinator.shutdown();

      expect(pendingMock.removeAllListeners).toHaveBeenCalled();
      expect(initStatus).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error' })
      );

      // Settle the still-pending initialize() call so it doesn't leak
      // into a later test as an unresolved promise.
      void initPromise.catch(() => {});
    });

    it('the defensive respawn-branch fallback logs a warning when its own reclaim shutdown cannot confirm exit', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));
      const staleSub = createdSubprocesses[0];
      staleSub.isReady = false;
      vi.mocked(staleSub.shutdown).mockResolvedValue(false);

      const warnSpy = vi.spyOn(console, 'warn');

      await coordinator.addScanner({
        scannerId: 'scanner-1',
        saneName: 'epkowa:interpreter:001:002',
        plates: [],
      });

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'defensive-fallback shutdown could not be confirmed'
        )
      );
      expect(coordinator.hasWorker('scanner-1')).toBe(true);
    });

    it('the defensive respawn-branch fallback still shuts down and respawns if the guard invariant is ever violated, logging loudly', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));
      const staleSub = createdSubprocesses[0];
      // Force the invariant-violation condition directly: a not-ready
      // subprocess left in the map with no in-flight guard entry. Normal
      // operation can no longer reach this after the Layer B guard, so it
      // must be constructed by hand to exercise the fallback path itself.
      staleSub.isReady = false;

      const errorSpy = vi.spyOn(console, 'error');

      await coordinator.addScanner({
        scannerId: 'scanner-1',
        saneName: 'epkowa:interpreter:001:002',
        plates: [],
      });

      expect(staleSub.shutdown).toHaveBeenCalled();
      expect(ScannerSubprocess).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('INVARIANT VIOLATION')
      );
      expect(coordinator.hasWorker('scanner-1')).toBe(true);
    });
  });

  describe('scanOnce()', () => {
    it('emits grid-start, grid-complete, and cycle-complete events', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      // When scan() is called, immediately emit cycle-done
      sub.scan.mockImplementation(() => {
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const gridStart = vi.fn();
      const gridComplete = vi.fn();
      const cycleComplete = vi.fn();
      coordinator.on('grid-start', gridStart);
      coordinator.on('grid-complete', gridComplete);
      coordinator.on('cycle-complete', cycleComplete);

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      expect(gridStart).toHaveBeenCalled();
      expect(gridComplete).toHaveBeenCalled();
      expect(cycleComplete).toHaveBeenCalledWith(
        expect.objectContaining({ cycle: 1 })
      );

      // grid-complete no longer carries rename bookkeeping — the Python
      // worker writes the final filename directly, so there is nothing to
      // rename and nothing to report here.
      const gridCompletePayload = gridComplete.mock.calls[0][0];
      expect(gridCompletePayload).not.toHaveProperty('renamedFiles');
      expect(gridCompletePayload).not.toHaveProperty('renameErrors');
    });

    it('emits scan-started (not scan-event) with jobId/scannerId/plateIndex/cycle_number/scan_started_at (task 10.1)', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        sub.emit('event', {
          type: 'scan-started',
          scanner_id: 'scanner-1',
          plate_index: '00',
        });
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const scanStarted = vi.fn();
      const scanEvent = vi.fn();
      coordinator.on('scan-started', scanStarted);
      coordinator.on('scan-event', scanEvent);

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      expect(scanStarted).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'scanner-1:00',
          scannerId: 'scanner-1',
          plateIndex: '00',
          cycle_number: 1,
          scan_started_at: expect.any(String),
        })
      );
      // scan-event (the old generic bus) must never fire (design.md
      // Decision 2 — replaced, not add-alongside).
      expect(scanEvent).not.toHaveBeenCalled();
    });

    it('emits scan-complete with jobId/scannerId/plateIndex/path and achieved_resolution when present (task 10.2)', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        sub.emit('event', {
          type: 'scan-complete',
          scanner_id: 'scanner-1',
          plate_index: '00',
          path: '/tmp/out.tif',
          achieved_resolution: 400,
        });
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const scanComplete = vi.fn();
      coordinator.on('scan-complete', scanComplete);

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      expect(scanComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'scanner-1:00',
          scannerId: 'scanner-1',
          plateIndex: '00',
          path: '/tmp/out.tif',
          achieved_resolution: 400,
        })
      );
    });

    it('emits scan-error (subprocess-originated) with jobId/scannerId/plateIndex/error/bytes_received/wall_seconds (task 10.3)', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        sub.emit('event', {
          type: 'scan-error',
          scanner_id: 'scanner-1',
          plate_index: '00',
          error: 'SANE IO error',
          bytes_received: 0,
          wall_seconds: 12,
        });
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const scanError = vi.fn();
      coordinator.on('scan-error', scanError);

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      expect(scanError).toHaveBeenCalledWith(
        expect.objectContaining({
          jobId: 'scanner-1:00',
          scannerId: 'scanner-1',
          plateIndex: '00',
          error: 'SANE IO error',
          bytes_received: 0,
          wall_seconds: 12,
        })
      );
    });

    it('regex path rewriting only affects filename, not directory', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      let capturedPlates: PlateConfig[] = [];
      sub.scan.mockImplementation((plates: PlateConfig[]) => {
        capturedPlates = plates;
        setImmediate(() => sub.emit('cycle-done', {}));
      });

      // Create plates with a date-like directory path
      const inputOutputPath =
        '/scans/20260410T000000/exp1_st_20260410T120000_cy1_S1_00.tif';
      const platesMap = new Map<string, PlateConfig[]>();
      platesMap.set('scanner-1', [
        {
          plate_index: '00',
          grid_mode: '2grid' as const,
          resolution: 600,
          // Directory contains 20260410T000000 which matches \d{8}T\d{6}
          output_path: inputOutputPath,
        },
      ]);

      const scanPromise = coordinator.scanOnce(platesMap);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      // The directory portion should NOT have been modified. The production
      // code rebuilds the path via path.join(dir, basename), which
      // normalizes separators to the host OS's — path.normalize the
      // expected dirname the same way, rather than hardcoding a POSIX
      // literal, so this passes on Windows too.
      expect(path.dirname(capturedPlates[0].output_path)).toBe(
        path.normalize(path.dirname(inputOutputPath))
      );
      // The filename portion SHOULD have the new timestamp
      expect(capturedPlates[0].output_path).not.toContain('st_20260410T120000');

      vi.useRealTimers();
    });

    it('forwarded scan-complete does not include scan_ended_at before row completes (task 10.2a — retargeted from scan-event)', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      // Emit a scan-complete event BEFORE cycle-done
      sub.scan.mockImplementation(() => {
        // Emit scan-complete first (individual plate done)
        sub.emit('event', {
          type: 'scan-complete',
          scanner_id: 'scanner-1',
          plate_index: '00',
          path: '/tmp/out.tif',
        });
        // Then cycle-done (all plates for this scanner done)
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const scanComplete = vi.fn();
      coordinator.on('scan-complete', scanComplete);

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      // The forwarded scan-complete should include scan_started_at but
      // NOT scan_ended_at (it's unknown until the row completes).
      expect(scanComplete).toHaveBeenCalled();
      const firstCall = scanComplete.mock.calls[0][0];
      expect(firstCall).toHaveProperty('scan_started_at');
      expect(firstCall).not.toHaveProperty('scan_ended_at');
    });

    it('logs USB stagger delay between scanners', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(2));

      const sub1 = createdSubprocesses[0];
      const sub2 = createdSubprocesses[1];

      // Both emit cycle-done after scan
      sub1.scan.mockImplementation(() => {
        setImmediate(() => sub1.emit('cycle-done', {}));
      });
      sub2.scan.mockImplementation(() => {
        setImmediate(() => sub2.emit('cycle-done', {}));
      });

      const platesMap = makePlatesMap(['scanner-1', 'scanner-2']);
      const scanPromise = coordinator.scanOnce(platesMap);

      // Advance through stagger delays + row timeouts
      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      // scanLog should have been called for stagger delay
      expect(scanLog).toHaveBeenCalledWith(expect.stringContaining('stagger'));

      vi.useRealTimers();
    });

    it('verifies file existence after scan-complete', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation((plates: PlateConfig[]) => {
        emitScanCompleteForPlates(sub, plates);
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      // fs.promises.access should have been called to verify output files —
      // using the real path from the scan-complete event, not a
      // coordinator-predicted one.
      expect(fs.promises.access).toHaveBeenCalled();
    });

    it('verifies the path reported by scan-complete, not the path it sent', async () => {
      // The Python worker now composes the final filename (with _et_)
      // itself at save time, so it can legitimately report a DIFFERENT
      // path than the one the coordinator sent via sub.scan(). The
      // coordinator must verify (and later use) the real reported path.
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      const sentPath = '/tmp/scan_st_20260410T120000_cy1_S1_00.tif';
      const realFinalPath =
        '/tmp/scan_st_20260410T120000_et_20260410T120530_cy1_S1_00.tif';

      sub.scan.mockImplementation(() => {
        sub.emit('scan-complete', {
          type: 'scan-complete',
          scanner_id: 'scanner-1',
          plate_index: '00',
          path: realFinalPath,
        });
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const platesMap = new Map<string, PlateConfig[]>();
      platesMap.set('scanner-1', [
        {
          plate_index: '00',
          grid_mode: '2grid',
          resolution: 600,
          output_path: sentPath,
        },
      ]);

      await coordinator.scanOnce(platesMap);

      // Verification ran against the reported final path, not the sent one.
      expect(fs.promises.access).toHaveBeenCalledWith(realFinalPath);
      expect(fs.promises.access).not.toHaveBeenCalledWith(sentPath);
    });

    it('emits scan-error when stat rejects (filesystem race) with a per-plate jobId (task 10.5a — the 4th direct emit site)', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation((plates: PlateConfig[]) => {
        emitScanCompleteForPlates(sub, plates);
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      // File exists but stat rejects (e.g., permissions, race condition)
      vi.mocked(fs.promises.stat).mockRejectedValue(
        new Error('EACCES: permission denied')
      );

      const scanError = vi.fn();
      coordinator.on('scan-error', scanError);

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      expect(scanError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Cannot stat'),
          jobId: 'scanner-1:00',
        })
      );
    });

    it('handles partial scanner failure mid-grid', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(2));

      const sub1 = createdSubprocesses[0];
      const sub2 = createdSubprocesses[1];

      // sub1 completes normally
      sub1.scan.mockImplementation(() => {
        setImmediate(() => sub1.emit('cycle-done', {}));
      });
      // sub2 exits (crash)
      sub2.scan.mockImplementation(() => {
        setImmediate(() => sub2.emit('exit', {}));
      });

      const cycleComplete = vi.fn();
      coordinator.on('cycle-complete', cycleComplete);

      const platesMap = makePlatesMap(['scanner-1', 'scanner-2']);
      const scanPromise = coordinator.scanOnce(platesMap);

      // Advance through stagger delays + row timeouts
      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      // Should still complete the cycle
      expect(cycleComplete).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('skips file verification after cancel during active row', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        // Cancel while the scan is "in progress" — then emit cycle-done
        coordinator.cancelAll();
        setImmediate(() => sub.emit('cycle-done', {}));
      });

      // Reset fs mocks to track calls during this specific test
      vi.mocked(fs.promises.access).mockClear();

      const platesMap = makePlatesMap(['scanner-1']);
      const scanPromise = coordinator.scanOnce(platesMap);

      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      // After cancel, file verification (access) should NOT run
      // for the cancelled row
      expect(fs.promises.access).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('emits scan-error and proceeds when subprocess does not respond within row timeout (jobId is the bare scannerId — task 10.4)', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      // Subprocess never emits cycle-done or exit — simulates a hang
      sub.scan.mockImplementation(() => {
        // intentionally do nothing
      });

      const scanError = vi.fn();
      coordinator.on('scan-error', scanError);
      const cycleComplete = vi.fn();
      coordinator.on('cycle-complete', cycleComplete);

      const platesMap = makePlatesMap(['scanner-1']);
      const scanPromise = coordinator.scanOnce(platesMap);

      // Advance past row timeouts for all row groups (2 rows for 2grid)
      // Each row has a 90s timeout
      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      // Should have emitted scan-error for the timed-out subprocess, with
      // jobId equal to the bare scannerId — no single plateIndex applies
      // to a whole-row timeout (task 10.4).
      expect(scanError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('timeout'),
          jobId: 'scanner-1',
        })
      );
      // Should still complete the cycle (not hang forever)
      expect(cycleComplete).toHaveBeenCalled();

      vi.useRealTimers();
    }, 15000);

    it('never emits scan-event across a run with a success, a subprocess-originated error, and a verification failure (task 10.6)', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      let rowCount = 0;
      sub.scan.mockImplementation((plates: PlateConfig[]) => {
        rowCount++;
        if (rowCount === 1) {
          // Row 1 (plates 00 + 01, 4grid top row): the worker succeeds
          // for both. Plate 00 will verify cleanly (success); plate 01's
          // file will fail verification below. The real ScannerSubprocess
          // emits both the specific channel (for row-completion tracking)
          // and the generic 'event' channel (for per-job forwarding) —
          // mirrored here so this test exercises real forwarding, not a
          // vacuous pass from never touching 'event' at all.
          for (const plate of plates) {
            const evt = {
              type: 'scan-complete',
              scanner_id: 'scanner-1',
              plate_index: plate.plate_index,
              path: plate.output_path,
            };
            sub.emit('scan-complete', evt);
            sub.emit('event', evt);
          }
        } else {
          // Row 2 (plates 10 + 11, 4grid bottom row): the worker itself
          // reports a scan-error for 10 — no scan-complete at all for
          // that plate. Plate 11 succeeds normally.
          sub.emit('event', {
            type: 'scan-error',
            scanner_id: 'scanner-1',
            plate_index: '10',
            error: 'worker-originated failure',
            bytes_received: 0,
            wall_seconds: 1,
          });
          const okPlate = plates.find((p) => p.plate_index === '11');
          if (okPlate) {
            const evt = {
              type: 'scan-complete',
              scanner_id: 'scanner-1',
              plate_index: okPlate.plate_index,
              path: okPlate.output_path,
            };
            sub.emit('scan-complete', evt);
            sub.emit('event', evt);
          }
        }
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      // Plate 01's output file fails verification (access rejects); all
      // other plates verify cleanly — a real, non-vacuous success case.
      vi.mocked(fs.promises.access).mockImplementation((p) =>
        String(p).includes('_01.tif')
          ? Promise.reject(new Error('ENOENT'))
          : Promise.resolve(undefined)
      );

      const scanEvent = vi.fn();
      coordinator.on('scan-event', scanEvent);

      const platesMap = makePlatesMap(['scanner-1'], '4grid');
      await coordinator.scanOnce(platesMap);

      expect(scanEvent).not.toHaveBeenCalled();
    });
  });

  describe('async FS operations', () => {
    it('emits scan-error when file is missing (access rejects)', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation((plates: PlateConfig[]) => {
        emitScanCompleteForPlates(sub, plates);
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      // File does not exist
      vi.mocked(fs.promises.access).mockRejectedValue(
        new Error('ENOENT: no such file or directory')
      );

      const scanError = vi.fn();
      coordinator.on('scan-error', scanError);

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      expect(scanError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Output file missing'),
          jobId: 'scanner-1:00',
        })
      );
    });

    it('emits scan-error for zero-size file with a per-plate jobId (task 10.5)', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation((plates: PlateConfig[]) => {
        emitScanCompleteForPlates(sub, plates);
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      vi.mocked(fs.promises.stat).mockResolvedValue({ size: 0 } as fs.Stats);

      const scanError = vi.fn();
      coordinator.on('scan-error', scanError);

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      expect(scanError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('zero-size'),
          jobId: 'scanner-1:00',
        })
      );
    });

    it('logs grid-complete events via scanLog', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      expect(scanLog).toHaveBeenCalledWith(
        expect.stringMatching(/grid.*complete/i)
      );
    });
  });

  describe('scanInterval()', () => {
    it('repeats at interval and stops after duration', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const intervalStart = vi.fn();
      const intervalComplete = vi.fn();
      coordinator.on('interval-start', intervalStart);
      coordinator.on('interval-complete', intervalComplete);

      const platesMap = makePlatesMap(['scanner-1']);
      const intervalPromise = coordinator.scanInterval(platesMap, 10000, 25000);

      // Advance through all cycles
      await vi.advanceTimersByTimeAsync(30000);
      await intervalPromise;

      expect(intervalStart).toHaveBeenCalled();
      expect(intervalComplete).toHaveBeenCalledWith(
        expect.objectContaining({
          totalCycles: 3, // ceil(25000/10000)
        })
      );
    });

    it("emits interval-waiting between cycles and scan-started at the start of each new cycle, across 2+ real cycles (review-pr round 5: the renderer's consumption of these events was previously only unit-tested via hand-fired mock events, never against a real ScanCoordinator run through multiple cycles)", async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        sub.emit('event', {
          type: 'scan-started',
          scanner_id: 'scanner-1',
          plate_index: '00',
        });
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const scanStarted = vi.fn();
      const intervalWaiting = vi.fn();
      const intervalComplete = vi.fn();
      coordinator.on('scan-started', scanStarted);
      coordinator.on('interval-waiting', intervalWaiting);
      coordinator.on('interval-complete', intervalComplete);

      const platesMap = makePlatesMap(['scanner-1']);
      // 10s interval, 20s duration => ceil(20000/10000) = 2 cycles.
      const intervalPromise = coordinator.scanInterval(platesMap, 10000, 20000);

      await vi.advanceTimersByTimeAsync(30000);
      await intervalPromise;

      expect(intervalComplete).toHaveBeenCalledWith(
        expect.objectContaining({ totalCycles: 2, cyclesCompleted: 2 })
      );
      // scan-started fires at least once per cycle (2 cycles).
      expect(scanStarted.mock.calls.length).toBeGreaterThanOrEqual(2);
      // interval-waiting fires exactly once — between cycle 1 and cycle 2,
      // not after the final cycle (which goes straight to interval-complete).
      expect(intervalWaiting).toHaveBeenCalledTimes(1);
      expect(intervalWaiting).toHaveBeenCalledWith(
        expect.objectContaining({ cycle: 1, totalCycles: 2 })
      );
    });
  });

  describe('cancelAll()', () => {
    it('cancels subprocesses and emits cancelled event', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const cancelled = vi.fn();
      coordinator.on('cancelled', cancelled);

      coordinator.cancelAll();

      expect(createdSubprocesses[0].cancel).toHaveBeenCalled();
      expect(cancelled).toHaveBeenCalled();
    });

    it('cancels during interval wait', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        setImmediate(() => sub.emit('cycle-done', {}));
      });

      const intervalComplete = vi.fn();
      coordinator.on('interval-complete', intervalComplete);

      const platesMap = makePlatesMap(['scanner-1']);
      const intervalPromise = coordinator.scanInterval(
        platesMap,
        60000, // 60s interval
        300000 // 5 min duration = 5 cycles
      );

      // Advance 1ms to let first scanOnce start, then advance through
      // row timeouts for first cycle (2 rows × 90s each)
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(91_000); // first row done
      await vi.advanceTimersByTimeAsync(91_000); // second row done
      // Now scanOnce is complete, scanInterval enters sleep(remainingMs)
      // Cancel during the sleep
      coordinator.cancelAll();
      // Advance to let scanInterval exit
      await vi.advanceTimersByTimeAsync(1000);
      await intervalPromise;

      expect(intervalComplete).toHaveBeenCalledWith(
        expect.objectContaining({ cancelled: true })
      );

      vi.useRealTimers();
    });

    it('isScanning returns false after cancelAll during interval wait', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        setImmediate(() => sub.emit('cycle-done', {}));
      });

      const platesMap = makePlatesMap(['scanner-1']);
      const intervalPromise = coordinator.scanInterval(platesMap, 10000, 30000);

      // Let first cycle complete, enter waiting phase
      await vi.advanceTimersByTimeAsync(1000);
      // Cancel during the wait
      coordinator.cancelAll();
      // Advance past the sleep
      await vi.advanceTimersByTimeAsync(15000);
      await intervalPromise;

      // B1: isScanning MUST be false after interval completes
      expect(coordinator.isScanning).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('shutdown()', () => {
    it('shuts down all subprocesses and clears map', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(2));

      await coordinator.shutdown();

      expect(createdSubprocesses[0].shutdown).toHaveBeenCalled();
      expect(createdSubprocesses[1].shutdown).toHaveBeenCalled();
      expect(coordinator.isScanning).toBe(false);
    });
  });

  describe('isScanning', () => {
    it('returns false when idle', async () => {
      const coordinator = await createCoordinator();
      expect(coordinator.isScanning).toBe(false);
    });

    it('returns true during scanning', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      let scanCallCount = 0;
      sub.scan.mockImplementation(() => {
        scanCallCount++;
        if (scanCallCount === 1) {
          // First row: delay cycle-done so we can check isScanning
          setTimeout(() => sub.emit('cycle-done', {}), 50);
        } else {
          // Subsequent rows: complete immediately
          setImmediate(() => sub.emit('cycle-done', {}));
        }
      });

      const platesMap = makePlatesMap(['scanner-1']);
      const scanPromise = coordinator.scanOnce(platesMap);

      // Give a tick for state transition
      await new Promise((r) => setTimeout(r, 10));
      expect(coordinator.isScanning).toBe(true);

      await scanPromise;
      expect(coordinator.isScanning).toBe(false);
    });
  });

  // Real-coordinator-level coverage for the exact `stopScanner()` +
  // `addScanner()` sequence the wedge-response-ui feature's
  // `retryScanner()` handler calls (session-handlers.ts). Every other
  // test of this sequence in the codebase (main-wiring, register-handlers,
  // session-handlers) exercises it against a fully mocked coordinator —
  // this describe block is the first to exercise it against the real
  // `ScanCoordinator` class, mocking only `ScannerSubprocess` beneath it.
  describe('stopScanner() + addScanner() — retry-scanner integration', () => {
    it('stopScanner() removes the worker, and addScanner() for the same id spawns a fresh subprocess while idle', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));
      expect(coordinator.hasWorker('scanner-1')).toBe(true);
      expect(createdSubprocesses).toHaveLength(1);

      await coordinator.stopScanner('scanner-1');

      expect(createdSubprocesses[0].shutdown).toHaveBeenCalled();
      expect(coordinator.hasWorker('scanner-1')).toBe(false);

      await coordinator.addScanner({
        scannerId: 'scanner-1',
        saneName: 'epkowa:interpreter:001:002',
        plates: [],
      });

      expect(ScannerSubprocess).toHaveBeenCalledTimes(2);
      expect(createdSubprocesses[1].spawn).toHaveBeenCalled();
      expect(coordinator.hasWorker('scanner-1')).toBe(true);
    });

    it('addScanner() for a retried scanner while a different scanner is mid-cycle queues until cycle-complete, then respawns', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(2)); // scanner-1, scanner-2
      expect(createdSubprocesses).toHaveLength(2);

      // Simulate auto-pause: scanner-1 wedged and was auto-stopped
      // (design.md Decision 1), leaving scanner-2 as the only one with
      // plates for this cycle.
      await coordinator.stopScanner('scanner-1');
      expect(coordinator.hasWorker('scanner-1')).toBe(false);

      const sub2 = createdSubprocesses[1];
      sub2.scan.mockImplementation(() => {
        // Delay cycle-done so isScanning is observably true while the
        // operator's Retry click (addScanner) is in flight.
        setTimeout(() => sub2.emit('cycle-done', {}), 50);
      });

      const platesMap = makePlatesMap(['scanner-2']);
      const scanPromise = coordinator.scanOnce(platesMap);

      await new Promise((r) => setTimeout(r, 10));
      expect(coordinator.isScanning).toBe(true);

      // Operator confirms "Power-Cycled & Retry" for scanner-1 while
      // scanner-2's cycle is still in flight — this is retryScanner()'s
      // exact call, `coordinator.addScanner({scannerId: 'scanner-1', ...})`.
      const retryPromise = coordinator.addScanner({
        scannerId: 'scanner-1',
        saneName: 'epkowa:interpreter:001:002',
        plates: [],
      });

      // Must NOT spawn immediately — queued until this cycle's
      // cycle-complete, per addScanner()'s documented mid-scan safety.
      expect(ScannerSubprocess).toHaveBeenCalledTimes(2);

      await scanPromise; // scanOnce() emits 'cycle-complete' before resolving
      await retryPromise;

      expect(ScannerSubprocess).toHaveBeenCalledTimes(3);
      expect(createdSubprocesses[2].scannerId).toBe('scanner-1');
      expect(createdSubprocesses[2].spawn).toHaveBeenCalled();
      expect(coordinator.hasWorker('scanner-1')).toBe(true);
    });
  });

  describe('implements ScanCoordinatorLike', () => {
    it('exposes all interface methods at runtime', async () => {
      // The `implements ScanCoordinatorLike` on the class is enforced by
      // tsc when compiling src/. This test verifies the methods exist at
      // runtime as a safety net.
      const { ScanCoordinator } = await import(
        '../../../src/main/graviscan/scan-coordinator'
      );
      const coordinator = new ScanCoordinator('/usr/bin/python3', false, false);

      // Runtime checks for interface methods
      expect(typeof coordinator.initialize).toBe('function');
      expect(typeof coordinator.scanOnce).toBe('function');
      expect(typeof coordinator.scanInterval).toBe('function');
      expect(typeof coordinator.cancelAll).toBe('function');
      expect(typeof coordinator.shutdown).toBe('function');
      expect(typeof coordinator.on).toBe('function');
      expect(typeof coordinator.isScanning).toBe('boolean');
    });
  });
});
