/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { mockGraviAPI } from '../setup';

// Will be created in Step 3
import { useTestScan } from '../../../src/renderer/hooks/useTestScan';
import type {
  DetectedScanner,
  ScannerAssignment,
} from '../../../src/types/graviscan';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeScanner(id: string): DetectedScanner {
  return {
    name: `Scanner ${id}`,
    scanner_id: id,
    usb_bus: 1,
    usb_device: 1,
    usb_port: '1-1',
    is_available: true,
    vendor_id: '04b8',
    product_id: '0001',
    sane_name: `epkowa:usb:001:00${id}`,
  };
}

function makeAssignment(
  slot: string,
  scannerId: string | null,
  gridMode: '2grid' | '4grid' = '2grid'
): ScannerAssignment {
  return { slot, scannerId, usbPort: '1-1', gridMode };
}

const defaultParams = () => ({
  scannerAssignments: [makeAssignment('Scanner 1', 'sc1')],
  detectedScanners: [makeScanner('sc1')],
  setScanningPlateIndex: vi.fn(),
  setScanImageUris: vi.fn(),
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Restore default happy-path mocks
  // Mocks use the unwrapped shapes the renderer actually sees through
  // window.electron.gravi.* (preload's unwrapGravi flattens the envelope).
  // getOutputDir returns { success, path }; readScanImage returns
  // { success, dataUri }. See src/main/graviscan/image-handlers.ts.
  mockGraviAPI.getOutputDir.mockResolvedValue({
    success: true,
    path: '/tmp/graviscan',
  });
  mockGraviAPI.startScan.mockResolvedValue({ success: true });
  mockGraviAPI.readScanImage.mockResolvedValue({
    success: true,
    dataUri: 'data:image/tiff;base64,AAAA',
  });
  // Event listeners return cleanup fns by default (from setup.ts)
});

describe('useTestScan', () => {
  // -----------------------------------------------------------------------
  // Initial state
  // -----------------------------------------------------------------------
  it('returns idle initial state', () => {
    const { result } = renderHook(() => useTestScan(defaultParams()));

    expect(result.current.isTesting).toBe(false);
    expect(result.current.testPhase).toBe('idle');
    expect(result.current.testResults).toEqual({});
    expect(result.current.testComplete).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Scan initiation — calls startScan with low-resolution params, one plate
  // per scanner
  // -----------------------------------------------------------------------
  it('calls startScan with low-resolution params and correct plate configs', async () => {
    // Make startScan resolve but never fire events (we only check the call)
    const { result } = renderHook(() => useTestScan(defaultParams()));

    // Don't await — we just want to verify the startScan call shape
    act(() => {
      void result.current.handleTestAllScanners();
    });

    // Allow the async chain through getOutputDir -> startScan
    await act(async () => {
      await vi.waitFor(() => {
        expect(mockGraviAPI.startScan).toHaveBeenCalledTimes(1);
      });
    });

    const callArg = mockGraviAPI.startScan.mock.calls[0][0];
    expect(callArg.scanners).toHaveLength(1);

    const scannerConfig = callArg.scanners[0];
    expect(scannerConfig.scannerId).toBe('sc1');
    expect(scannerConfig.plates).toHaveLength(2); // 2grid → 2 plates

    // Resolution must be low (200 for test scan)
    for (const plate of scannerConfig.plates) {
      expect(plate.resolution).toBe(200);
      expect(plate.output_path).toContain('test-scan-');
    }
  });

  // -----------------------------------------------------------------------
  // Phase tracking: idle → scanning → (complete via events)
  // -----------------------------------------------------------------------
  it('transitions testPhase to scanning on start', async () => {
    // Keep startScan pending so handleTestAllScanners stays in the scanning
    // phase long enough for us to observe it.
    let resolveStartScan!: (v: { success: boolean }) => void;
    mockGraviAPI.startScan.mockReturnValue(
      new Promise((r) => {
        resolveStartScan = r;
      })
    );

    const { result } = renderHook(() => useTestScan(defaultParams()));

    expect(result.current.testPhase).toBe('idle');

    // Fire-and-forget inside act; we need to flush the getOutputDir microtask
    // so that setTestPhase('scanning') is called before we assert.
    await act(async () => {
      void result.current.handleTestAllScanners();
      // Flush getOutputDir promise
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.testPhase).toBe('scanning');

    // Cleanup: resolve startScan so the hook doesn't leak
    await act(async () => {
      resolveStartScan({ success: false });
    });
  });

  // -----------------------------------------------------------------------
  // Preview image loading on scan complete (calls readScanImage)
  // -----------------------------------------------------------------------
  it('loads preview image via readScanImage when grid completes', async () => {
    // Capture the onGridComplete callback so we can invoke it
    let gridCompleteCallback: ((data: any) => void) | null = null;
    let scanEventCallback: ((data: any) => void) | null = null;
    const cleanupGridComplete = vi.fn();
    const cleanupScanEvent = vi.fn();
    const cleanupScanError = vi.fn();

    mockGraviAPI.onGridComplete.mockImplementation((cb: any) => {
      gridCompleteCallback = cb;
      return cleanupGridComplete;
    });
    mockGraviAPI.onScanEvent.mockImplementation((cb: any) => {
      scanEventCallback = cb;
      return cleanupScanEvent;
    });
    mockGraviAPI.onScanError.mockReturnValue(cleanupScanError);

    const setScanImageUris = vi.fn();
    const params = {
      ...defaultParams(),
      setScanImageUris,
    };

    const { result } = renderHook(() => useTestScan(params));

    act(() => {
      void result.current.handleTestAllScanners();
    });

    // Wait for startScan to be called (event listeners are set up before)
    await act(async () => {
      await vi.waitFor(() => {
        expect(mockGraviAPI.startScan).toHaveBeenCalled();
      });
    });

    // Simulate scan-event for first plate
    await act(async () => {
      scanEventCallback?.({ scannerId: 'sc1', plateIndex: '00' });
    });

    // Simulate grid-complete for first plate
    await act(async () => {
      gridCompleteCallback?.({
        scannerId: 'sc1',
        plateIndex: '00',
        imagePath: '/tmp/graviscan/test.tif',
      });
    });

    expect(mockGraviAPI.readScanImage).toHaveBeenCalledWith(
      '/tmp/graviscan/test.tif'
    );

    // Simulate grid-complete for second plate (completes the scanner)
    await act(async () => {
      gridCompleteCallback?.({
        scannerId: 'sc1',
        plateIndex: '01',
        imagePath: '/tmp/graviscan/test2.tif',
      });
    });

    // setScanImageUris should have been called with the loaded image
    expect(setScanImageUris).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Error handling: one scanner fails, others succeed
  // -----------------------------------------------------------------------
  it('records error for failed scanner while others succeed', async () => {
    const scanners = [makeScanner('sc1'), makeScanner('sc2')];
    const assignments = [
      makeAssignment('Scanner 1', 'sc1'),
      makeAssignment('Scanner 2', 'sc2'),
    ];

    let gridCompleteCallback: ((data: any) => void) | null = null;
    let scanErrorCallback: ((data: any) => void) | null = null;

    mockGraviAPI.onGridComplete.mockImplementation((cb: any) => {
      gridCompleteCallback = cb;
      return vi.fn();
    });
    mockGraviAPI.onScanError.mockImplementation((cb: any) => {
      scanErrorCallback = cb;
      return vi.fn();
    });
    mockGraviAPI.onScanEvent.mockReturnValue(vi.fn());

    const params = {
      scannerAssignments: assignments,
      detectedScanners: scanners,
      setScanningPlateIndex: vi.fn(),
      setScanImageUris: vi.fn(),
    };

    const { result } = renderHook(() => useTestScan(params));

    act(() => {
      void result.current.handleTestAllScanners();
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(mockGraviAPI.startScan).toHaveBeenCalled();
      });
    });

    // sc1 completes both plates successfully
    await act(async () => {
      gridCompleteCallback?.({
        scannerId: 'sc1',
        plateIndex: '00',
        imagePath: '/tmp/a.tif',
      });
    });
    await act(async () => {
      gridCompleteCallback?.({
        scannerId: 'sc1',
        plateIndex: '01',
        imagePath: '/tmp/b.tif',
      });
    });

    // sc2 errors on both plates
    await act(async () => {
      scanErrorCallback?.({ scannerId: 'sc2', error: 'Device not found' });
    });
    await act(async () => {
      scanErrorCallback?.({ scannerId: 'sc2', error: 'Device not found' });
    });

    // Wait for testComplete
    await act(async () => {
      await vi.waitFor(() => {
        expect(result.current.testComplete).toBe(true);
      });
    });

    expect(result.current.testResults['sc1'].success).toBe(true);
    expect(result.current.testResults['sc2'].success).toBe(false);
    expect(result.current.testResults['sc2'].error).toBe('Device not found');
  });

  // -----------------------------------------------------------------------
  // Result tracking — testResults map populated per scanner
  // -----------------------------------------------------------------------
  it('populates testResults per scanner on completion', async () => {
    let gridCompleteCallback: ((data: any) => void) | null = null;

    mockGraviAPI.onGridComplete.mockImplementation((cb: any) => {
      gridCompleteCallback = cb;
      return vi.fn();
    });
    mockGraviAPI.onScanEvent.mockReturnValue(vi.fn());
    mockGraviAPI.onScanError.mockReturnValue(vi.fn());

    const { result } = renderHook(() => useTestScan(defaultParams()));

    act(() => {
      void result.current.handleTestAllScanners();
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(mockGraviAPI.startScan).toHaveBeenCalled();
      });
    });

    // Complete both plates for the single scanner
    await act(async () => {
      gridCompleteCallback?.({
        scannerId: 'sc1',
        plateIndex: '00',
        imagePath: '/tmp/a.tif',
      });
    });
    await act(async () => {
      gridCompleteCallback?.({
        scannerId: 'sc1',
        plateIndex: '01',
        imagePath: '/tmp/b.tif',
      });
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(result.current.testComplete).toBe(true);
      });
    });

    expect(result.current.testResults).toHaveProperty('sc1');
    expect(result.current.testResults['sc1'].success).toBe(true);
    expect(result.current.testResults['sc1'].scanTimeMs).toBeGreaterThanOrEqual(
      0
    );
  });

  // -----------------------------------------------------------------------
  // Cleanup on unmount — event listener removal functions called
  // -----------------------------------------------------------------------
  it('cleans up event listeners when all scans complete', async () => {
    const cleanupScanEvent = vi.fn();
    const cleanupGridComplete = vi.fn();
    const cleanupScanError = vi.fn();

    let gridCompleteCallback: ((data: any) => void) | null = null;

    mockGraviAPI.onScanEvent.mockReturnValue(cleanupScanEvent);
    mockGraviAPI.onGridComplete.mockImplementation((cb: any) => {
      gridCompleteCallback = cb;
      return cleanupGridComplete;
    });
    mockGraviAPI.onScanError.mockReturnValue(cleanupScanError);

    const { result } = renderHook(() => useTestScan(defaultParams()));

    act(() => {
      void result.current.handleTestAllScanners();
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(mockGraviAPI.startScan).toHaveBeenCalled();
      });
    });

    // Complete all plates to trigger cleanup
    await act(async () => {
      gridCompleteCallback?.({
        scannerId: 'sc1',
        plateIndex: '00',
        imagePath: '/tmp/a.tif',
      });
    });
    await act(async () => {
      gridCompleteCallback?.({
        scannerId: 'sc1',
        plateIndex: '01',
        imagePath: '/tmp/b.tif',
      });
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(result.current.testComplete).toBe(true);
      });
    });

    // Event listener cleanup functions should have been called
    expect(cleanupGridComplete).toHaveBeenCalled();
    expect(cleanupScanError).toHaveBeenCalled();
    expect(cleanupScanEvent).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // resetTestResults
  // -----------------------------------------------------------------------
  it('resets testResults and testComplete', async () => {
    let gridCompleteCallback: ((data: any) => void) | null = null;

    mockGraviAPI.onGridComplete.mockImplementation((cb: any) => {
      gridCompleteCallback = cb;
      return vi.fn();
    });
    mockGraviAPI.onScanEvent.mockReturnValue(vi.fn());
    mockGraviAPI.onScanError.mockReturnValue(vi.fn());

    const { result } = renderHook(() => useTestScan(defaultParams()));

    // Run a test scan to completion
    act(() => {
      void result.current.handleTestAllScanners();
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(mockGraviAPI.startScan).toHaveBeenCalled();
      });
    });

    await act(async () => {
      gridCompleteCallback?.({
        scannerId: 'sc1',
        plateIndex: '00',
        imagePath: '/tmp/a.tif',
      });
    });
    await act(async () => {
      gridCompleteCallback?.({
        scannerId: 'sc1',
        plateIndex: '01',
        imagePath: '/tmp/b.tif',
      });
    });

    await act(async () => {
      await vi.waitFor(() => {
        expect(result.current.testComplete).toBe(true);
      });
    });

    // Now reset
    act(() => {
      result.current.resetTestResults();
    });

    expect(result.current.testResults).toEqual({});
    expect(result.current.testComplete).toBe(false);
  });

  // -----------------------------------------------------------------------
  // startScan failure — all scanners marked as failed
  // -----------------------------------------------------------------------
  it('marks all scanners as failed when startScan returns failure', async () => {
    mockGraviAPI.startScan.mockResolvedValue({
      success: false,
      error: 'Subprocess crashed',
    });
    mockGraviAPI.onScanEvent.mockReturnValue(vi.fn());
    mockGraviAPI.onGridComplete.mockReturnValue(vi.fn());
    mockGraviAPI.onScanError.mockReturnValue(vi.fn());

    const { result } = renderHook(() => useTestScan(defaultParams()));

    await act(async () => {
      await result.current.handleTestAllScanners();
    });

    expect(result.current.testComplete).toBe(true);
    expect(result.current.testResults['sc1'].success).toBe(false);
    expect(result.current.testResults['sc1'].error).toBe('Subprocess crashed');
  });

  // -----------------------------------------------------------------------
  // No assigned scanners — early return, no startScan call
  // -----------------------------------------------------------------------
  it('does nothing when no scanners are assigned', async () => {
    const params = {
      ...defaultParams(),
      scannerAssignments: [makeAssignment('Scanner 1', null)],
    };

    const { result } = renderHook(() => useTestScan(params));

    await act(async () => {
      await result.current.handleTestAllScanners();
    });

    expect(mockGraviAPI.startScan).not.toHaveBeenCalled();
  });
});
