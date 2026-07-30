// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all handler modules
vi.mock('../../../src/main/graviscan/scanner-handlers', () => ({
  detectScanners: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn().mockResolvedValue(null),
  saveConfig: vi.fn().mockResolvedValue(undefined),
  saveScannersToDB: vi.fn().mockResolvedValue(undefined),
  getPlatformInfo: vi
    .fn()
    .mockResolvedValue({ platform: 'linux', backend: 'sane' }),
  runStartupScannerValidation: vi.fn().mockResolvedValue({ valid: true }),
  validateConfig: vi.fn().mockResolvedValue({ status: 'valid' }),
  resetUsb: vi.fn().mockResolvedValue({ success: true, scanners: [] }),
  getScannerStatus: vi.fn().mockResolvedValue({ success: true, scanners: [] }),
}));

vi.mock('../../../src/main/graviscan/scanner-upsert', () => ({
  disableScannerById: vi.fn().mockResolvedValue({ ok: true }),
  stopWorkersForDisabledScanners: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/main/graviscan/session-handlers', () => ({
  startScan: vi.fn().mockResolvedValue({ success: true }),
  getScanStatus: vi.fn().mockReturnValue(null),
  markJobRecorded: vi.fn(),
  cancelScan: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../../src/main/graviscan/image-handlers', () => ({
  getOutputDir: vi
    .fn()
    .mockReturnValue({ success: true, path: '/home/user/.bloom/graviscan' }),
  readScanImage: vi.fn().mockResolvedValue({ data: 'base64...' }),
  uploadAllScans: vi.fn().mockResolvedValue({ uploaded: 0 }),
  downloadImages: vi.fn().mockResolvedValue({ exported: 0 }),
  ensureDir: vi.fn().mockResolvedValue({ success: true, path: '/scans/s1' }),
  listScanFiles: vi.fn().mockReturnValue({ success: true, files: [] }),
}));

vi.mock('../../../src/main/graviscan/verify-plates', () => ({
  verifyPlates: vi
    .fn()
    .mockResolvedValue({ success: true, results: [], swaps: [] }),
}));

// Mock fs for realpath validation
vi.mock('fs', () => ({
  realpathSync: vi.fn((p: string) => p), // identity by default
  existsSync: vi.fn(() => true), // "everything exists" by default
}));

import * as fs from 'fs';
import * as path from 'path';

// The mocked output directory every containment check is measured against.
const OUTPUT_DIR = '/home/user/.bloom/graviscan';
import * as scannerHandlers from '../../../src/main/graviscan/scanner-handlers';
import * as sessionHandlers from '../../../src/main/graviscan/session-handlers';
import * as imageHandlers from '../../../src/main/graviscan/image-handlers';
import * as scannerUpsert from '../../../src/main/graviscan/scanner-upsert';
import * as verifyPlatesHandlers from '../../../src/main/graviscan/verify-plates';
import {
  registerGraviScanHandlers,
  _resetRegistration,
} from '../../../src/main/graviscan/register-handlers';

// Channel → handler mapping for parametric tests
const CHANNELS = [
  'graviscan:detect-scanners',
  'graviscan:get-config',
  'graviscan:save-config',
  'graviscan:save-scanners-db',
  'graviscan:disable-scanner',
  'graviscan:platform-info',
  'graviscan:validate-scanners',
  'graviscan:validate-config',
  'graviscan:start-scan',
  'graviscan:get-scan-status',
  'graviscan:mark-job-recorded',
  'graviscan:cancel-scan',
  'graviscan:get-output-dir',
  'graviscan:read-scan-image',
  'graviscan:upload-all-scans',
  'graviscan:download-images',
  'graviscan:reset-usb',
  'graviscan:verify-plates',
  'graviscan:get-scanner-status',
  'graviscan:ensure-dir',
  'graviscan:list-scan-files',
];

function createMockIpcMain() {
  const handlers = new Map<string, (...args: any[]) => any>();
  return {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
    _handlers: handlers,
    _invoke: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for ${channel}`);
      return handler(
        {
          /* mock event */
        },
        ...args
      );
    },
  };
}

function createMockSessionFns() {
  return {
    getScanSession: vi.fn().mockReturnValue(null),
    setScanSession: vi.fn(),
    markScanJobRecorded: vi.fn(),
  };
}

describe('registerGraviScanHandlers', () => {
  let mockIpcMain: ReturnType<typeof createMockIpcMain>;
  let mockDb: any;
  let mockSessionFns: ReturnType<typeof createMockSessionFns>;
  let mockGetMainWindow: ReturnType<typeof vi.fn>;
  let mockGetCoordinator: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetRegistration();
    mockIpcMain = createMockIpcMain();
    mockDb = {};
    mockSessionFns = createMockSessionFns();
    mockGetMainWindow = vi.fn().mockReturnValue(null);
    mockGetCoordinator = vi.fn().mockReturnValue(null);

    // Default fs.realpathSync to identity (mock paths don't exist on disk)
    vi.mocked(fs.realpathSync).mockImplementation((p) => p as string);
    // Default every path to "exists" so containment checks that tolerate a
    // not-yet-created directory behave like the strict check unless a test
    // opts into a missing path.
    vi.mocked(fs.existsSync).mockImplementation(() => true);

    // Suppress console
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('registers all 23 IPC channels', () => {
    registerGraviScanHandlers(
      mockIpcMain as any,
      mockDb,
      mockGetMainWindow,
      mockSessionFns,
      mockGetCoordinator
    );

    expect(mockIpcMain.handle).toHaveBeenCalledTimes(23);
    for (const channel of CHANNELS) {
      expect(mockIpcMain._handlers.has(channel)).toBe(true);
    }
  });

  describe('channel delegation', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it.each([
      ['graviscan:detect-scanners', scannerHandlers.detectScanners],
      ['graviscan:get-config', scannerHandlers.getConfig],
      ['graviscan:platform-info', scannerHandlers.getPlatformInfo],
      ['graviscan:validate-config', scannerHandlers.validateConfig],
      ['graviscan:get-output-dir', imageHandlers.getOutputDir],
    ])('%s delegates to correct handler', async (channel, handler) => {
      await mockIpcMain._invoke(channel);
      expect(handler).toHaveBeenCalled();
    });

    it('graviscan:save-config passes config arg', async () => {
      await mockIpcMain._invoke('graviscan:save-config', {
        grid_mode: '2grid',
        resolution: 600,
      });
      expect(scannerHandlers.saveConfig).toHaveBeenCalledWith(mockDb, {
        grid_mode: '2grid',
        resolution: 600,
      });
    });

    it('graviscan:validate-scanners passes cachedIds', async () => {
      await mockIpcMain._invoke('graviscan:validate-scanners', ['id1', 'id2']);
      expect(scannerHandlers.runStartupScannerValidation).toHaveBeenCalledWith(
        mockDb,
        ['id1', 'id2']
      );
    });

    it('graviscan:start-scan delegates to startScan', async () => {
      const params = { scanners: [], metadata: {} };
      await mockIpcMain._invoke('graviscan:start-scan', params);
      expect(sessionHandlers.startScan).toHaveBeenCalled();
    });

    it('graviscan:get-scan-status delegates to getScanStatus', async () => {
      await mockIpcMain._invoke('graviscan:get-scan-status');
      expect(sessionHandlers.getScanStatus).toHaveBeenCalledWith(
        mockSessionFns
      );
    });

    it('graviscan:mark-job-recorded passes jobKey', async () => {
      await mockIpcMain._invoke('graviscan:mark-job-recorded', 'scanner1:00');
      expect(sessionHandlers.markJobRecorded).toHaveBeenCalledWith(
        mockSessionFns,
        'scanner1:00'
      );
    });

    it('graviscan:cancel-scan delegates to cancelScan', async () => {
      await mockIpcMain._invoke('graviscan:cancel-scan');
      expect(sessionHandlers.cancelScan).toHaveBeenCalled();
    });
  });

  describe('graviscan:disable-scanner', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('delegates to disableScannerById with db, coordinator, scannerId', async () => {
      const coordinator = { hasWorker: vi.fn(), stopScanner: vi.fn() };
      mockGetCoordinator.mockReturnValue(coordinator);

      const result = await mockIpcMain._invoke(
        'graviscan:disable-scanner',
        'scanner-1'
      );

      expect(scannerUpsert.disableScannerById).toHaveBeenCalledWith(
        mockDb,
        coordinator,
        'scanner-1'
      );
      expect(result).toEqual({ ok: true });
    });

    it('passes a null coordinator through when none is initialized', async () => {
      mockGetCoordinator.mockReturnValue(null);

      await mockIpcMain._invoke('graviscan:disable-scanner', 'scanner-1');

      expect(scannerUpsert.disableScannerById).toHaveBeenCalledWith(
        mockDb,
        null,
        'scanner-1'
      );
    });

    it('returns { ok: false, error } surfaced from the helper', async () => {
      vi.mocked(scannerUpsert.disableScannerById).mockResolvedValueOnce({
        ok: false,
        error: 'Scanner unknown-id not found',
      });

      const result = await mockIpcMain._invoke(
        'graviscan:disable-scanner',
        'unknown-id'
      );

      expect(result).toEqual({
        ok: false,
        error: 'Scanner unknown-id not found',
      });
    });

    it('returns { ok: false, error } when the helper throws', async () => {
      vi.mocked(scannerUpsert.disableScannerById).mockRejectedValueOnce(
        new Error('DB unavailable')
      );

      const result = await mockIpcMain._invoke(
        'graviscan:disable-scanner',
        'scanner-1'
      );

      expect(result).toEqual({ ok: false, error: 'DB unavailable' });
    });
  });

  describe('graviscan:save-scanners-db coordinator orchestration', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('does nothing coordinator-related when no coordinator is initialized', async () => {
      vi.mocked(scannerHandlers.saveScannersToDB).mockResolvedValueOnce({
        success: true,
        scanners: [{ id: 's1', enabled: true, usb_bus: 1, usb_device: 2 }],
        count: 1,
        disabled: [],
      } as any);
      mockGetCoordinator.mockReturnValue(null);

      const result = await mockIpcMain._invoke(
        'graviscan:save-scanners-db',
        []
      );

      expect(result.success).toBe(true);
      expect(
        scannerUpsert.stopWorkersForDisabledScanners
      ).not.toHaveBeenCalled();
    });

    it('spawns a worker for a saved, enabled scanner with no running worker (#234)', async () => {
      vi.mocked(scannerHandlers.saveScannersToDB).mockResolvedValueOnce({
        success: true,
        scanners: [
          {
            id: 's1',
            enabled: true,
            usb_bus: 1,
            usb_device: 2,
            usb_port: '1-2',
          },
        ],
        count: 1,
        disabled: [],
      } as any);
      const coordinator = {
        hasWorker: vi.fn().mockReturnValue(false),
        addScanner: vi.fn().mockResolvedValue(undefined),
        stopScanner: vi.fn(),
      };
      mockGetCoordinator.mockReturnValue(coordinator);

      await mockIpcMain._invoke('graviscan:save-scanners-db', []);

      expect(coordinator.addScanner).toHaveBeenCalledWith({
        scannerId: 's1',
        saneName: 'epkowa:interpreter:001:002',
        plates: [],
      });
    });

    it('does not block the IPC response on addScanner() resolving (final-review #5)', async () => {
      vi.mocked(scannerHandlers.saveScannersToDB).mockResolvedValueOnce({
        success: true,
        scanners: [
          {
            id: 's1',
            enabled: true,
            usb_bus: 1,
            usb_device: 2,
            usb_port: '1-2',
          },
        ],
        count: 1,
        disabled: [],
      } as any);
      // Simulate addScanner() being queued behind an active scan cycle —
      // its promise never resolves within this test's lifetime.
      let addScannerResolved = false;
      const coordinator = {
        hasWorker: vi.fn().mockReturnValue(false),
        addScanner: vi.fn().mockImplementation(
          () =>
            new Promise<void>((resolve) => {
              setTimeout(() => {
                addScannerResolved = true;
                resolve();
              }, 60_000); // effectively "never" for this test
            })
        ),
        stopScanner: vi.fn(),
      };
      mockGetCoordinator.mockReturnValue(coordinator);

      const result = await mockIpcMain._invoke(
        'graviscan:save-scanners-db',
        []
      );

      // The IPC response must have resolved WITHOUT waiting for
      // addScanner() to settle.
      expect(result.success).toBe(true);
      expect(addScannerResolved).toBe(false);
      expect(coordinator.addScanner).toHaveBeenCalledTimes(1);
    });

    it('serializes concurrent spawn-on-discovery calls instead of firing them in parallel (second-round fix)', async () => {
      // scan-coordinator.ts's own "Staggered initialization" doc comment
      // requires spawning subprocesses one at a time to avoid SANE init
      // contention. save-scanners-db discovering 2+ new scanners at once
      // must not violate that — each addScanner() call must wait for the
      // previous one to settle before starting, even though none of them
      // block the IPC response itself.
      vi.mocked(scannerHandlers.saveScannersToDB).mockResolvedValueOnce({
        success: true,
        scanners: [
          {
            id: 's1',
            enabled: true,
            usb_bus: 1,
            usb_device: 2,
            usb_port: '1-2',
          },
          {
            id: 's2',
            enabled: true,
            usb_bus: 1,
            usb_device: 3,
            usb_port: '1-3',
          },
        ],
        count: 2,
        disabled: [],
      } as any);

      const callOrder: string[] = [];
      let resolveFirst: (() => void) | undefined;
      const firstDeferred = new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });

      const coordinator = {
        hasWorker: vi.fn().mockReturnValue(false),
        addScanner: vi
          .fn()
          .mockImplementationOnce(async (cfg: { scannerId: string }) => {
            callOrder.push(`start:${cfg.scannerId}`);
            await firstDeferred; // s1 does not resolve until we say so
            callOrder.push(`end:${cfg.scannerId}`);
          })
          .mockImplementationOnce(async (cfg: { scannerId: string }) => {
            callOrder.push(`start:${cfg.scannerId}`);
          }),
        stopScanner: vi.fn(),
      };
      mockGetCoordinator.mockReturnValue(coordinator);

      await mockIpcMain._invoke('graviscan:save-scanners-db', []);
      // Flush a microtask tick so the first spawn's synchronous prefix
      // (up to its internal `await`) has had a chance to run.
      await Promise.resolve();
      await Promise.resolve();

      // Only s1 should have started — s2 must not fire until s1 settles.
      expect(coordinator.addScanner).toHaveBeenCalledTimes(1);
      expect(callOrder).toEqual(['start:s1']);

      // Now let s1 resolve and flush again.
      resolveFirst!();
      await new Promise((r) => setTimeout(r, 0));
      await new Promise((r) => setTimeout(r, 0));

      // s2 should now have started, strictly after s1 ended.
      expect(coordinator.addScanner).toHaveBeenCalledTimes(2);
      expect(callOrder).toEqual(['start:s1', 'end:s1', 'start:s2']);
    });

    it('skips spawning (and logs) when usb_bus/usb_device are null instead of synthesizing a fake saneName (final-review #8)', async () => {
      vi.mocked(scannerHandlers.saveScannersToDB).mockResolvedValueOnce({
        success: true,
        scanners: [
          {
            id: 's1',
            enabled: true,
            usb_bus: null,
            usb_device: null,
            usb_port: '1-2',
          },
        ],
        count: 1,
        disabled: [],
      } as any);
      const coordinator = {
        hasWorker: vi.fn().mockReturnValue(false),
        addScanner: vi.fn().mockResolvedValue(undefined),
        stopScanner: vi.fn(),
      };
      mockGetCoordinator.mockReturnValue(coordinator);
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await mockIpcMain._invoke('graviscan:save-scanners-db', []);

      expect(coordinator.addScanner).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('Skipping spawn for s1')
      );
    });

    it('does not spawn a worker for a scanner that already has one', async () => {
      vi.mocked(scannerHandlers.saveScannersToDB).mockResolvedValueOnce({
        success: true,
        scanners: [{ id: 's1', enabled: true, usb_bus: 1, usb_device: 2 }],
        count: 1,
        disabled: [],
      } as any);
      const coordinator = {
        hasWorker: vi.fn().mockReturnValue(true),
        addScanner: vi.fn().mockResolvedValue(undefined),
        stopScanner: vi.fn(),
      };
      mockGetCoordinator.mockReturnValue(coordinator);

      await mockIpcMain._invoke('graviscan:save-scanners-db', []);

      expect(coordinator.addScanner).not.toHaveBeenCalled();
    });

    it('does not spawn a worker for a disabled scanner', async () => {
      vi.mocked(scannerHandlers.saveScannersToDB).mockResolvedValueOnce({
        success: true,
        scanners: [{ id: 's1', enabled: false, usb_bus: 1, usb_device: 2 }],
        count: 1,
        disabled: [],
      } as any);
      const coordinator = {
        hasWorker: vi.fn().mockReturnValue(false),
        addScanner: vi.fn().mockResolvedValue(undefined),
        stopScanner: vi.fn(),
      };
      mockGetCoordinator.mockReturnValue(coordinator);

      await mockIpcMain._invoke('graviscan:save-scanners-db', []);

      expect(coordinator.addScanner).not.toHaveBeenCalled();
    });

    it('stops orphan workers for stale-disabled scanner ids (#20)', async () => {
      vi.mocked(scannerHandlers.saveScannersToDB).mockResolvedValueOnce({
        success: true,
        scanners: [],
        count: 0,
        disabled: ['stale-1', 'stale-2'],
      } as any);
      const coordinator = {
        hasWorker: vi.fn().mockReturnValue(false),
        addScanner: vi.fn().mockResolvedValue(undefined),
        stopScanner: vi.fn(),
      };
      mockGetCoordinator.mockReturnValue(coordinator);

      await mockIpcMain._invoke('graviscan:save-scanners-db', []);

      expect(scannerUpsert.stopWorkersForDisabledScanners).toHaveBeenCalledWith(
        coordinator,
        ['stale-1', 'stale-2']
      );
    });

    it('does not call stopWorkersForDisabledScanners when nothing was disabled', async () => {
      vi.mocked(scannerHandlers.saveScannersToDB).mockResolvedValueOnce({
        success: true,
        scanners: [],
        count: 0,
        disabled: [],
      } as any);
      mockGetCoordinator.mockReturnValue({
        hasWorker: vi.fn().mockReturnValue(false),
        addScanner: vi.fn(),
        stopScanner: vi.fn(),
      });

      await mockIpcMain._invoke('graviscan:save-scanners-db', []);

      expect(
        scannerUpsert.stopWorkersForDisabledScanners
      ).not.toHaveBeenCalled();
    });

    it('does not attempt coordinator orchestration when saveScannersToDB fails', async () => {
      vi.mocked(scannerHandlers.saveScannersToDB).mockResolvedValueOnce({
        success: false,
        error: 'DB error',
        scanners: [],
        disabled: [],
      } as any);
      const coordinator = {
        hasWorker: vi.fn().mockReturnValue(false),
        addScanner: vi.fn(),
        stopScanner: vi.fn(),
      };
      mockGetCoordinator.mockReturnValue(coordinator);

      await mockIpcMain._invoke('graviscan:save-scanners-db', []);

      expect(coordinator.addScanner).not.toHaveBeenCalled();
      expect(
        scannerUpsert.stopWorkersForDisabledScanners
      ).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('returns { success: false, error } when handler throws', async () => {
      vi.mocked(scannerHandlers.detectScanners).mockRejectedValueOnce(
        new Error('DB connection failed')
      );

      const result = await mockIpcMain._invoke('graviscan:detect-scanners');
      expect(result).toEqual({
        success: false,
        error: 'DB connection failed',
      });
    });

    it('logs errors via console.error', async () => {
      vi.mocked(scannerHandlers.detectScanners).mockRejectedValueOnce(
        new Error('DB connection failed')
      );

      await mockIpcMain._invoke('graviscan:detect-scanners');
      expect(console.error).toHaveBeenCalledWith(
        '[GraviScan IPC]',
        'DB connection failed'
      );
    });
  });

  describe('path validation', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('allows paths within output directory', async () => {
      const result = await mockIpcMain._invoke(
        'graviscan:read-scan-image',
        '/home/user/.bloom/graviscan/exp1/scan.tiff',
        {}
      );
      expect(result.success).toBe(true);
      expect(imageHandlers.readScanImage).toHaveBeenCalled();
    });

    it('rejects paths outside output directory', async () => {
      const result = await mockIpcMain._invoke(
        'graviscan:read-scan-image',
        '/etc/passwd',
        {}
      );
      expect(result).toEqual({
        success: false,
        error: 'Path outside scan directory',
      });
      expect(imageHandlers.readScanImage).not.toHaveBeenCalled();
    });

    it('rejects path traversal attempts', async () => {
      const result = await mockIpcMain._invoke(
        'graviscan:read-scan-image',
        '/home/user/.bloom/graviscan/../../etc/passwd',
        {}
      );
      expect(result).toEqual({
        success: false,
        error: 'Path outside scan directory',
      });
    });
  });

  describe('upload guard', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('rejects upload when coordinator is scanning', async () => {
      mockGetCoordinator.mockReturnValue({ isScanning: true });

      const result = await mockIpcMain._invoke('graviscan:upload-all-scans');
      expect(result).toEqual({
        success: false,
        error: 'Cannot upload while scanning is in progress',
      });
      expect(imageHandlers.uploadAllScans).not.toHaveBeenCalled();
    });

    it('allows upload when no scan active', async () => {
      mockGetCoordinator.mockReturnValue(null);

      const result = await mockIpcMain._invoke('graviscan:upload-all-scans');
      expect(result.success).toBe(true);
    });
  });

  describe('graviscan:get-scanner-status', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('delegates to scannerHandlers.getScannerStatus with the coordinator and db', async () => {
      const coordinator = { getScannerStatuses: vi.fn().mockReturnValue([]) };
      mockGetCoordinator.mockReturnValue(coordinator);

      await mockIpcMain._invoke('graviscan:get-scanner-status');

      expect(scannerHandlers.getScannerStatus).toHaveBeenCalledWith(
        coordinator,
        mockDb
      );
    });

    it('returns the result shape directly (not double-wrapped via wrapHandler)', async () => {
      vi.mocked(scannerHandlers.getScannerStatus).mockResolvedValueOnce({
        success: true,
        scanners: [
          {
            scannerId: 's1',
            displayName: 'Scanner 1',
            usbPort: '1-2',
            gridMode: '2grid',
            status: 'ready',
          },
        ],
      } as any);

      const result = await mockIpcMain._invoke('graviscan:get-scanner-status');

      expect(result).toEqual({
        success: true,
        scanners: [
          {
            scannerId: 's1',
            displayName: 'Scanner 1',
            usbPort: '1-2',
            gridMode: '2grid',
            status: 'ready',
          },
        ],
      });
    });
  });

  describe('graviscan:ensure-dir', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('delegates to imageHandlers.ensureDir with the resolved dirPath', async () => {
      const dirPath = `${OUTPUT_DIR}/session-1`;

      await mockIpcMain._invoke('graviscan:ensure-dir', dirPath);

      // The validated path is what gets used, not the caller's raw string.
      expect(imageHandlers.ensureDir).toHaveBeenCalledWith(
        path.resolve(dirPath)
      );
    });

    it('returns the result shape directly', async () => {
      vi.mocked(imageHandlers.ensureDir).mockResolvedValueOnce({
        success: true,
        path: `${OUTPUT_DIR}/session-1`,
      });

      const result = await mockIpcMain._invoke(
        'graviscan:ensure-dir',
        `${OUTPUT_DIR}/session-1`
      );

      expect(result).toEqual({
        success: true,
        path: `${OUTPUT_DIR}/session-1`,
      });
    });

    it('rejects a dirPath outside the scan output directory', async () => {
      const result = await mockIpcMain._invoke(
        'graviscan:ensure-dir',
        '/etc/cron.d/evil'
      );

      expect(result).toEqual({
        success: false,
        error: 'Path outside scan directory',
      });
      expect(imageHandlers.ensureDir).not.toHaveBeenCalled();
    });

    it('rejects a `..` traversal that escapes the scan output directory', async () => {
      const result = await mockIpcMain._invoke(
        'graviscan:ensure-dir',
        `${OUTPUT_DIR}/../../../etc/cron.d/evil`
      );

      expect(result).toEqual({
        success: false,
        error: 'Path outside scan directory',
      });
      expect(imageHandlers.ensureDir).not.toHaveBeenCalled();
    });

    it('rejects a symlinked dirPath that really resolves outside the output directory', async () => {
      const link = path.resolve(`${OUTPUT_DIR}/escape-hatch`);
      vi.mocked(fs.realpathSync).mockImplementation((p) =>
        (p as string) === link ? path.resolve('/etc/cron.d') : (p as string)
      );

      const result = await mockIpcMain._invoke('graviscan:ensure-dir', link);

      expect(result).toEqual({
        success: false,
        error: 'Path outside scan directory',
      });
      expect(imageHandlers.ensureDir).not.toHaveBeenCalled();
    });

    it('still allows a contained directory that does not exist yet (the whole point of ensure-dir)', async () => {
      const dirPath = path.resolve(`${OUTPUT_DIR}/brand-new-session`);
      // Only the leaf is missing; containment is judged from the deepest
      // ancestor that does exist, whose symlinks realpathSync can resolve.
      vi.mocked(fs.existsSync).mockImplementation((p) => p !== dirPath);

      const result = await mockIpcMain._invoke('graviscan:ensure-dir', dirPath);

      expect(imageHandlers.ensureDir).toHaveBeenCalledWith(dirPath);
      expect(result.success).toBe(true);
    });

    it('rejects a not-yet-existing dirPath whose existing ancestor is outside the output directory', async () => {
      const dirPath = path.resolve('/etc/cron.d/not-created-yet');
      vi.mocked(fs.existsSync).mockImplementation((p) => p !== dirPath);

      const result = await mockIpcMain._invoke('graviscan:ensure-dir', dirPath);

      expect(result).toEqual({
        success: false,
        error: 'Path outside scan directory',
      });
      expect(imageHandlers.ensureDir).not.toHaveBeenCalled();
    });

    it('delegates a missing dirPath through unvalidated so image-handlers owns the "required" error', async () => {
      await mockIpcMain._invoke('graviscan:ensure-dir', undefined);

      expect(imageHandlers.ensureDir).toHaveBeenCalledWith(undefined);
    });

    it('rejects when the output directory cannot be resolved for validation', async () => {
      vi.mocked(imageHandlers.getOutputDir).mockReturnValueOnce({
        success: false,
        error: 'no .env',
      } as any);

      const result = await mockIpcMain._invoke(
        'graviscan:ensure-dir',
        `${OUTPUT_DIR}/session-1`
      );

      expect(result).toEqual({
        success: false,
        error: 'Cannot determine scan directory for path validation',
      });
      expect(imageHandlers.ensureDir).not.toHaveBeenCalled();
    });
  });

  describe('graviscan:list-scan-files', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('delegates to imageHandlers.listScanFiles with the resolved dirPath', async () => {
      const dirPath = `${OUTPUT_DIR}/exp1`;

      await mockIpcMain._invoke('graviscan:list-scan-files', dirPath);

      expect(imageHandlers.listScanFiles).toHaveBeenCalledWith(
        path.resolve(dirPath)
      );
    });

    it('delegates with undefined dirPath when none is passed (base-dir mode)', async () => {
      await mockIpcMain._invoke('graviscan:list-scan-files');

      // No caller-supplied path to validate — listScanFiles resolves the
      // default output directory itself.
      expect(imageHandlers.listScanFiles).toHaveBeenCalledWith(undefined);
    });

    it('returns the result shape directly', async () => {
      vi.mocked(imageHandlers.listScanFiles).mockReturnValueOnce({
        success: true,
        files: [
          {
            name: 'scan_00.tif',
            path: `${OUTPUT_DIR}/exp1/scan_00.tif`,
            size: 1024,
            modifiedAt: '2026-07-01T00:00:00.000Z',
            folder: 'exp1',
          },
        ],
      });

      const result = await mockIpcMain._invoke(
        'graviscan:list-scan-files',
        `${OUTPUT_DIR}/exp1`
      );

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
    });

    it('rejects a dirPath outside the scan output directory', async () => {
      const result = await mockIpcMain._invoke(
        'graviscan:list-scan-files',
        '/etc'
      );

      expect(result).toEqual({
        success: false,
        files: [],
        error: 'Path outside scan directory',
      });
      expect(imageHandlers.listScanFiles).not.toHaveBeenCalled();
    });

    it('rejects a `..` traversal that escapes the scan output directory', async () => {
      const result = await mockIpcMain._invoke(
        'graviscan:list-scan-files',
        `${OUTPUT_DIR}/../../../etc`
      );

      expect(result).toEqual({
        success: false,
        files: [],
        error: 'Path outside scan directory',
      });
      expect(imageHandlers.listScanFiles).not.toHaveBeenCalled();
    });

    it('rejects a symlinked dirPath that really resolves outside the output directory', async () => {
      const link = path.resolve(`${OUTPUT_DIR}/escape-hatch`);
      vi.mocked(fs.realpathSync).mockImplementation((p) =>
        (p as string) === link ? path.resolve('/etc') : (p as string)
      );

      const result = await mockIpcMain._invoke(
        'graviscan:list-scan-files',
        link
      );

      expect(result).toEqual({
        success: false,
        files: [],
        error: 'Path outside scan directory',
      });
      expect(imageHandlers.listScanFiles).not.toHaveBeenCalled();
    });

    it('still delegates a contained directory that does not exist yet (empty-list contract preserved)', async () => {
      const dirPath = path.resolve(`${OUTPUT_DIR}/never-scanned`);
      vi.mocked(fs.existsSync).mockImplementation((p) => p !== dirPath);

      const result = await mockIpcMain._invoke(
        'graviscan:list-scan-files',
        dirPath
      );

      // Containment must not turn "directory not there yet" into an error —
      // listScanFiles() itself answers that with { success: true, files: [] }.
      expect(imageHandlers.listScanFiles).toHaveBeenCalledWith(dirPath);
      expect(result.success).toBe(true);
    });

    it('rejects when the output directory cannot be resolved for validation', async () => {
      vi.mocked(imageHandlers.getOutputDir).mockReturnValueOnce({
        success: false,
        error: 'no .env',
      } as any);

      const result = await mockIpcMain._invoke(
        'graviscan:list-scan-files',
        `${OUTPUT_DIR}/exp1`
      );

      expect(result).toEqual({
        success: false,
        files: [],
        error: 'Cannot determine scan directory for path validation',
      });
      expect(imageHandlers.listScanFiles).not.toHaveBeenCalled();
    });
  });

  describe('double registration', () => {
    it('throws on second call', () => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );

      expect(() =>
        registerGraviScanHandlers(
          mockIpcMain as any,
          mockDb,
          mockGetMainWindow,
          mockSessionFns,
          mockGetCoordinator
        )
      ).toThrow('already registered');
    });
  });

  describe('path validation — getOutputDir failure', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('rejects readScanImage when getOutputDir returns failure', async () => {
      vi.mocked(imageHandlers.getOutputDir).mockReturnValueOnce({
        success: false,
        error: 'Permission denied',
      } as any);

      const result = await mockIpcMain._invoke(
        'graviscan:read-scan-image',
        '/etc/passwd',
        {}
      );
      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('scan directory'),
      });
      expect(imageHandlers.readScanImage).not.toHaveBeenCalled();
    });
  });

  describe('onProgress window safety', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('upload progress checks window at send-time, not registration-time', async () => {
      // Window exists at invoke-time
      const send = vi.fn();
      const mockWin = { isDestroyed: () => false, webContents: { send } };
      mockGetMainWindow.mockReturnValue(mockWin);
      mockGetCoordinator.mockReturnValue(null);

      // Make uploadAllScans call onProgress
      vi.mocked(imageHandlers.uploadAllScans).mockImplementationOnce(
        async (_db: any, onProgress?: any) => {
          // Simulate window closing mid-upload
          mockGetMainWindow.mockReturnValue(null);
          // This should NOT crash
          if (onProgress) onProgress({ percent: 50 });
          return { uploaded: 1, skipped: 0, failed: 0, errors: [] };
        }
      );

      const result = await mockIpcMain._invoke('graviscan:upload-all-scans');
      expect(result.success).toBe(true);
      // Progress should NOT have been sent (window was null at send-time)
      expect(send).not.toHaveBeenCalled();
    });
  });

  describe('graviscan:verify-plates', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('delegates to verifyPlates with db, plates, experimentId, and the scan output dir', async () => {
      const plates = [
        {
          scannerId: 's1',
          plateIndex: '00',
          imagePath: '/scan.tif',
          assignedPlateId: 'Plate_13',
        },
      ];

      await mockIpcMain._invoke('graviscan:verify-plates', plates, 'exp-1');

      // The output directory is resolved here and passed in, so
      // verify-plates.ts can do realpath containment without importing
      // electron itself.
      expect(verifyPlatesHandlers.verifyPlates).toHaveBeenCalledWith(
        mockDb,
        plates,
        'exp-1',
        '/home/user/.bloom/graviscan',
        expect.any(Function)
      );
    });

    it('rejects the invocation when the scan output directory cannot be resolved', async () => {
      vi.mocked(imageHandlers.getOutputDir).mockReturnValueOnce({
        success: false,
        error: 'Permission denied',
      } as any);

      const result = await mockIpcMain._invoke(
        'graviscan:verify-plates',
        [],
        'exp-1'
      );

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('scan directory'),
        results: [],
        swaps: [],
      });
      expect(verifyPlatesHandlers.verifyPlates).not.toHaveBeenCalled();
    });

    it('forwards verify-started/verify-result/verify-complete to the renderer', async () => {
      const send = vi.fn();
      const mockWin = { isDestroyed: () => false, webContents: { send } };
      mockGetMainWindow.mockReturnValue(mockWin);

      vi.mocked(verifyPlatesHandlers.verifyPlates).mockImplementationOnce(
        async (
          _db: any,
          _plates: any,
          _experimentId: any,
          _outputDir: any,
          onProgress?: any
        ) => {
          onProgress?.({ type: 'verify-started' });
          onProgress?.({
            type: 'verify-result',
            result: { scannerId: 's1', status: 'verified' },
          });
          onProgress?.({
            type: 'verify-complete',
            results: [{ scannerId: 's1', status: 'verified' }],
            swaps: [],
          });
          return { success: true, results: [], swaps: [] };
        }
      );

      await mockIpcMain._invoke('graviscan:verify-plates', [], 'exp-1');

      expect(send).toHaveBeenCalledWith('graviscan:verify-started', undefined);
      expect(send).toHaveBeenCalledWith('graviscan:verify-result', {
        scannerId: 's1',
        status: 'verified',
      });
      expect(send).toHaveBeenCalledWith('graviscan:verify-complete', {
        results: [{ scannerId: 's1', status: 'verified' }],
        swaps: [],
      });
    });

    it('does not crash when no renderer window is available', async () => {
      mockGetMainWindow.mockReturnValue(null);

      vi.mocked(verifyPlatesHandlers.verifyPlates).mockImplementationOnce(
        async (
          _db: any,
          _plates: any,
          _experimentId: any,
          _outputDir: any,
          onProgress?: any
        ) => {
          onProgress?.({ type: 'verify-started' });
          return { success: true, results: [], swaps: [] };
        }
      );

      const result = await mockIpcMain._invoke(
        'graviscan:verify-plates',
        [],
        'exp-1'
      );

      expect(result).toEqual({ success: true, results: [], swaps: [] });
    });

    it('rejects the invocation when no experimentId is supplied', async () => {
      // Proceeding unscoped would let a write hit a different experiment's
      // row for the same long-lived scanner and plate position.
      const result = await mockIpcMain._invoke(
        'graviscan:verify-plates',
        [
          {
            scannerId: 's1',
            plateIndex: '00',
            imagePath: '/scan.tif',
            assignedPlateId: 'Plate_13',
          },
        ],
        undefined
      );

      expect(result).toEqual({
        success: false,
        error: expect.stringContaining('experimentId'),
        results: [],
        swaps: [],
      });
      expect(verifyPlatesHandlers.verifyPlates).not.toHaveBeenCalled();
    });

    it.each([
      ['a number', 123],
      ['a filter object', { not: 'zzz' }],
      ['an array', ['exp-1']],
      ['an empty string', ''],
      ['null', null],
    ])(
      'rejects the invocation when experimentId is %s',
      async (_label, badId) => {
        // The IPC payload is untyped, so a renderer bug (or a hostile one) can
        // put anything here. Prisma drops an `undefined` `where` key and
        // accepts a filter object in place of a scalar — either one widens
        // every write in verifyPlates() to the whole experiment table.
        const result = await mockIpcMain._invoke(
          'graviscan:verify-plates',
          [
            {
              scannerId: 's1',
              plateIndex: '00',
              imagePath: '/scan.tif',
              assignedPlateId: 'Plate_13',
            },
          ],
          badId
        );

        expect(result).toEqual({
          success: false,
          error: expect.stringContaining('experimentId'),
          results: [],
          swaps: [],
        });
        expect(verifyPlatesHandlers.verifyPlates).not.toHaveBeenCalled();
      }
    );
  });

  describe('concurrent start-scan', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('rejects start-scan when session is active', async () => {
      mockSessionFns.getScanSession.mockReturnValue({ isActive: true });

      const result = await mockIpcMain._invoke('graviscan:start-scan', {});
      expect(result).toEqual({
        success: false,
        error: 'Scan already in progress',
      });
      expect(sessionHandlers.startScan).not.toHaveBeenCalled();
    });
  });
});
