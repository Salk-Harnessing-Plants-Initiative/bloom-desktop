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
