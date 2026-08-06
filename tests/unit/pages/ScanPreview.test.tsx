/**
 * Unit tests for ScanPreview page — delete flow
 * (add-cylinderscan-delete-upload-integrity, tasks.md 2.9/2.10).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ScanPreview } from '../../../src/renderer/ScanPreview';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const baseScan = {
  id: 'scan-1',
  plant_id: 'PLANT-001',
  accession_name: 'Col-0',
  capture_date: '2026-02-17T10:30:00.000Z',
  experiment: { id: 'exp-1', name: 'Exp 1', species: 'Arabidopsis' },
  phenotyper: { id: 'phen-1', name: 'Jane' },
  wave_number: 1,
  plant_age_days: 14,
  exposure_time: 10000,
  gain: 100,
  gamma: 1,
  brightness: 0,
  contrast: 0,
  seconds_per_rot: 7,
  scanner_name: 'TestScanner',
  images: [{ id: 'img-1', frame_number: 1, path: 'a.png', status: 'pending' }],
};

let mockGet: ReturnType<typeof vi.fn>;
let mockDelete: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockNavigate.mockReset();
  mockGet = vi.fn().mockResolvedValue({ success: true, data: baseScan });
  mockDelete = vi.fn().mockResolvedValue({ success: true, data: {} });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron = {
    ...win.electron,
    database: {
      ...win.electron.database,
      scans: {
        get: mockGet,
        upload: vi.fn().mockResolvedValue({ success: true, data: {} }),
        delete: mockDelete,
      },
    },
    config: {
      ...win.electron.config,
      get: vi.fn().mockResolvedValue({ config: { scans_dir: '/scans' } }),
    },
  };
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/scan/scan-1']}>
      <Routes>
        <Route path="/scan/:scanId" element={<ScanPreview />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ScanPreview delete flow', () => {
  it('has a delete button in the toolbar', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'PLANT-001' });

    expect(screen.getByTitle('Delete scan')).toBeInTheDocument();
  });

  it('opens the confirmation modal when the delete button is clicked', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'PLANT-001' });

    fireEvent.click(screen.getByTitle('Delete scan'));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('calls scans.delete and navigates back to browse-scans when confirmed', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'PLANT-001' });

    fireEvent.click(screen.getByTitle('Delete scan'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('scan-1'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/browse-scans')
    );
  });

  it('does not delete when Cancel is clicked', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'PLANT-001' });

    fireEvent.click(screen.getByTitle('Delete scan'));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
