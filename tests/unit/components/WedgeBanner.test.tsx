import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { WedgeBanner } from '../../../src/renderer/components/WedgeBanner';
import type { GraviWedgeEvent } from '../../../src/types/graviscan';

function makeEvent(overrides: Partial<GraviWedgeEvent> = {}): GraviWedgeEvent {
  return {
    scanner_id: 'sc-1',
    signature: 'sane_start_invalid',
    session_id: 'sess-1',
    cycle_number: 1,
    timestamp: '2026-08-03T00:00:00.000Z',
    error_message: 'epkowa: sane_start: Invalid argument',
    display_name: 'Bench 3',
    ...overrides,
  };
}

describe('WedgeBanner', () => {
  let wedgeListeners: Array<(event: GraviWedgeEvent) => void>;
  let intervalCompleteListeners: Array<() => void>;
  let cancelledListeners: Array<() => void>;
  let retryScanner: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    wedgeListeners = [];
    intervalCompleteListeners = [];
    cancelledListeners = [];
    retryScanner = vi.fn().mockResolvedValue({ success: true });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.gravi = {
      onWedgeDetected: vi.fn((cb: (event: GraviWedgeEvent) => void) => {
        wedgeListeners.push(cb);
        return () => {};
      }),
      onIntervalComplete: vi.fn((cb: () => void) => {
        intervalCompleteListeners.push(cb);
        return () => {};
      }),
      onCancelled: vi.fn((cb: () => void) => {
        cancelledListeners.push(cb);
        return () => {};
      }),
      retryScanner,
    };
  });

  function fireWedge(event: GraviWedgeEvent) {
    act(() => {
      wedgeListeners.forEach((cb) => cb(event));
    });
  }

  it('renders a banner entry showing identity/signature/error, with already-paused copy, in error styling', () => {
    render(<WedgeBanner />);
    fireWedge(makeEvent());

    expect(screen.getByText(/Bench 3/)).toBeInTheDocument();
    expect(screen.getByText(/sane_start_invalid/)).toBeInTheDocument();
    expect(
      screen.getByText(/sane_start: Invalid argument/)
    ).toBeInTheDocument();
    expect(screen.getByText(/paused/i)).toBeInTheDocument();

    const entry = screen.getByTestId('wedge-entry-sc-1');
    expect(entry.className).toContain('bg-red-50');
    expect(entry.className).toContain('border-red-500');
  });

  it('renders two independently-actionable entries as a vertically-stacked list', () => {
    render(<WedgeBanner />);
    fireWedge(makeEvent({ scanner_id: 'sc-1', display_name: 'Bench 1' }));
    fireWedge(makeEvent({ scanner_id: 'sc-2', display_name: 'Bench 2' }));

    expect(screen.getByTestId('wedge-entry-sc-1')).toBeInTheDocument();
    expect(screen.getByTestId('wedge-entry-sc-2')).toBeInTheDocument();
  });

  it('Dismiss removes the entry without calling retryScanner', async () => {
    const user = userEvent.setup();
    render(<WedgeBanner />);
    fireWedge(makeEvent());

    await user.click(
      screen.getByRole('button', { name: /dismiss/i, hidden: false })
    );

    expect(screen.queryByTestId('wedge-entry-sc-1')).not.toBeInTheDocument();
    expect(retryScanner).not.toHaveBeenCalled();
  });

  it('Power-Cycled & Retry shows a confirmation sub-state with explanatory text, without calling retryScanner yet', async () => {
    const user = userEvent.setup();
    render(<WedgeBanner />);
    fireWedge(makeEvent());

    await user.click(
      screen.getByRole('button', { name: /power-cycled.*retry/i })
    );

    expect(retryScanner).not.toHaveBeenCalled();
    expect(screen.getByText(/power.cycl/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /confirm retry/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
  });

  it('Confirm Retry calls retryScanner and removes the entry on success', async () => {
    const user = userEvent.setup();
    render(<WedgeBanner />);
    fireWedge(makeEvent());

    await user.click(
      screen.getByRole('button', { name: /power-cycled.*retry/i })
    );
    await user.click(screen.getByRole('button', { name: /confirm retry/i }));

    expect(retryScanner).toHaveBeenCalledWith('sc-1');
    await waitFor(() =>
      expect(screen.queryByTestId('wedge-entry-sc-1')).not.toBeInTheDocument()
    );
  });

  it('Cancel reverts to the unconfirmed state without calling retryScanner', async () => {
    const user = userEvent.setup();
    render(<WedgeBanner />);
    fireWedge(makeEvent());

    await user.click(
      screen.getByRole('button', { name: /power-cycled.*retry/i })
    );
    await user.click(screen.getByRole('button', { name: /^cancel$/i }));

    expect(retryScanner).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: /power-cycled.*retry/i })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /confirm retry/i })
    ).not.toBeInTheDocument();
  });

  it('a failed Confirm Retry leaves the entry in place and shows the error inline', async () => {
    retryScanner.mockResolvedValue({ success: false, error: 'still wedged' });
    const user = userEvent.setup();
    render(<WedgeBanner />);
    fireWedge(makeEvent());

    await user.click(
      screen.getByRole('button', { name: /power-cycled.*retry/i })
    );
    await user.click(screen.getByRole('button', { name: /confirm retry/i }));

    expect(await screen.findByText(/still wedged/)).toBeInTheDocument();
    expect(screen.getByTestId('wedge-entry-sc-1')).toBeInTheDocument();
  });

  it('a rejected Confirm Retry (IPC promise rejects, not resolves-with-error) shows an error and leaves the entry in place', async () => {
    retryScanner.mockRejectedValue(new Error('IPC channel closed'));
    const user = userEvent.setup();
    render(<WedgeBanner />);
    fireWedge(makeEvent());

    await user.click(
      screen.getByRole('button', { name: /power-cycled.*retry/i })
    );
    await user.click(screen.getByRole('button', { name: /confirm retry/i }));

    expect(await screen.findByText(/IPC channel closed/)).toBeInTheDocument();
    expect(screen.getByTestId('wedge-entry-sc-1')).toBeInTheDocument();
  });

  it('does not dismiss a fresh, superseding wedge entry when a stale in-flight retry for the same scanner later resolves successfully', async () => {
    let resolveRetry!: (value: { success: true }) => void;
    retryScanner.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRetry = resolve;
        })
    );
    const user = userEvent.setup();
    render(<WedgeBanner />);
    fireWedge(makeEvent({ cycle_number: 1, signature: 'sane_start_invalid' }));

    await user.click(
      screen.getByRole('button', { name: /power-cycled.*retry/i })
    );
    await user.click(screen.getByRole('button', { name: /confirm retry/i }));

    // A fresh wedge for the same scanner supersedes the entry before the
    // first retry call resolves — e.g. the respawned worker re-wedged
    // almost immediately because the physical power-cycle wasn't actually
    // done yet.
    fireWedge(
      makeEvent({ cycle_number: 2, signature: 'device_io_120s_zero_bytes' })
    );

    // The stale retry call now resolves successfully.
    await act(async () => {
      resolveRetry({ success: true });
    });

    // The new, unaddressed wedge entry must still be showing — the stale
    // "success" belongs to the superseded occurrence, not this one.
    expect(screen.getByTestId('wedge-entry-sc-1')).toBeInTheDocument();
    expect(screen.getByText(/device_io_120s_zero_bytes/)).toBeInTheDocument();
  });

  it('resets to the unconfirmed two-button view when a new wedge supersedes an entry mid-confirmation', async () => {
    const user = userEvent.setup();
    render(<WedgeBanner />);
    fireWedge(makeEvent({ cycle_number: 1 }));

    await user.click(
      screen.getByRole('button', { name: /power-cycled.*retry/i })
    );
    expect(
      screen.getByRole('button', { name: /confirm retry/i })
    ).toBeInTheDocument();

    fireWedge(makeEvent({ cycle_number: 2 }));

    expect(
      screen.queryByRole('button', { name: /confirm retry/i })
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /power-cycled.*retry/i })
    ).toBeInTheDocument();
    expect(retryScanner).not.toHaveBeenCalled();
  });

  it('shows no counter indicator when totalAutoPauseEvents is 0, and shows both numbers together once wedges occur', () => {
    render(<WedgeBanner />);
    expect(
      screen.queryByTestId('wedge-session-counter')
    ).not.toBeInTheDocument();

    fireWedge(makeEvent({ scanner_id: 'sc-1' }));
    fireWedge(makeEvent({ scanner_id: 'sc-1' }));
    fireWedge(makeEvent({ scanner_id: 'sc-2' }));

    const counter = screen.getByTestId('wedge-session-counter');
    expect(counter).toHaveTextContent('3');
    expect(counter).toHaveTextContent('2');
  });
});
