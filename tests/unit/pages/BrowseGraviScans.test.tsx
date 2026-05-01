/**
 * Unit tests for BrowseGraviScans page
 *
 * Tests scan list rendering, session grouping, filters,
 * empty state, placeholder images, soft-delete filtering,
 * and cancelled session indicators.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { BrowseGraviScans } from '../../../src/renderer/graviscan/BrowseGraviScans';

// ─── Mocks ─────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Sample data

const sampleExperiments = [
  {
    id: 'exp-1',
    name: 'Root Growth Study',
    species: 'Arabidopsis',
    accession_id: 'acc-1',
  },
  {
    id: 'exp-2',
    name: 'Gravity Response',
    species: 'Maize',
    accession_id: 'acc-2',
  },
];

const sampleScans = [
  {
    id: 'scan-1',
    experiment_id: 'exp-1',
    phenotyper_id: 'phen-1',
    scanner_id: 'scanner-1',
    session_id: 'session-1',
    wave_number: 1,
    plate_barcode: 'PLATE-001',
    plate_index: '1',
    grid_mode: '2grid',
    resolution: 1200,
    path: '/scans/scan-1.tif',
    capture_date: '2026-04-10T12:00:00.000Z',
    deleted: false,
    experiment: {
      id: 'exp-1',
      name: 'Root Growth Study',
      species: 'Arabidopsis',
    },
    phenotyper: { id: 'phen-1', name: 'Lab Bot 1' },
    scanner: { id: 'scanner-1', name: 'Epson V850' },
    session: {
      id: 'session-1',
      scan_mode: 'single',
      started_at: '2026-04-10T12:00:00.000Z',
      cancelled: false,
    },
    images: [{ id: 'img-1', path: '/scans/img-1.tif', status: 'pending' }],
  },
  {
    id: 'scan-2',
    experiment_id: 'exp-1',
    phenotyper_id: 'phen-1',
    scanner_id: 'scanner-1',
    session_id: 'session-1',
    wave_number: 1,
    plate_barcode: 'PLATE-002',
    plate_index: '2',
    grid_mode: '2grid',
    resolution: 1200,
    path: '/scans/scan-2.tif',
    capture_date: '2026-04-10T12:01:00.000Z',
    deleted: false,
    experiment: {
      id: 'exp-1',
      name: 'Root Growth Study',
      species: 'Arabidopsis',
    },
    phenotyper: { id: 'phen-1', name: 'Lab Bot 1' },
    scanner: { id: 'scanner-1', name: 'Epson V850' },
    session: {
      id: 'session-1',
      scan_mode: 'single',
      started_at: '2026-04-10T12:00:00.000Z',
      cancelled: false,
    },
    images: [{ id: 'img-2', path: '/scans/img-2.tif', status: 'pending' }],
  },
  {
    id: 'scan-3',
    experiment_id: 'exp-2',
    phenotyper_id: 'phen-1',
    scanner_id: 'scanner-1',
    session_id: 'session-2',
    wave_number: 2,
    plate_barcode: 'PLATE-003',
    plate_index: '1',
    grid_mode: '2grid',
    resolution: 1200,
    path: '/scans/scan-3.tif',
    capture_date: '2026-04-12T14:00:00.000Z',
    deleted: false,
    experiment: {
      id: 'exp-2',
      name: 'Gravity Response',
      species: 'Maize',
    },
    phenotyper: { id: 'phen-1', name: 'Lab Bot 1' },
    scanner: { id: 'scanner-1', name: 'Epson V850' },
    session: {
      id: 'session-2',
      scan_mode: 'continuous',
      started_at: '2026-04-12T14:00:00.000Z',
      cancelled: true,
    },
    images: [],
  },
];

// Soft-deleted scan (should be filtered out by DB query, but we test for it)
const deletedScan = {
  ...sampleScans[0],
  id: 'scan-deleted',
  deleted: true,
};

beforeEach(() => {
  vi.clearAllMocks();

  // Reset mock implementations
  window.electron.database.graviscans.list = vi
    .fn()
    .mockResolvedValue({ success: true, data: sampleScans });

  window.electron.database.experiments.list = vi
    .fn()
    .mockResolvedValue({ success: true, data: sampleExperiments });

  window.electron.gravi.readScanImage = vi
    .fn()
    .mockResolvedValue({ success: true, data: 'data:image/jpeg;base64,abc' });
});

function renderBrowseGraviScans() {
  return render(
    <MemoryRouter>
      <BrowseGraviScans />
    </MemoryRouter>
  );
}

// ─── Tests ─────────────────────────────────────────────────

describe('BrowseGraviScans page', () => {
  // --- Renders scan list grouped by session ---
  describe('Session grouping', () => {
    it('renders scans grouped by session', async () => {
      renderBrowseGraviScans();

      await waitFor(() => {
        // Should show scan data
        expect(screen.getByText(/PLATE-001/)).toBeInTheDocument();
        expect(screen.getByText(/PLATE-002/)).toBeInTheDocument();
      });
    });

    it('groups scans under session headers', async () => {
      renderBrowseGraviScans();

      await waitFor(() => {
        // Session headers show truncated session IDs (first 8 chars)
        // session-1 -> "Session session-" and session-2 -> "Session session-"
        // Check that there are 2 session groups rendered
        const sessionHeaders = screen.getAllByText(/Session /);
        expect(sessionHeaders.length).toBe(2);
      });
    });
  });

  // --- Filter by experiment ---
  describe('Experiment filter', () => {
    it('shows experiment dropdown', async () => {
      renderBrowseGraviScans();

      await waitFor(() => {
        const select = screen.getByLabelText(/experiment/i);
        expect(select).toBeInTheDocument();
      });
    });

    it('filters scans by experiment when selected', async () => {
      renderBrowseGraviScans();

      await waitFor(() => {
        expect(screen.getByLabelText(/experiment/i)).toBeInTheDocument();
      });

      const select = screen.getByLabelText(/experiment/i);
      fireEvent.change(select, { target: { value: 'exp-1' } });

      // The list call should be re-triggered with experiment filter
      await waitFor(() => {
        expect(window.electron.database.graviscans.list).toHaveBeenCalledWith(
          expect.objectContaining({ experiment_id: 'exp-1' })
        );
      });
    });
  });

  // --- Date filter ---
  describe('Date filter', () => {
    it('shows date range inputs', async () => {
      renderBrowseGraviScans();

      await waitFor(() => {
        expect(screen.getByLabelText(/from date/i)).toBeInTheDocument();
        expect(screen.getByLabelText(/to date/i)).toBeInTheDocument();
      });
    });
  });

  // --- Empty state ---
  describe('Empty state', () => {
    it('shows empty state with guidance when no scans', async () => {
      window.electron.database.graviscans.list = vi
        .fn()
        .mockResolvedValue({ success: true, data: [] });

      renderBrowseGraviScans();

      await waitFor(() => {
        expect(screen.getByText(/no scans found/i)).toBeInTheDocument();
      });
    });
  });

  // --- Placeholder for missing images ---
  describe('Image placeholders', () => {
    it('shows placeholder when readScanImage fails', async () => {
      window.electron.gravi.readScanImage = vi
        .fn()
        .mockResolvedValue({ success: false, data: null });

      renderBrowseGraviScans();

      await waitFor(() => {
        expect(screen.getByText(/PLATE-001/)).toBeInTheDocument();
      });

      // Placeholder should be shown for failed images
      const placeholders = screen.getAllByText(/no preview/i);
      expect(placeholders.length).toBeGreaterThan(0);
    });
  });

  // --- Soft-deleted scans ---
  describe('Soft-deleted scans', () => {
    it('does not display soft-deleted scans', async () => {
      // DB returns only non-deleted (the API filters deleted: false)
      // But we also verify the component does not render them if they slip through
      window.electron.database.graviscans.list = vi.fn().mockResolvedValue({
        success: true,
        data: [...sampleScans, deletedScan],
      });

      renderBrowseGraviScans();

      await waitFor(() => {
        expect(screen.getByText(/PLATE-001/)).toBeInTheDocument();
      });

      // The deleted scan should not appear — BrowseGraviScans filters deleted
      const scanCards = screen.getAllByTestId('graviscan-card');
      // sampleScans has 3, deletedScan should be excluded
      expect(scanCards.length).toBe(3);
    });
  });

  // --- Cancelled session indicator ---
  describe('Cancelled session indicator', () => {
    it('shows cancelled indicator for cancelled sessions', async () => {
      renderBrowseGraviScans();

      await waitFor(() => {
        expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
      });
    });
  });
});
