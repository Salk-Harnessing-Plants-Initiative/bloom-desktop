// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron module
const mockInvoke = vi.fn().mockResolvedValue({});
const mockOn = vi.fn();
const mockRemoveListener = vi.fn();
let exposedAPI: any = null;

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: vi.fn((_name: string, api: any) => {
      exposedAPI = api;
    }),
  },
  ipcRenderer: {
    invoke: mockInvoke,
    on: mockOn,
    removeListener: mockRemoveListener,
  },
}));

describe('preload gravi namespace', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    exposedAPI = null;
    // Reset module registry so preload re-executes on each import
    vi.resetModules();
    // Re-import preload to trigger contextBridge.exposeInMainWorld
    await import('../../src/main/preload');
  });

  it('exposes gravi namespace on electron API', () => {
    expect(exposedAPI).toBeTruthy();
    expect(exposedAPI.gravi).toBeTruthy();
  });

  describe('invoke methods', () => {
    const invokeMethods = [
      'detectScanners',
      'getConfig',
      'saveConfig',
      'saveScannersToDB',
      'disableScanner',
      'getPlatformInfo',
      'validateScanners',
      'validateConfig',
      'startScan',
      'getScanStatus',
      'markJobRecorded',
      'cancelScan',
      'getOutputDir',
      'readScanImage',
      'uploadAllScans',
      'downloadImages',
    ];

    it('has all 16 invoke methods', () => {
      for (const method of invokeMethods) {
        expect(typeof exposedAPI.gravi[method]).toBe('function');
      }
    });

    it('detectScanners calls ipcRenderer.invoke with correct channel', async () => {
      await exposedAPI.gravi.detectScanners();
      expect(mockInvoke).toHaveBeenCalledWith('graviscan:detect-scanners');
    });

    it('saveConfig passes args', async () => {
      await exposedAPI.gravi.saveConfig({ grid_mode: '2grid' });
      expect(mockInvoke).toHaveBeenCalledWith('graviscan:save-config', {
        grid_mode: '2grid',
      });
    });

    it('disableScanner passes scannerId to the correct channel', async () => {
      await exposedAPI.gravi.disableScanner('scanner-1');
      expect(mockInvoke).toHaveBeenCalledWith(
        'graviscan:disable-scanner',
        'scanner-1'
      );
    });

    it('readScanImage passes path and opts', async () => {
      await exposedAPI.gravi.readScanImage('/path/scan.tiff', {
        thumbnail: true,
      });
      expect(mockInvoke).toHaveBeenCalledWith(
        'graviscan:read-scan-image',
        '/path/scan.tiff',
        { thumbnail: true }
      );
    });
  });

  describe('event listeners', () => {
    // task 12.1a: onScanEvent removed, onScanStarted + onScanComplete
    // added (12 - 1 + 2 = 13).
    const listenerMethods = [
      'onScanStarted',
      'onScanComplete',
      'onGridStart',
      'onGridComplete',
      'onCycleComplete',
      'onIntervalStart',
      'onIntervalWaiting',
      'onIntervalComplete',
      'onOvertime',
      'onCancelled',
      'onScanError',
      'onUploadProgress',
      'onDownloadProgress',
    ];

    it('has all 13 event listener methods', () => {
      for (const method of listenerMethods) {
        expect(typeof exposedAPI.gravi[method]).toBe('function');
      }
    });

    it('does not expose onScanEvent', () => {
      expect(exposedAPI.gravi.onScanEvent).toBeUndefined();
    });

    it('onScanStarted registers listener on correct channel (task 12.1b — retargeted from onScanEvent)', () => {
      const callback = vi.fn();
      exposedAPI.gravi.onScanStarted(callback);
      expect(mockOn).toHaveBeenCalledWith(
        'graviscan:scan-started',
        expect.any(Function)
      );
    });

    it('onScanStarted returns cleanup function (task 12.1c — retargeted from onScanEvent)', () => {
      const callback = vi.fn();
      const cleanup = exposedAPI.gravi.onScanStarted(callback);
      expect(typeof cleanup).toBe('function');
    });

    it('cleanup function calls removeListener (task 12.1d — retargeted from onScanEvent)', () => {
      const callback = vi.fn();
      const cleanup = exposedAPI.gravi.onScanStarted(callback);
      cleanup();
      expect(mockRemoveListener).toHaveBeenCalledWith(
        'graviscan:scan-started',
        expect.any(Function)
      );
    });

    it('listener invokes callback with event data (task 12.1e — retargeted from onScanEvent)', () => {
      const callback = vi.fn();
      exposedAPI.gravi.onScanStarted(callback);

      // Get the listener that was registered
      const registeredListener = mockOn.mock.calls.find(
        (call: any[]) => call[0] === 'graviscan:scan-started'
      )?.[1];
      expect(registeredListener).toBeTruthy();

      // Simulate event
      registeredListener(
        {},
        { jobId: 'scanner-1:00', scannerId: 'scanner-1', plateIndex: '00' }
      );
      expect(callback).toHaveBeenCalledWith({
        jobId: 'scanner-1:00',
        scannerId: 'scanner-1',
        plateIndex: '00',
      });
    });

    it('onScanComplete registers listener on correct channel', () => {
      const callback = vi.fn();
      exposedAPI.gravi.onScanComplete(callback);
      expect(mockOn).toHaveBeenCalledWith(
        'graviscan:scan-complete',
        expect.any(Function)
      );
    });

    it('onScanComplete cleanup function calls removeListener', () => {
      const callback = vi.fn();
      const cleanup = exposedAPI.gravi.onScanComplete(callback);
      cleanup();
      expect(mockRemoveListener).toHaveBeenCalledWith(
        'graviscan:scan-complete',
        expect.any(Function)
      );
    });
  });
});
