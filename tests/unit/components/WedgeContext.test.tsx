import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { WedgeProvider, useWedgeContext } from '../../../src/renderer/contexts/WedgeContext';
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

/** A consumer that renders whether it currently sees an active wedge for
 * 'sc-1', to prove two independently-mounted consumers observe the same
 * shared state. */
function Consumer({ label }: { label: string }) {
  const { entries } = useWedgeContext();
  const hasWedge = 'sc-1' in entries;
  return <div data-testid={label}>{hasWedge ? 'wedged' : 'clear'}</div>;
}

describe('WedgeContext', () => {
  let wedgeListeners: Array<(event: GraviWedgeEvent) => void>;

  beforeEach(() => {
    wedgeListeners = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.gravi = {
      onWedgeDetected: vi.fn((cb: (event: GraviWedgeEvent) => void) => {
        wedgeListeners.push(cb);
        return vi.fn();
      }),
      onIntervalComplete: vi.fn(() => vi.fn()),
      onCancelled: vi.fn(() => vi.fn()),
    };
  });

  function fireWedge(event: GraviWedgeEvent) {
    act(() => {
      wedgeListeners.forEach((cb) => cb(event));
    });
  }

  it('provides the same wedge state to a consumer already mounted when a wedge fires', () => {
    render(
      <WedgeProvider>
        <Consumer label="banner" />
      </WedgeProvider>
    );
    expect(screen.getByTestId('banner').textContent).toBe('clear');

    fireWedge(makeEvent());
    expect(screen.getByTestId('banner').textContent).toBe('wedged');
  });

  it('a second, later-mounted consumer observes a wedge that occurred before it mounted', () => {
    let showSecondConsumer = false;
    const { rerender } = render(
      <WedgeProvider>
        <Consumer label="banner" />
        {showSecondConsumer && <Consumer label="scan-screen" />}
      </WedgeProvider>
    );

    // Wedge fires while only the first consumer (simulating WedgeBanner,
    // always mounted) is present.
    fireWedge(makeEvent());
    expect(screen.getByTestId('banner').textContent).toBe('wedged');

    // Simulate navigating to the Capture Scan screen — a second consumer
    // mounts AFTER the wedge already fired. It must see the same state,
    // not start blank — the exact bug an independent-useWedgeEvents()-
    // per-consumer design had.
    showSecondConsumer = true;
    rerender(
      <WedgeProvider>
        <Consumer label="banner" />
        {showSecondConsumer && <Consumer label="scan-screen" />}
      </WedgeProvider>
    );
    expect(screen.getByTestId('scan-screen').textContent).toBe('wedged');
  });

  it('registers exactly one onWedgeDetected subscription regardless of consumer count', () => {
    render(
      <WedgeProvider>
        <Consumer label="a" />
        <Consumer label="b" />
      </WedgeProvider>
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    expect(win.electron.gravi.onWedgeDetected).toHaveBeenCalledTimes(1);
  });
});
