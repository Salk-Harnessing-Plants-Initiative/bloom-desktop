// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

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
    rename: vi.fn().mockResolvedValue(undefined),
  },
  // Keep existsSync for any other code that might use it
  existsSync: vi.fn().mockReturnValue(true),
  statSync: vi.fn().mockReturnValue({ size: 1024 }),
  renameSync: vi.fn(),
}));

import * as fs from 'fs';
import { ScannerSubprocess } from '../../../src/main/graviscan/scanner-subprocess';
import { scanLog } from '../../../src/main/graviscan/scan-logger';
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
    shutdown: vi.fn().mockResolvedValue(undefined),
    removeAllListeners: vi.fn().mockReturnThis(),
  });
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
    vi.mocked(fs.promises.rename).mockResolvedValue(undefined);

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
    it('spawns subprocesses sequentially', async () => {
      const coordinator = await createCoordinator();
      const scanners = makeScanners(2);

      await coordinator.initialize(scanners);

      expect(ScannerSubprocess).toHaveBeenCalledTimes(2);
      // Both should have spawn called
      expect(createdSubprocesses[0].spawn).toHaveBeenCalled();
      expect(createdSubprocesses[1].spawn).toHaveBeenCalled();
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

    it('resets state to idle when spawn fails', async () => {
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

      await expect(coordinator.initialize(failScanner)).rejects.toThrow(
        'SANE device not found'
      );

      // State should be reset to idle, not stuck in 'initializing'
      expect(coordinator.isScanning).toBe(false);
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
      const platesMap = new Map<string, PlateConfig[]>();
      platesMap.set('scanner-1', [
        {
          plate_index: '00',
          grid_mode: '2grid' as const,
          resolution: 600,
          // Directory contains 20260410T000000 which matches \d{8}T\d{6}
          output_path:
            '/scans/20260410T000000/exp1_st_20260410T120000_cy1_S1_00.tif',
        },
      ]);

      const scanPromise = coordinator.scanOnce(platesMap);
      await vi.advanceTimersByTimeAsync(100_000);
      await scanPromise;

      // The directory portion should NOT have been modified
      expect(capturedPlates[0].output_path).toContain(
        '/scans/20260410T000000/'
      );
      // The filename portion SHOULD have the new timestamp
      expect(capturedPlates[0].output_path).not.toContain('st_20260410T120000');

      vi.useRealTimers();
    });

    it('forwarded scan-event does not include scan_ended_at before row completes', async () => {
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

      const scanEvent = vi.fn();
      coordinator.on('scan-event', scanEvent);

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      // The forwarded scan-event should NOT have scan_ended_at
      // (it's unknown until the row completes)
      expect(scanEvent).toHaveBeenCalled();
      const firstCall = scanEvent.mock.calls[0][0];
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
      sub.scan.mockImplementation(() => {
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      // fs.promises.access should have been called to verify output files
      expect(fs.promises.access).toHaveBeenCalled();
    });

    it('emits scan-error when stat rejects (filesystem race)', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      // File exists but stat rejects (e.g., permissions, race condition)
      vi.mocked(fs.promises.stat).mockRejectedValue(new Error('EACCES: permission denied'));

      const scanError = vi.fn();
      coordinator.on('scan-error', scanError);

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      expect(scanError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('Cannot stat'),
        })
      );
    });

    it('emits rename-error when rename fails', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      // Make rename fail
      vi.mocked(fs.promises.rename).mockRejectedValue(new Error('ENOSPC: no space left on device'));

      const renameError = vi.fn();
      coordinator.on('rename-error', renameError);

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      expect(renameError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('ENOSPC'),
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

    it('emits scan-error and proceeds when subprocess does not respond within row timeout', async () => {
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

      // Should have emitted scan-error for the timed-out subprocess
      expect(scanError).toHaveBeenCalledWith(
        expect.objectContaining({
          error: expect.stringContaining('timeout'),
        })
      );
      // Should still complete the cycle (not hang forever)
      expect(cycleComplete).toHaveBeenCalled();

      vi.useRealTimers();
    }, 15000);
  });

  describe('async FS operations', () => {
    it('emits scan-error when file is missing (access rejects)', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
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
        })
      );
    });

    it('emits scan-error for zero-size file', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
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
        })
      );
    });

    it('logs successful renames via scanLog', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      expect(scanLog).toHaveBeenCalledWith(
        expect.stringContaining('Renamed:')
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
