// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../src/main/graviscan/scan-logger', () => ({
  scanLog: vi.fn(),
  cleanupOldLogs: vi.fn(),
  closeScanLog: vi.fn(),
}));

// Types matching Ben's ScanCoordinator + PlateConfig
interface ScanCoordinatorLike {
  readonly isScanning: boolean;
  initialize(scanners: any[]): Promise<void>;
  scanOnce(platesPerScanner: Map<string, any[]>): Promise<void>;
  scanInterval(
    platesPerScanner: Map<string, any[]>,
    intervalMs: number,
    durationMs: number
  ): Promise<void>;
  cancelAll(): void;
  shutdown(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
  hasWorker(scannerId: string): boolean;
  addScanner(config: any): Promise<void>;
  stopScanner(scannerId: string): Promise<void>;
}

function createMockCoordinator(
  overrides: Partial<ScanCoordinatorLike> = {}
): ScanCoordinatorLike {
  return {
    isScanning: false,
    initialize: vi.fn().mockResolvedValue(undefined),
    scanOnce: vi.fn().mockResolvedValue(undefined),
    scanInterval: vi.fn().mockResolvedValue(undefined),
    cancelAll: vi.fn(),
    shutdown: vi.fn().mockResolvedValue(undefined),
    on: vi.fn().mockReturnThis(),
    // Default: every scanner comes online — matches the pre-existing
    // "happy path" test expectations. Tests for the final-review #3 fix
    // (zero/partial scanners ready) override this per-test.
    hasWorker: vi.fn().mockReturnValue(true),
    addScanner: vi.fn().mockResolvedValue(undefined),
    stopScanner: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function createMockSessionFns() {
  return {
    getScanSession: vi.fn().mockReturnValue(null),
    setScanSession: vi.fn(),
    markScanJobRecorded: vi.fn(),
  };
}

// Static imports — added after implementation exists
import {
  startScan,
  getScanStatus,
  markJobRecorded,
  cancelScan,
  retryScanner,
} from '../../../src/main/graviscan/session-handlers';
import { scanLog } from '../../../src/main/graviscan/scan-logger';

function createMockRetryDb(
  row: {
    usb_bus: number | null;
    usb_device: number | null;
    enabled: boolean;
  } | null
) {
  return {
    graviScanner: {
      findUnique: vi.fn().mockResolvedValue(row),
    },
  };
}

describe('session-handlers', () => {
  let coordinator: ReturnType<typeof createMockCoordinator>;
  let sessionFns: ReturnType<typeof createMockSessionFns>;
  let onError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    coordinator = createMockCoordinator();
    sessionFns = createMockSessionFns();
    onError = vi.fn();
  });

  describe('startScan', () => {
    const baseParams = {
      scanners: [
        {
          scannerId: 's1',
          saneName: 'epkowa:interpreter:001:002',
          plates: [
            {
              plate_index: '00',
              grid_mode: '2grid',
              resolution: 600,
              output_path: '/tmp/scan',
            },
          ],
        },
      ],
      metadata: {
        experimentId: 'exp-1',
        phenotyperId: 'pheno-1',
        resolution: 600,
      },
    };

    it('should reject when coordinator is null', async () => {
      const result = await startScan(
        null as any,
        baseParams,
        sessionFns,
        onError
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('should reject when scan already in progress', async () => {
      coordinator = createMockCoordinator({ isScanning: true } as any);

      const result = await startScan(
        coordinator,
        baseParams,
        sessionFns,
        onError
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('already in progress');
    });

    it('should initialize coordinator and call scanOnce for one-shot', async () => {
      const result = await startScan(
        coordinator,
        baseParams,
        sessionFns,
        onError
      );

      expect(result.success).toBe(true);
      expect(coordinator.initialize).toHaveBeenCalled();
      expect(coordinator.scanOnce).toHaveBeenCalled();
      expect(sessionFns.setScanSession).toHaveBeenCalled();
    });

    it('should call scanInterval for continuous mode', async () => {
      const continuousParams = {
        ...baseParams,
        interval: { intervalSeconds: 300, durationSeconds: 3600 },
      };

      const result = await startScan(
        coordinator,
        continuousParams,
        sessionFns,
        onError
      );

      expect(result.success).toBe(true);
      expect(coordinator.scanInterval).toHaveBeenCalledWith(
        expect.any(Map),
        300000,
        3600000
      );
    });

    it('should build correct session state with jobs map', async () => {
      await startScan(coordinator, baseParams, sessionFns, onError);

      const sessionArg = sessionFns.setScanSession.mock.calls[0][0];
      expect(sessionArg.isActive).toBe(true);
      expect(sessionArg.experimentId).toBe('exp-1');
      expect(sessionArg.jobs['s1:00']).toBeDefined();
      expect(sessionArg.jobs['s1:00'].status).toBe('pending');
    });

    it('should calculate totalCycles for continuous mode', async () => {
      const continuousParams = {
        ...baseParams,
        interval: { intervalSeconds: 60, durationSeconds: 300 },
      };

      await startScan(coordinator, continuousParams, sessionFns, onError);

      const sessionArg = sessionFns.setScanSession.mock.calls[0][0];
      expect(sessionArg.totalCycles).toBe(5); // 300 / 60
    });

    it('should ceil totalCycles for non-even division', async () => {
      const continuousParams = {
        ...baseParams,
        interval: { intervalSeconds: 60, durationSeconds: 350 },
      };

      await startScan(coordinator, continuousParams, sessionFns, onError);

      const sessionArg = sessionFns.setScanSession.mock.calls[0][0];
      expect(sessionArg.totalCycles).toBe(6); // Math.ceil(350/60) = 6
    });

    it('should reject when interval parameters are invalid', async () => {
      const invalidParams = {
        ...baseParams,
        interval: { intervalSeconds: 0, durationSeconds: 300 },
      };

      const result = await startScan(
        coordinator,
        invalidParams,
        sessionFns,
        onError
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('positive');
    });

    it('fails and does not set session state when no scanner comes online after initialize() (final-review #3)', async () => {
      // initialize() no longer rejects on a per-scanner spawn failure
      // (stage 2 isolates those) — simulate that case: initialize()
      // resolves, but hasWorker() is false for every configured scanner.
      coordinator = createMockCoordinator({
        hasWorker: vi.fn().mockReturnValue(false),
      } as any);

      const result = await startScan(
        coordinator,
        baseParams,
        sessionFns,
        onError
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('No scanners came online');
      expect(sessionFns.setScanSession).not.toHaveBeenCalled();
      expect(coordinator.scanOnce).not.toHaveBeenCalled();
    });

    it('succeeds when at least one of several scanners comes online after initialize()', async () => {
      const multiParams = {
        ...baseParams,
        scanners: [
          baseParams.scanners[0],
          {
            scannerId: 's2',
            saneName: 'epkowa:interpreter:001:003',
            plates: [
              {
                plate_index: '00',
                grid_mode: '2grid',
                resolution: 600,
                output_path: '/tmp/scan2',
              },
            ],
          },
        ],
      };
      coordinator = createMockCoordinator({
        hasWorker: vi.fn((id: string) => id === 's1'), // s2 failed to spawn
      } as any);

      const result = await startScan(
        coordinator,
        multiParams,
        sessionFns,
        onError
      );

      expect(result.success).toBe(true);
      expect(sessionFns.setScanSession).toHaveBeenCalled();
    });

    it('should not set session state if coordinator.initialize throws', async () => {
      coordinator = createMockCoordinator({
        initialize: vi.fn().mockRejectedValue(new Error('USB init failed')),
      } as any);

      const result = await startScan(
        coordinator,
        baseParams,
        sessionFns,
        onError
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('USB init failed');
      // Session should NOT have been set since initialize failed
      expect(sessionFns.setScanSession).not.toHaveBeenCalled();
    });

    it('should call onError and clear session when fire-and-forget rejects', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const deferred = { reject: (_e: Error) => {} };
      const scanPromise = new Promise<void>((_resolve, reject) => {
        deferred.reject = reject;
      });
      coordinator = createMockCoordinator({
        scanOnce: vi.fn().mockReturnValue(scanPromise),
      } as any);

      const result = await startScan(
        coordinator,
        baseParams,
        sessionFns,
        onError
      );
      expect(result.success).toBe(true);

      // Now reject the detached promise
      deferred.reject(new Error('Subprocess crashed'));
      // Wait for the .catch() handler to execute
      await vi.waitFor(() => {
        expect(onError).toHaveBeenCalled();
      });
      expect(sessionFns.setScanSession).toHaveBeenCalledWith(null);
    });

    it('should clear session when fire-and-forget resolves (scan completes)', async () => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const deferred = { resolve: () => {} };
      const scanPromise = new Promise<void>((resolve) => {
        deferred.resolve = resolve;
      });
      coordinator = createMockCoordinator({
        scanOnce: vi.fn().mockReturnValue(scanPromise),
      } as any);

      const result = await startScan(
        coordinator,
        baseParams,
        sessionFns,
        onError
      );
      expect(result.success).toBe(true);

      // Session should be set (from startScan)
      expect(sessionFns.setScanSession).toHaveBeenCalledTimes(1);

      // Now resolve the detached promise (scan completes successfully)
      deferred.resolve();
      // Wait for the .then() handler to execute
      await vi.waitFor(() => {
        expect(sessionFns.setScanSession).toHaveBeenCalledTimes(2);
      });
      // Second call should clear the session
      expect(sessionFns.setScanSession).toHaveBeenLastCalledWith(null);
    });
  });

  describe('getScanStatus', () => {
    it('should return isActive false when no session', () => {
      const result = getScanStatus(sessionFns);

      expect(result.isActive).toBe(false);
    });

    it('should return full session state when active', async () => {
      sessionFns.getScanSession.mockReturnValue({
        isActive: true,
        experimentId: 'exp-1',
        phenotyperId: 'pheno-1',
        resolution: 600,
        sessionId: null,
        jobs: { 's1:00': { status: 'pending' } },
        isContinuous: false,
        currentCycle: 0,
        totalCycles: 1,
        intervalMs: 0,
        scanStartedAt: Date.now(),
        scanDurationMs: 0,
        coordinatorState: 'scanning',
        nextScanAt: null,
        waveNumber: 0,
      });

      const result = getScanStatus(sessionFns);

      expect(result.isActive).toBe(true);
      expect(result.experimentId).toBe('exp-1');
      expect(result.jobs).toBeDefined();
    });
  });

  describe('markJobRecorded', () => {
    it('should delegate to injected markScanJobRecorded', () => {
      markJobRecorded(sessionFns, 's1:00');

      expect(sessionFns.markScanJobRecorded).toHaveBeenCalledWith('s1:00');
    });
  });

  describe('cancelScan', () => {
    it('should call cancelAll and shutdown then clear session', async () => {
      const result = await cancelScan(coordinator, sessionFns);

      expect(result.success).toBe(true);
      expect(coordinator.cancelAll).toHaveBeenCalled();
      expect(coordinator.shutdown).toHaveBeenCalled();
      expect(sessionFns.setScanSession).toHaveBeenCalledWith(null);
    });

    it('should return error when coordinator is null', async () => {
      const result = await cancelScan(null as any, sessionFns);

      expect(result.success).toBe(false);
      expect(result.error).toContain('not initialized');
    });

    it('should clear session state even when shutdown throws', async () => {
      coordinator = createMockCoordinator({
        shutdown: vi.fn().mockRejectedValue(new Error('SANE device busy')),
      } as any);

      const result = await cancelScan(coordinator, sessionFns);

      expect(result.success).toBe(false);
      expect(result.error).toContain('SANE device busy');
      // Session MUST be cleared even on shutdown failure — otherwise it gets stuck
      expect(sessionFns.setScanSession).toHaveBeenCalledWith(null);
    });

    it('should return success when no scan session is active', async () => {
      // Coordinator exists but no scan in progress
      coordinator = createMockCoordinator({ isScanning: false } as any);
      const result = await cancelScan(coordinator, sessionFns);

      expect(result.success).toBe(true);
    });
  });

  describe('retryScanner', () => {
    beforeEach(() => {
      sessionFns.getScanSession.mockReturnValue({ isActive: true } as any);
    });

    it('stops then respawns the scanner using a fresh saneName from the db, and logs success', async () => {
      const db = createMockRetryDb({
        usb_bus: 3,
        usb_device: 7,
        enabled: true,
      });

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(coordinator.stopScanner).toHaveBeenCalledWith('sc-1');
      expect(coordinator.addScanner).toHaveBeenCalledWith({
        scannerId: 'sc-1',
        saneName: 'epkowa:interpreter:003:007',
        plates: [],
      });
      expect(result).toEqual({ success: true });
      expect(scanLog).toHaveBeenCalledWith(expect.stringContaining('sc-1'));
    });

    it('fails without respawning when the scanner row cannot be found', async () => {
      const db = createMockRetryDb(null);

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(coordinator.stopScanner).not.toHaveBeenCalled();
      expect(coordinator.addScanner).not.toHaveBeenCalled();
    });

    it('fails without respawning when usb_bus/usb_device is null (mid reset-usb)', async () => {
      const db = createMockRetryDb({
        usb_bus: null,
        usb_device: null,
        enabled: true,
      });

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(coordinator.addScanner).not.toHaveBeenCalled();
    });

    it('fails without respawning a disabled scanner', async () => {
      const db = createMockRetryDb({
        usb_bus: 3,
        usb_device: 7,
        enabled: false,
      });

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(coordinator.addScanner).not.toHaveBeenCalled();
    });

    it('fails cleanly with no active session, without querying the db', async () => {
      sessionFns.getScanSession.mockReturnValue(null);
      const db = createMockRetryDb({
        usb_bus: 3,
        usb_device: 7,
        enabled: true,
      });

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result.success).toBe(false);
      expect(db.graviScanner.findUnique).not.toHaveBeenCalled();
      expect(coordinator.addScanner).not.toHaveBeenCalled();
    });

    it('fails cleanly with an inactive session', async () => {
      sessionFns.getScanSession.mockReturnValue({ isActive: false } as any);
      const db = createMockRetryDb({
        usb_bus: 3,
        usb_device: 7,
        enabled: true,
      });

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result.success).toBe(false);
      expect(coordinator.addScanner).not.toHaveBeenCalled();
    });

    it('fails cleanly when coordinator is null, without throwing', async () => {
      const db = createMockRetryDb({
        usb_bus: 3,
        usb_device: 7,
        enabled: true,
      });

      const result = await retryScanner(
        null as any,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('catches a rejected addScanner and surfaces it, logging the failed retry', async () => {
      coordinator = createMockCoordinator({
        addScanner: vi.fn().mockRejectedValue(new Error('spawn failed')),
      } as any);
      const db = createMockRetryDb({
        usb_bus: 3,
        usb_device: 7,
        enabled: true,
      });

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('spawn failed');
      expect(scanLog).toHaveBeenCalledWith(expect.stringContaining('sc-1'));
    });
  });
});
