// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all handler modules
vi.mock('../../../src/main/graviscan/scanner-handlers', () => ({
  detectScanners: vi.fn().mockResolvedValue([]),
  getConfig: vi.fn().mockResolvedValue(null),
  saveConfig: vi.fn().mockResolvedValue(undefined),
  saveScannersToDB: vi.fn().mockResolvedValue(undefined),
  getPlatformInfo: vi.fn().mockResolvedValue({ platform: 'linux', backend: 'sane' }),
  runStartupScannerValidation: vi.fn().mockResolvedValue({ valid: true }),
  validateConfig: vi.fn().mockResolvedValue({ status: 'valid' }),
}));

vi.mock('../../../src/main/graviscan/session-handlers', () => ({
  startScan: vi.fn().mockResolvedValue({ success: true }),
  getScanStatus: vi.fn().mockReturnValue(null),
  markJobRecorded: vi.fn(),
  cancelScan: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('../../../src/main/graviscan/image-handlers', () => ({
  getOutputDir: vi.fn().mockReturnValue({ success: true, path: '/home/user/.bloom/graviscan' }),
  readScanImage: vi.fn().mockResolvedValue({ data: 'base64...' }),
  uploadAllScans: vi.fn().mockResolvedValue({ uploaded: 0 }),
  downloadImages: vi.fn().mockResolvedValue({ exported: 0 }),
}));

import * as scannerHandlers from '../../../src/main/graviscan/scanner-handlers';
import * as sessionHandlers from '../../../src/main/graviscan/session-handlers';
import * as imageHandlers from '../../../src/main/graviscan/image-handlers';
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
      return handler({ /* mock event */ }, ...args);
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

    // Suppress console
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('registers all 15 IPC channels', () => {
    registerGraviScanHandlers(
      mockIpcMain as any,
      mockDb,
      mockGetMainWindow,
      mockSessionFns,
      mockGetCoordinator
    );

    expect(mockIpcMain.handle).toHaveBeenCalledTimes(15);
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
      await mockIpcMain._invoke('graviscan:save-config', { grid_mode: '2grid', resolution: 600 });
      expect(scannerHandlers.saveConfig).toHaveBeenCalledWith(mockDb, { grid_mode: '2grid', resolution: 600 });
    });

    it('graviscan:validate-scanners passes cachedIds', async () => {
      await mockIpcMain._invoke('graviscan:validate-scanners', ['id1', 'id2']);
      expect(scannerHandlers.runStartupScannerValidation).toHaveBeenCalledWith(mockDb, ['id1', 'id2']);
    });

    it('graviscan:start-scan delegates to startScan', async () => {
      const params = { scanners: [], metadata: {} };
      await mockIpcMain._invoke('graviscan:start-scan', params);
      expect(sessionHandlers.startScan).toHaveBeenCalled();
    });

    it('graviscan:get-scan-status delegates to getScanStatus', async () => {
      await mockIpcMain._invoke('graviscan:get-scan-status');
      expect(sessionHandlers.getScanStatus).toHaveBeenCalledWith(mockSessionFns);
    });

    it('graviscan:mark-job-recorded passes jobKey', async () => {
      await mockIpcMain._invoke('graviscan:mark-job-recorded', 'scanner1:00');
      expect(sessionHandlers.markJobRecorded).toHaveBeenCalledWith(mockSessionFns, 'scanner1:00');
    });

    it('graviscan:cancel-scan delegates to cancelScan', async () => {
      await mockIpcMain._invoke('graviscan:cancel-scan');
      expect(sessionHandlers.cancelScan).toHaveBeenCalled();
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
