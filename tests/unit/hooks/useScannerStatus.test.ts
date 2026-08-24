import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useScannerStatus } from '../../../src/renderer/hooks/useScannerStatus';
import type { ScannerStatusRow } from '../../../src/types/graviscan';

function row(overrides: Partial<ScannerStatusRow> = {}): ScannerStatusRow {
  return {
    scannerId: 'sc-1',
    displayName: 'Scanner 1',
    usbPort: '1-1',
    gridMode: '2grid',
    status: 'ready',
    ...overrides,
  };
}

describe('useScannerStatus', () => {
  let getScannerStatus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    getScannerStatus = vi.fn().mockResolvedValue({
      success: true,
      scanners: [row()],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.gravi = { getScannerStatus };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('maps each ScannerStatusRow into a ScannerPanelState including gridMode', async () => {
    getScannerStatus.mockResolvedValue({
      success: true,
      scanners: [row({ gridMode: '4grid' })],
    });

    const { result } = renderHook(() => useScannerStatus());

    await waitFor(() => expect(result.current.scanners).toHaveLength(1));
    expect(result.current.scanners[0].scannerId).toBe('sc-1');
    expect(result.current.scanners[0].gridMode).toBe('4grid');
    expect(result.current.scanners[0].connectionStatus).toBe('ready');
  });

  it('marks a scanner error/dead/disconnected as offline', async () => {
    getScannerStatus.mockResolvedValue({
      success: true,
      scanners: [
        row({ scannerId: 'sc-err', status: 'error' }),
        row({ scannerId: 'sc-dead', status: 'dead' }),
        row({ scannerId: 'sc-disc', status: 'disconnected' }),
        row({ scannerId: 'sc-ok', status: 'ready' }),
      ],
    });

    const { result } = renderHook(() => useScannerStatus());
    await waitFor(() => expect(result.current.scanners).toHaveLength(4));

    const byId = Object.fromEntries(
      result.current.scanners.map((s) => [s.scannerId, s])
    );
    expect(byId['sc-err'].isOnline).toBe(false);
    expect(byId['sc-dead'].isOnline).toBe(false);
    expect(byId['sc-disc'].isOnline).toBe(false);
    expect(byId['sc-ok'].isOnline).toBe(true);
  });

  it('polls getScannerStatus while any scanner is starting, and stops once all leave starting (PR #213 fix)', async () => {
    vi.useFakeTimers();
    getScannerStatus.mockResolvedValueOnce({
      success: true,
      scanners: [row({ status: 'starting' })],
    });

    renderHook(() => useScannerStatus());
    // Flush the initial mount's async refresh() so the "starting" status is
    // observed and the polling effect's setInterval is created under fake-
    // timer control (created any earlier, e.g. under real timers, would not
    // respond to advanceTimersByTimeAsync below).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getScannerStatus).toHaveBeenCalledTimes(1);

    // Still starting on the next poll.
    getScannerStatus.mockResolvedValueOnce({
      success: true,
      scanners: [row({ status: 'starting' })],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getScannerStatus).toHaveBeenCalledTimes(2);

    // Now ready — one more poll should observe it, then polling stops.
    getScannerStatus.mockResolvedValue({
      success: true,
      scanners: [row({ status: 'ready' })],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(getScannerStatus).toHaveBeenCalledTimes(3);

    const callsBeforeExtraTime = getScannerStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    // No further polling once nothing is starting.
    expect(getScannerStatus).toHaveBeenCalledTimes(callsBeforeExtraTime);
  });

  it('does not poll when no scanner is starting', async () => {
    getScannerStatus.mockResolvedValue({
      success: true,
      scanners: [row({ status: 'ready' })],
    });

    renderHook(() => useScannerStatus());
    await waitFor(() => expect(getScannerStatus).toHaveBeenCalledTimes(1));

    vi.useFakeTimers();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(getScannerStatus).toHaveBeenCalledTimes(1);
  });

  it('exposes a refresh() a caller can invoke to force a refetch outside the polling loop', async () => {
    // Capture Scan's Start Scan flow spawns/initializes scanner subprocesses
    // (session-handlers.ts's startScan -> coordinator.initialize()) entirely
    // between the button click and useScanSession's isScanning becoming
    // true — after this hook's initial mount-time fetch already ran. Unlike
    // Configure Scanner (where the hook's own poll-while-'starting' loop is
    // what observes that transition, since initialization happens through
    // that page's own actions while the hook is already mounted and
    // polling), Capture Scan's initial fetch can only ever see the pre-scan
    // 'disconnected' snapshot. GraviScan.tsx calls refresh() on the
    // isScanning transition to close that gap (not modeled here, since it
    // needs useScanSession's output, which itself depends on this hook's
    // `scanners` — see the hook's doc comment) — this test just confirms
    // refresh() does the refetch it would rely on.
    getScannerStatus.mockResolvedValueOnce({
      success: true,
      scanners: [row({ status: 'disconnected' })],
    });
    getScannerStatus.mockResolvedValueOnce({
      success: true,
      scanners: [row({ status: 'ready' })],
    });

    const { result } = renderHook(() => useScannerStatus());

    await waitFor(() =>
      expect(result.current.scanners[0]?.connectionStatus).toBe('disconnected')
    );
    expect(getScannerStatus).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.refresh();
    });

    await waitFor(() =>
      expect(result.current.scanners[0]?.connectionStatus).toBe('ready')
    );
    expect(getScannerStatus).toHaveBeenCalledTimes(2);
  });
});
