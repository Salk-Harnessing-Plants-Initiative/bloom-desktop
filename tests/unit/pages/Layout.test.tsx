/**
 * Unit tests for Layout — mode-conditional nav links
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { Layout } from '../../../src/renderer/Layout';

beforeEach(() => {
  vi.clearAllMocks();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win) {
    win.electron = {
      ...win.electron,
      scanner: {
        getScannerId: vi.fn().mockResolvedValue('TestScanner'),
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
});
