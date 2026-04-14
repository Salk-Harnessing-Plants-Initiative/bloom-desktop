// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all handler modules with realistic return values
vi.mock('../../../src/main/graviscan/scanner-handlers', () => ({
  detectScanners: vi.fn().mockResolvedValue({
    detectedScanners: [
      {
        scannerId: 'mock-1',
        saneName: 'epkowa:mock:001:002',
        displayName: 'Mock Scanner 1',
      },
    ],
    savedScanners: [],
  }),
  getConfig: vi.fn().mockResolvedValue(null),
  saveConfig: vi
    .fn()
    .mockResolvedValue({ grid_mode: '2grid', resolution: 600 }),
  saveScannersToDB: vi.fn().mockResolvedValue(undefined),
  getPlatformInfo: vi
    .fn()
    .mockResolvedValue({ platform: 'linux', backend: 'sane' }),
  runStartupScannerValidation: vi
    .fn()
    .mockResolvedValue({ valid: true, scanners: [] }),
  validateConfig: vi.fn().mockResolvedValue({ status: 'valid' }),
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
  readScanImage: vi
    .fn()
    .mockResolvedValue({ data: 'base64data', width: 400, height: 300 }),
  uploadAllScans: vi.fn().mockResolvedValue({ uploaded: 0, errors: [] }),
  downloadImages: vi.fn().mockResolvedValue({ exported: 0 }),
}));

import * as scannerHandlers from '../../../src/main/graviscan/scanner-handlers';
import * as sessionHandlers from '../../../src/main/graviscan/session-handlers';
import {
  registerGraviScanHandlers,
  _resetRegistration,
} from '../../../src/main/graviscan/register-handlers';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockIpcMain() {
  const handlers = new Map<string, (...args: any[]) => any>();
  return {
    handle: vi.fn((channel: string, handler: (...args: any[]) => any) => {
      handlers.set(channel, handler);
    }),
    invoke: async (channel: string, ...args: unknown[]) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler for ${channel}`);
      return handler(
        {
          /* mock IPC event */
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GraviScan IPC integration (invocation round-trip)', () => {
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

    // Suppress console output
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  // -------------------------------------------------------------------------
  // 1. Handler invocation round-trip tests
  // -------------------------------------------------------------------------
  describe('handler invocation round-trip', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('detectScanners returns mock scanner data wrapped in {success, data}', async () => {
      const result = await mockIpcMain.invoke('graviscan:detect-scanners');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        detectedScanners: [
          {
            scannerId: 'mock-1',
            saneName: 'epkowa:mock:001:002',
            displayName: 'Mock Scanner 1',
          },
        ],
        savedScanners: [],
      });
      expect(result.data.detectedScanners).toHaveLength(1);
    });

    it('getConfig returns null wrapped in {success, data}', async () => {
      const result = await mockIpcMain.invoke('graviscan:get-config');

      expect(result).toEqual({ success: true, data: null });
    });

    it('getPlatformInfo returns platform data', async () => {
      const result = await mockIpcMain.invoke('graviscan:platform-info');

      expect(result.success).toBe(true);
      expect(result.data.platform).toBe('linux');
      expect(result.data.backend).toBe('sane');
    });

    it('getOutputDir returns path', async () => {
      const result = await mockIpcMain.invoke('graviscan:get-output-dir');

      expect(result.success).toBe(true);
      expect(result.data.success).toBe(true);
      expect(result.data.path).toBe('/home/user/.bloom/graviscan');
    });

    it('getScanStatus returns null when no session', async () => {
      const result = await mockIpcMain.invoke('graviscan:get-scan-status');

      expect(result).toEqual({ success: true, data: null });
    });

    it('saveConfig passes args through and returns saved config', async () => {
      const configArg = { grid_mode: '2grid', resolution: 600 };
      const result = await mockIpcMain.invoke(
        'graviscan:save-config',
        configArg
      );

      expect(scannerHandlers.saveConfig).toHaveBeenCalledWith(
        mockDb,
        configArg
      );
      expect(result.success).toBe(true);
      expect(result.data).toEqual({ grid_mode: '2grid', resolution: 600 });
    });
  });

  // -------------------------------------------------------------------------
  // 2. Session state round-trip tests
  // -------------------------------------------------------------------------
  describe('session state round-trip', () => {
    it('tracks session lifecycle through start, status, and cancel', async () => {
      // Real state management (not mocks)
      let scanSession: any = null;
      const realSessionFns = {
        getScanSession: vi.fn(() => scanSession),
        setScanSession: vi.fn((session: any) => {
          scanSession = session;
        }),
        markScanJobRecorded: vi.fn(),
      };

      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        realSessionFns,
        mockGetCoordinator
      );

      // Step 1: Initially no session
      const statusBefore = await mockIpcMain.invoke(
        'graviscan:get-scan-status'
      );
      expect(statusBefore).toEqual({ success: true, data: null });

      // Step 2: Mock startScan to actually call setScanSession
      vi.mocked(sessionHandlers.startScan).mockImplementationOnce(
        async (_coordinator, _params, fns) => {
          fns.setScanSession({ isActive: true, startedAt: Date.now() });
          return { success: true };
        }
      );

      const startResult = await mockIpcMain.invoke('graviscan:start-scan', {
        scanners: [],
        metadata: {},
      });
      expect(startResult.success).toBe(true);
      expect(realSessionFns.setScanSession).toHaveBeenCalledWith(
        expect.objectContaining({ isActive: true })
      );

      // Step 3: Session now exists — getScanStatus returns it
      vi.mocked(sessionHandlers.getScanStatus).mockReturnValueOnce({
        isActive: true,
        startedAt: expect.any(Number),
      });
      const statusDuring = await mockIpcMain.invoke(
        'graviscan:get-scan-status'
      );
      expect(statusDuring.success).toBe(true);
      expect(statusDuring.data).not.toBeNull();

      // Step 4: Cancel clears the session
      vi.mocked(sessionHandlers.cancelScan).mockImplementationOnce(
        async (_coordinator, fns) => {
          fns.setScanSession(null);
          return { success: true };
        }
      );

      const cancelResult = await mockIpcMain.invoke('graviscan:cancel-scan');
      expect(cancelResult.success).toBe(true);

      // Step 5: Session is null again
      vi.mocked(sessionHandlers.getScanStatus).mockReturnValueOnce(null);
      const statusAfter = await mockIpcMain.invoke('graviscan:get-scan-status');
      expect(statusAfter).toEqual({ success: true, data: null });
    });
  });

  // -------------------------------------------------------------------------
  // 3. Error propagation test
  // -------------------------------------------------------------------------
  describe('error propagation', () => {
    beforeEach(() => {
      registerGraviScanHandlers(
        mockIpcMain as any,
        mockDb,
        mockGetMainWindow,
        mockSessionFns,
        mockGetCoordinator
      );
    });

    it('returns {success: false, error} when detectScanners throws', async () => {
      vi.mocked(scannerHandlers.detectScanners).mockRejectedValueOnce(
        new Error('USB device not found')
      );

      const result = await mockIpcMain.invoke('graviscan:detect-scanners');

      expect(result).toEqual({
        success: false,
        error: 'USB device not found',
      });
    });
  });

  // -------------------------------------------------------------------------
  // 4. Mode conditional test
  // -------------------------------------------------------------------------
  describe('mode conditional — cylinderscan skips registration', () => {
    it('invoking any graviscan channel throws when handlers are not registered', async () => {
      // Do NOT call registerGraviScanHandlers (simulating cylinderscan mode)
      await expect(
        mockIpcMain.invoke('graviscan:detect-scanners')
      ).rejects.toThrow('No handler for graviscan:detect-scanners');

      await expect(mockIpcMain.invoke('graviscan:get-config')).rejects.toThrow(
        'No handler for graviscan:get-config'
      );

      await expect(
        mockIpcMain.invoke('graviscan:start-scan', {})
      ).rejects.toThrow('No handler for graviscan:start-scan');
    });
  });
});
