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
  images: [
    { id: 'img-1', status: 'pending', path: 'frame_000.jpg', frame_number: 0 },
  ],
  scanner_name: 'Cam-A',
  exposure_time: 50000,
  gain: 4,
  brightness: 0.5,
  contrast: 1.0,
  gamma: 1.0,
  seconds_per_rot: 7.0,
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
    config: {
      ...win.electron?.config,
      get: vi.fn().mockResolvedValue({ config: { scans_dir: '/scans' } }),
    },
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

describe('BrowseScans baseline rendering', () => {
  it('renders the table with the documented columns', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    const headerTexts = Array.from(document.querySelectorAll('thead th')).map(
      (th) => th.textContent?.trim()
    );

    [
      'Plant ID',
      'Accession',
      'Capture Date',
      'Experiment',
      'Phenotyper',
      'Wave',
      'Age (days)',
      'Images',
      'Upload Status',
      'Actions',
    ].forEach((header) => {
      expect(headerTexts).toContain(header);
    });
  });

  it('shows an empty-state message when there are no scans', async () => {
    mockList.mockResolvedValue(makeListResponse([]));
    renderPage();

    await waitFor(() => expect(mockList).toHaveBeenCalled());
    expect(await screen.findByText('No scans found')).toBeInTheDocument();
  });

  it('shows the total count summary', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    expect(await screen.findByText(/Showing 1 of 1 scans/)).toBeInTheDocument();
  });
});

describe('BrowseScans color palette', () => {
  it('uses focus:ring-lime-500 on the filter inputs, not blue', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    const experimentFilter = document.getElementById('experiment-filter');
    const dateFrom = document.getElementById('date-from');
    const dateTo = document.getElementById('date-to');

    [experimentFilter, dateFrom, dateTo].forEach((el) => {
      expect(el?.className).toContain('focus:ring-lime-500');
      expect(el?.className).not.toContain('focus:ring-blue-500');
    });
  });

  it('uses lime on the Plant ID link and the view icon, not blue', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    const plantLink = await screen.findByText('PLANT-001');
    expect(plantLink.className).toContain('text-lime-700');
    expect(plantLink.className).not.toContain('text-blue-600');

    const viewIcon = screen.getByTitle('View scan');
    expect(viewIcon.className).toContain('text-lime-700');
    expect(viewIcon.className).not.toContain('text-blue-600');
  });

  it('uses lime on the batch "Upload Selected" button, not blue', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    // Select the row to reveal the batch action bar
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]); // index 0 is "select all"

    const uploadSelectedButton = await screen.findByText(/Upload Selected/);
    expect(uploadSelectedButton.className).toContain('bg-lime-700');
    expect(uploadSelectedButton.className).not.toContain('bg-blue-600');
  });

  it('leaves gray row chrome and upload-status colors unchanged (regression guard)', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    const row = screen.getByText('PLANT-001').closest('tr');
    expect(row?.className).toContain('hover:bg-gray-50');

    const tbody = document.querySelector('tbody');
    expect(tbody?.className).toContain('divide-gray-100');
  });
});

describe('thumbnail column', () => {
  it('renders a lazy-loaded thumbnail sourced from the lowest-frame_number image', async () => {
    mockList.mockResolvedValue(
      makeListResponse([
        {
          ...baseScan,
          images: [
            {
              id: 'img-2',
              status: 'uploaded',
              path: 'frame_001.jpg',
              frame_number: 1,
            },
            {
              id: 'img-1',
              status: 'uploaded',
              path: 'frame_000.jpg',
              frame_number: 0,
            },
          ],
        },
      ])
    );

    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    const thumbnail = await screen.findByAltText(/thumbnail/i);
    expect(thumbnail).toHaveAttribute('loading', 'lazy');
    expect(thumbnail.getAttribute('src')).toContain('frame_000.jpg');
    expect(thumbnail.getAttribute('src')).not.toContain('frame_001.jpg');
  });

  it('renders a placeholder for a scan with zero images', async () => {
    mockList.mockResolvedValue(makeListResponse([{ ...baseScan, images: [] }]));

    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    expect(screen.queryByAltText(/thumbnail/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('thumbnail-placeholder')).toBeInTheDocument();
  });

  it('falls back to the placeholder when the image fails to load', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    const thumbnail = await screen.findByAltText(/thumbnail/i);
    fireEvent.error(thumbnail);

    await waitFor(() => {
      expect(screen.getByTestId('thumbnail-placeholder')).toBeInTheDocument();
    });
  });
});

describe('camera-settings column', () => {
  it('renders a compact summary including scanner name, exposure, and gain', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    expect(screen.getByText(/Cam-A/)).toBeInTheDocument();
    expect(screen.getByText(/Exp 50000ms/)).toBeInTheDocument();
    expect(screen.getByText(/Gain 4/)).toBeInTheDocument();
  });

  it('includes the full field set at unrounded precision in the title tooltip', async () => {
    renderPage();
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    await screen.findByText('PLANT-001');

    const summaryCell = screen.getByText(/Cam-A/).closest('[title]');
    expect(summaryCell).not.toBeNull();
    const title = summaryCell!.getAttribute('title')!;

    expect(title).toContain('Cam-A');
    expect(title).toContain('50000');
    expect(title).toContain('4');
    expect(title).toContain('0.5');
    expect(title).toContain('1');
  });
});
