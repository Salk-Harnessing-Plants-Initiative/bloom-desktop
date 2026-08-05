import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act, render, screen } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { useScanSession } from '../../../src/renderer/hooks/useScanSession';
import { WedgeProvider } from '../../../src/renderer/contexts/WedgeContext';
import type { PlateAssignment } from '../../../src/types/graviscan';

function plate(overrides: Partial<PlateAssignment> = {}): PlateAssignment {
  return {
    plateIndex: '00',
    plantBarcode: 'PLATE_001',
    transplantDate: '2026-08-01',
    customNote: null,
    selected: true,
    ...overrides,
  };
}

function baseParams(overrides: Partial<Parameters<typeof useScanSession>[0]> = {}) {
  return {
    experimentId: 'exp-1',
    phenotyperId: 'pheno-1',
    waveNumber: 0,
    resolution: 1200,
    scannerIds: ['sc-1'],
    gridModes: { 'sc-1': '2grid' as const },
    saneNames: { 'sc-1': 'epkowa:usb:001:005' },
    assignmentsByScanner: { 'sc-1': [plate({ plateIndex: '00' }), plate({ plateIndex: '01', plantBarcode: 'PLATE_002' })] },
    isContinuous: false,
    intervalMinutes: 5,
    durationHours: 1,
    ...overrides,
  };
}

function wedgeWrapper({ children }: { children: ReactNode }) {
  return createElement(WedgeProvider, null, children);
}

describe('useScanSession', () => {
  let listeners: Record<string, Array<(...args: unknown[]) => void>>;
  let startScan: ReturnType<typeof vi.fn>;
  let cancelScan: ReturnType<typeof vi.fn>;
  let getScanStatus: ReturnType<typeof vi.fn>;
  let getOutputDir: ReturnType<typeof vi.fn>;
  let verifyPlates: ReturnType<typeof vi.fn>;
  let graviscansCreate: ReturnType<typeof vi.fn>;
  let graviscanSessionsCreate: ReturnType<typeof vi.fn>;
  let graviscanSessionsComplete: ReturnType<typeof vi.fn>;

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

  beforeEach(() => {
    listeners = {};
    localStorage.clear();

    startScan = vi.fn().mockResolvedValue({ success: true });
    cancelScan = vi.fn().mockResolvedValue({ success: true });
    getScanStatus = vi.fn().mockResolvedValue({ isActive: false });
    getOutputDir = vi.fn().mockResolvedValue({ success: true, path: '/out' });
    verifyPlates = vi.fn().mockResolvedValue({ success: true, results: [], swaps: [] });
    graviscansCreate = vi.fn().mockResolvedValue({ success: true, data: { id: 'gs-1' } });
    graviscanSessionsCreate = vi
      .fn()
      .mockResolvedValue({ success: true, data: { id: 'sess-1' } });
    graviscanSessionsComplete = vi.fn().mockResolvedValue({ success: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.gravi = {
      startScan,
      cancelScan,
      getScanStatus,
      getOutputDir,
      verifyPlates,
      readScanImage: vi.fn().mockResolvedValue({ success: true, dataUri: 'data:image/tiff;base64,x' }),
      onScanStarted: on('scan-started'),
      onScanComplete: on('scan-complete'),
      onScanError: on('scan-error'),
      onCycleComplete: on('cycle-complete'),
      onIntervalComplete: on('interval-complete'),
      onCancelled: on('cancelled'),
      onWedgeDetected: on('wedge-detected'),
      onIntervalStart: on('interval-start'),
      onIntervalWaiting: on('interval-waiting'),
      onOvertime: on('overtime'),
    };
    win.electron.database.graviscans = { create: graviscansCreate };
    win.electron.database.graviscanSessions = {
      create: graviscanSessionsCreate,
      complete: graviscanSessionsComplete,
    };
  });

  afterEach(() => {
    localStorage.clear();
  });

  // ── Reducer core (task 12.1) ────────────────────────────────────────────

  it('JOB_COMPLETE derives per-scanner progress from the post-update pending-jobs state', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });

    await act(async () => {
      await result.current.startScan();
    });
    expect(result.current.pendingJobs['sc-1:00']).toBeDefined();
    expect(result.current.pendingJobs['sc-1:01']).toBeDefined();

    fire('scan-complete', { scannerId: 'sc-1', plateIndex: '00', imagePath: '/out/00.tiff' });

    await waitFor(() => expect(result.current.pendingJobs['sc-1:00']).toBeUndefined());
    expect(result.current.progressByScanner['sc-1']).toBe(50);

    fire('scan-complete', { scannerId: 'sc-1', plateIndex: '01', imagePath: '/out/01.tiff' });
    await waitFor(() => expect(result.current.pendingJobs['sc-1:01']).toBeUndefined());
    expect(result.current.progressByScanner['sc-1']).toBe(100);
  });

  it('a duplicated scan-complete event for an already-removed job is a no-op, not a second decrement', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', { scannerId: 'sc-1', plateIndex: '00', imagePath: '/out/00.tiff' });
    await waitFor(() => expect(result.current.progressByScanner['sc-1']).toBe(50));

    // Retried/duplicated event for the same job.
    fire('scan-complete', { scannerId: 'sc-1', plateIndex: '00', imagePath: '/out/00.tiff' });
    expect(result.current.progressByScanner['sc-1']).toBe(50);
  });

  it('resolves dual-cased scan-complete payloads (snake_case and camelCase) identically', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', { scanner_id: 'sc-1', plate_index: '00', imagePath: '/out/00.tiff' });
    await waitFor(() => expect(result.current.pendingJobs['sc-1:00']).toBeUndefined());
    expect(result.current.progressByScanner['sc-1']).toBe(50);
  });

  it('resolves dual-cased scan-started payloads without throwing', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    expect(() =>
      fire('scan-started', { scanner_id: 'sc-1', plate_index: '00' })
    ).not.toThrow();
  });

  it('handleCancelScan is async, and a rejection surfaces an error state rather than throwing', async () => {
    cancelScan.mockRejectedValue(new Error('IPC channel closed'));
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    await act(async () => {
      await expect(result.current.cancelScan()).resolves.not.toThrow();
    });
    expect(result.current.error).toMatch(/IPC channel closed/);
  });

  it('handleCancelScan success path clears pending jobs and resets isScanning', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });
    expect(result.current.isScanning).toBe(true);

    await act(async () => {
      await result.current.cancelScan();
    });

    expect(result.current.isScanning).toBe(false);
    expect(Object.keys(result.current.pendingJobs)).toHaveLength(0);
    expect(cancelScan).toHaveBeenCalled();
  });

  it('a cancelScan() success response with success:false surfaces the error without throwing', async () => {
    cancelScan.mockResolvedValue({ success: false, error: 'no active session' });
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    await act(async () => {
      await result.current.cancelScan();
    });
    expect(result.current.error).toMatch(/no active session/);
  });

  it('getOutputDir() failure surfaces a blocking error and does not fall back to /tmp', async () => {
    getOutputDir.mockResolvedValue({ success: false, error: 'cannot resolve output dir' });
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });

    await act(async () => {
      await result.current.startScan();
    });

    expect(result.current.error).toMatch(/cannot resolve output dir/);
    expect(startScan).not.toHaveBeenCalled();
    // No plate's output path should ever be built against a hardcoded /tmp.
    expect(result.current.isScanning).toBe(false);
  });

  it('on-mount restore rehydrates pendingJobs/waveNumber/timing when the session is active', async () => {
    const onRestoreWaveNumber = vi.fn();
    getScanStatus.mockResolvedValue({
      isActive: true,
      experimentId: 'exp-1',
      waveNumber: 3,
      currentCycle: 2,
      totalCycles: 5,
      coordinatorState: 'scanning',
      scanStartedAt: 1000,
      nextScanAt: null,
      jobs: {
        'sc-1:00': {
          scannerId: 'sc-1',
          plateIndex: '00',
          outputPath: '/out/00.tiff',
          plantBarcode: 'PLATE_001',
          transplantDate: null,
          customNote: null,
          gridMode: '2grid',
          status: 'pending',
        },
      },
    });

    const { result } = renderHook(
      () => useScanSession(baseParams({ waveNumber: 0, onRestoreWaveNumber })),
      { wrapper: wedgeWrapper }
    );

    await waitFor(() => expect(result.current.isScanning).toBe(true));
    expect(result.current.pendingJobs['sc-1:00']).toBeDefined();
    expect(onRestoreWaveNumber).toHaveBeenCalledWith(3);
    expect(result.current.currentCycle).toBe(2);
    expect(result.current.totalCycles).toBe(5);
    expect(result.current.scanStartedAt).toBe(1000);
  });

  it('on-mount restore rehydrates nothing when the session is not active', async () => {
    getScanStatus.mockResolvedValue({ isActive: false });
    const onRestoreWaveNumber = vi.fn();

    const { result } = renderHook(
      () => useScanSession(baseParams({ onRestoreWaveNumber })),
      { wrapper: wedgeWrapper }
    );

    await waitFor(() => expect(getScanStatus).toHaveBeenCalled());
    expect(result.current.isScanning).toBe(false);
    expect(Object.keys(result.current.pendingJobs)).toHaveLength(0);
    expect(onRestoreWaveNumber).not.toHaveBeenCalled();
  });

  it('verification invocation passes the current waveNumber (including 0) alongside experimentId', async () => {
    const { result } = renderHook(() => useScanSession(baseParams({ waveNumber: 0 })), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', { scannerId: 'sc-1', plateIndex: '00', imagePath: '/out/00.tiff' });
    await waitFor(() => expect(result.current.pendingJobs['sc-1:00']).toBeUndefined());
    fire('scan-complete', { scannerId: 'sc-1', plateIndex: '01', imagePath: '/out/01.tiff' });

    await waitFor(() => expect(verifyPlates).toHaveBeenCalled());
    expect(verifyPlates).toHaveBeenCalledWith(
      expect.any(Array),
      'exp-1',
      0
    );
  });

  // ── Backend persistence wiring (task 12.3) ──────────────────────────────

  it('startScan() success calls graviscanSessions.create with experiment/phenotyper/mode/interval/duration', async () => {
    const { result } = renderHook(
      () =>
        useScanSession(
          baseParams({ isContinuous: true, intervalMinutes: 10, durationHours: 2 })
        ),
      { wrapper: wedgeWrapper }
    );

    await act(async () => {
      await result.current.startScan();
    });

    expect(graviscanSessionsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        experiment_id: 'exp-1',
        phenotyper_id: 'pheno-1',
        scan_mode: 'continuous',
        interval_seconds: 600,
        duration_seconds: 7200,
      })
    );
  });

  it('each job completion calls graviscans.create with all fields graviscansCreate requires', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00.tiff',
      cycleNumber: 1,
    });

    await waitFor(() => expect(graviscansCreate).toHaveBeenCalled());
    expect(graviscansCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        experiment_id: 'exp-1',
        phenotyper_id: 'pheno-1',
        scanner_id: 'sc-1',
        plate_index: '00',
        wave_number: 0,
        session_id: 'sess-1',
        cycle_number: 1,
        grid_mode: '2grid',
        resolution: 1200,
        path: '/out/00.tiff',
      })
    );
  });

  it('a duplicated job-completion event calling graviscans.create twice for the same job is safe (dedup happens in the handler)', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', { scannerId: 'sc-1', plateIndex: '00', imagePath: '/out/00.tiff', cycleNumber: 1 });
    await waitFor(() => expect(graviscansCreate).toHaveBeenCalledTimes(1));

    // A duplicated IPC event redelivers scan-complete for the same job.
    fire('scan-complete', { scannerId: 'sc-1', plateIndex: '00', imagePath: '/out/00.tiff', cycleNumber: 1 });
    await waitFor(() => expect(graviscansCreate).toHaveBeenCalledTimes(2));
    expect(graviscansCreate.mock.calls[1][0]).toMatchObject({
      scanner_id: 'sc-1',
      plate_index: '00',
      cycle_number: 1,
    });
  });

  it('clean session completion calls graviscanSessions.complete with cancelled: false', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', { scannerId: 'sc-1', plateIndex: '00', imagePath: '/out/00.tiff' });
    await waitFor(() => expect(result.current.pendingJobs['sc-1:00']).toBeUndefined());
    fire('scan-complete', { scannerId: 'sc-1', plateIndex: '01', imagePath: '/out/01.tiff' });

    await waitFor(() =>
      expect(graviscanSessionsComplete).toHaveBeenCalledWith({
        session_id: 'sess-1',
        cancelled: false,
      })
    );
  });

  it('a successful cancel calls graviscanSessions.complete with cancelled: true', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    await act(async () => {
      await result.current.cancelScan();
    });

    expect(graviscanSessionsComplete).toHaveBeenCalledWith({
      session_id: 'sess-1',
      cancelled: true,
    });
  });

  // ── Abnormal-termination marker (task 12.5, Decision 5) ─────────────────

  it('successful startScan() writes a localStorage marker keyed by experiment+wave with the expected cycle count', async () => {
    const { result } = renderHook(
      () =>
        useScanSession(
          baseParams({ waveNumber: 2, isContinuous: true, intervalMinutes: 10, durationHours: 1 })
        ),
      { wrapper: wedgeWrapper }
    );

    await act(async () => {
      await result.current.startScan();
    });

    const raw = localStorage.getItem('graviscan:session-in-progress:exp-1:2');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toMatchObject({ expectedCycles: 6 });
  });

  it('a successful cancelScan() removes the marker', async () => {
    const { result } = renderHook(() => useScanSession(baseParams({ waveNumber: 0 })), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });
    expect(localStorage.getItem('graviscan:session-in-progress:exp-1:0')).not.toBeNull();

    await act(async () => {
      await result.current.cancelScan();
    });
    expect(localStorage.getItem('graviscan:session-in-progress:exp-1:0')).toBeNull();
  });

  it('clean completion removes the marker', async () => {
    const { result } = renderHook(() => useScanSession(baseParams({ waveNumber: 0 })), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', { scannerId: 'sc-1', plateIndex: '00', imagePath: '/out/00.tiff' });
    await waitFor(() => expect(result.current.pendingJobs['sc-1:00']).toBeUndefined());
    fire('scan-complete', { scannerId: 'sc-1', plateIndex: '01', imagePath: '/out/01.tiff' });

    await waitFor(() =>
      expect(localStorage.getItem('graviscan:session-in-progress:exp-1:0')).toBeNull()
    );
  });

  it('on mount with an inactive session, a marker for the currently selected experiment+wave surfaces a non-blocking banner naming the expected cycle count', async () => {
    localStorage.setItem(
      'graviscan:session-in-progress:exp-1:0',
      JSON.stringify({ expectedCycles: 6 })
    );
    getScanStatus.mockResolvedValue({ isActive: false });

    const { result } = renderHook(() => useScanSession(baseParams({ waveNumber: 0 })), {
      wrapper: wedgeWrapper,
    });

    await waitFor(() =>
      expect(result.current.abnormalTermination).toEqual({ expectedCycles: 6 })
    );
  });

  it('a marker for a different wave of the same experiment produces no banner', async () => {
    localStorage.setItem(
      'graviscan:session-in-progress:exp-1:5',
      JSON.stringify({ expectedCycles: 6 })
    );
    getScanStatus.mockResolvedValue({ isActive: false });

    const { result } = renderHook(() => useScanSession(baseParams({ waveNumber: 0 })), {
      wrapper: wedgeWrapper,
    });

    await waitFor(() => expect(getScanStatus).toHaveBeenCalled());
    expect(result.current.abnormalTermination).toBeNull();
  });

  it('no marker for the current experiment+wave produces no banner', async () => {
    getScanStatus.mockResolvedValue({ isActive: false });
    const { result } = renderHook(() => useScanSession(baseParams({ waveNumber: 0 })), {
      wrapper: wedgeWrapper,
    });

    await waitFor(() => expect(getScanStatus).toHaveBeenCalled());
    expect(result.current.abnormalTermination).toBeNull();
  });

  // ── Wedge-blocks-start (task 12.7, Decision 6) ──────────────────────────

  it('disables starting while an assigned scanner has an active, unacknowledged wedge', async () => {
    const { result } = renderHook(() => useScanSession(baseParams({ scannerIds: ['sc-1'] })), {
      wrapper: wedgeWrapper,
    });
    expect(result.current.canStartScan).toBe(true);

    fire('wedge-detected', {
      scanner_id: 'sc-1',
      signature: 'sane_start_invalid',
      session_id: 'sess-x',
      cycle_number: 1,
      timestamp: '2026-08-04T00:00:00.000Z',
      error_message: 'epkowa: sane_start: Invalid argument',
    });

    await waitFor(() => expect(result.current.canStartScan).toBe(false));
  });

  it('a wedge that occurred before this hook mounted (context already populated) still blocks Start', async () => {
    // A single WedgeProvider instance, matching Layout.tsx mounting it once
    // for the whole session. Only a placeholder is rendered inside it at
    // first — simulating the operator being on a different screen — then
    // the scan-session consumer mounts afterward via rerender, reading the
    // context's already-accumulated state rather than starting fresh.
    function Placeholder() {
      return createElement('div', { 'data-testid': 'can-start' }, 'not-mounted');
    }
    function ScanSessionConsumer() {
      const session = useScanSession(baseParams({ scannerIds: ['sc-1'] }));
      return createElement('div', { 'data-testid': 'can-start' }, String(session.canStartScan));
    }

    let showScanSession = false;
    const tree = () =>
      createElement(
        WedgeProvider,
        null,
        showScanSession ? createElement(ScanSessionConsumer) : createElement(Placeholder)
      );

    const { rerender } = render(tree());

    fire('wedge-detected', {
      scanner_id: 'sc-1',
      signature: 'sane_start_invalid',
      session_id: 'sess-x',
      cycle_number: 1,
      timestamp: '2026-08-04T00:00:00.000Z',
      error_message: 'epkowa: sane_start: Invalid argument',
    });

    showScanSession = true;
    rerender(tree());

    await waitFor(() =>
      expect(screen.getByTestId('can-start').textContent).toBe('false')
    );
  });

  it('startScan() is blocked (no IPC call made) while canStartScan is false', async () => {
    const { result } = renderHook(() => useScanSession(baseParams({ scannerIds: ['sc-1'] })), {
      wrapper: wedgeWrapper,
    });

    fire('wedge-detected', {
      scanner_id: 'sc-1',
      signature: 'sane_start_invalid',
      session_id: 'sess-x',
      cycle_number: 1,
      timestamp: '2026-08-04T00:00:00.000Z',
      error_message: 'epkowa: sane_start: Invalid argument',
    });
    await waitFor(() => expect(result.current.canStartScan).toBe(false));

    await act(async () => {
      await result.current.startScan();
    });

    expect(startScan).not.toHaveBeenCalled();
    expect(result.current.error).toMatch(/wedge/i);
  });
});
