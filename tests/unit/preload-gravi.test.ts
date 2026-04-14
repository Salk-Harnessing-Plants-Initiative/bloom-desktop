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

    it('has all 15 invoke methods', () => {
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
    const listenerMethods = [
      'onScanEvent',
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

    it('has all 12 event listener methods', () => {
      for (const method of listenerMethods) {
        expect(typeof exposedAPI.gravi[method]).toBe('function');
      }
    });

    it('onScanEvent registers listener on correct channel', () => {
      const callback = vi.fn();
      exposedAPI.gravi.onScanEvent(callback);
      expect(mockOn).toHaveBeenCalledWith(
        'graviscan:scan-event',
        expect.any(Function)
      );
    });

    it('onScanEvent returns cleanup function', () => {
      const callback = vi.fn();
      const cleanup = exposedAPI.gravi.onScanEvent(callback);
      expect(typeof cleanup).toBe('function');
    });

    it('cleanup function calls removeListener', () => {
      const callback = vi.fn();
      const cleanup = exposedAPI.gravi.onScanEvent(callback);
      cleanup();
      expect(mockRemoveListener).toHaveBeenCalledWith(
        'graviscan:scan-event',
        expect.any(Function)
      );
    });

    it('listener invokes callback with event data', () => {
      const callback = vi.fn();
      exposedAPI.gravi.onScanEvent(callback);

      // Get the listener that was registered
      const registeredListener = mockOn.mock.calls.find(
        (call: any[]) => call[0] === 'graviscan:scan-event'
      )?.[1];
      expect(registeredListener).toBeTruthy();

      // Simulate event
      registeredListener(
        {},
        { type: 'scan-complete', scanner_id: 'scanner-1' }
      );
      expect(callback).toHaveBeenCalledWith({
        type: 'scan-complete',
        scanner_id: 'scanner-1',
      });
    });
  });
});
