import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useTestScan } from '../../../src/renderer/hooks/useTestScan';

describe('useTestScan', () => {
  let listeners: Record<string, Array<(...args: unknown[]) => void>>;
  let startScan: ReturnType<typeof vi.fn>;
  let getOutputDir: ReturnType<typeof vi.fn>;

  function on(channel: string) {
    return vi.fn((cb: (...args: unknown[]) => void) => {
      (listeners[channel] ??= []).push(cb);
      return () => {
        listeners[channel] = (listeners[channel] || []).filter((l) => l !== cb);
      };
    });
  }

  function fire(channel: string, ...args: unknown[]) {
    act(() => {
      (listeners[channel] || []).forEach((cb) => cb(...args));
    });
  }

  function baseParams() {
    return {
      scannerIds: ['sc-1', 'sc-2'],
      gridModes: { 'sc-1': '2grid' as const, 'sc-2': '2grid' as const },
      saneNames: { 'sc-1': 'epkowa:usb:001:005', 'sc-2': 'epkowa:usb:001:006' },
    };
  }

  beforeEach(() => {
    listeners = {};
    // register-handlers.ts's wrapHandler() wraps both channels' normal
    // (non-throwing) resolution in a { success: true, data: T } envelope —
    // confirmed via direct inspection. Mocks must match that shape.
    startScan = vi
      .fn()
      .mockResolvedValue({ success: true, data: { success: true } });
    getOutputDir = vi.fn().mockResolvedValue({
      success: true,
      data: { success: true, path: '/out' },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.gravi = {
      startScan,
      getOutputDir,
      readScanImage: vi.fn().mockResolvedValue({
        success: true,
        dataUri: 'data:image/tiff;base64,x',
      }),
      onScanStarted: on('scan-started'),
      onScanComplete: on('scan-complete'),
      onScanError: on('scan-error'),
    };
  });

  it('captures one plate per assigned scanner without touching any session state', async () => {
    const { result } = renderHook(() => useTestScan(baseParams()));

    let testPromise!: Promise<void>;
    act(() => {
      testPromise = result.current.testAllScanners();
    });
    await waitFor(() => expect(result.current.isTesting).toBe(true));

    expect(startScan).toHaveBeenCalledWith(
      expect.objectContaining({
        scanners: expect.arrayContaining([
          expect.objectContaining({ scannerId: 'sc-1' }),
          expect.objectContaining({ scannerId: 'sc-2' }),
        ]),
      })
    );
    // A test scan never carries session metadata/interval — this is a
    // one-shot capture independent of useScanSession's own state.
    expect(startScan.mock.calls[0][0].metadata).toBeUndefined();
    expect(startScan.mock.calls[0][0].interval).toBeUndefined();

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/sc-1-00.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      imagePath: '/out/sc-1-01.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-2',
      plateIndex: '00',
      imagePath: '/out/sc-2-00.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-2',
      plateIndex: '01',
      imagePath: '/out/sc-2-01.tiff',
    });

    await act(async () => {
      await testPromise;
    });

    expect(result.current.isTesting).toBe(false);
    expect(result.current.testResults['sc-1'].success).toBe(true);
    expect(result.current.testResults['sc-2'].success).toBe(true);
  });

  it('a scan-error for a scanner marks that scanner failed without blocking the other scanner', async () => {
    const { result } = renderHook(() => useTestScan(baseParams()));

    let testPromise!: Promise<void>;
    act(() => {
      testPromise = result.current.testAllScanners();
    });
    await waitFor(() => expect(result.current.isTesting).toBe(true));

    fire('scan-error', {
      scannerId: 'sc-1',
      plateIndex: '00',
      error: 'sane_start: Invalid argument',
    });
    fire('scan-error', {
      scannerId: 'sc-1',
      plateIndex: '01',
      error: 'sane_start: Invalid argument',
    });
    fire('scan-complete', {
      scannerId: 'sc-2',
      plateIndex: '00',
      imagePath: '/out/sc-2-00.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-2',
      plateIndex: '01',
      imagePath: '/out/sc-2-01.tiff',
    });

    await act(async () => {
      await testPromise;
    });

    expect(result.current.testResults['sc-1'].success).toBe(false);
    expect(result.current.testResults['sc-1'].error).toMatch(
      /Invalid argument/
    );
    expect(result.current.testResults['sc-2'].success).toBe(true);
  });

  it('getOutputDir() failure surfaces a blocking error and does not fall back to /tmp', async () => {
    getOutputDir.mockResolvedValue({
      success: true,
      data: { success: false, error: 'cannot resolve output dir' },
    });
    const { result } = renderHook(() => useTestScan(baseParams()));

    await act(async () => {
      await result.current.testAllScanners();
    });

    expect(result.current.error).toMatch(/cannot resolve output dir/);
    expect(startScan).not.toHaveBeenCalled();
    expect(result.current.isTesting).toBe(false);
  });

  it('a startScan() failure marks every assigned scanner failed with the returned error', async () => {
    startScan.mockResolvedValue({
      success: true,
      data: { success: false, error: 'No scanners came online' },
    });
    const { result } = renderHook(() => useTestScan(baseParams()));

    await act(async () => {
      await result.current.testAllScanners();
    });

    expect(result.current.testResults['sc-1'].success).toBe(false);
    expect(result.current.testResults['sc-1'].error).toBe(
      'No scanners came online'
    );
    expect(result.current.testResults['sc-2'].success).toBe(false);
    expect(result.current.isTesting).toBe(false);
  });

  it('no scanners assigned surfaces an error without calling startScan', async () => {
    const { result } = renderHook(() =>
      useTestScan({ scannerIds: [], gridModes: {}, saneNames: {} })
    );

    await act(async () => {
      await result.current.testAllScanners();
    });

    expect(result.current.error).toMatch(/no scanners/i);
    expect(startScan).not.toHaveBeenCalled();
  });

  // ── Regressions found by review-pr round 1 ──────────────────────────────

  it('resolves the real scan-complete event shape (`path`, not `imagePath`)', async () => {
    const { result } = renderHook(() => useTestScan(baseParams()));

    let testPromise!: Promise<void>;
    act(() => {
      testPromise = result.current.testAllScanners();
    });
    await waitFor(() => expect(result.current.isTesting).toBe(true));

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      path: '/out/sc-1-00.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      path: '/out/sc-1-01.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-2',
      plateIndex: '00',
      path: '/out/sc-2-00.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-2',
      plateIndex: '01',
      path: '/out/sc-2-01.tiff',
    });

    await act(async () => {
      await testPromise;
    });

    expect(result.current.testResults['sc-1'].imagePath).toBe(
      '/out/sc-1-01.tiff'
    );
  });

  it('a second testAllScanners() call while the first is still running is a no-op, not a re-entrant corruption', async () => {
    let resolveStart!: (value: unknown) => void;
    startScan.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveStart = resolve;
        })
    );
    const { result } = renderHook(() => useTestScan(baseParams()));

    let firstPromise!: Promise<void>;
    act(() => {
      firstPromise = result.current.testAllScanners();
    });
    await waitFor(() => expect(result.current.isTesting).toBe(true));

    // A double-click while the first run's own startScan() call hasn't
    // even resolved yet.
    let secondPromise!: Promise<void>;
    act(() => {
      secondPromise = result.current.testAllScanners();
    });
    expect(startScan).toHaveBeenCalledTimes(1);

    resolveStart({ success: true, data: { success: true } });
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      path: '/out/00.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      path: '/out/01.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-2',
      plateIndex: '00',
      path: '/out/00.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-2',
      plateIndex: '01',
      path: '/out/01.tiff',
    });

    await act(async () => {
      await Promise.all([firstPromise, secondPromise]);
    });

    expect(startScan).toHaveBeenCalledTimes(1);
    expect(result.current.testResults['sc-1'].success).toBe(true);
    expect(result.current.testResults['sc-2'].success).toBe(true);
  });

  it('a getOutputDir() promise rejection surfaces an error and does not permanently lock out future test runs', async () => {
    getOutputDir.mockRejectedValueOnce(new Error('IPC bridge closed'));
    const { result } = renderHook(() => useTestScan(baseParams()));

    await act(async () => {
      await result.current.testAllScanners();
    });
    expect(result.current.error).toMatch(/IPC bridge closed/);
    expect(result.current.isTesting).toBe(false);

    // A later, working call must not be permanently blocked by the guard.
    getOutputDir.mockResolvedValue({
      success: true,
      data: { success: true, path: '/out' },
    });
    let secondPromise!: Promise<void>;
    act(() => {
      secondPromise = result.current.testAllScanners();
    });
    await waitFor(() => expect(startScan).toHaveBeenCalledTimes(1));

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      path: '/out/00.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      path: '/out/01.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-2',
      plateIndex: '00',
      path: '/out/00.tiff',
    });
    fire('scan-complete', {
      scannerId: 'sc-2',
      plateIndex: '01',
      path: '/out/01.tiff',
    });
    await act(async () => {
      await secondPromise;
    });
  });
});
