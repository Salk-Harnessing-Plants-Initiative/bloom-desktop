/**
 * Unit tests for MachineConfiguration — scanner mode selector and conditional fields
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MachineConfiguration } from '../../../src/renderer/MachineConfiguration';

// Mock window.electron.config
const mockConfigAPI = {
  get: vi.fn(),
  set: vi.fn(),
  testCamera: vi.fn(),
  browseDirectory: vi.fn(),
  exists: vi.fn(),
  fetchScanners: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();

  (
    window as unknown as { electron: { config: typeof mockConfigAPI } }
  ).electron = { config: mockConfigAPI };

  mockConfigAPI.get.mockResolvedValue({
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
  });

  mockConfigAPI.exists.mockResolvedValue(false);
  mockConfigAPI.set.mockResolvedValue({ success: true });
  mockConfigAPI.testCamera.mockResolvedValue({ success: true });
  mockConfigAPI.browseDirectory.mockResolvedValue(null);
});

describe('MachineConfiguration — Scanner Mode', () => {
  it('scanner mode selector is the first visible field', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Scanner Mode')).toBeInTheDocument();
    });

    // Radio buttons should be present
    expect(screen.getByLabelText('CylinderScan')).toBeInTheDocument();
    expect(screen.getByLabelText('GraviScan')).toBeInTheDocument();
  });

  it('CylinderScan fields visible when mode is cylinderscan', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Scanner Mode')).toBeInTheDocument();
    });

    // Hardware and Scan Parameters sections should be visible
    expect(screen.getByText('Hardware')).toBeInTheDocument();
    expect(screen.getByText('Scan Parameters')).toBeInTheDocument();
    expect(screen.getByLabelText(/Camera IP/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Frames per rotation/i)).toBeInTheDocument();
  });

  it('CylinderScan fields hidden when mode is graviscan', async () => {
    mockConfigAPI.get.mockResolvedValue({
      config: {
        scanner_mode: 'graviscan',
        scanner_name: '',
        camera_ip_address: '',
        scans_dir: '~/.bloom/scans',
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        bloom_scanner_username: '',
        bloom_scanner_password: '',
        bloom_anon_key: '',
        num_frames: 72,
        seconds_per_rot: 7.0,
      },
      hasCredentials: false,
    });

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Scanner Mode')).toBeInTheDocument();
    });

    // Hardware and Scan Parameters should NOT be visible
    expect(screen.queryByText('Hardware')).not.toBeInTheDocument();
    expect(screen.queryByText('Scan Parameters')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Camera IP/i)).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Frames per rotation/i)
    ).not.toBeInTheDocument();

    // Shared sections should still be visible
    expect(screen.getByText('Bloom API Credentials')).toBeInTheDocument();
    expect(screen.getByText('Station Identity')).toBeInTheDocument();
  });

  it('switching mode hides cylinder-specific fields', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Hardware')).toBeInTheDocument();
    });

    // Switch to GraviScan
    fireEvent.click(screen.getByLabelText('GraviScan'));

    await waitFor(() => {
      expect(screen.queryByText('Hardware')).not.toBeInTheDocument();
    });
    expect(screen.queryByText('Scan Parameters')).not.toBeInTheDocument();
  });

  it('save succeeds with graviscan mode and empty camera_ip', async () => {
    mockConfigAPI.get.mockResolvedValue({
      config: {
        scanner_mode: 'graviscan',
        scanner_name: '',
        camera_ip_address: '',
        scans_dir: '~/.bloom/scans',
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        bloom_scanner_username: '',
        bloom_scanner_password: '',
        bloom_anon_key: '',
        num_frames: 72,
        seconds_per_rot: 7.0,
      },
      hasCredentials: false,
    });

    mockConfigAPI.set.mockResolvedValue({ success: true });

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Scanner Mode')).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Save Configuration/i })
    );

    await waitFor(() => {
      expect(mockConfigAPI.set).toHaveBeenCalledWith(
        expect.objectContaining({ scanner_mode: 'graviscan' })
      );
    });
  });
});
