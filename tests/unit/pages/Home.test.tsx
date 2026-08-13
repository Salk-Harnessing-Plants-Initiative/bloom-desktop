/**
 * Unit tests for Home page — mode-aware workflow steps
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Home } from '../../../src/renderer/Home';

// Track navigations
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock window.electron
const mockConfigAPI = {
  exists: vi.fn().mockResolvedValue(true),
  getMode: vi.fn().mockResolvedValue({ mode: 'cylinderscan' }),
};

const mockPythonAPI = {
  getVersion: vi.fn().mockResolvedValue({ version: '1.0.0' }),
  checkHardware: vi.fn().mockResolvedValue({ camera: false, daq: false }),
  onStatus: vi.fn().mockReturnValue(vi.fn()),
  onError: vi.fn().mockReturnValue(vi.fn()),
};

const mockGetRecent = vi.fn().mockResolvedValue({ success: true, data: [] });
const mockGetFailedUploadCount = vi
  .fn()
  .mockResolvedValue({ success: true, data: { failedCount: 0 } });

beforeEach(() => {
  vi.clearAllMocks();
  mockConfigAPI.exists.mockResolvedValue(true);
  mockGetRecent.mockResolvedValue({ success: true, data: [] });
  mockGetFailedUploadCount.mockResolvedValue({
    success: true,
    data: { failedCount: 0 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win) {
    win.electron = {
      ...win.electron,
      config: mockConfigAPI,
      python: mockPythonAPI,
      database: {
        ...win.electron?.database,
        scans: {
          ...win.electron?.database?.scans,
          getRecent: mockGetRecent,
          getFailedUploadCount: mockGetFailedUploadCount,
        },
      },
    };
  }
});

describe('Home page', () => {
  it('renders the CylinderScanWorkflowGuide (Daily Workflow / Setup sections) when mode is cylinderscan', async () => {
    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    // The generic "Workflow Steps" heading is retired for cylinderscan mode —
    // CylinderScanWorkflowGuide has its own "Daily Workflow"/"Setup" headers,
    // which would otherwise nest redundantly under it.
    await waitFor(() => {
      expect(screen.getByText('Daily Workflow')).toBeInTheDocument();
    });
    expect(screen.getByText('Setup')).toBeInTheDocument();

    // CylinderScan's steps (Camera Settings, Accessions, etc.) all still render
    expect(screen.getByText('Camera Settings')).toBeInTheDocument();
    expect(screen.getByText('Accessions')).toBeInTheDocument();
    expect(screen.getByText(/CylinderScan workflow/)).toBeInTheDocument();
  });

  it('renders GraviScan workflow steps when mode is graviscan', async () => {
    render(
      <MemoryRouter>
        <Home mode="graviscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Workflow Steps')).toBeInTheDocument();
    });

    // GraviScan has Metadata step, no Camera Settings
    expect(screen.getByText('Metadata')).toBeInTheDocument();
    expect(screen.queryByText('Camera Settings')).not.toBeInTheDocument();
  });

  it('each step navigates to correct route on click', async () => {
    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Scientists')).toBeInTheDocument();
    });

    // Click the Scientists step (slug testid — CylinderScanWorkflowGuide
    // uses workflow-step-${id}, not the old numeric workflow-step-${step})
    fireEvent.click(screen.getByTestId('workflow-step-scientists'));
    expect(mockNavigate).toHaveBeenCalledWith('/scientists');
  });

  it('redirects to /machine-config when no config exists', async () => {
    mockConfigAPI.exists.mockResolvedValue(false);

    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/machine-config');
    });
  });
});

describe("Home page — Today's Activity summary (#104)", () => {
  it("shows today's scans and an aggregated upload-status breakdown across all of them", async () => {
    mockGetRecent.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'scan-1',
          plant_id: 'PLANT-001',
          capture_date: '2026-08-12T10:00:00.000Z',
          experiment: { name: 'Exp A' },
          images: [
            { status: 'uploaded' },
            { status: 'uploaded' },
            { status: 'failed' },
          ],
        },
        {
          id: 'scan-2',
          plant_id: 'PLANT-002',
          capture_date: '2026-08-12T11:00:00.000Z',
          experiment: { name: 'Exp B' },
          images: [{ status: 'pending' }, { status: 'uploaded' }],
        },
      ],
    });

    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Today's Activity")).toBeInTheDocument();
    });

    expect(screen.getByText('PLANT-001')).toBeInTheDocument();
    expect(screen.getByText('PLANT-002')).toBeInTheDocument();

    // Combined across both scans: 3 uploaded, 1 failed, 1 pending
    expect(screen.getByText(/3 uploaded/)).toBeInTheDocument();
    expect(screen.getByText(/1 failed/)).toBeInTheDocument();
    expect(screen.getByText(/1 pending/)).toBeInTheDocument();
  });

  it('shows an empty/neutral state when no scans were captured today (not an error)', async () => {
    mockGetRecent.mockResolvedValue({ success: true, data: [] });

    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Today's Activity")).toBeInTheDocument();
    });

    expect(screen.getByText(/no scans captured today/i)).toBeInTheDocument();
  });

  it("does not fetch getRecent or render Today's Activity in graviscan mode", async () => {
    render(
      <MemoryRouter>
        <Home mode="graviscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Workflow Steps')).toBeInTheDocument();
    });

    expect(mockGetRecent).not.toHaveBeenCalled();
    expect(screen.queryByText("Today's Activity")).not.toBeInTheDocument();
  });

  it('shows a distinct error message when getRecent fails, not the same "no scans" empty state', async () => {
    mockGetRecent.mockResolvedValue({ success: false, error: 'DB error' });

    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/couldn.t load today.s activity/i)
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/no scans captured today/i)
    ).not.toBeInTheDocument();
  });

  it('shows the same distinct error message when getRecent rejects', async () => {
    mockGetRecent.mockRejectedValue(new Error('IPC failure'));

    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/couldn.t load today.s activity/i)
      ).toBeInTheDocument();
    });
  });

  it('disclose truncation when exactly 10 recent scans are returned (the getRecent limit)', async () => {
    mockGetRecent.mockResolvedValue({
      success: true,
      data: Array.from({ length: 10 }, (_, i) => ({
        id: `scan-${i}`,
        plant_id: `PLANT-${i}`,
        capture_date: '2026-08-12T10:00:00.000Z',
        experiment: null,
        images: [{ status: 'uploaded' }],
      })),
    });

    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/showing the 10 most recent scans/i)
      ).toBeInTheDocument();
    });
  });

  it('does not show the truncation disclosure when fewer than 10 scans are returned', async () => {
    mockGetRecent.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'scan-1',
          plant_id: 'PLANT-001',
          capture_date: '2026-08-12T10:00:00.000Z',
          experiment: null,
          images: [{ status: 'uploaded' }],
        },
      ],
    });

    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('PLANT-001')).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/showing the 10 most recent scans/i)
    ).not.toBeInTheDocument();
  });
});

describe('Home page — date-unscoped failed-upload indicator (#104)', () => {
  it('shows a persistent failed-upload indicator whenever failedCount > 0, even with no scans today', async () => {
    mockGetRecent.mockResolvedValue({ success: true, data: [] });
    mockGetFailedUploadCount.mockResolvedValue({
      success: true,
      data: { failedCount: 3 },
    });

    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/3 failed uploads need attention/i)
      ).toBeInTheDocument();
    });
  });

  it('shows no indicator when failedCount is 0', async () => {
    mockGetFailedUploadCount.mockResolvedValue({
      success: true,
      data: { failedCount: 0 },
    });

    render(
      <MemoryRouter>
        <Home mode="cylinderscan" />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Today's Activity")).toBeInTheDocument();
    });

    expect(
      screen.queryByText(/failed uploads need attention/i)
    ).not.toBeInTheDocument();
  });
});
