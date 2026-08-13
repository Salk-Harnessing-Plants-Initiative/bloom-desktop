/**
 * Unit tests for Layout — mode-conditional nav links
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '../../../src/renderer/Layout';
import type { GraviWedgeEvent } from '../../../src/types/graviscan';

let wedgeListeners: Array<(event: GraviWedgeEvent) => void>;

beforeEach(() => {
  vi.clearAllMocks();
  wedgeListeners = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win) {
    win.electron = {
      ...win.electron,
      scanner: {
        getScannerId: vi.fn().mockResolvedValue('TestScanner'),
      },
      // Wedge-response UI (Tier 3) mocks — without these, WedgeBanner
      // mounting unconditionally in graviscan mode throws
      // TypeError: Cannot read properties of undefined (reading
      // 'onWedgeDetected') against this file's otherwise-bare mock.
      gravi: {
        onWedgeDetected: vi.fn((cb: (event: GraviWedgeEvent) => void) => {
          wedgeListeners.push(cb);
          return () => {};
        }),
        onIntervalComplete: vi.fn(() => () => {}),
        onCancelled: vi.fn(() => () => {}),
        retryScanner: vi.fn().mockResolvedValue({ success: true }),
      },
    };
  }
});

function renderLayout(mode: string | null) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Layout mode={mode} />}>
          <Route index element={<div>Home content</div>} />
          <Route
            path="configure-scanner"
            element={<div>Configure Scanner content</div>}
          />
        </Route>
      </Routes>
    </MemoryRouter>
  );
}

describe('Layout nav links', () => {
  it('renders a "Configure Scanner" nav link pointing to /configure-scanner in graviscan mode', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    const link = screen.getByRole('link', { name: /configure scanner/i });
    expect(link).toHaveAttribute('href', '/configure-scanner');
  });

  it('does not render a "Configure Scanner" nav link in cylinderscan mode', async () => {
    renderLayout('cylinderscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    expect(
      screen.queryByRole('link', { name: /configure scanner/i })
    ).not.toBeInTheDocument();
  });

  it('renders a "Capture Scan" nav link pointing to /capture-scan in graviscan mode', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    const link = screen.getByRole('link', { name: /^capture scan$/i });
    expect(link).toHaveAttribute('href', '/capture-scan');
  });
});

describe('Layout wedge banner wiring', () => {
  it('mounts the wedge banner (subscribes to onWedgeDetected) in graviscan mode', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((window.electron.gravi as any).onWedgeDetected).toHaveBeenCalled();
  });

  it('does not mount the wedge banner (no onWedgeDetected subscription) in cylinderscan mode', async () => {
    renderLayout('cylinderscan');
    await waitFor(() => screen.getByText(/scanner:/i));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gravi = window.electron.gravi as any;
    expect(gravi.onWedgeDetected).not.toHaveBeenCalled();
  });

  it('renders the wedge banner app-wide — alongside whatever child route is active, not scoped to one screen', async () => {
    renderLayout('graviscan');
    await waitFor(() => screen.getByText(/scanner:/i));
    expect(screen.getByText('Home content')).toBeInTheDocument();

    act(() => {
      wedgeListeners.forEach((cb) =>
        cb({
          scanner_id: 'sc-1',
          signature: 'sane_start_invalid',
          session_id: 'sess-1',
          cycle_number: 1,
          timestamp: '2026-08-03T00:00:00.000Z',
          error_message: 'epkowa: sane_start: Invalid argument',
        })
      );
    });

    // The banner and the (unrelated) index route content are both visible
    // at the same time — proves the banner isn't scoped to a dedicated
    // scan screen (design.md Decision 4).
    expect(screen.getByTestId('wedge-entry-sc-1')).toBeInTheDocument();
    expect(screen.getByText('Home content')).toBeInTheDocument();
  });
});
