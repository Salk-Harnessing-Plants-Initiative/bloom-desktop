/**
 * Unit tests for MachineConfiguration — scanner mode selector and conditional fields
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from '@testing-library/react';
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

// Mock window.electron.camera / window.electron.python — the Hardware
// section (cylinderscan mode) now calls these on mount for camera detection
// and Check Hardware/Restart Python (see #338/#339).
const mockCameraAPI = { detectCameras: vi.fn() };
const mockPythonAPI = { checkHardware: vi.fn(), restart: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();

  (
    window as unknown as {
      electron: {
        config: typeof mockConfigAPI;
        camera: typeof mockCameraAPI;
        python: typeof mockPythonAPI;
      };
    }
  ).electron = {
    config: mockConfigAPI,
    camera: mockCameraAPI,
    python: mockPythonAPI,
  };

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

  mockCameraAPI.detectCameras.mockResolvedValue({
    success: true,
    cameras: [
      {
        ip_address: 'mock',
        model_name: 'Mock Camera',
        serial_number: '',
        mac_address: '',
        user_defined_name: '',
        friendly_name: 'Mock Camera',
        is_mock: true,
      },
    ],
  });
  mockPythonAPI.checkHardware.mockResolvedValue({
    camera: { library_available: true, devices_found: 1, available: true },
    daq: { library_available: true, devices_found: 1, available: true },
  });
  mockPythonAPI.restart.mockResolvedValue({ success: true });
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
    expect(
      screen.getByRole('button', { name: /Check Hardware/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Restart Python/i })
    ).toBeInTheDocument();
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
    expect(
      screen.queryByRole('button', { name: /Check Hardware/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Restart Python/i })
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

describe('MachineConfiguration — Restart Required Notice', () => {
  it('shows a persistent restart-required notice when scanner_mode changes and save succeeds', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Scanner Mode')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('GraviScan'));
    fireEvent.click(
      screen.getByRole('button', { name: /Save Configuration/i })
    );

    await waitFor(() => {
      expect(screen.getByTestId('restart-required-notice')).toBeInTheDocument();
    });
  });

  it('does not show the restart-required notice when a non-mode field changes and save succeeds', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Scans Directory/i)).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Scans Directory/i), {
      target: { value: '/data/new-scans' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Save Configuration/i })
    );

    await waitFor(() => {
      expect(
        screen.getByText('Configuration saved successfully!')
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByTestId('restart-required-notice')
    ).not.toBeInTheDocument();
  });

  it('the restart-required notice survives past the 3-second auto-dismiss window used by the generic toast', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    try {
      render(<MachineConfiguration />);

      await vi.waitFor(() => {
        expect(screen.getByText('Scanner Mode')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByLabelText('GraviScan'));
      fireEvent.click(
        screen.getByRole('button', { name: /Save Configuration/i })
      );

      await vi.waitFor(() => {
        expect(
          screen.getByTestId('restart-required-notice')
        ).toBeInTheDocument();
      });

      act(() => {
        vi.advanceTimersByTime(3500);
      });

      expect(screen.getByTestId('restart-required-notice')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('dismissing the restart-required notice removes it', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Scanner Mode')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('GraviScan'));
    fireEvent.click(
      screen.getByRole('button', { name: /Save Configuration/i })
    );

    await waitFor(() => {
      expect(screen.getByTestId('restart-required-notice')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Dismiss/i }));

    expect(
      screen.queryByTestId('restart-required-notice')
    ).not.toBeInTheDocument();
  });

  it('does not stack the generic save toast on top of a still-visible, not-yet-dismissed restart-required notice', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Scanner Mode')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('GraviScan'));
    fireEvent.click(
      screen.getByRole('button', { name: /Save Configuration/i })
    );

    await waitFor(() => {
      expect(screen.getByTestId('restart-required-notice')).toBeInTheDocument();
    });

    // A second, unrelated save (no further mode change) while the notice
    // is still showing and undismissed.
    fireEvent.change(screen.getByLabelText(/Scanner Name/i), {
      target: { value: 'RenamedScanner' },
    });
    fireEvent.click(
      screen.getByRole('button', { name: /Save Configuration/i })
    );

    await waitFor(() => {
      expect(mockConfigAPI.set).toHaveBeenCalledTimes(2);
    });

    expect(screen.getByTestId('restart-required-notice')).toBeInTheDocument();
    expect(
      screen.queryByText('Configuration saved successfully!')
    ).not.toBeInTheDocument();
  });
});
