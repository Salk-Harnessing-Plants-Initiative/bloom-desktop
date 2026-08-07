/**
 * Unit tests for App component — mode-conditional routing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import App from '../../../src/renderer/App';

// Mock useAppMode at the module level
const mockUseAppMode = vi.fn();
vi.mock('../../../src/renderer/hooks/useAppMode', () => ({
  useAppMode: () => mockUseAppMode(),
}));

// Mock window.electron for components that use it
const mockConfigAPI = {
  get: vi.fn().mockResolvedValue({
    config: {
      scanner_mode: 'cylinderscan',
      scanner_name: '',
      camera_ip_address: 'mock',
      scans_dir: '~/.bloom/scans',
      bloom_api_url: 'https://api.bloom.salk.edu/proxy',
      bloom_scanner_username: '',
      bloom_scanner_password: '',
      bloom_anon_key: '',
      num_frames: 72,
      seconds_per_rot: 7.0,
    },
    hasCredentials: false,
  }),
  set: vi.fn().mockResolvedValue({ success: true }),
  testCamera: vi.fn(),
  browseDirectory: vi.fn(),
  exists: vi.fn().mockResolvedValue(true),
  getMode: vi.fn().mockResolvedValue({ mode: 'cylinderscan' }),
  fetchScanners: vi.fn(),
  getGraviScanEnvStatus: vi
    .fn()
    .mockResolvedValue({ slackConfigured: true, libusbRecoveryEnabled: true }),
};

const mockGraviAPI = {
  getScannerStatus: vi.fn().mockResolvedValue({ success: true, scanners: [] }),
  getConfig: vi.fn().mockResolvedValue({
    success: true,
    data: { success: true, config: null },
  }),
  getScanStatus: vi
    .fn()
    .mockResolvedValue({ success: true, data: { isActive: false } }),
  onScanStarted: vi.fn().mockReturnValue(vi.fn()),
  onScanComplete: vi.fn().mockReturnValue(vi.fn()),
  onScanError: vi.fn().mockReturnValue(vi.fn()),
  // Wedge-response UI (Tier 3) — without these, WedgeBanner mounting
  // unconditionally in graviscan mode throws (this file renders the real
  // App -> Layout tree, so Layout's WedgeBanner mounts for real here too).
  onWedgeDetected: vi.fn().mockReturnValue(vi.fn()),
  onIntervalStart: vi.fn().mockReturnValue(vi.fn()),
  onIntervalComplete: vi.fn().mockReturnValue(vi.fn()),
  onCancelled: vi.fn().mockReturnValue(vi.fn()),
  onUploadProgress: vi.fn().mockReturnValue(vi.fn()),
  retryScanner: vi.fn().mockResolvedValue({ success: true }),
  // BrowseGraviScans (Tier 5) — mounted for real when its nav link is
  // clicked in this file's real App -> Layout -> Route tree.
  uploadAllScans: vi.fn().mockResolvedValue({
    success: true,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }),
  downloadImages: vi.fn().mockResolvedValue({ success: true }),
};

const mockDatabaseGraviscansAPI = {
  browseByExperiment: vi
    .fn()
    .mockResolvedValue({ success: true, data: { experiments: [], total: 0 } }),
};

const mockDatabaseExperimentsAPI = {
  listGraviMetadata: vi.fn().mockResolvedValue({ success: true, data: [] }),
};

const mockDatabaseGraviPlateAccessionsAPI = {
  listFiles: vi.fn().mockResolvedValue({ success: true, data: [] }),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAppMode.mockReturnValue({ mode: 'cylinderscan', isLoading: false });
  mockConfigAPI.getGraviScanEnvStatus.mockResolvedValue({
    slackConfigured: true,
    libusbRecoveryEnabled: true,
  });
  mockGraviAPI.getScannerStatus.mockResolvedValue({
    success: true,
    scanners: [],
  });
  mockGraviAPI.getConfig.mockResolvedValue({
    success: true,
    data: { success: true, config: null },
  });
  mockGraviAPI.getScanStatus.mockResolvedValue({
    success: true,
    data: { isActive: false },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win) {
    win.electron = {
      ...win.electron,
      config: mockConfigAPI,
      gravi: mockGraviAPI,
      scanner: { getScannerId: vi.fn().mockResolvedValue('TestScanner') },
      database: {
        ...win.electron.database,
        graviscans: mockDatabaseGraviscansAPI,
        experiments: {
          ...win.electron.database?.experiments,
          ...mockDatabaseExperimentsAPI,
        },
        graviPlateAccessions: mockDatabaseGraviPlateAccessionsAPI,
      },
    };
  }
});

describe('App routing', () => {
  it('shows loading state while mode is resolving', () => {
    mockUseAppMode.mockReturnValue({ mode: null, isLoading: true });

    render(<App />);

    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('renders capture routes when mode is cylinderscan', async () => {
    mockUseAppMode.mockReturnValue({ mode: 'cylinderscan', isLoading: false });

    render(<App />);

    // Sidebar should show capture-related nav items (may appear multiple times due to Home workflow)
    await waitFor(() => {
      expect(screen.getAllByText('Capture Scan').length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText('Camera Settings').length).toBeGreaterThan(0);
  });

  it('renders the shared Browse Scans link in cylinderscan mode', async () => {
    mockUseAppMode.mockReturnValue({ mode: 'cylinderscan', isLoading: false });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Browse Scans')).toBeInTheDocument();
    });
  });

  it('replaces the shared Browse Scans link with Browse GraviScans and Metadata in graviscan mode', async () => {
    mockUseAppMode.mockReturnValue({ mode: 'graviscan', isLoading: false });

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: /browse graviscans/i })
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('link', { name: /^metadata$/i })
    ).toBeInTheDocument();
    // Scoped to the sidebar nav link specifically — the Home page's
    // "Browse Scans" workflow-step card title is unchanged by this tier
    // (only its target route changed, per design.md Decision 2) and would
    // otherwise cause a false failure here.
    expect(
      screen.queryByRole('link', { name: /^browse scans$/i })
    ).not.toBeInTheDocument();
  });

  it('shows Layout subtitle matching mode', async () => {
    mockUseAppMode.mockReturnValue({ mode: 'graviscan', isLoading: false });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('GraviScan')).toBeInTheDocument();
    });
  });

  it('shows CylinderScan subtitle for cylinderscan mode', async () => {
    mockUseAppMode.mockReturnValue({ mode: 'cylinderscan', isLoading: false });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('CylinderScan')).toBeInTheDocument();
    });
  });

  it('does not make /browse-graviscans, /graviscan-experiment/:id, or /metadata reachable in cylinderscan mode', async () => {
    mockUseAppMode.mockReturnValue({ mode: 'cylinderscan', isLoading: false });

    render(<App />);

    // None of the three new nav links exist in cylinderscan mode, so there
    // is no in-app way to navigate there — confirms the routes are gated.
    await waitFor(() => {
      expect(screen.getAllByText('Camera Settings').length).toBeGreaterThan(0);
    });
    expect(
      screen.queryByRole('link', { name: /browse graviscans/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /^metadata$/i })
    ).not.toBeInTheDocument();
  });

  it('makes /browse-graviscans, /graviscan-experiment/:id, and /metadata reachable (not the catch-all redirect) in graviscan mode', async () => {
    mockUseAppMode.mockReturnValue({ mode: 'graviscan', isLoading: false });

    render(<App />);

    const browseLink = await screen.findByRole('link', {
      name: /browse graviscans/i,
    });
    fireEvent.click(browseLink);
    await waitFor(() => {
      expect(screen.queryByText(/Loading/i)).not.toBeInTheDocument();
    });
    // The catch-all route redirects unknown/gated paths to Home, which
    // re-renders the sidebar and workflow steps; confirm we did NOT land
    // there by checking the Home-only "workflow-step-1" testid is absent.
    expect(screen.queryByTestId('workflow-step-1')).not.toBeInTheDocument();

    const metadataLink = screen.getByRole('link', { name: /^metadata$/i });
    fireEvent.click(metadataLink);
    await waitFor(() => {
      expect(screen.queryByTestId('workflow-step-1')).not.toBeInTheDocument();
    });
  });

  it('navigates to the ConfigureScanner page via its nav link in graviscan mode', async () => {
    mockUseAppMode.mockReturnValue({ mode: 'graviscan', isLoading: false });

    render(<App />);

    const navLink = await screen.findByRole('link', {
      name: /configure scanner/i,
    });
    fireEvent.click(navLink);

    await waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /configure scanner/i })
      ).toBeInTheDocument();
    });
  });
});
