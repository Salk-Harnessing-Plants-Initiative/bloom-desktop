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

vi.mock('fs');

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

    // Mock fs
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.renameSync).mockReturnValue(undefined);
    vi.mocked(fs.statSync).mockReturnValue({ size: 1024 } as fs.Stats);

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

    it('logs USB stagger delay between scanners', async () => {
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
      await coordinator.scanOnce(platesMap);

      // scanLog should have been called for stagger delay
      expect(scanLog).toHaveBeenCalledWith(expect.stringContaining('stagger'));
    }, 15000);

    it('verifies file existence after scan-complete', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      const platesMap = makePlatesMap(['scanner-1']);
      await coordinator.scanOnce(platesMap);

      // fs.existsSync should have been called to verify output files
      expect(fs.existsSync).toHaveBeenCalled();
    });

    it('emits scan-error when statSync throws (filesystem race)', async () => {
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        process.nextTick(() => sub.emit('cycle-done', {}));
      });

      // File exists but statSync throws (e.g., permissions, race condition)
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.statSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

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
      vi.mocked(fs.renameSync).mockImplementation(() => {
        throw new Error('ENOSPC: no space left on device');
      });

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
      await coordinator.scanOnce(platesMap);

      // Should still complete the cycle
      expect(cycleComplete).toHaveBeenCalled();
    }, 15000);
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
      const coordinator = await createCoordinator();
      await coordinator.initialize(makeScanners(1));

      const sub = createdSubprocesses[0];
      sub.scan.mockImplementation(() => {
        setImmediate(() => sub.emit('cycle-done', {}));
      });

      const intervalComplete = vi.fn();
      coordinator.on('interval-complete', intervalComplete);

      const platesMap = makePlatesMap(['scanner-1']);
      // Use very short intervals for test speed
      const intervalPromise = coordinator.scanInterval(platesMap, 100, 500);

      // Wait a bit for first cycle, then cancel
      await new Promise((r) => setTimeout(r, 200));
      coordinator.cancelAll();
      await intervalPromise;

      expect(intervalComplete).toHaveBeenCalledWith(
        expect.objectContaining({ cancelled: true })
      );
    }, 15000);
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
