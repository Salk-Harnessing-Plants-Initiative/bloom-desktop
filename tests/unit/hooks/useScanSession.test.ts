import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  renderHook,
  waitFor,
  act,
  render,
  screen,
} from '@testing-library/react';
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

function baseParams(
  overrides: Partial<Parameters<typeof useScanSession>[0]> = {}
) {
  return {
    experimentId: 'exp-1',
    phenotyperId: 'pheno-1',
    waveNumber: 0,
    resolution: 1200,
    scannerIds: ['sc-1'],
    gridModes: { 'sc-1': '2grid' as const },
    saneNames: { 'sc-1': 'epkowa:usb:001:005' },
    assignmentsByScanner: {
      'sc-1': [
        plate({ plateIndex: '00' }),
        plate({ plateIndex: '01', plantBarcode: 'PLATE_002' }),
      ],
    },
    isContinuous: false,
    intervalMinutes: 5,
    durationMinutes: 60,
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
  let markJobRecorded: ReturnType<typeof vi.fn>;
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

    // register-handlers.ts's wrapHandler() wraps these four channels'
    // normal (non-throwing) resolution in a { success: true, data: T }
    // envelope — confirmed via direct inspection, and matching
    // ConfigureScanner.tsx's own `result.data?.isActive` usage. Mocks here
    // must return that same shape or they don't exercise what the real
    // preload bridge actually resolves with.
    startScan = vi
      .fn()
      .mockResolvedValue({ success: true, data: { success: true } });
    cancelScan = vi
      .fn()
      .mockResolvedValue({ success: true, data: { success: true } });
    getScanStatus = vi
      .fn()
      .mockResolvedValue({ success: true, data: { isActive: false } });
    getOutputDir = vi.fn().mockResolvedValue({
      success: true,
      data: { success: true, path: '/out' },
    });
    verifyPlates = vi
      .fn()
      .mockResolvedValue({ success: true, results: [], swaps: [] });
    markJobRecorded = vi.fn().mockResolvedValue({ success: true });
    graviscansCreate = vi
      .fn()
      .mockResolvedValue({ success: true, data: { id: 'gs-1' } });
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
      markJobRecorded,
      readScanImage: vi.fn().mockResolvedValue({
        success: true,
        dataUri: 'data:image/tiff;base64,x',
      }),
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
    // A second scanner's job stays pending throughout, so the session
    // itself doesn't end when sc-1's jobs finish — otherwise SCAN_ENDED's
    // own state reset (design.md Decision 17) would clear
    // progressByScanner before this test's 100% assertion could observe it.
    const { result } = renderHook(
      () =>
        useScanSession(
          baseParams({
            scannerIds: ['sc-1', 'sc-2'],
            gridModes: { 'sc-1': '2grid', 'sc-2': '2grid' },
            saneNames: {
              'sc-1': 'epkowa:usb:001:005',
              'sc-2': 'epkowa:usb:001:006',
            },
            assignmentsByScanner: {
              'sc-1': [
                plate({ plateIndex: '00' }),
                plate({ plateIndex: '01', plantBarcode: 'PLATE_002' }),
              ],
              'sc-2': [plate({ plateIndex: '00', plantBarcode: 'PLATE_003' })],
            },
          })
        ),
      { wrapper: wedgeWrapper }
    );

    await act(async () => {
      await result.current.startScan();
    });
    expect(result.current.pendingJobs['sc-1:00']).toBeDefined();
    expect(result.current.pendingJobs['sc-1:01']).toBeDefined();

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00.tiff',
    });

    await waitFor(() =>
      expect(result.current.pendingJobs['sc-1:00']).toBeUndefined()
    );
    expect(result.current.progressByScanner['sc-1']).toBe(50);

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      imagePath: '/out/01.tiff',
    });
    await waitFor(() =>
      expect(result.current.pendingJobs['sc-1:01']).toBeUndefined()
    );
    expect(result.current.progressByScanner['sc-1']).toBe(100);
  });

  it('a duplicated scan-complete event for an already-removed job is a no-op, not a second decrement', async () => {
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
    });
    await waitFor(() =>
      expect(result.current.progressByScanner['sc-1']).toBe(50)
    );

    // Retried/duplicated event for the same job.
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00.tiff',
    });
    expect(result.current.progressByScanner['sc-1']).toBe(50);
  });

  it('resolves dual-cased scan-complete payloads (snake_case and camelCase) identically', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', {
      scanner_id: 'sc-1',
      plate_index: '00',
      imagePath: '/out/00.tiff',
    });
    await waitFor(() =>
      expect(result.current.pendingJobs['sc-1:00']).toBeUndefined()
    );
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
    cancelScan.mockResolvedValue({
      success: true,
      data: { success: false, error: 'no active session' },
    });
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
    getOutputDir.mockResolvedValue({
      success: true,
      data: { success: false, error: 'cannot resolve output dir' },
    });
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
      success: true,
      data: {
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
    getScanStatus.mockResolvedValue({
      success: true,
      data: { isActive: false },
    });
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
    const { result } = renderHook(
      () => useScanSession(baseParams({ waveNumber: 0 })),
      {
        wrapper: wedgeWrapper,
      }
    );
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00.tiff',
    });
    await waitFor(() =>
      expect(result.current.pendingJobs['sc-1:00']).toBeUndefined()
    );
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      imagePath: '/out/01.tiff',
    });

    await waitFor(() => expect(verifyPlates).toHaveBeenCalled());
    expect(verifyPlates).toHaveBeenCalledWith(expect.any(Array), 'exp-1', 0);
  });

  // ── Backend persistence wiring (task 12.3) ──────────────────────────────

  it('startScan() success calls graviscanSessions.create with experiment/phenotyper/mode/interval/duration', async () => {
    const { result } = renderHook(
      () =>
        useScanSession(
          baseParams({
            isContinuous: true,
            intervalMinutes: 10,
            durationMinutes: 120,
          })
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

  it('startScan() builds output_path with a _cy1_ marker so the coordinator can rewrite it per cycle (regression: identical path was reused every cycle, silently overwriting prior scans)', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });

    await act(async () => {
      await result.current.startScan();
    });

    expect(startScan).toHaveBeenCalledWith(
      expect.objectContaining({
        scanners: expect.arrayContaining([
          expect.objectContaining({
            plates: expect.arrayContaining([
              expect.objectContaining({
                plate_index: '00',
                output_path: expect.stringMatching(/_cy1_/),
              }),
            ]),
          }),
        ]),
      })
    );
  });

  it('continuous-mode session does not end after the first cycle completes — only interval-complete ends it (regression: markJobAccountedFor fired finishSession after cycle 1, while the backend kept scanning cycles 2/3 independently, silently overwriting data)', async () => {
    const { result } = renderHook(
      () =>
        useScanSession(
          baseParams({
            isContinuous: true,
            intervalMinutes: 60,
            durationMinutes: 180,
          })
        ),
      { wrapper: wedgeWrapper }
    );

    await act(async () => {
      await result.current.startScan();
    });
    expect(result.current.totalCycles).toBe(3);
    expect(result.current.currentCycle).toBe(1);

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00_cy1.tiff',
      cycleNumber: 1,
    });
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      imagePath: '/out/01_cy1.tiff',
      cycleNumber: 1,
    });

    // Cycle 1's plates are all in — the backend still has 2 more cycles to
    // go, so the session must not end here.
    expect(result.current.isScanning).toBe(true);
    expect(graviscanSessionsComplete).not.toHaveBeenCalled();

    fire('cycle-complete', { cycle: 1 });
    expect(result.current.currentCycle).toBe(2);
    expect(Object.keys(result.current.pendingJobs)).toHaveLength(2);

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00_cy2.tiff',
      cycleNumber: 2,
    });
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      imagePath: '/out/01_cy2.tiff',
      cycleNumber: 2,
    });
    expect(result.current.isScanning).toBe(true);
    expect(graviscanSessionsComplete).not.toHaveBeenCalled();

    fire('cycle-complete', { cycle: 2 });
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00_cy3.tiff',
      cycleNumber: 3,
    });
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      imagePath: '/out/01_cy3.tiff',
      cycleNumber: 3,
    });
    expect(result.current.isScanning).toBe(true);
    expect(graviscanSessionsComplete).not.toHaveBeenCalled();

    fire('interval-complete', {
      cyclesCompleted: 3,
      totalCycles: 3,
      cancelled: false,
    });

    await waitFor(() => expect(result.current.isScanning).toBe(false));
    expect(graviscanSessionsComplete).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'sess-1', cancelled: false })
    );
  });

  it('coordinatorState turns "waiting" on interval-waiting and back to "scanning" on the next cycle\'s first scan-started (regression: "Waiting for next cycle..." never appeared because coordinatorState was never driven by a live event)', async () => {
    const { result } = renderHook(
      () =>
        useScanSession(
          baseParams({
            isContinuous: true,
            intervalMinutes: 60,
            durationMinutes: 180,
          })
        ),
      { wrapper: wedgeWrapper }
    );

    await act(async () => {
      await result.current.startScan();
    });
    expect(result.current.coordinatorState).toBe('scanning');

    fire('interval-waiting', { cycle: 1, totalCycles: 3, nextScanMs: 60000 });
    expect(result.current.coordinatorState).toBe('waiting');

    fire('scan-started', { scannerId: 'sc-1', plateIndex: '00' });
    expect(result.current.coordinatorState).toBe('scanning');
  });

  // ── SCAN_ENDED/CANCELLED symmetry; late-event guard (task 26.1, design.md Decision 17) ──

  it('a clean single-shot completion clears pendingJobs and progressByScanner, not just isScanning (regression: SCAN_ENDED did not reset either, unlike CANCELLED)', async () => {
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
    });
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      imagePath: '/out/01.tiff',
    });

    await waitFor(() => expect(result.current.isScanning).toBe(false));
    expect(Object.keys(result.current.pendingJobs)).toHaveLength(0);
    expect(Object.keys(result.current.progressByScanner)).toHaveLength(0);
  });

  it('a late interval-waiting/scan-started event after the session has already ended does not resurrect coordinatorState (regression: no guard against a stray event arriving after SCAN_ENDED/CANCELLED)', async () => {
    const { result } = renderHook(
      () =>
        useScanSession(
          baseParams({
            isContinuous: true,
            intervalMinutes: 60,
            durationMinutes: 180,
          })
        ),
      { wrapper: wedgeWrapper }
    );

    await act(async () => {
      await result.current.startScan();
    });

    fire('interval-complete', {
      cyclesCompleted: 3,
      totalCycles: 3,
      cancelled: false,
    });
    await waitFor(() => expect(result.current.isScanning).toBe(false));
    expect(result.current.coordinatorState).toBe('idle');

    // A stray/late event arrives after the session has already ended.
    fire('interval-waiting', { cycle: 3, totalCycles: 3, nextScanMs: 60000 });
    expect(result.current.coordinatorState).toBe('idle');

    fire('scan-started', { scannerId: 'sc-1', plateIndex: '00' });
    expect(result.current.coordinatorState).toBe('idle');
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

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00.tiff',
      cycleNumber: 1,
    });
    await waitFor(() => expect(graviscansCreate).toHaveBeenCalledTimes(1));

    // A duplicated IPC event redelivers scan-complete for the same job.
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00.tiff',
      cycleNumber: 1,
    });
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

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00.tiff',
    });
    await waitFor(() =>
      expect(result.current.pendingJobs['sc-1:00']).toBeUndefined()
    );
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      imagePath: '/out/01.tiff',
    });

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
          baseParams({
            waveNumber: 2,
            isContinuous: true,
            intervalMinutes: 10,
            durationMinutes: 60,
          })
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
    const { result } = renderHook(
      () => useScanSession(baseParams({ waveNumber: 0 })),
      {
        wrapper: wedgeWrapper,
      }
    );
    await act(async () => {
      await result.current.startScan();
    });
    expect(
      localStorage.getItem('graviscan:session-in-progress:exp-1:0')
    ).not.toBeNull();

    await act(async () => {
      await result.current.cancelScan();
    });
    expect(
      localStorage.getItem('graviscan:session-in-progress:exp-1:0')
    ).toBeNull();
  });

  it('clean completion removes the marker', async () => {
    const { result } = renderHook(
      () => useScanSession(baseParams({ waveNumber: 0 })),
      {
        wrapper: wedgeWrapper,
      }
    );
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00.tiff',
    });
    await waitFor(() =>
      expect(result.current.pendingJobs['sc-1:00']).toBeUndefined()
    );
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      imagePath: '/out/01.tiff',
    });

    await waitFor(() =>
      expect(
        localStorage.getItem('graviscan:session-in-progress:exp-1:0')
      ).toBeNull()
    );
  });

  it('on mount with an inactive session, a marker for the currently selected experiment+wave surfaces a non-blocking banner naming the expected cycle count', async () => {
    localStorage.setItem(
      'graviscan:session-in-progress:exp-1:0',
      JSON.stringify({ expectedCycles: 6 })
    );
    getScanStatus.mockResolvedValue({
      success: true,
      data: { isActive: false },
    });

    const { result } = renderHook(
      () => useScanSession(baseParams({ waveNumber: 0 })),
      {
        wrapper: wedgeWrapper,
      }
    );

    await waitFor(() =>
      expect(result.current.abnormalTermination).toEqual({ expectedCycles: 6 })
    );
  });

  it('a marker for a different wave of the same experiment produces no banner', async () => {
    localStorage.setItem(
      'graviscan:session-in-progress:exp-1:5',
      JSON.stringify({ expectedCycles: 6 })
    );
    getScanStatus.mockResolvedValue({
      success: true,
      data: { isActive: false },
    });

    const { result } = renderHook(
      () => useScanSession(baseParams({ waveNumber: 0 })),
      {
        wrapper: wedgeWrapper,
      }
    );

    await waitFor(() => expect(getScanStatus).toHaveBeenCalled());
    expect(result.current.abnormalTermination).toBeNull();
  });

  it('no marker for the current experiment+wave produces no banner', async () => {
    getScanStatus.mockResolvedValue({
      success: true,
      data: { isActive: false },
    });
    const { result } = renderHook(
      () => useScanSession(baseParams({ waveNumber: 0 })),
      {
        wrapper: wedgeWrapper,
      }
    );

    await waitFor(() => expect(getScanStatus).toHaveBeenCalled());
    expect(result.current.abnormalTermination).toBeNull();
  });

  it('a fresh successful startScan() clears a pre-existing abnormalTermination banner (regression: banner persisted indefinitely once shown)', async () => {
    localStorage.setItem(
      'graviscan:session-in-progress:exp-1:0',
      JSON.stringify({ expectedCycles: 6 })
    );
    getScanStatus.mockResolvedValue({
      success: true,
      data: { isActive: false },
    });

    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });

    await waitFor(() =>
      expect(result.current.abnormalTermination).toEqual({ expectedCycles: 6 })
    );

    await act(async () => {
      await result.current.startScan();
    });

    expect(result.current.abnormalTermination).toBeNull();
  });

  it('the abnormal-termination banner still appears once experimentId/waveNumber resolve asynchronously after mount (regression: mount-once effect closure permanently missed a marker that only existed after resolving — matches GraviScan.tsx always starting experimentId at null)', async () => {
    localStorage.setItem(
      'graviscan:session-in-progress:exp-1:0',
      JSON.stringify({ expectedCycles: 6 })
    );
    getScanStatus.mockResolvedValue({
      success: true,
      data: { isActive: false },
    });

    const { result, rerender } = renderHook((props) => useScanSession(props), {
      initialProps: baseParams({ experimentId: null, waveNumber: 0 }),
      wrapper: wedgeWrapper,
    });

    // Nothing to find yet — experimentId isn't known.
    expect(result.current.abnormalTermination).toBeNull();

    // GraviScan.tsx's own async session-restore resolves moments later.
    rerender(baseParams({ experimentId: 'exp-1', waveNumber: 0 }));

    await waitFor(() =>
      expect(result.current.abnormalTermination).toEqual({ expectedCycles: 6 })
    );
  });

  it('switching to a different wave reactively clears a previously-shown abnormal-termination banner (not just "dont set" — must actively clear)', async () => {
    localStorage.setItem(
      'graviscan:session-in-progress:exp-1:3',
      JSON.stringify({ expectedCycles: 6 })
    );
    getScanStatus.mockResolvedValue({
      success: true,
      data: { isActive: false },
    });

    const { result, rerender } = renderHook((props) => useScanSession(props), {
      initialProps: baseParams({ experimentId: 'exp-1', waveNumber: 3 }),
      wrapper: wedgeWrapper,
    });

    await waitFor(() =>
      expect(result.current.abnormalTermination).toEqual({ expectedCycles: 6 })
    );

    rerender(baseParams({ experimentId: 'exp-1', waveNumber: 4 }));

    await waitFor(() => expect(result.current.abnormalTermination).toBeNull());
  });

  // ── Wedge-blocks-start (task 12.7, Decision 6) ──────────────────────────

  it('disables starting while an assigned scanner has an active, unacknowledged wedge', async () => {
    const { result } = renderHook(
      () => useScanSession(baseParams({ scannerIds: ['sc-1'] })),
      {
        wrapper: wedgeWrapper,
      }
    );
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
      return createElement(
        'div',
        { 'data-testid': 'can-start' },
        'not-mounted'
      );
    }
    function ScanSessionConsumer() {
      const session = useScanSession(baseParams({ scannerIds: ['sc-1'] }));
      return createElement(
        'div',
        { 'data-testid': 'can-start' },
        String(session.canStartScan)
      );
    }

    let showScanSession = false;
    const tree = () =>
      createElement(
        WedgeProvider,
        null,
        showScanSession
          ? createElement(ScanSessionConsumer)
          : createElement(Placeholder)
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
    const { result } = renderHook(
      () => useScanSession(baseParams({ scannerIds: ['sc-1'] })),
      {
        wrapper: wedgeWrapper,
      }
    );

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

  // ── Regressions found by review-pr round 1 ──────────────────────────────

  it('resolves the real scan-complete event shape: `path` (not `imagePath`) and `cycle_number` (not `cycleNumber`)', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    // scan-coordinator.ts's real forwarded event: only `path` and
    // `cycle_number`, never `imagePath`/`cycleNumber` — no camelCase
    // duplicates exist for these two fields (unlike scanner_id/plate_index).
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      path: '/out/00.tiff',
      cycle_number: 3,
    });
    await waitFor(() =>
      expect(result.current.pendingJobs['sc-1:00']).toBeUndefined()
    );

    expect(graviscansCreate).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/out/00.tiff', cycle_number: 3 })
    );
  });

  it('two scan-complete events for the last two remaining jobs, delivered synchronously with no render between them, both correctly resolve and end the session exactly once', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });
    expect(Object.keys(result.current.pendingJobs)).toHaveLength(2);

    // Both events fired inside the same act() — no render/effect flush
    // happens between them, exactly the scenario where a stateRef-based
    // "still pending" check would see the same stale snapshot twice.
    act(() => {
      (listeners['scan-complete'] || []).forEach((cb) =>
        cb({ scannerId: 'sc-1', plateIndex: '00', path: '/out/00.tiff' })
      );
      (listeners['scan-complete'] || []).forEach((cb) =>
        cb({ scannerId: 'sc-1', plateIndex: '01', path: '/out/01.tiff' })
      );
    });

    await waitFor(() => expect(result.current.isScanning).toBe(false));
    expect(Object.keys(result.current.pendingJobs)).toHaveLength(0);
    // finishSession must have run exactly once — graviscanSessions.complete
    // is its own unique signal for that.
    await waitFor(() =>
      expect(graviscanSessionsComplete).toHaveBeenCalledTimes(1)
    );
  });

  it('a duplicated scan-complete for an already-completed job (after the session already ended) does not re-fire finishSession', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

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
    await waitFor(() =>
      expect(graviscanSessionsComplete).toHaveBeenCalledTimes(1)
    );

    // A retried/duplicated IPC event for a job that already completed.
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      path: '/out/00.tiff',
    });
    expect(graviscanSessionsComplete).toHaveBeenCalledTimes(1);
  });

  it('a session where one job errors and the other completes still reaches "all done" (round-2 regression: errored jobs must count toward completion too)', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });
    expect(Object.keys(result.current.pendingJobs)).toHaveLength(2);

    fire('scan-error', {
      scannerId: 'sc-1',
      plateIndex: '00',
      error: 'sane_start: Invalid argument',
    });
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      path: '/out/01.tiff',
    });

    await waitFor(() => expect(result.current.isScanning).toBe(false));
    expect(Object.keys(result.current.pendingJobs)).toHaveLength(0);
    await waitFor(() =>
      expect(graviscanSessionsComplete).toHaveBeenCalledTimes(1)
    );
  });

  it('a stray scan-error for a job outside this session (unknown scanner/plate key) does not count toward "all done" (round-3 regression)', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });
    expect(Object.keys(result.current.pendingJobs)).toHaveLength(2);

    // A leftover/mismatched event for a job this session never started.
    fire('scan-error', {
      scannerId: 'sc-unknown',
      plateIndex: '99',
      error: 'stray event',
    });
    // Only one of the two real jobs completes — the session must NOT be
    // considered done just because the stray event inflated the count.
    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      path: '/out/00.tiff',
    });

    expect(result.current.isScanning).toBe(true);
    expect(Object.keys(result.current.pendingJobs)).toHaveLength(1);
    expect(graviscanSessionsComplete).not.toHaveBeenCalled();
  });

  it('startScan() called twice in rapid succession only starts one session', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });

    await act(async () => {
      await Promise.all([
        result.current.startScan(),
        result.current.startScan(),
      ]);
    });

    expect(startScan).toHaveBeenCalledTimes(1);
    expect(graviscanSessionsCreate).toHaveBeenCalledTimes(1);
  });

  it('clicking Start while a scan is already in progress surfaces an error instead of silently no-oping (regression)', async () => {
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });

    await act(async () => {
      await result.current.startScan();
    });
    expect(result.current.isScanning).toBe(true);

    await act(async () => {
      await result.current.startScan();
    });

    expect(startScan).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBe('A scan is already in progress.');
  });

  it('a getOutputDir() promise rejection (not just a resolved failure) surfaces an error instead of throwing unhandled', async () => {
    getOutputDir.mockRejectedValue(new Error('IPC bridge closed'));
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });

    await act(async () => {
      await result.current.startScan();
    });

    expect(result.current.error).toMatch(/IPC bridge closed/);
    expect(result.current.isScanning).toBe(false);
  });

  it('a failed graviscanSessions.create() surfaces an error but still starts the session (hardware already started)', async () => {
    graviscanSessionsCreate.mockResolvedValue({
      success: false,
      error: 'db locked',
    });
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });

    await act(async () => {
      await result.current.startScan();
    });

    expect(result.current.isScanning).toBe(true);
    expect(result.current.error).toMatch(/db locked/);
  });

  // ── Session context freeze (task 22.1, design.md Decision 13) ───────────

  it("a mid-scan wave switch does not misattribute a still-in-flight job's DB write, verification, or marker-clearing (regression: contextRef mirrored live selector state)", async () => {
    const { result, rerender } = renderHook((props) => useScanSession(props), {
      initialProps: baseParams({ waveNumber: 0 }),
      wrapper: wedgeWrapper,
    });

    await act(async () => {
      await result.current.startScan();
    });
    expect(
      localStorage.getItem('graviscan:session-in-progress:exp-1:0')
    ).not.toBeNull();

    // Operator switches wave while the session's jobs are still pending.
    rerender(baseParams({ waveNumber: 5 }));

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00.tiff',
    });
    await waitFor(() => expect(graviscansCreate).toHaveBeenCalled());
    expect(graviscansCreate).toHaveBeenCalledWith(
      expect.objectContaining({ wave_number: 0 })
    );

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      imagePath: '/out/01.tiff',
    });
    await waitFor(() => expect(verifyPlates).toHaveBeenCalled());
    expect(verifyPlates).toHaveBeenCalledWith(expect.any(Array), 'exp-1', 0);

    await waitFor(() =>
      expect(graviscanSessionsComplete).toHaveBeenCalledTimes(1)
    );
    // The session's own marker (wave 0) is cleared — no marker for wave 5
    // was ever written, so this also confirms clearAbnormalMarker targeted
    // the frozen wave, not the live one.
    expect(
      localStorage.getItem('graviscan:session-in-progress:exp-1:0')
    ).toBeNull();
  });

  it("a job completing after a mid-scan restore records against the backend session's own experimentId/waveNumber/resolution, not this hook instance's current props (regression: restore never froze a session context either)", async () => {
    getScanStatus.mockResolvedValue({
      success: true,
      data: {
        isActive: true,
        experimentId: 'exp-restored',
        phenotyperId: 'pheno-restored',
        waveNumber: 7,
        resolution: 2400,
        currentCycle: 1,
        totalCycles: 1,
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
      },
    });

    const { result } = renderHook(
      () =>
        useScanSession(baseParams({ experimentId: 'exp-1', waveNumber: 0 })),
      { wrapper: wedgeWrapper }
    );

    await waitFor(() => expect(result.current.isScanning).toBe(true));

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00.tiff',
    });

    await waitFor(() => expect(graviscansCreate).toHaveBeenCalled());
    expect(graviscansCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        experiment_id: 'exp-restored',
        phenotyper_id: 'pheno-restored',
        wave_number: 7,
        resolution: 2400,
      })
    );
  });

  // ── completedJobsRef restore on remount (task 23.1, design.md Decision 14) ─

  it('marks a job recorded (window.electron.gravi.markJobRecorded) once its DB write succeeds', async () => {
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
    });

    await waitFor(() =>
      expect(markJobRecorded).toHaveBeenCalledWith('sc-1:00')
    );
  });

  it('a job already recorded before a mid-scan remount is still included in QR verification after restore (regression: completedJobsRef was never rebuilt on restore)', async () => {
    getScanStatus.mockResolvedValue({
      success: true,
      data: {
        isActive: true,
        experimentId: 'exp-1',
        phenotyperId: 'pheno-1',
        waveNumber: 0,
        resolution: 1200,
        currentCycle: 1,
        totalCycles: 1,
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
            status: 'recorded',
          },
          'sc-1:01': {
            scannerId: 'sc-1',
            plateIndex: '01',
            outputPath: '/out/01.tiff',
            plantBarcode: 'PLATE_002',
            transplantDate: null,
            customNote: null,
            gridMode: '2grid',
            status: 'pending',
          },
        },
      },
    });

    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });

    await waitFor(() => expect(result.current.isScanning).toBe(true));
    // Only the still-pending job restores into pendingJobs.
    expect(result.current.pendingJobs['sc-1:00']).toBeUndefined();
    expect(result.current.pendingJobs['sc-1:01']).toBeDefined();

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '01',
      imagePath: '/out/01.tiff',
    });

    await waitFor(() => expect(verifyPlates).toHaveBeenCalled());
    const plates = verifyPlates.mock.calls[0][0] as Array<{
      plateIndex: string;
    }>;
    expect(plates.map((p) => p.plateIndex).sort()).toEqual(['00', '01']);
  });

  // ── achieved_resolution persistence (task 24.1, design.md Decision 15) ──

  it("persists the scan-complete event's achieved_resolution, not the requested DPI (regression: recordCompletedJob wrote ctx.resolution unconditionally)", async () => {
    const { result } = renderHook(
      () => useScanSession(baseParams({ resolution: 1200 })),
      { wrapper: wedgeWrapper }
    );
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00.tiff',
      achieved_resolution: 1180,
    });

    await waitFor(() => expect(graviscansCreate).toHaveBeenCalled());
    expect(graviscansCreate).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: 1180 })
    );
  });

  it('falls back to the requested resolution when a scan-complete event omits achieved_resolution', async () => {
    const { result } = renderHook(
      () => useScanSession(baseParams({ resolution: 1200 })),
      { wrapper: wedgeWrapper }
    );
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      imagePath: '/out/00.tiff',
    });

    await waitFor(() => expect(graviscansCreate).toHaveBeenCalled());
    expect(graviscansCreate).toHaveBeenCalledWith(
      expect.objectContaining({ resolution: 1200 })
    );
  });

  it('a failed database.graviscans.create() (recordCompletedJob) surfaces an error rather than failing silently', async () => {
    graviscansCreate.mockRejectedValue(new Error('disk full'));
    const { result } = renderHook(() => useScanSession(baseParams()), {
      wrapper: wedgeWrapper,
    });
    await act(async () => {
      await result.current.startScan();
    });

    fire('scan-complete', {
      scannerId: 'sc-1',
      plateIndex: '00',
      path: '/out/00.tiff',
    });

    await waitFor(() => expect(result.current.error).toMatch(/disk full/));
  });
});
