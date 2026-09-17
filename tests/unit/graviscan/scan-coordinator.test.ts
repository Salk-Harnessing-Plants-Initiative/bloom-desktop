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
  // Delegate to the REAL EventEmitter implementation rather than
  // `mockReturnThis()`. A no-op `removeAllListeners` is not merely a weaker
  // mock — it actively hides bugs: `stopScanner()` strips listeners before
  // awaiting shutdown, so a mock that keeps them makes a stripped listener
  // look reachable and lets a row settle in tests via a path production can
  // never take. That is exactly how the wedge-auto-pause gap went unnoticed.
  const realRemoveAllListeners = emitter.removeAllListeners.bind(emitter);
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
    removeAllListeners: vi.fn((event?: string | symbol) =>
      realRemoveAllListeners(event as string)
    ),
  });
}

// Helper to emit a scan-complete event per plate, as the real
// ScannerSubprocess does when the Python worker reports each plate's final
// (already-_et_-stamped) path. `sub` is whatever mock subprocess received
// the `scan()` call; `plates` is the array `scan()` was called with.
function emitScanCompleteForPlates(
  sub: EventEmitter & { scannerId: string },
  plates: PlateConfig[]
): void {
  for (const plate of plates) {
    // Was hardcoding `scanner_id: 'test-scanner'` regardless of which mock
    // emitted, and emitting only the specific channel. Both are fixed by
    // going through emitScanComplete().
    emitScanComplete(sub, {
      plate_index: plate.plate_index,
      path: plate.output_path,
    });
  }
}

// Emit a worker event the way production does: `ScannerSubprocess.handleLine()`
// (`scanner-subprocess.ts:443-487`) emits the SPECIFIC channel and then
// unconditionally mirrors the same payload onto the generic `'event'`
// channel. The coordinator subscribes to both — `onScanComplete` per row,
// and a persistent `sub.on('event')` relay that feeds the renderer and DB.
//
// Round 7 found that 6 of 7 emit sites used one channel only. That is the
// fifth instance of this change's recurring defect class (a mock more
// forgiving than production), one level up from the payload-shape instances
// rounds 5 and 6 fixed: two tests drove the coordinator into a
// `done`-with-an-unreported-plate state production cannot reach, which is
// also the only place the `done` diagnostic branch executed.
function emitWorkerEvent(
  sub: {
    emit: (event: string, payload: unknown) => boolean;
    scannerId: string;
  },
  type: string,
  fields: Record<string, unknown>
): void {
  const payload = { type, scanner_id: sub.scannerId, ...fields };
  sub.emit(type, payload);
  sub.emit('event', payload);
}

/** `scan-complete` as production delivers it — both channels. */
function emitScanComplete(
  sub: {
    emit: (event: string, payload: unknown) => boolean;
    scannerId: string;
  },
  fields: { plate_index: string; path: string; [k: string]: unknown }
): void {
  emitWorkerEvent(sub, 'scan-complete', {
    job_id: `${sub.scannerId}:${fields.plate_index}`,
    ...fields,
  });
}

// Emit `cycle-done` the way production does. `ScannerSubprocess` forwards
// the worker's raw parsed event (`scanner-subprocess.ts:476`), which carries
// `{ type, scanner_id, cycle }` — `scan_worker.py:404` — where `cycle` is
// incremented once per SCAN COMMAND (`scan_worker.py:387`), i.e. once per
// dispatched row, NOT once per coordinator cycle. Deriving it from
// `sub.scan.mock.calls.length` reproduces exactly that semantics and keeps
// working when a test replaces the `scan` implementation, since vi still
// records the call.
//
// Round 6 found every site emitting a bare `{}` here — the same
// mock-fidelity class as the `exit` payload round 5 fixed. `cycle-done` is
// the event that SETTLES a row, and it currently has no cycle guard, so a
// faithful payload is what makes that gap testable at all.
function emitCycleDone(sub: {
  emit: (event: string, payload: unknown) => boolean;
  scannerId: string;
  scan: { mock: { calls: unknown[] } };
}): void {
  sub.emit('cycle-done', {
    type: 'cycle-done',
    scanner_id: sub.scannerId,
    cycle: sub.scan.mock.calls.length,
  });
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
              wave_number: 1,
            },
            {
              plate_index: '01',
              grid_mode: '4grid',
              resolution: 600,
              output_path: '/tmp/scan_st_20260410T120000_cy1_S1_01.tif',
              wave_number: 1,
            },
            {
              plate_index: '10',
              grid_mode: '4grid',
              resolution: 600,
              output_path: '/tmp/scan_st_20260410T120000_cy1_S1_10.tif',
              wave_number: 1,
            },
            {
              plate_index: '11',
              grid_mode: '4grid',
              resolution: 600,
              output_path: '/tmp/scan_st_20260410T120000_cy1_S1_11.tif',
              wave_number: 1,
            },
          ]
        : [
            {
              plate_index: '00',
              grid_mode: '2grid',
              resolution: 600,
              output_path: '/tmp/scan_st_20260410T120000_cy1_S1_00.tif',
              wave_number: 1,
            },
            {
              plate_index: '01',
              grid_mode: '2grid',
              resolution: 600,
              output_path: '/tmp/scan_st_20260410T120000_cy1_S1_01.tif',
              wave_number: 1,
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

    it('a fresh initialize() right after a bulk shutdown() does not hang on an orphaned in-flight spawn guard entry left by addScanner()', async () => {
      // Real bug found by CI's graviscan-ipc.e2e.ts ("Reset All USB
      // Connections marks rows starting, then settles back to a
      // populated list") — not a unit test, a genuine regression this
      // PR introduced. Exact real trigger sequence: "Detect Scanners"
      // calls addScanner() (via the save-scanners-db IPC handler in
      // register-handlers.ts) — NOT initialize(). If that worker is
      // still mid-spawn when "Reset All USB Connections" fires
      // resetUsb()'s coordinator.shutdown() (bulk) then
      // coordinator.initialize(...), bulk shutdown()'s
      // removeAllListeners() (this file's own I2 fix) strips that
      // worker's spawn()-internal listeners, so its original
      // addScanner()-triggered spawnSingleScanner() call can now ONLY
      // settle via its own SPAWN_READY_TIMEOUT_MS bound — but bulk
      // shutdown() didn't clear spawnInFlight for that scannerId, so the
      // subsequent initialize() call for the SAME scanner got handed
      // that same orphaned, now-45s-bound promise instead of spawning
      // fresh.
      vi.useFakeTimers();
      const coordinator = await createCoordinator();
      const scannerId = 'scanner-1';
      const config: ScannerConfig = {
        scannerId,
        saneName: 'epkowa:interpreter:001:002',
        plates: [],
      };

      const { mock: pendingMock } = createPendingMockSubprocess(scannerId);
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(
          pendingMock as unknown as ReturnType<typeof createMockSubprocess>
        );
        return pendingMock as unknown as ScannerSubprocess;
      });

      // "Detect Scanners" → addScanner(), still mid-spawn.
      const orphanedAdd = coordinator.addScanner(config);
      await Promise.resolve();
      expect(ScannerSubprocess).toHaveBeenCalledTimes(1);

      // "Reset All USB Connections" → resetUsb()'s own
      // coordinator.shutdown() call, while scanner-1 is still mid-spawn.
      await coordinator.shutdown();

      // ...then resetUsb()'s own coordinator.initialize(...) call, for
      // the same scanner, must spawn a genuinely new subprocess promptly
      // — NOT hang for SPAWN_READY_TIMEOUT_MS waiting on the orphaned
      // addScanner() attempt.
      const freshMock = createMockSubprocess(scannerId);
      vi.mocked(ScannerSubprocess).mockImplementationOnce(() => {
        createdSubprocesses.push(freshMock);
        return freshMock as unknown as ScannerSubprocess;
      });
      const freshInit = coordinator.initialize([config]);
      await Promise.resolve();

      expect(ScannerSubprocess).toHaveBeenCalledTimes(2);
      await freshInit;
      expect(coordinator.hasWorker(scannerId)).toBe(true);

      void orphanedAdd.catch(() => {});
      vi.useRealTimers();
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
        process.nextTick(() => emitCycleDone(sub));
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
        process.nextTick(() => emitCycleDone(sub));
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
        process.nextTick(() => emitCycleDone(sub));
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
        process.nextTick(() => emitCycleDone(sub));
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
        setImmediate(() => emitCycleDone(sub));
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
        process.nextTick(() => emitCycleDone(sub));
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
        setImmediate(() => emitCycleDone(sub1));
      });
      sub2.scan.mockImplementation(() => {
        setImmediate(() => emitCycleDone(sub2));
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
        process.nextTick(() => emitCycleDone(sub));
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
        process.nextTick(() => emitCycleDone(sub));
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
        process.nextTick(() => emitCycleDone(sub));
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
        setImmediate(() => emitCycleDone(sub1));
      });
      // sub2 exits (crash)
      sub2.scan.mockImplementation(() => {
        setImmediate(() =>
          sub2.emit('exit', {
            scannerId: sub2.scannerId,
            code: 1,
            signal: null,
          })
        );
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

    it('logs one scanLog diagnostic per plate when a subprocess exits mid-row without a full cancellation (closes #281 item 1\'s silent-skip gap; extends "handles partial scanner failure mid-grid" above with the new diagnostic assertion)', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      // scanner-1's subprocess exits mid-row — no cycle-done, no
      // scan-complete for either plate in this row.
      sub.scan.mockImplementation(() => {
        setImmediate(() =>
          sub.emit('exit', { scannerId: sub.scannerId, code: 1, signal: null })
        );
      });

      const scanError = vi.fn();
      coordinator.on('scan-error', scanError);

      // 4grid gives this one scanner 2 plates per row group (00+01 in the
      // top row, 10+11 in the bottom row). All 4 plates must be diagnosed,
      // proving "one line per plate" (not one combined line per row) across
      // multiple rows, not just within a single one.
      //
      // The two rows get there by DIFFERENT routes, which is the point
      // (review round 5, B2). The `exit` payload here is production's
      // `{ scannerId, code, signal }`; when these tests emitted `{}`, the
      // coordinator's identity-guarded eviction at the subprocess `exit`
      // handler silently missed and the dead scanner kept receiving rows
      // that production would never have sent it. With a faithful payload:
      //   - row 00+01 exits mid-row  -> diagnosed from the row's `exit`
      //     outcome, via its unreported plates;
      //   - the scanner is then EVICTED from `this.subprocesses`, so row
      //     10+11 is never dispatched at all and has no result -> diagnosed
      //     by the end-of-row reconciliation against `platesPerScanner`.
      // Before that reconciliation existed this assertion could only ever
      // see 2 in production, and the plates of every row after the failure
      // went unrecorded at plate level.
      const platesMap = makePlatesMap(['scanner-1'], '4grid');
      const scanPromise = coordinator.scanOnce(platesMap);

      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      const exitDiagnosticCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('no completion signal received')
        );
      expect(exitDiagnosticCalls).toHaveLength(4);
      for (const plateIndex of ['00', '01', '10', '11']) {
        expect(
          exitDiagnosticCalls.some(
            ([msg]) =>
              typeof msg === 'string' &&
              msg.includes('scanner-1') &&
              msg.includes(`plate ${plateIndex}`)
          )
        ).toBe(true);
      }
      // Cycle number included, so the line is self-sufficient across a
      // multi-cycle interval session.
      expect(
        exitDiagnosticCalls.every(
          ([msg]) => typeof msg === 'string' && msg.includes('Cycle 1')
        )
      ).toBe(true);

      // No scan-error emitted as a result of this diagnostic — avoids
      // feeding a synthetic error back into wedge-detection for a scanner
      // that may already be correctly auto-paused.
      expect(scanError).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('gives a timed-out row per-plate diagnostics too, without a second scan-error (round 6 policy change)', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        // Never resolves — triggers the existing row-timeout path, which
        // already logs its own scanLog + scan-error at the moment it fires.
      });

      const scanError = vi.fn();
      coordinator.on('scan-error', scanError);

      const platesMap = makePlatesMap(['scanner-1']);
      const scanPromise = coordinator.scanOnce(platesMap);

      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      // Round 5 suppressed the per-plate line for a timed-out row on the
      // grounds that the timeout was "already fully diagnosed". Round 6
      // showed that diagnosis is row-level only — `Row scan timeout after
      // Nms` plus a scan-error carrying `jobId: scannerId`, with no plate
      // index, wave or path. That is exactly the aggregate-only shortfall
      // the per-plate line exists to fix, and a row timeout is the
      // commonest symptom of a wedged scanner, so suppressing it left the
      // hole where hardware fails most often. Both row groups time out, one
      // plate each in 2grid.
      const perPlateCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('no completion signal received')
        );
      expect(perPlateCalls).toHaveLength(2);
      for (const [msg] of perPlateCalls) {
        expect(msg).toContain('the row timed out after');
      }

      // The existing row-level timeout diagnostic still fires as before.
      const timeoutLogCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('Row scan timeout')
        );
      expect(timeoutLogCalls.length).toBeGreaterThan(0);

      // The reason round 5 excluded timeout is still honoured where it
      // actually mattered: no SECOND scan-error. A duplicate would
      // double-count into WedgeDetector's confirmedFailures, where two is
      // enough to auto-pause a scanner that was merely slow. One row-level
      // error per timed-out row, and the per-plate lines stay log-only.
      const perRowErrors = scanError.mock.calls.filter(
        ([e]) => e && e.jobId === 'scanner-1'
      );
      expect(perRowErrors).toHaveLength(2);

      vi.useRealTimers();
    }, 15000);

    it('diagnoses a row that stopScanner() ended mid-flight (the wedge auto-pause path) without waiting out the row timeout', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      // This is what wedge auto-pause actually does: wiring.ts calls
      // coordinator.stopScanner() on the wedged scanner mid-row. stopScanner()
      // strips the subprocess's listeners BEFORE awaiting shutdown, so the
      // later `exit` event can never reach the row promise — the row could
      // previously only settle via the 90s SCAN_ROW_TIMEOUT_MS, stalling
      // every other scanner's row and producing no per-plate record at all.
      sub.scan.mockImplementation(() => {
        setImmediate(() => {
          void coordinator.stopScanner('scanner-1');
        });
      });

      const scanError = vi.fn();
      coordinator.on('scan-error', scanError);

      const platesMap = makePlatesMap(['scanner-1']);
      const scanPromise = coordinator.scanOnce(platesMap);

      // Advance far LESS than SCAN_ROW_TIMEOUT_MS (90s). If the row still
      // needed the timeout to settle, this would hang instead of resolving.
      await vi.advanceTimersByTimeAsync(5_000);
      await scanPromise;

      const stopDiagnosticCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('no completion signal received') &&
            msg.includes('the scanner was stopped mid-row')
        );
      // Exactly one plate in this 2grid row group, so exactly one line —
      // a loose `> 0` would not notice a duplicate-logging regression.
      expect(stopDiagnosticCalls).toHaveLength(1);

      // The cause must name the wedge path, NOT the cancel path. Hoisting
      // the diagnostic above the cancel check (round 5, I3) made
      // `shutdown()` reach this same `stopped` outcome, so the two are now
      // distinguished by `this.cancelled` (round 6). stopScanner() never
      // sets it, so a deliberate Cancel must not be described as a wedge
      // and this must not be described as a cancellation.
      expect(stopDiagnosticCalls[0][0]).toContain('wedge auto-pause');
      expect(stopDiagnosticCalls[0][0]).not.toContain('cancelled');

      // The row must NOT have fallen through to the timeout path.
      const timeoutLogCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('Row scan timeout')
        );
      expect(timeoutLogCalls).toHaveLength(0);

      // Same rationale as the exit case: no synthetic scan-error, so a
      // scanner that is already correctly auto-paused isn't re-fed into
      // wedge detection.
      expect(scanError).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('verifies plates that already reported a path before the exit, and diagnoses only the unreported ones', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      // 4grid row group ['00','01']: plate 00 completes and reports its real
      // final path, then the worker dies before plate 01. Discarding the
      // accumulated paths here would (a) log "output presence unknown" for a
      // plate whose path is known, (b) skip its on-disk verification, and
      // (c) undercount it in the grid-complete tally.
      sub.scan.mockImplementation((plates: { plate_index: string }[]) => {
        setImmediate(() => {
          sub.emit('scan-complete', {
            plate_index: '00',
            path: '/scans/exp/wave1/scanner-1/plate_st_20260101T000000_et_20260101T000100_cy1_S1_00.tif',
          });
          void plates;
          sub.emit('exit', { scannerId: sub.scannerId, code: 1, signal: null });
        });
      });

      const platesMap = makePlatesMap(['scanner-1'], '4grid');
      const scanPromise = coordinator.scanOnce(platesMap);

      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      const diagnosticCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('no completion signal received')
        );

      // Plate 00 reported a path — it must NOT be described as unknown.
      expect(
        diagnosticCalls.some(
          ([msg]) => typeof msg === 'string' && msg.includes('plate 00')
        )
      ).toBe(false);
      // Plate 01 never reported — it must be.
      expect(
        diagnosticCalls.some(
          ([msg]) => typeof msg === 'string' && msg.includes('plate 01')
        )
      ).toBe(true);

      // And plate 00's file must have gone through real on-disk verification.
      expect(fs.promises.access).toHaveBeenCalledWith(
        '/scans/exp/wave1/scanner-1/plate_st_20260101T000000_et_20260101T000100_cy1_S1_00.tif'
      );

      // ...and must COUNT toward its grid's tally. Verifying it but not
      // counting it would report `0/1 files verified — 1 MISSING` for a grid
      // that produced and verified a real file, which makes the completeness
      // signal actively wrong in exactly the early-ending-row case it exists
      // for. (Spec: "each such plate SHALL count toward its grid's verified
      // tally".)
      const grid00Tally = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('grid 00 complete') &&
            msg.includes('files verified')
        );
      expect(grid00Tally.length).toBeGreaterThan(0);
      for (const [msg] of grid00Tally) {
        expect(msg).toContain('1/1 files verified');
        expect(msg).not.toContain('MISSING');
      }

      vi.useRealTimers();
    });

    it('still records the per-plate diagnostic when the row is ended by shutdown() (Cancel Scan / app quit) (review round 5, I3)', async () => {
      // `shutdown()` sets `this.cancelled = true` BEFORE invoking the
      // in-flight row settler, and the verification loop breaks on
      // `this.cancelled`. So while the `stopped` outcome did suppress the
      // spurious 90s row-timeout scan-error, the durable per-plate record —
      // the half this change actually claims ("including when a scanner is
      // deliberately stopped mid-row") — never fired for EITHER of the two
      // deliberate mid-row stops: Cancel Scan (session-handlers cancelScan)
      // and app quit (shutdownGraviScan). It only ever appeared on the
      // stopScanner() wedge path.
      //
      // The line is log-only and emits no scan-error, so it cannot feed
      // WedgeDetector and is safe to record on a cancelled session.
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));
      const sub = createdSubprocesses[0];

      // Worker takes the row and never reports: the session is cancelled
      // out from under it.
      sub.scan.mockImplementation(() => {});

      const platesMap = makePlatesMap(['scanner-1']);
      const scanPromise = coordinator.scanOnce(platesMap);

      // Let the row be dispatched and its listeners attach.
      await vi.advanceTimersByTimeAsync(10);
      await coordinator.shutdown();

      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      const diagnostics = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('no completion signal received')
        );

      // Exactly one: 2grid dispatches one plate per row group, and the
      // cancel `break` stops the second group. A loose `> 0` would not
      // notice a duplicate-logging regression between the row-outcome
      // diagnostic and the reconciliation, which now both run above the
      // break and both call logUnverifiedPlate().
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0][0]).toContain('plate 00');
      // And it must name the cancel, not imply a wedge.
      expect(diagnostics[0][0]).toContain('cancelled');
      expect(diagnostics[0][0]).not.toContain('wedge');

      vi.useRealTimers();
    });

    it('attributes a wedge stop to the wedge even when a cancel arrives before the row is logged (review round 7)', async () => {
      // `rowOutcomeCause()` reads `this.cancelled` at LOG time, but the
      // outcome was determined at SETTLE time, and the two are separated by
      // `await Promise.all(rowDonePromises)` — which can span the full
      // SCAN_ROW_TIMEOUT_MS while other scanners finish.
      //
      // Production interleaving: scanner-1 wedges and stopScanner() settles
      // its row as `stopped` with cancelled=false; scanner-2's row is still
      // in flight; the operator sees the wedge banner and presses Cancel,
      // which sets cancelled=true before the logging runs. Scanner-1's
      // plates — lost to a wedge — then get logged as "the session was
      // cancelled", the exact inverse of the defect round 6 fixed.
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(2));
      const sub1 = createdSubprocesses[0];
      const sub2 = createdSubprocesses[1];

      // scanner-1 wedges: its row is settled by stopScanner(), NOT by a
      // cancel. scanner-2 never reports, holding Promise.all open.
      sub1.scan.mockImplementation(() => {
        setImmediate(() => {
          void coordinator.stopScanner('scanner-1');
        });
      });
      sub2.scan.mockImplementation(() => {});

      const platesMap = makePlatesMap(['scanner-1', 'scanner-2']);
      const scanPromise = coordinator.scanOnce(platesMap);

      // Let scanner-1's row settle as `stopped` while cancelled is false...
      await vi.advanceTimersByTimeAsync(6_000);
      // ...then the operator cancels, flipping the flag before logging.
      await coordinator.shutdown();
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      const scanner1Lines = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('no completion signal received') &&
            msg.includes('[scanner-1]')
        );

      expect(scanner1Lines.length).toBeGreaterThan(0);
      for (const [msg] of scanner1Lines) {
        expect(msg).toContain('wedge auto-pause');
        expect(msg).not.toContain('cancelled');
      }

      vi.useRealTimers();
    });

    it('does not tell an operator to re-scan a plate whose scanner never received the row (review round 7)', async () => {
      // A plate reconciled because its scanner was not dispatched was never
      // sent to any worker, so no file can exist and there is nothing to go
      // and check. Emitting "Check for <path> and re-scan this plate if it
      // is absent" for it — once per plate per cycle, for the life of a
      // multi-day session — buries the records that do warrant action.
      //
      // Actionability keys on whether the plate was DISPATCHED, not on
      // `initErrors`: a worker that died mid-session is exactly as
      // un-actionable as one that never came online, and `initErrors` is
      // only populated by spawn failure.
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));
      const sub = createdSubprocesses[0];

      // 4grid: the worker dies in row group ['00','01'], is evicted, and
      // row group ['10','11'] is then never dispatched at all.
      sub.scan.mockImplementation(() => {
        setImmediate(() =>
          sub.emit('exit', {
            scannerId: sub.scannerId,
            code: 1,
            signal: null,
          })
        );
      });

      const platesMap = makePlatesMap(['scanner-1'], '4grid');
      const scanPromise = coordinator.scanOnce(platesMap);
      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      const lines = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('no completion signal received')
        )
        .map(([msg]) => msg as string);

      const dispatched = lines.filter((m) => /plate 0[01]/.test(m));
      const neverDispatched = lines.filter((m) => /plate 1[01]/.test(m));

      expect(dispatched).toHaveLength(2);
      expect(neverDispatched).toHaveLength(2);

      // Plates 00/01 WERE sent to the worker, so a partial file may exist.
      for (const m of dispatched) {
        expect(m).toContain('re-scan this plate if it is absent');
      }
      // Plates 10/11 were never sent anywhere.
      for (const m of neverDispatched) {
        expect(m).not.toContain('re-scan this plate');
        expect(m).toContain('No image was produced');
      }

      vi.useRealTimers();
    });

    it('cycle-corrects BOTH the start stamp and the cycle number on a reconciled plate (review round 7)', async () => {
      // The reconciliation rewrites the quoted path by hand because no
      // `platesToScan` exists for a scanner that received no row. It must
      // apply the same TWO rewrites the dispatch path does — the `_st_`
      // stamp as well as `_cy<N>_` — or two lines in the same cycle quote
      // different filename conventions once #370 restores stamped names.
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));
      const sub = createdSubprocesses[0];

      sub.scan.mockImplementation(() => {
        setImmediate(() =>
          sub.emit('exit', {
            scannerId: sub.scannerId,
            code: 1,
            signal: null,
          })
        );
      });

      const platesMap = makePlatesMap(['scanner-1'], '4grid');
      const scanPromise = coordinator.scanOnce(platesMap);
      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      const reconciled = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('no completion signal received') &&
            /plate 1[01]/.test(msg)
        )
        .map(([msg]) => msg as string);

      expect(reconciled.length).toBeGreaterThan(0);
      for (const m of reconciled) {
        // The fixture's `_st_20260410T120000` must have been REPLACED with
        // this row's real start stamp, exactly as a dispatched plate's is.
        expect(m).not.toContain('_st_20260410T120000');
        expect(m).toMatch(/_st_\d{8}T\d{6}/);
      }

      vi.useRealTimers();
    });

    it('names the cause when a row reports complete without a plate reporting (review round 7)', async () => {
      // The `done` branch of rowOutcomeCause() is the one round 6 added to
      // cover #371's desync, and nothing asserted it. Production emits
      // scan-complete on BOTH the specific channel and the generic 'event'
      // channel, so a faithful test that omits a plate's completion
      // entirely is the only way to reach `done` with an unreported plate.
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));
      const sub = createdSubprocesses[0];

      sub.scan.mockImplementation((plates: PlateConfig[]) => {
        // Report ONLY the first plate of the row group; the second never
        // reports, yet the row still settles `done`.
        emitScanComplete(sub, {
          plate_index: plates[0].plate_index,
          path: plates[0].output_path,
        });
        process.nextTick(() => emitCycleDone(sub));
      });

      await coordinator.scanOnce(makePlatesMap(['scanner-1'], '4grid'));

      const doneLines = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes(
              'the row reported complete without this plate reporting'
            )
        );

      expect(doneLines).toHaveLength(2);
    });

    it('accepts a scan-complete unconditionally when the dispatched name carries no cycle token, instead of dropping every event (review round 6)', async () => {
      // The cycle guard is armed by `expected.includes(cycleToken)`. That
      // precondition exists so a filename scheme without `_cy<N>_` degrades
      // to pre-guard behaviour rather than silently rejecting everything —
      // an unconditional guard would turn a completely healthy grid into
      // all-MISSING under such a scheme, with no error anywhere.
      //
      // Every other fixture in this file carries `_cy1_`, so without this
      // test, deleting the precondition fails nothing. #370 may change the
      // filename convention, which makes it worth pinning now.
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      const tokenless = '/tmp/plate-00-no-cycle-token.tif';

      sub.scan.mockImplementation((plates: PlateConfig[]) => {
        sub.emit('scan-complete', {
          type: 'scan-complete',
          scanner_id: 'scanner-1',
          plate_index: plates[0].plate_index,
          path: tokenless,
        });
        process.nextTick(() => emitCycleDone(sub));
      });

      const platesMap = new Map<string, PlateConfig[]>([
        [
          'scanner-1',
          [
            {
              plate_index: '00',
              grid_mode: '2grid',
              resolution: 600,
              output_path: tokenless,
              wave_number: 1,
            },
          ],
        ],
      ]);

      await coordinator.scanOnce(platesMap);

      // Accepted and verified, not dropped.
      expect(fs.promises.access).toHaveBeenCalledWith(tokenless);
      const tally = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('grid 00 complete')
        );
      expect(tally).toHaveLength(1);
      expect(tally[0][0]).toContain('1/1 files verified');
      expect(tally[0][0]).not.toContain('MISSING');
    });

    it("does not count a PREVIOUS CYCLE's late scan-complete as this cycle's file (review round 5, B1)", async () => {
      // `rowGrids` is the same list of grid indices on every cycle, so a
      // guard keyed on plate_index alone separates rows WITHIN a cycle but
      // cannot separate cycle N's row ['00'] from cycle N+1's row ['00'].
      //
      // A row timeout does not abort the worker — the Python side reads
      // commands serially and keeps scanning, while the coordinator
      // immediately dispatches the next row into the same pipe. So cycle 1's
      // completion can land while cycle 2's listener is attached. Without a
      // cycle discriminator it is accepted, verified against cycle 1's file
      // (which genuinely exists), and counted as cycle 2's — logging
      // `grid 00 complete — 1/1 files verified` for a cycle that scanned
      // nothing. The spec calls that out as "an affirmative completeness
      // claim that is false, and strictly worse than the bare count this
      // replaced".
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));
      const sub = createdSubprocesses[0];

      const dispatched: PlateConfig[][] = [];
      sub.scan.mockImplementation((plates: PlateConfig[]) => {
        dispatched.push(plates);
        if (dispatched.length === 1) {
          // Cycle 1: worker is still busy. No cycle-done — the row times out
          // while the physical scan continues.
          return;
        }
        // Cycle 2: cycle 1's completion finally arrives, carrying cycle 1's
        // own `_cy1_` path, and only then does this row report done with
        // nothing of its own.
        setImmediate(() => {
          sub.emit('scan-complete', {
            type: 'scan-complete',
            scanner_id: 'scanner-1',
            plate_index: '00',
            path: dispatched[0][0].output_path,
          });
          emitCycleDone(sub);
        });
      });

      // A SINGLE grid index deliberately: one row group per cycle is the
      // configuration in which `rowGrids` cannot discriminate anything at
      // all, so it is the sharpest form of the bug (and is what a 2grid
      // session with both plates on one scanner looks like).
      const platesMap = new Map<string, PlateConfig[]>([
        [
          'scanner-1',
          [
            {
              plate_index: '00',
              grid_mode: '2grid',
              resolution: 600,
              output_path: '/tmp/scan_st_20260410T120000_cy1_S1_00.tif',
              wave_number: 1,
            },
          ],
        ],
      ]);

      const cycle1 = coordinator.scanOnce(platesMap);
      await vi.advanceTimersByTimeAsync(100_000);
      await cycle1;

      const cycle2 = coordinator.scanOnce(platesMap);
      await vi.advanceTimersByTimeAsync(100_000);
      await cycle2;

      // Sanity: the two cycles really did dispatch different paths, or this
      // test proves nothing.
      expect(dispatched).toHaveLength(2);
      expect(dispatched[0][0].output_path).toContain('_cy1_');
      expect(dispatched[1][0].output_path).toContain('_cy2_');

      const tallies = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('grid 00 complete') &&
            msg.includes('files verified')
        )
        .map(([msg]) => msg as string);

      // Exactly two: one grid, two cycles.
      expect(tallies).toHaveLength(2);
      const cycle2Tally = tallies[tallies.length - 1];
      expect(cycle2Tally).toContain('Cycle 2');
      expect(cycle2Tally).toContain('0/1 files verified');
      expect(cycle2Tally).toContain('1 MISSING');

      // The stale path must never have been verified as cycle 2's output.
      expect(fs.promises.access).not.toHaveBeenCalledWith(
        dispatched[0][0].output_path
      );
    });

    it('ignores a late scan-complete belonging to a different row, and a duplicate for the same plate', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      // 4grid: the first row group is ['00','01']. The worker emits plate
      // 00 twice (a duplicate) and also emits plate '10', which belongs to
      // the NEXT row group — the shape a timed-out row produces when its
      // worker keeps running and its late events land on the following row's
      // listener. Neither may reach this row's tally: the duplicate would
      // inflate it past its denominator, and the foreign plate would be
      // verified and counted against a grid this row never scanned.
      let rowCall = 0;
      sub.scan.mockImplementation(() => {
        const isFirstRow = rowCall++ === 0;
        setImmediate(() => {
          const p = '/scans/exp/wave1/scanner-1/x_st_1_et_2_cy1_S1_';
          if (isFirstRow) {
            sub.emit('scan-complete', {
              plate_index: '00',
              path: `${p}00.tif`,
            });
            // Duplicate of a plate this row owns.
            sub.emit('scan-complete', {
              plate_index: '00',
              path: `${p}00.tif`,
            });
            // Belongs to the NEXT row group — must not be adopted by this one.
            sub.emit('scan-complete', {
              plate_index: '10',
              path: `${p}10-STRAY.tif`,
            });
          }
          emitCycleDone(sub);
        });
      });

      const platesMap = makePlatesMap(['scanner-1'], '4grid');
      const scanPromise = coordinator.scanOnce(platesMap);

      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      // The foreign plate's file must never be verified by this row.
      expect(fs.promises.access).not.toHaveBeenCalledWith(
        '/scans/exp/wave1/scanner-1/x_st_1_et_2_cy1_S1_10-STRAY.tif'
      );

      // Plate 00 counted exactly once — never 2/1.
      const tallies = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('files verified')
        );
      expect(tallies.length).toBeGreaterThan(0);
      for (const [msg] of tallies) {
        expect(msg).not.toContain('2/1');
      }
      const grid00 = tallies.filter(([msg]) =>
        String(msg).includes('grid 00 complete')
      );
      expect(grid00.length).toBeGreaterThan(0);
      for (const [msg] of grid00) {
        expect(msg).toContain('1/1 files verified');
      }

      vi.useRealTimers();
    });

    it('includes wave and the cycle-corrected expected path in the diagnostic so a missing plate is traceable without the database', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        setImmediate(() =>
          sub.emit('exit', { scannerId: sub.scannerId, code: 1, signal: null })
        );
      });

      const platesMap = makePlatesMap(['scanner-1']);
      const scanPromise = coordinator.scanOnce(platesMap);

      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      const diagnosticCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('no completion signal received')
        );
      expect(diagnosticCalls.length).toBeGreaterThan(0);

      // This line is the only durable record that the plate's outcome is
      // unknown, so it has to be reconstructable on its own — a scanner UUID
      // and a two-digit grid index are not enough to find the affected wave.
      for (const [msg] of diagnosticCalls) {
        expect(msg).toContain('wave 1');
        // Shares the `MISSING` token with the grid tally, so one grep finds
        // both halves of the signal rather than only the aggregate one.
        expect(msg).toContain('MISSING?');
        // Ends with an action a technician can take. "output presence
        // unknown" never got a plate re-scanned.
        expect(msg).toMatch(/re-scan this plate if it is absent/);
        // Deliberately does NOT label the path `pre-_et_`: no `_et_`-stamped
        // file exists to look for (#370), so the old wording sent the reader
        // hunting for a filename that will never appear on disk.
        expect(msg).not.toContain('_et_');
        // The expected path carries experiment id, wave, scanner and cycle.
        expect(msg).toContain('Check for ');
        // And it must be the CYCLE-CORRECTED path (from platesToScan), not
        // the stale one the row was built from. scanOnce() rewrites `_cy<N>_`
        // per cycle; quoting the stale path would name the wrong cycle for a
        // plate that is missing.
        expect(msg).toContain('_cy1_');
      }

      vi.useRealTimers();
    });

    it('reports the current cycle in the diagnostic path on a later cycle, not the one the plates were built with', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        setImmediate(() =>
          sub.emit('exit', { scannerId: sub.scannerId, code: 1, signal: null })
        );
      });

      // Two cycles: the fixture's output_path is built with `_cy1_`, so if
      // the outcome carried the stale rowPlates rather than the rewritten
      // platesToScan, cycle 2's diagnostic would still say `_cy1_`.
      const platesMap = makePlatesMap(['scanner-1']);
      const first = coordinator.scanOnce(platesMap);
      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await first;

      vi.mocked(scanLog).mockClear();
      const second = coordinator.scanOnce(platesMap);
      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await second;

      const diagnosticCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('no completion signal received')
        );
      expect(diagnosticCalls.length).toBeGreaterThan(0);
      for (const [msg] of diagnosticCalls) {
        expect(msg).toContain('_cy2_');
        expect(msg).not.toContain('_cy1_');
      }

      vi.useRealTimers();
    });

    it('logs the grid-complete tally with an expected denominator, so a short grid is distinguishable from a complete one', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        setImmediate(() =>
          sub.emit('exit', { scannerId: sub.scannerId, code: 1, signal: null })
        );
      });

      const platesMap = makePlatesMap(['scanner-1']);
      const scanPromise = coordinator.scanOnce(platesMap);

      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      // Assert the actual NUMBERS, not just the shape. A regex like
      // /\d+\/\d+ files verified/ passes just as happily against a hardcoded
      // "0/0", which is precisely the ambiguity this line exists to remove.
      const gridCompleteCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('files verified')
        );
      expect(gridCompleteCalls.length).toBeGreaterThan(0);

      // 2grid, one scanner: each of grids 00 and 01 expected exactly 1 plate
      // and the subprocess died before any completed, so each grid is 0/1
      // and must say so explicitly.
      for (const [msg] of gridCompleteCalls) {
        expect(msg).toContain('0/1 files verified');
        expect(msg).toContain('1 MISSING');
      }

      vi.useRealTimers();
    });

    it('keeps the expected denominator honest when a scanner is stopped mid-cycle, instead of shrinking both sides of the ratio', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(2));

      const sub1 = createdSubprocesses[0];
      const sub2 = createdSubprocesses[1];

      // scanner-1 completes both its plates normally.
      sub1.scan.mockImplementation((plates: { plate_index: string }[]) => {
        setImmediate(() => {
          emitScanCompleteForPlates(sub1, plates);
          emitCycleDone(sub1);
        });
      });
      // scanner-2 is stopped on its very first row, so from the NEXT row
      // group onward it is gone from the subprocess map and contributes no
      // result at all. Deriving the denominator from dispatched results would
      // therefore report the remaining grids as fully complete.
      sub2.scan.mockImplementation(() => {
        setImmediate(() => {
          void coordinator.stopScanner('scanner-2');
        });
      });

      const platesMap = makePlatesMap(['scanner-1', 'scanner-2']);
      const scanPromise = coordinator.scanOnce(platesMap);

      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      const gridCompleteCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('files verified')
        );
      expect(gridCompleteCalls.length).toBeGreaterThan(0);

      // Two scanners were asked for one plate each per grid, so the
      // denominator is 2 for every grid — including the grids scanned after
      // scanner-2 was already removed.
      for (const [msg] of gridCompleteCalls) {
        expect(msg).toContain('/2 files verified');
        expect(msg).not.toContain('1/1');
        expect(msg).not.toContain('0/0');
      }

      vi.useRealTimers();
    });

    it('settles a stopped scanner without delaying the other scanners in the same row', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(2));

      const sub1 = createdSubprocesses[0];
      const sub2 = createdSubprocesses[1];

      sub1.scan.mockImplementation((plates: { plate_index: string }[]) => {
        setImmediate(() => {
          emitScanCompleteForPlates(sub1, plates);
          emitCycleDone(sub1);
        });
      });
      sub2.scan.mockImplementation(() => {
        setImmediate(() => {
          void coordinator.stopScanner('scanner-2');
        });
      });

      const cycleComplete = vi.fn();
      coordinator.on('cycle-complete', cycleComplete);

      const platesMap = makePlatesMap(['scanner-1', 'scanner-2']);
      const scanPromise = coordinator.scanOnce(platesMap);

      // The whole cycle must finish well inside SCAN_ROW_TIMEOUT_MS. Rows are
      // awaited with Promise.all, so a scanner that could only settle by
      // timing out would hold every healthy scanner behind it for 90s.
      await vi.advanceTimersByTimeAsync(30_000);
      await scanPromise;

      expect(cycleComplete).toHaveBeenCalled();
      const timeoutLogCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('Row scan timeout')
        );
      expect(timeoutLogCalls).toHaveLength(0);

      vi.useRealTimers();
    });

    it('settles in-flight rows when shutdown() strips listeners, instead of stranding them until the row timeout', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      // This is the Cancel Scan path: cancelScan calls cancelAll() then
      // shutdown() in the same tick, and cancelAll() only writes to stdin —
      // which the worker cannot read until its current blocking save returns.
      // shutdown() therefore strips the row's listeners while it is still in
      // flight, exactly as stopScanner() did before it was fixed.
      sub.scan.mockImplementation(() => {
        setImmediate(() => {
          void coordinator.shutdown();
        });
      });

      const platesMap = makePlatesMap(['scanner-1']);
      const scanPromise = coordinator.scanOnce(platesMap);

      // Far less than SCAN_ROW_TIMEOUT_MS: if the row were orphaned it would
      // still be pending here, and would later emit a spurious row-timeout
      // scan-error for a scan the operator deliberately cancelled.
      await vi.advanceTimersByTimeAsync(5_000);
      await scanPromise;

      const timeoutLogCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('Row scan timeout')
        );
      expect(timeoutLogCalls).toHaveLength(0);

      vi.useRealTimers();
    });

    it('skips a scanner stopped during the USB stagger window rather than attaching listeners to a dead subprocess', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(2));

      const sub1 = createdSubprocesses[0];
      // scanner-1 scans first; scanner-2 is then held in the 5s USB stagger.
      // Stopping it inside that window is the likeliest moment for a wedge
      // (USB contention peaks there) and the row promise — and therefore its
      // settler — does not exist yet, so stopScanner() has nothing to call.
      sub1.scan.mockImplementation((plates: { plate_index: string }[]) => {
        // Land the stop INSIDE the stagger wait. Stopping before the loop
        // reaches scanner-2 would just drop it from the Map iterator, which
        // is already safe; the gap is the window after it has been read out
        // of the map but before its row promise (and settler) exist.
        setTimeout(() => {
          void coordinator.stopScanner('scanner-2');
        }, 1_000);
        setImmediate(() => {
          emitScanCompleteForPlates(sub1, plates);
          emitCycleDone(sub1);
        });
      });

      const platesMap = makePlatesMap(['scanner-1', 'scanner-2']);
      const scanPromise = coordinator.scanOnce(platesMap);

      await vi.advanceTimersByTimeAsync(30_000);
      await scanPromise;

      expect(
        vi
          .mocked(scanLog)
          .mock.calls.some(
            ([msg]) =>
              typeof msg === 'string' &&
              msg.includes('stopped during the USB stagger window')
          )
      ).toBe(true);
      // And crucially it must not have fallen through to the row timeout.
      const timeoutLogCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) => typeof msg === 'string' && msg.includes('Row scan timeout')
        );
      expect(timeoutLogCalls).toHaveLength(0);

      vi.useRealTimers();
    });

    it('does not emit a second scan-error while verifying a row that already timed out', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      // Plate 00 completes and reports a path; plate 01 never does, so the
      // row hits SCAN_ROW_TIMEOUT_MS. The timeout emits its own row-level
      // scan-error. Verification then finds plate 00's file missing — which
      // must NOT produce a second scan-error, because WedgeDetector counts
      // two confirmed failures as grounds to auto-pause the scanner.
      sub.scan.mockImplementation(() => {
        setImmediate(() => {
          sub.emit('scan-complete', {
            plate_index: '00',
            path: '/scans/exp/wave1/scanner-1/gone_st_1_et_2_cy1_S1_00.tif',
          });
        });
      });
      vi.mocked(fs.promises.access).mockRejectedValue(new Error('ENOENT'));

      const scanError = vi.fn();
      coordinator.on('scan-error', scanError);

      const platesMap = makePlatesMap(['scanner-1']);
      const scanPromise = coordinator.scanOnce(platesMap);

      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      const rowTimeoutErrors = scanError.mock.calls.filter(([e]) =>
        String(e?.error).includes('Row scan timeout')
      );
      const perPlateErrors = scanError.mock.calls.filter(([e]) =>
        String(e?.error).includes('Output file missing')
      );
      expect(rowTimeoutErrors.length).toBeGreaterThan(0);
      expect(perPlateErrors).toHaveLength(0);

      // The missing file is still recorded in the log, just not re-reported
      // as a fresh error event.
      const missingLogs = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' && msg.includes('Output file missing')
        );
      expect(missingLogs.length).toBeGreaterThan(0);

      vi.useRealTimers();
    }, 15000);

    it('still records an already-determined exit diagnostic when a cancel lands mid-verification', async () => {
      vi.useFakeTimers();

      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(2));

      const sub1 = createdSubprocesses[0];
      const sub2 = createdSubprocesses[1];

      // scanner-1 completes; scanner-2's worker died mid-row. Both outcomes
      // are already determined before the verification loop runs. A cancel
      // arriving while the loop awaits scanner-1's fs.access must not erase
      // scanner-2's record — the exit happened BEFORE the operator cancelled,
      // and the diagnostic is log-only (it emits no scan-error), so
      // suppressing it loses the only trace of a genuinely unknown outcome.
      sub1.scan.mockImplementation((plates: { plate_index: string }[]) => {
        setImmediate(() => {
          emitScanCompleteForPlates(sub1, plates);
          emitCycleDone(sub1);
        });
      });
      sub2.scan.mockImplementation(() => {
        setImmediate(() =>
          sub2.emit('exit', {
            scannerId: sub2.scannerId,
            code: 1,
            signal: null,
          })
        );
      });

      vi.mocked(fs.promises.access).mockImplementation(async () => {
        // Cancel exactly while the verification loop is suspended on an await.
        coordinator.cancelAll();
      });

      const platesMap = makePlatesMap(['scanner-1', 'scanner-2']);
      const scanPromise = coordinator.scanOnce(platesMap);

      await vi.advanceTimersByTimeAsync(100_000);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      const diagnosticCalls = vi
        .mocked(scanLog)
        .mock.calls.filter(
          ([msg]) =>
            typeof msg === 'string' &&
            msg.includes('no completion signal received') &&
            msg.includes('scanner-2')
        );
      expect(diagnosticCalls.length).toBeGreaterThan(0);

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
        setImmediate(() => emitCycleDone(sub));
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
        process.nextTick(() => emitCycleDone(sub));
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
        process.nextTick(() => emitCycleDone(sub));
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
        process.nextTick(() => emitCycleDone(sub));
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
        process.nextTick(() => emitCycleDone(sub));
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
        process.nextTick(() => emitCycleDone(sub));
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
        process.nextTick(() => emitCycleDone(sub));
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
        setImmediate(() => emitCycleDone(sub));
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
        setImmediate(() => emitCycleDone(sub));
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
          setTimeout(() => emitCycleDone(sub), 50);
        } else {
          // Subsequent rows: complete immediately
          setImmediate(() => emitCycleDone(sub));
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
        setTimeout(() => emitCycleDone(sub2), 50);
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
