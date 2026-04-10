// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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
} from '../../../src/main/graviscan/session-handlers';

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

    it('should not set session state if coordinator.initialize throws', async () => {
      coordinator = createMockCoordinator({
        initialize: vi.fn().mockRejectedValue(new Error('USB init failed')),
      } as any);

      const result = await startScan(coordinator, baseParams, sessionFns, onError);

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
});
