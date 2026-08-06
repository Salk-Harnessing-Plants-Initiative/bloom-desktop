/**
 * Unit tests for BrowseScans page — delete flow
 * (add-cylinderscan-delete-upload-integrity, tasks.md 2.3/2.5/2.7).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { BrowseScans } from '../../../src/renderer/BrowseScans';

const baseScan = {
  id: 'scan-1',
  plant_id: 'PLANT-001',
  accession_name: 'Col-0',
  capture_date: '2026-02-17T10:30:00.000Z',
  experiment: { id: 'exp-1', name: 'Exp 1', species: 'Arabidopsis' },
  phenotyper: { id: 'phen-1', name: 'Jane' },
  wave_number: 1,
  plant_age_days: 14,
  images: [{ id: 'img-1', status: 'pending' }],
};

function makeListResponse(scans: unknown[]) {
  return {
    success: true,
    data: { scans, total: scans.length, page: 1, pageSize: 25 },
  };
}

let mockList: ReturnType<typeof vi.fn>;
let mockDelete: ReturnType<typeof vi.fn>;
let mockUpload: ReturnType<typeof vi.fn>;
let mockUploadBatch: ReturnType<typeof vi.fn>;
let mockExperimentsList: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockList = vi.fn().mockResolvedValue(makeListResponse([baseScan]));
  mockDelete = vi.fn().mockResolvedValue({ success: true, data: {} });
  mockUpload = vi.fn().mockResolvedValue({ success: true, data: {} });
  mockUploadBatch = vi.fn().mockResolvedValue({ success: true, data: {} });
  mockExperimentsList = vi.fn().mockResolvedValue({ success: true, data: [] });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron = {
    ...win.electron,
    database: {
      ...win.electron.database,
      scans: {
        list: mockList,
        delete: mockDelete,
        upload: mockUpload,
        uploadBatch: mockUploadBatch,
      },
      experiments: {
        list: mockExperimentsList,
      },
    },
  };
});

function renderPage() {
  return render(
    <MemoryRouter>
      <BrowseScans />
    </MemoryRouter>
  );
}

describe('BrowseScans delete flow', () => {
  it('opens a confirmation modal instead of window.confirm when Delete is clicked', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    fireEvent.click(screen.getByTitle('Delete scan'));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/Delete this scan\?/)).toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('calls scans.delete and refreshes the table when confirmed', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    fireEvent.click(screen.getByTitle('Delete scan'));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => expect(mockDelete).toHaveBeenCalledWith('scan-1'));
    await waitFor(() => expect(mockList).toHaveBeenCalledTimes(2));
  });

  it('does not delete when Cancel is clicked in the modal', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    fireEvent.click(screen.getByTitle('Delete scan'));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it('shows a success message after a successful delete', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    fireEvent.click(screen.getByTitle('Delete scan'));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await screen.findByText('Scan deleted successfully');
  });

  it('disables the Delete button while that scan is uploading', async () => {
    let resolveUpload: (value: unknown) => void = () => {};
    mockUpload.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      })
    );

    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    fireEvent.click(screen.getByTitle('Upload to Bloom'));

    await waitFor(() =>
      expect(screen.getByTitle('Delete scan')).toBeDisabled()
    );

    resolveUpload({ success: true, data: {} });
    await waitFor(() =>
      expect(screen.getByTitle('Delete scan')).not.toBeDisabled()
    );
  });
});
