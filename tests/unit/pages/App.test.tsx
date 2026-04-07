/**
 * Unit tests for App component — mode-conditional routing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
};

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAppMode.mockReturnValue({ mode: 'cylinderscan', isLoading: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  if (win) {
    win.electron = {
      ...win.electron,
      config: mockConfigAPI,
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

    // Sidebar should show capture-related nav items
    await waitFor(() => {
      expect(screen.getByText('Capture Scan')).toBeInTheDocument();
    });
    expect(screen.getByText('Camera Settings')).toBeInTheDocument();
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
});
