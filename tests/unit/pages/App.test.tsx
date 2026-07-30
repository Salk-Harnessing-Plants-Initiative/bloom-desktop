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
  getConfig: vi
    .fn()
    .mockResolvedValue({
      success: true,
      data: { success: true, config: null },
    }),
  getScanStatus: vi
    .fn()
    .mockResolvedValue({ success: true, data: { isActive: false } }),
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

  it('renders browse routes regardless of mode', async () => {
    mockUseAppMode.mockReturnValue({ mode: 'graviscan', isLoading: false });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Browse Scans')).toBeInTheDocument();
    });
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
