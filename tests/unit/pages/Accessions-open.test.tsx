/**
 * The Accessions page opened from an experiment's accession file link
 * (/accessions?open=<id>): the linked file opens, and a link to a file that no
 * longer exists says so instead of doing nothing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Accessions } from '../../../src/renderer/Accessions';

const FILES = [
  { id: 'acc-1', name: 'Col-0 lines', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'acc-2', name: 'Soy lines', createdAt: '2026-02-01T00:00:00.000Z' },
];

let getMappings: ReturnType<typeof vi.fn>;
const realScroll = Element.prototype.scrollIntoView;

beforeEach(() => {
  getMappings = vi.fn().mockResolvedValue({ success: true, data: [] });
  Element.prototype.scrollIntoView = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron.database.experiments = {
    latestScans: vi.fn().mockResolvedValue({ success: true, data: [] }),
  };
  win.electron.database.accessions = {
    list: vi.fn().mockResolvedValue({ success: true, data: FILES }),
    getMappings,
    create: vi.fn(),
    createWithMappings: vi.fn(),
  };
});

afterEach(() => {
  Element.prototype.scrollIntoView = realScroll;
});

function renderAt(url: string) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/accessions" element={<Accessions />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('Accessions page opened from a link', () => {
  it('opens the file named in ?open=', async () => {
    renderAt('/accessions?open=acc-2');
    await waitFor(() => expect(getMappings).toHaveBeenCalledWith('acc-2'));
    expect(getMappings).not.toHaveBeenCalledWith('acc-1');
    expect(
      screen.queryByText(/accession file was not found/)
    ).not.toBeInTheDocument();
  });

  it('says when the linked file no longer exists', async () => {
    renderAt('/accessions?open=deleted-id');
    expect(
      await screen.findByText(
        'That accession file was not found. It may have been deleted.'
      )
    ).toBeInTheDocument();
    expect(getMappings).not.toHaveBeenCalled();
  });

  it('opens nothing and says nothing without a link', async () => {
    renderAt('/accessions');
    expect(await screen.findByText('Soy lines')).toBeInTheDocument();
    expect(getMappings).not.toHaveBeenCalled();
    expect(
      screen.queryByText(/accession file was not found/)
    ).not.toBeInTheDocument();
  });
});
