// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/main/graviscan/scan-logger', () => ({
  scanLog: vi.fn(),
  cleanupOldLogs: vi.fn(),
  closeScanLog: vi.fn(),
}));

// `retryScanner` now re-resolves the USB address before respawning (#182),
// via `scanner-usb-refresh`, which reaches USB detection. This file
// previously mocked only `scan-logger`, so without this factory the retry
// tests would spawn a real `lsusb` subprocess — and the outcome differs by
// platform (ENOENT on Windows/macOS, "no Epson found" on ubuntu-latest), so
// such a test would pass locally and fail in CI or vice versa.
//
// Mirrors the complete-replacement factories in `scanner-handlers.test.ts:5-7`
// and `reset-usb-handler.test.ts:5-7`. `buildSaneName` gets a REAL
// implementation, not a `vi.fn()`, because assertions below check its output.
vi.mock('../../../src/main/lsusb-detection', () => ({
  detectEpsonScanners: vi.fn(),
  detectEpsonScannersAsync: vi.fn(),
  buildSaneName: (bus: number, device: number) =>
    `epkowa:interpreter:${String(bus).padStart(3, '0')}:${String(device).padStart(3, '0')}`,
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
  getScannerStatuses(): Array<{
    scannerId: string;
    status: 'ready' | 'starting' | 'error' | 'dead';
    error?: string;
  }>;
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
    // Default: whichever scanner was queried reports 'ready' — matches
    // the retryScanner happy-path expectation. Tests for the silent-failure
    // fix override this per-test.
    getScannerStatuses: vi.fn(() => [
      { scannerId: 'sc-1', status: 'ready' as const },
    ]),
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
import { detectEpsonScannersAsync } from '../../../src/main/lsusb-detection';

const mockDetectAsync = vi.mocked(detectEpsonScannersAsync);

/**
 * Retry's DB double.
 *
 * Takes a `Partial` row and merges defaults. The widening must supply
 * *defaults*, not merely a wider type: the 13 pre-existing call sites pass
 * literal `{usb_bus, usb_device, enabled}` rows, and a type-only widening
 * would leave every one of them at `usb_port: undefined` → `no-stable-port`
 * → all 13 failing for a reason unrelated to any new assertion.
 *
 * Row shape audited wholesale against `prisma/schema.prisma`'s `GraviScanner`
 * model, not field-by-field as a test happens to need.
 */
function createMockRetryDb(
  row: {
    id?: string;
    usb_bus: number | null;
    usb_device: number | null;
    usb_port?: string | null;
    display_name?: string | null;
    name?: string | null;
    enabled: boolean;
  } | null
) {
  const merged =
    row === null
      ? null
      : {
          id: 'sc-1',
          usb_port: '1-2.3',
          display_name: 'Scanner A',
          name: 'Perfection V600 Photo',
          ...row,
        };
  return {
    graviScanner: {
      findUnique: vi.fn().mockResolvedValue(merged),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

/**
 * Default detection for the retry tests: reports `sc-1` at the address its
 * stored row already holds, so a refresh is a no-op and the pre-existing
 * tests keep their original meaning.
 */
function detectionReporting(
  usbBus: number | null,
  usbDevice: number | null,
  usbPort = '1-2.3'
) {
  return {
    success: true,
    count: 1,
    scanners: [
      {
        name: 'Perfection V600 Photo',
        scanner_id: 'detected-1',
        usb_bus: usbBus,
        usb_device: usbDevice,
        usb_port: usbPort,
        is_available: true,
        vendor_id: '04b8',
        product_id: '013a',
        sane_name: `epkowa:interpreter:${String(usbBus).padStart(3, '0')}:${String(usbDevice).padStart(3, '0')}`,
      },
    ],
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

    // design.md Decision 3, path 2 of 3. `GraviScan.tsx` fetches the
    // saneNames map once per page mount, so the most plausible operator
    // recovery — cancel, power-cycle, start a new session without leaving
    // the page — spawns on an address captured before the power-cycle and
    // fails with the identical error the retry button used to. Fixing the
    // button without this would fix the feature and leave the workaround
    // broken.
    describe('spawn-time address resolution at session start', () => {
      it('attaches a resolver built by the injected factory to every scanner config', async () => {
        // `startScan` must NOT gain a `db` parameter — session-handlers
        // deliberately carries almost no DB dependency. It receives a
        // factory instead, and never sees the database.
        const made: string[] = [];
        const makeSaneNameResolver = vi.fn((scannerId: string) => {
          made.push(scannerId);
          return async () => 'epkowa:interpreter:001:008';
        });

        await startScan(
          coordinator,
          baseParams,
          sessionFns,
          onError,
          makeSaneNameResolver
        );

        expect(makeSaneNameResolver).toHaveBeenCalledTimes(1);
        expect(made).toEqual(['s1']);

        const configs = coordinator.initialize.mock.calls[0][0];
        expect(configs).toHaveLength(1);
        expect(configs[0]).toMatchObject({
          scannerId: 's1',
          saneName: 'epkowa:interpreter:001:002',
          resolveSaneName: expect.any(Function),
        });
        // The config still carries the snapshot name as the fallback; the
        // resolver is what makes it live.
        await expect(configs[0].resolveSaneName()).resolves.toBe(
          'epkowa:interpreter:001:008'
        );
      });

      it('starts a session without a factory, attaching no resolver', async () => {
        // The factory is optional so existing callers and tests keep
        // working; an absent resolver is ordinary, not a failure.
        const result = await startScan(
          coordinator,
          baseParams,
          sessionFns,
          onError
        );

        expect(result.success).toBe(true);
        const configs = coordinator.initialize.mock.calls[0][0];
        expect(configs[0]).not.toHaveProperty('resolveSaneName');
      });
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
      sessionFns.getScanSession.mockReturnValue({
        isActive: true,
        sessionId: 'session-42',
      } as any);
      // `vitest.config.ts` sets neither `clearMocks` nor `restoreMocks`, so
      // call counts accumulate across tests unless cleared explicitly —
      // which silently turns every `not.toHaveBeenCalled()` below into a
      // failure inherited from an earlier test.
      mockDetectAsync.mockReset();
      // Default: the scanner is found at the port and address its row
      // already holds, so the refresh is a no-op and the pre-existing tests
      // keep their original meaning. Tests that exercise a *moved* address
      // override this.
      mockDetectAsync.mockResolvedValue(detectionReporting(3, 7) as any);
    });

    // Restored here rather than at the end of each test that sets it: a
    // failing assertion would otherwise skip the cleanup and leak
    // GRAVISCAN_MOCK into every subsequent test, turning one real failure
    // into a cascade of misleading ones — which is exactly what happened
    // while writing these.
    //
    // Set and restored directly on `process.env`, which is what the
    // production code reads.
    afterEach(() => {
      delete process.env.GRAVISCAN_MOCK;
      vi.unstubAllEnvs();
    });

    // Title corrected by this change: the saneName no longer comes from a
    // "fresh database read" (which a power-cycle makes stale) but from live
    // USB re-resolution keyed on the stable usb_port. The standing spec
    // prescribed the old mechanism by name; see the MODIFIED delta.
    it('stops then respawns the scanner using a live re-resolved saneName, and logs success', async () => {
      const db = createMockRetryDb({
        usb_bus: 3,
        usb_device: 7,
        usb_port: '3-1',
        enabled: true,
      });
      mockDetectAsync.mockResolvedValue(detectionReporting(3, 7, '3-1') as any);

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
        // Spawn-time re-resolution: a queued addScanner can sit for up to a
        // full scan interval, so fixing the address at click time is only
        // half a fix (design.md Decision 3).
        resolveSaneName: expect.any(Function),
      });
      expect(result).toEqual({ success: true });
      expect(coordinator.getScannerStatuses).toHaveBeenCalled();
      expect(scanLog).toHaveBeenCalledWith(
        expect.stringContaining('scanner=sc-1 session=session-42')
      );
    });

    it('reports failure when addScanner() resolves but the respawned worker reports status "error"', async () => {
      coordinator = createMockCoordinator({
        getScannerStatuses: vi.fn(() => [
          {
            scannerId: 'sc-1',
            status: 'error' as const,
            error: 'sane_start: Invalid argument',
          },
        ]),
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

      expect(result).toEqual({
        success: false,
        error: 'sane_start: Invalid argument',
      });
      expect(scanLog).toHaveBeenCalledWith(
        expect.stringContaining('scanner=sc-1 session=session-42')
      );
    });

    it('reports failure when addScanner() resolves but the scanner is missing entirely from getScannerStatuses()', async () => {
      coordinator = createMockCoordinator({
        getScannerStatuses: vi.fn(() => []),
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
      expect(result.error).toBeDefined();
      expect(result.error).not.toBe('');
    });

    it('reports failure when addScanner() resolves but the respawned worker reports status "dead" with no error field', async () => {
      coordinator = createMockCoordinator({
        getScannerStatuses: vi.fn(() => [
          { scannerId: 'sc-1', status: 'dead' as const },
        ]),
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
      expect(result.error).toBeDefined();
      expect(result.error).not.toBe('');
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
      // The row guard stays strictly BEFORE refresh, so row-missing is
      // reached without spending a detection.
      expect(mockDetectAsync).not.toHaveBeenCalled();
    });

    // DELIBERATELY INVERTED by this change (design.md Decision 6). The old
    // assertion was "null usb_bus/usb_device fails without respawning". With
    // refresh in place those columns are recoverable from `usb_port`, so the
    // guard moves from "null ⇒ fail" to "no usable port ⇒ fail" and this
    // case now SUCCEEDS. Updated in place rather than duplicated, so the
    // inverted expectation is visible in one test rather than contradicted
    // across two.
    //
    // What this gives up is stated in Decision 6: that guard was also the
    // only main-process detection of a retry racing a `reset-usb`, which
    // nulls both columns and then sleeps 5s. `graviscan:reset-usb` has no
    // `isScanning` guard, so the interleaving stays reachable over IPC. The
    // replacement (a handler-level guard) is filed separately.
    it('recovers and respawns when usb_bus/usb_device are null but the port is known', async () => {
      const db = createMockRetryDb({
        usb_bus: null,
        usb_device: null,
        usb_port: '1-2.3',
        enabled: true,
      });
      mockDetectAsync.mockResolvedValue(detectionReporting(1, 8) as any);

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result).toEqual({ success: true });
      expect(coordinator.addScanner).toHaveBeenCalledWith({
        scannerId: 'sc-1',
        saneName: 'epkowa:interpreter:001:008',
        plates: [],
        resolveSaneName: expect.any(Function),
      });
      expect(db.graviScanner.update).toHaveBeenCalledWith({
        where: { id: 'sc-1' },
        data: { usb_bus: 1, usb_device: 8 },
      });
    });

    // The 2026-09-16 hardware reproduction, as a unit test: the row was
    // synced to usb_device 7, the device came back at 8 after a physical
    // power-cycle, a session started fine on the live name, and retry failed
    // on the stale one. This is the whole point of the change.
    it('respawns on the live address after a power-cycle moved the device number (#182)', async () => {
      const db = createMockRetryDb({
        usb_bus: 1,
        usb_device: 7,
        usb_port: '1-2.3',
        enabled: true,
      });
      mockDetectAsync.mockResolvedValue(detectionReporting(1, 8) as any);

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result).toEqual({ success: true });
      expect(coordinator.addScanner).toHaveBeenCalledWith(
        expect.objectContaining({ saneName: 'epkowa:interpreter:001:008' })
      );
      // Explicit: the stale name must not be used. Without this the test
      // would still pass if the implementation called addScanner twice, or
      // if a later refactor reintroduced the stale read alongside the fresh
      // one.
      expect(coordinator.addScanner).not.toHaveBeenCalledWith(
        expect.objectContaining({ saneName: 'epkowa:interpreter:001:007' })
      );
      // The corrected address is persisted, so the Configure Scanner page
      // and the scan log's before/after stay honest.
      expect(db.graviScanner.update).toHaveBeenCalledWith({
        where: { id: 'sc-1' },
        data: { usb_bus: 1, usb_device: 8 },
      });
    });

    it('retries without a DB write when the address has not moved', async () => {
      const db = createMockRetryDb({
        usb_bus: 3,
        usb_device: 7,
        usb_port: '3-1',
        enabled: true,
      });
      mockDetectAsync.mockResolvedValue(detectionReporting(3, 7, '3-1') as any);

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result).toEqual({ success: true });
      expect(coordinator.addScanner).toHaveBeenCalledWith(
        expect.objectContaining({ saneName: 'epkowa:interpreter:003:007' })
      );
      expect(db.graviScanner.update).not.toHaveBeenCalled();
    });

    it('in mock mode, retries without invoking USB detection', async () => {
      // The one retry scenario CI can exercise end to end, since CI has no
      // real scanner and mock scanners never re-enumerate.
      process.env.GRAVISCAN_MOCK = 'true';
      const db = createMockRetryDb({
        usb_bus: 1,
        usb_device: 2,
        usb_port: '1-1',
        enabled: true,
      });

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result).toEqual({ success: true });
      expect(mockDetectAsync).not.toHaveBeenCalled();
      expect(coordinator.addScanner).toHaveBeenCalledWith(
        expect.objectContaining({ saneName: 'epkowa:interpreter:001:002' })
      );
    });

    it('refreshes the address strictly before stopping the scanner', async () => {
      // Ordering, not just counts: refresh must run BEFORE stopScanner, so a
      // scanner that cannot be re-resolved is left running rather than
      // stopped and unrecoverable.
      const calls: string[] = [];
      mockDetectAsync.mockImplementation(async () => {
        calls.push('detect');
        return detectionReporting(1, 8) as any;
      });
      coordinator = createMockCoordinator({
        stopScanner: vi.fn(async () => {
          calls.push('stopScanner');
        }),
        addScanner: vi.fn(async () => {
          calls.push('addScanner');
        }),
      } as any);
      const db = createMockRetryDb({
        usb_bus: 1,
        usb_device: 7,
        usb_port: '1-2.3',
        enabled: true,
      });

      await retryScanner(coordinator, db as any, sessionFns, 'sc-1');

      expect(calls).toEqual(['detect', 'stopScanner', 'addScanner']);
    });

    it('fails without respawning when the scanner is not detected at its port', async () => {
      const db = createMockRetryDb({
        usb_bus: 1,
        usb_device: 7,
        usb_port: '1-2.3',
        display_name: 'Scanner A',
        enabled: true,
      });
      // Detection succeeds but nothing occupies the saved port — the
      // scanner is powered off, which after a power-cycle is the likeliest
      // reason a retry fails.
      mockDetectAsync.mockResolvedValue({
        success: true,
        count: 0,
        scanners: [],
      } as any);

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result.success).toBe(false);
      // Identifies the scanner usefully: the port and the display name, so
      // the message is actionable at 2am.
      expect(result.error).toContain('1-2.3');
      expect(result.error).toContain('Scanner A');
      // A fallback here would be a guaranteed false positive: after a
      // power-cycle the stored address is ALWAYS wrong.
      expect(coordinator.stopScanner).not.toHaveBeenCalled();
      expect(coordinator.addScanner).not.toHaveBeenCalled();
      expect(scanLog).toHaveBeenCalledWith(
        expect.stringContaining('scanner=sc-1 session=session-42')
      );
    });

    it('does not tell the operator to run Detect Scanners when the scanner is not detected', async () => {
      // `saveScannersToDB` calls `disableStaleScannerRows`, which disables
      // every enabled row whose `usb_port` is absent from the current
      // detection set — i.e. exactly this powered-off scanner. And unlike
      // Reset USB, that path is not gated on an active scan. So the
      // prohibition covers `not-detected`, not just `no-stable-port`.
      const db = createMockRetryDb({
        usb_bus: 1,
        usb_device: 7,
        usb_port: '1-2.3',
        enabled: true,
      });
      mockDetectAsync.mockResolvedValue({
        success: true,
        count: 0,
        scanners: [],
      } as any);

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result.error).not.toMatch(/detect scanners/i);
    });

    it('fails without respawning when the row has no usable usb_port', async () => {
      const db = createMockRetryDb({
        usb_bus: 1,
        usb_device: 7,
        usb_port: null,
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
      expect(result.error).not.toMatch(/detect scanners/i);
      expect(coordinator.stopScanner).not.toHaveBeenCalled();
      expect(coordinator.addScanner).not.toHaveBeenCalled();
    });

    it('fails without respawning when USB detection itself fails', async () => {
      const db = createMockRetryDb({
        usb_bus: 1,
        usb_device: 7,
        usb_port: '1-2.3',
        enabled: true,
      });
      mockDetectAsync.mockResolvedValue({
        success: false,
        count: 0,
        scanners: [],
        error: 'lsusb not available',
      } as any);

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

    it('fails without respawning on an unusable resolved address in mock mode', async () => {
      // Guards `epkowa:interpreter:null:null`, which mock-mode spawning does
      // NOT validate — `buildSubprocessEnv`'s /^\d{3}$/ check sits inside a
      // `platform === 'linux' && !mock` branch — so without this a mock
      // retry would report success on a nonsense device.
      process.env.GRAVISCAN_MOCK = 'true';
      const db = createMockRetryDb({
        usb_bus: null,
        usb_device: null,
        usb_port: '1-2.3',
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
      // Nothing that could be formatted into a name containing 'null'
      // reached the coordinator.
      expect(coordinator.addScanner).not.toHaveBeenCalledWith(
        expect.objectContaining({ saneName: expect.stringContaining('null') })
      );
    });

    it('identifies a scanner with no display_name by its port, not its identifier', async () => {
      // The rig's real row: `display_name` null and `name` the model string,
      // which is identical across all five production scanners. A
      // display_name-first message degrades to a UUID on exactly the
      // hardware this feature runs on.
      const db = createMockRetryDb({
        usb_bus: 1,
        usb_device: 8,
        usb_port: '1-8',
        display_name: null,
        name: 'Perfection V600 Photo',
        enabled: true,
      });
      mockDetectAsync.mockResolvedValue({
        success: true,
        count: 0,
        scanners: [],
      } as any);

      const result = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('1-8');
      // `name` is the model string — useless for distinguishing scanners.
      expect(result.error).not.toContain('Perfection V600 Photo');
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
      // The enabled guard stays strictly BEFORE refresh, so a disabled
      // scanner costs no USB detection. Without this assertion the test
      // would pass whether or not detection ran.
      expect(mockDetectAsync).not.toHaveBeenCalled();
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
      expect(mockDetectAsync).not.toHaveBeenCalled();
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
      expect(mockDetectAsync).not.toHaveBeenCalled();
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
      expect(mockDetectAsync).not.toHaveBeenCalled();
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
      expect(scanLog).toHaveBeenCalledWith(
        expect.stringContaining('scanner=sc-1 session=session-42')
      );
    });

    it('rejects a second concurrent retry for the same scannerId while the first is still in flight, without a second stopScanner()+addScanner() pair', async () => {
      let resolveAddScanner!: () => void;
      coordinator = createMockCoordinator({
        addScanner: vi.fn(
          () =>
            new Promise<void>((resolve) => {
              resolveAddScanner = resolve;
            })
        ),
      } as any);
      const db = createMockRetryDb({
        usb_bus: 3,
        usb_device: 7,
        enabled: true,
      });

      const first = retryScanner(coordinator, db as any, sessionFns, 'sc-1');
      const second = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(second.success).toBe(false);
      expect(second.error).toContain('already in progress');

      // Let the first call's own await chain (findUnique, then
      // stopScanner) actually reach its addScanner() call before we
      // resolve it.
      await new Promise((r) => setTimeout(r, 0));
      resolveAddScanner();
      const firstResult = await first;
      expect(firstResult.success).toBe(true);
      // Only the first call's addScanner() ever ran — the second was
      // rejected by the in-flight guard before reaching the coordinator.
      expect(coordinator.addScanner).toHaveBeenCalledTimes(1);
    });

    it('allows a subsequent retry for the same scannerId once a prior retry has resolved', async () => {
      const db = createMockRetryDb({
        usb_bus: 3,
        usb_device: 7,
        enabled: true,
      });

      const first = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );
      const second = await retryScanner(
        coordinator,
        db as any,
        sessionFns,
        'sc-1'
      );

      expect(first.success).toBe(true);
      expect(second.success).toBe(true);
      expect(coordinator.addScanner).toHaveBeenCalledTimes(2);
    });
  });
});
