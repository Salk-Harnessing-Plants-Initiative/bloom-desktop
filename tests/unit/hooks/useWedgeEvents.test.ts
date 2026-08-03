import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWedgeEvents } from '../../../src/renderer/hooks/useWedgeEvents';
import type { GraviWedgeEvent } from '../../../src/types/graviscan';

function makeEvent(overrides: Partial<GraviWedgeEvent> = {}): GraviWedgeEvent {
  return {
    scanner_id: 'sc-1',
    signature: 'sane_start_invalid',
    session_id: 'sess-1',
    cycle_number: 1,
    timestamp: '2026-08-03T00:00:00.000Z',
    error_message: 'epkowa: sane_start: Invalid argument',
    ...overrides,
  };
}

describe('useWedgeEvents', () => {
  let wedgeListeners: Array<(event: GraviWedgeEvent) => void>;
  let intervalCompleteListeners: Array<() => void>;
  let cancelledListeners: Array<() => void>;
  let unsubscribeWedge: ReturnType<typeof vi.fn>;
  let unsubscribeIntervalComplete: ReturnType<typeof vi.fn>;
  let unsubscribeCancelled: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    wedgeListeners = [];
    intervalCompleteListeners = [];
    cancelledListeners = [];
    unsubscribeWedge = vi.fn();
    unsubscribeIntervalComplete = vi.fn();
    unsubscribeCancelled = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.gravi = {
      onWedgeDetected: vi.fn((cb: (event: GraviWedgeEvent) => void) => {
        wedgeListeners.push(cb);
        return unsubscribeWedge;
      }),
      onIntervalComplete: vi.fn((cb: () => void) => {
        intervalCompleteListeners.push(cb);
        return unsubscribeIntervalComplete;
      }),
      onCancelled: vi.fn((cb: () => void) => {
        cancelledListeners.push(cb);
        return unsubscribeCancelled;
      }),
    };
  });

  function fireWedge(event: GraviWedgeEvent) {
    act(() => {
      wedgeListeners.forEach((cb) => cb(event));
    });
  }

  it('adds one entry keyed by scanner_id on a wedge event', () => {
    const { result } = renderHook(() => useWedgeEvents());
    fireWedge(makeEvent());

    expect(Object.keys(result.current.entries)).toEqual(['sc-1']);
    expect(result.current.entries['sc-1'].signature).toBe('sane_start_invalid');
  });

  it('replaces (not duplicates) the entry when a second wedge fires for the same scanner_id', () => {
    const { result } = renderHook(() => useWedgeEvents());
    fireWedge(makeEvent({ cycle_number: 3, signature: 'sane_start_invalid' }));
    fireWedge(
      makeEvent({ cycle_number: 5, signature: 'device_io_120s_zero_bytes' })
    );

    expect(Object.keys(result.current.entries)).toEqual(['sc-1']);
    expect(result.current.entries['sc-1'].cycle_number).toBe(5);
    expect(result.current.entries['sc-1'].signature).toBe(
      'device_io_120s_zero_bytes'
    );
  });

  it('tracks two different scanners as independent entries; dismissing one leaves the other untouched', () => {
    const { result } = renderHook(() => useWedgeEvents());
    fireWedge(makeEvent({ scanner_id: 'sc-1', cycle_number: 1 }));
    fireWedge(makeEvent({ scanner_id: 'sc-2', cycle_number: 2 }));

    expect(Object.keys(result.current.entries).sort()).toEqual([
      'sc-1',
      'sc-2',
    ]);

    act(() => {
      result.current.dismiss('sc-1');
    });

    expect(Object.keys(result.current.entries)).toEqual(['sc-2']);
    expect(result.current.entries['sc-2'].cycle_number).toBe(2);
  });

  it('clears all entries when onIntervalComplete fires', () => {
    const { result } = renderHook(() => useWedgeEvents());
    fireWedge(makeEvent());
    expect(Object.keys(result.current.entries)).toHaveLength(1);

    act(() => {
      intervalCompleteListeners.forEach((cb) => cb());
    });

    expect(Object.keys(result.current.entries)).toHaveLength(0);
  });

  it('clears all entries when onCancelled fires', () => {
    const { result } = renderHook(() => useWedgeEvents());
    fireWedge(makeEvent());
    expect(Object.keys(result.current.entries)).toHaveLength(1);

    act(() => {
      cancelledListeners.forEach((cb) => cb());
    });

    expect(Object.keys(result.current.entries)).toHaveLength(0);
  });

  it('dismiss(scannerId) removes exactly that entry with no IPC call', () => {
    const { result } = renderHook(() => useWedgeEvents());
    fireWedge(makeEvent());

    act(() => {
      result.current.dismiss('sc-1');
    });

    expect(Object.keys(result.current.entries)).toHaveLength(0);
  });

  it('dismissIfCurrent removes the entry when cycle_number/timestamp still match', () => {
    const { result } = renderHook(() => useWedgeEvents());
    fireWedge(makeEvent({ cycle_number: 3, timestamp: 't1' }));

    act(() => {
      result.current.dismissIfCurrent('sc-1', 3, 't1');
    });

    expect(Object.keys(result.current.entries)).toHaveLength(0);
  });

  it('dismissIfCurrent is a no-op when a fresh wedge has superseded the entry (stale retry callback)', () => {
    const { result } = renderHook(() => useWedgeEvents());
    fireWedge(makeEvent({ cycle_number: 3, timestamp: 't1' }));
    fireWedge(makeEvent({ cycle_number: 4, timestamp: 't2' }));

    act(() => {
      // Stale identity from the superseded (cycle 3) wedge.
      result.current.dismissIfCurrent('sc-1', 3, 't1');
    });

    expect(Object.keys(result.current.entries)).toEqual(['sc-1']);
    expect(result.current.entries['sc-1'].cycle_number).toBe(4);
  });

  it('unmount calls all three cleanup functions', () => {
    const { unmount } = renderHook(() => useWedgeEvents());
    unmount();

    expect(unsubscribeWedge).toHaveBeenCalledTimes(1);
    expect(unsubscribeIntervalComplete).toHaveBeenCalledTimes(1);
    expect(unsubscribeCancelled).toHaveBeenCalledTimes(1);
  });

  it('totalAutoPauseEvents increments on every wedge, including repeats for the same scanner, and is unaffected by dismiss', () => {
    const { result } = renderHook(() => useWedgeEvents());
    fireWedge(makeEvent({ scanner_id: 'sc-1' }));
    fireWedge(makeEvent({ scanner_id: 'sc-1' })); // retried, wedged again
    fireWedge(makeEvent({ scanner_id: 'sc-2' }));

    expect(result.current.totalAutoPauseEvents).toBe(3);

    act(() => {
      result.current.dismiss('sc-1');
    });

    expect(result.current.totalAutoPauseEvents).toBe(3);
  });

  it('totalScannersAffected counts distinct scanners, not events — a repeat on the same scanner does not inflate it', () => {
    const { result } = renderHook(() => useWedgeEvents());
    fireWedge(makeEvent({ scanner_id: 'sc-1' }));
    expect(result.current.totalAutoPauseEvents).toBe(1);
    expect(result.current.totalScannersAffected).toBe(1);

    fireWedge(makeEvent({ scanner_id: 'sc-1' })); // same scanner again
    expect(result.current.totalAutoPauseEvents).toBe(2);
    expect(result.current.totalScannersAffected).toBe(1);

    fireWedge(makeEvent({ scanner_id: 'sc-2' })); // new scanner
    expect(result.current.totalAutoPauseEvents).toBe(3);
    expect(result.current.totalScannersAffected).toBe(2);
  });

  it('resets both counters to 0 when the session ends (interval-complete/cancelled), same as the per-scanner entries', () => {
    const { result } = renderHook(() => useWedgeEvents());
    fireWedge(makeEvent({ scanner_id: 'sc-1' }));
    fireWedge(makeEvent({ scanner_id: 'sc-2' }));
    expect(result.current.totalAutoPauseEvents).toBe(2);
    expect(result.current.totalScannersAffected).toBe(2);

    act(() => {
      intervalCompleteListeners.forEach((cb) => cb());
    });

    expect(result.current.totalAutoPauseEvents).toBe(0);
    expect(result.current.totalScannersAffected).toBe(0);
  });
});
