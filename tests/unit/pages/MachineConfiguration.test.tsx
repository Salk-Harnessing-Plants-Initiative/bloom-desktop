/**
 * Unit tests for MachineConfiguration page
 *
 * TDD: Tests define expected behavior before implementation.
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

// Mock window.electron.camera (camera auto-detection, relocated from
// CameraSettingsForm per #338)
const mockCameraAPI = {
  detectCameras: vi.fn(),
};

// Mock window.electron.python (Check Hardware / Restart Python, relocated
// from Home's PythonStatus per #339)
const mockPythonAPI = {
  checkHardware: vi.fn(),
  restart: vi.fn(),
};

const MOCK_CAMERA = {
  ip_address: 'mock',
  model_name: 'Mock Camera',
  serial_number: '',
  mac_address: '',
  user_defined_name: '',
  friendly_name: 'Mock Camera',
  is_mock: true,
};

// Setup mock before tests
beforeEach(() => {
  vi.clearAllMocks();

  // Setup window.electron mock
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

  // Default mock implementations
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
    },
    hasCredentials: false,
  });

  mockConfigAPI.exists.mockResolvedValue(false);
  mockConfigAPI.set.mockResolvedValue({ success: true });
  mockConfigAPI.testCamera.mockResolvedValue({ success: true });
  mockConfigAPI.browseDirectory.mockResolvedValue(null);

  mockCameraAPI.detectCameras.mockResolvedValue({
    success: true,
    cameras: [MOCK_CAMERA],
  });
  mockPythonAPI.checkHardware.mockResolvedValue({
    camera: { library_available: true, devices_found: 1, available: true },
    daq: { library_available: true, devices_found: 1, available: true },
  });
  mockPythonAPI.restart.mockResolvedValue({ success: true });
});

describe('MachineConfiguration Page', () => {
  describe('First-run state (no credentials)', () => {
    it('should display configuration form directly when no credentials exist', async () => {
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
        },
        hasCredentials: false,
      });

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(screen.getByText(/Machine Configuration/i)).toBeInTheDocument();
      });

      // Should show form, not login
      expect(screen.getByLabelText(/Scanner Name/i)).toBeInTheDocument();
    });
  });

  describe('Config load failure fallback', () => {
    it('falls back to the hardcoded default bloom_api_url when config.get() rejects', async () => {
      mockConfigAPI.get.mockRejectedValue(new Error('IPC failure'));

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(screen.getByLabelText(/Scanner Name/i)).toBeInTheDocument();
      });

      expect(
        screen.getByDisplayValue('https://bloom.salk.edu/api')
      ).toBeInTheDocument();
    });
  });

  describe('Configuration form with existing credentials', () => {
    beforeEach(() => {
      mockConfigAPI.get.mockResolvedValue({
        config: {
          scanner_mode: 'cylinderscan',
          scanner_name: 'TestScanner',
          camera_ip_address: '10.0.0.50',
          scans_dir: '/data/scans',
          bloom_api_url: 'https://api.bloom.salk.edu/proxy',
          bloom_scanner_username: 'test@salk.edu',
          bloom_scanner_password: '********',
          bloom_anon_key: 'testkey123',
        },
        hasCredentials: true,
      });
    });

    it('should show configuration form directly without login', async () => {
      // Mock successful scanner fetch
      mockConfigAPI.fetchScanners.mockResolvedValue({
        success: true,
        scanners: [{ name: 'TestScanner' }, { name: 'OtherScanner' }],
      });

      render(<MachineConfiguration />);

      // Should immediately show config form (no login screen)
      await waitFor(() => {
        expect(screen.getByLabelText(/Scanner Name/i)).toBeInTheDocument();
      });

      // Should NOT have login elements
      expect(screen.queryByText(/Authenticate/i)).not.toBeInTheDocument();

      // Form should show all credential fields
      expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Anon Key/i)).toBeInTheDocument();
    });

    it('should pre-fill form with saved values', async () => {
      render(<MachineConfiguration />);

      // Should pre-fill hardware and API fields
      await waitFor(() => {
        expect(screen.getByDisplayValue('10.0.0.50')).toBeInTheDocument();
      });

      expect(screen.getByDisplayValue('/data/scans')).toBeInTheDocument();
      expect(screen.getByDisplayValue('test@salk.edu')).toBeInTheDocument();
      expect(screen.getByDisplayValue('********')).toBeInTheDocument();
      expect(screen.getByDisplayValue('testkey123')).toBeInTheDocument();
      expect(
        screen.getByDisplayValue('https://api.bloom.salk.edu/proxy')
      ).toBeInTheDocument();
    });
  });

  describe('Configuration form', () => {
    beforeEach(() => {
      // First-run state - no credentials yet
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
        },
        hasCredentials: false,
      });
    });

    it('should display all configuration fields', async () => {
      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(screen.getByLabelText(/Scanner Name/i)).toBeInTheDocument();
      });

      expect(screen.getByLabelText(/Camera IP/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Scans Directory/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/API URL/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
      // Password field with label
      expect(
        screen.getByLabelText(
          (content, element) =>
            element?.tagName === 'INPUT' && content.includes('Password')
        )
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/Anon Key/i)).toBeInTheDocument();
    });

    it('should pre-populate form with existing values', async () => {
      // User has credentials configured
      mockConfigAPI.get.mockResolvedValue({
        config: {
          scanner_mode: 'cylinderscan',
          scanner_name: 'PBIOBScanner',
          camera_ip_address: '192.168.1.10',
          scans_dir: '/custom/path',
          bloom_api_url: 'https://custom.api.url',
          bloom_scanner_username: 'existing@salk.edu',
          bloom_scanner_password: '********',
          bloom_anon_key: 'existingkey',
        },
        hasCredentials: true,
      });

      mockConfigAPI.fetchScanners.mockResolvedValue({
        success: true,
        scanners: [
          { name: 'PBIOBScanner' },
          { name: 'FastScanner' },
          { name: 'SlowScanner' },
          { name: 'Unknown' },
        ],
      });

      render(<MachineConfiguration />);

      // Should directly show config form with pre-populated values
      await waitFor(() => {
        expect(screen.getByLabelText(/Camera IP/i)).toHaveValue('192.168.1.10');
      });

      expect(screen.getByLabelText(/Scans Directory/i)).toHaveValue(
        '/custom/path'
      );
      expect(screen.getByDisplayValue('existing@salk.edu')).toBeInTheDocument();
      expect(screen.getByDisplayValue('existingkey')).toBeInTheDocument();
    });

    it('should save configuration when Save is clicked', async () => {
      mockConfigAPI.set.mockResolvedValue({ success: true });

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(screen.getByLabelText(/Scanner Name/i)).toBeInTheDocument();
      });

      // Fill in required fields
      fireEvent.change(screen.getByLabelText(/Scanner Name/i), {
        target: { value: 'NewScanner' },
      });

      // Click save
      fireEvent.click(
        screen.getByRole('button', { name: /Save Configuration/i })
      );

      await waitFor(() => {
        expect(mockConfigAPI.set).toHaveBeenCalled();
      });
    });

    it('should show validation errors for invalid input', async () => {
      // Scenario: User fills form, fetches scanners, tries to save with empty scanner
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
        },
        hasCredentials: false,
      });

      mockConfigAPI.fetchScanners.mockResolvedValue({
        success: true,
        scanners: [{ name: 'PBIOBScanner' }, { name: 'FastScanner' }],
      });

      mockConfigAPI.set.mockResolvedValue({
        success: false,
        errors: {
          scanner_mode: 'Scanner mode is required',
          scanner_name: 'Scanner name is required',
        },
      });

      render(<MachineConfiguration />);

      // Wait for config form to load
      await waitFor(() => {
        expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
      });

      // Fill in all credentials to enable Fetch Scanners button
      fireEvent.change(screen.getByLabelText(/Username/i), {
        target: { value: 'user@salk.edu' },
      });
      fireEvent.change(screen.getByLabelText(/Password/i), {
        target: { value: 'password' },
      });
      fireEvent.change(screen.getByLabelText(/Anon Key/i), {
        target: { value: 'test-anon-key' },
      });

      // Fetch scanners
      fireEvent.click(
        screen.getByRole('button', { name: /Fetch Scanners from Bloom/i })
      );

      // Wait for scanner list to populate
      await waitFor(() => {
        const scannerSelect = screen.getByLabelText(
          /Scanner Name/i
        ) as HTMLSelectElement;
        expect(scannerSelect.disabled).toBe(false);
      });

      // Change to empty value
      fireEvent.change(screen.getByLabelText(/Scanner Name/i), {
        target: { value: '' },
      });

      // Try to save
      fireEvent.click(
        screen.getByRole('button', { name: /Save Configuration/i })
      );

      await waitFor(() => {
        expect(
          screen.getByText(/Scanner name is required/i)
        ).toBeInTheDocument();
      });
    });

    it('should reset form when Cancel is clicked', async () => {
      // Scenario: User fills form, fetches scanners, makes changes, then cancels
      mockConfigAPI.get.mockResolvedValue({
        config: {
          scanner_mode: 'cylinderscan',
          scanner_name: 'PBIOBScanner', // Start with a saved scanner
          camera_ip_address: 'mock',
          scans_dir: '~/.bloom/scans',
          bloom_api_url: 'https://api.bloom.salk.edu/proxy',
          bloom_scanner_username: 'user@salk.edu',
          bloom_scanner_password: 'password',
          bloom_anon_key: 'test-anon-key',
        },
        hasCredentials: true,
      });

      mockConfigAPI.fetchScanners.mockResolvedValue({
        success: true,
        scanners: [
          { name: 'PBIOBScanner' },
          { name: 'FastScanner' },
          { name: 'SlowScanner' },
        ],
      });

      render(<MachineConfiguration />);

      // Wait for config form to load
      await waitFor(() => {
        expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
      });

      // Fetch scanners
      fireEvent.click(
        screen.getByRole('button', { name: /Fetch Scanners from Bloom/i })
      );

      // Wait for scanner list to populate
      await waitFor(() => {
        const scannerSelect = screen.getByLabelText(
          /Scanner Name/i
        ) as HTMLSelectElement;
        expect(scannerSelect.disabled).toBe(false);
      });

      // Change scanner selection
      fireEvent.change(screen.getByLabelText(/Scanner Name/i), {
        target: { value: 'FastScanner' },
      });

      expect(screen.getByLabelText(/Scanner Name/i)).toHaveValue('FastScanner');

      // Click cancel
      fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));

      // Should reset to original
      await waitFor(() => {
        expect(screen.getByLabelText(/Scanner Name/i)).toHaveValue(
          'PBIOBScanner'
        );
      });
    });
  });

  describe('Camera test', () => {
    beforeEach(() => {
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
        },
        hasCredentials: false,
      });
    });

    it('should test camera connection when Test Connection is clicked', async () => {
      mockConfigAPI.testCamera.mockResolvedValue({ success: true });

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(screen.getByLabelText(/Camera IP/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      await waitFor(() => {
        // Config has camera_ip_address: 'mock'
        expect(mockConfigAPI.testCamera).toHaveBeenCalledWith('mock');
      });
    });

    it('should show success message when camera test succeeds', async () => {
      mockConfigAPI.testCamera.mockResolvedValue({ success: true });

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(screen.getByLabelText(/Camera IP/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      await waitFor(() => {
        expect(screen.getByText(/Connected/i)).toBeInTheDocument();
      });
    });

    it('should show error message when camera test fails', async () => {
      mockConfigAPI.testCamera.mockResolvedValue({
        success: false,
        error: 'Connection refused',
      });

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(screen.getByLabelText(/Camera IP/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

      await waitFor(() => {
        expect(screen.getByText(/Connection refused/i)).toBeInTheDocument();
      });
    });
  });

  describe('Directory browser', () => {
    beforeEach(() => {
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
        },
        hasCredentials: false,
      });
    });

    it('should open directory browser when Browse is clicked', async () => {
      mockConfigAPI.browseDirectory.mockResolvedValue('/selected/path');

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(screen.getByLabelText(/Scans Directory/i)).toBeInTheDocument();
      });

      fireEvent.click(screen.getByRole('button', { name: /Browse/i }));

      await waitFor(() => {
        expect(mockConfigAPI.browseDirectory).toHaveBeenCalled();
      });
    });

    it('should update field when directory is selected', async () => {
      mockConfigAPI.browseDirectory.mockResolvedValue('/selected/path');

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(screen.getByLabelText(/Scans Directory/i)).toHaveValue(
          '~/.bloom/scans'
        );
      });

      fireEvent.click(screen.getByRole('button', { name: /Browse/i }));

      await waitFor(() => {
        expect(screen.getByLabelText(/Scans Directory/i)).toHaveValue(
          '/selected/path'
        );
      });
    });

    it('should not change field when browser is cancelled', async () => {
      mockConfigAPI.browseDirectory.mockResolvedValue(null);

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(screen.getByLabelText(/Scans Directory/i)).toHaveValue(
          '~/.bloom/scans'
        );
      });

      fireEvent.click(screen.getByRole('button', { name: /Browse/i }));

      await waitFor(() => {
        expect(mockConfigAPI.browseDirectory).toHaveBeenCalled();
      });

      // Should still have original value
      expect(screen.getByLabelText(/Scans Directory/i)).toHaveValue(
        '~/.bloom/scans'
      );
    });
  });

  describe('Scanner Name Dropdown', () => {
    // This test verifies the fetch is called (even though user sees login screen)
    it('should NOT fetch scanners on mount (requires user to click button)', async () => {
      mockConfigAPI.get.mockResolvedValue({
        config: {
          scanner_mode: 'cylinderscan',
          scanner_name: '',
          camera_ip_address: 'mock',
          scans_dir: '~/.bloom/scans',
          bloom_api_url: 'https://api.bloom.salk.edu/proxy',
          bloom_scanner_username: 'user@salk.edu',
          bloom_scanner_password: 'password',
          bloom_anon_key: 'test-key',
        },
        hasCredentials: true,
      });

      mockConfigAPI.fetchScanners.mockResolvedValue({
        success: true,
        scanners: [
          { name: 'PBIOBScanner' },
          { name: 'FastScanner' },
          { name: 'SlowScanner' },
          { name: 'Unknown' },
        ],
      });

      render(<MachineConfiguration />);

      // Wait for form to render
      await waitFor(() => {
        expect(screen.getByLabelText(/Username/i)).toBeInTheDocument();
      });

      // Fetch should NOT be called on mount - user must click button
      expect(mockConfigAPI.fetchScanners).not.toHaveBeenCalled();
    });

    it('should display scanner dropdown when scanners fetched', async () => {
      // First-run scenario: no credentials, so shows config form immediately
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
        },
        hasCredentials: false,
      });

      render(<MachineConfiguration />);

      await waitFor(() => {
        const dropdown = screen.getByLabelText(/Scanner Name/i);
        expect(dropdown.tagName).toBe('SELECT');
      });
    });

    it('should not fetch scanners when no credentials configured', async () => {
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
        },
        hasCredentials: false,
      });

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(screen.getByLabelText(/Scanner Name/i)).toBeInTheDocument();
      });

      expect(mockConfigAPI.fetchScanners).not.toHaveBeenCalled();
    });

    it('should show message when no credentials configured', async () => {
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
        },
        hasCredentials: false,
      });

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(
          screen.getByText(/Configure Bloom API credentials/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe('Fetch Scanners Button', () => {
    it('should display "Fetch Scanners from Bloom" button', async () => {
      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Fetch Scanners from Bloom/i })
        ).toBeInTheDocument();
      });
    });

    it('should have button disabled when credentials are incomplete', async () => {
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
        },
        hasCredentials: false,
      });

      render(<MachineConfiguration />);

      await waitFor(() => {
        const button = screen.getByRole('button', {
          name: /Fetch Scanners from Bloom/i,
        });
        expect(button).toBeDisabled();
      });
    });

    it('should enable button when all credentials are present', async () => {
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
        },
        hasCredentials: false,
      });

      render(<MachineConfiguration />);

      // Wait for form to load
      await waitFor(() => {
        expect(screen.getByLabelText(/Password/i)).toBeInTheDocument();
      });

      // Fill in all required credentials
      fireEvent.change(screen.getByLabelText(/Username/i), {
        target: { value: 'user@salk.edu' },
      });
      fireEvent.change(screen.getByLabelText(/Password/i), {
        target: { value: 'password123' },
      });
      fireEvent.change(screen.getByLabelText(/Anon Key/i), {
        target: { value: 'test-anon-key' },
      });

      // Button should now be enabled
      await waitFor(() => {
        const button = screen.getByRole('button', {
          name: /Fetch Scanners from Bloom/i,
        }) as HTMLButtonElement;
        expect(button.disabled).toBe(false);
      });
    });

    it('should call fetchScanners when button is clicked', async () => {
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
        },
        hasCredentials: false,
      });

      mockConfigAPI.fetchScanners.mockResolvedValue({
        success: true,
        scanners: [
          { id: 1, name: 'FastScanner' },
          { id: 2, name: 'SlowScanner' },
        ],
      });

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Fetch Scanners from Bloom/i })
        ).toBeInTheDocument();
      });

      // Fill in all credentials to enable button
      fireEvent.change(screen.getByLabelText(/Username/i), {
        target: { value: 'user@salk.edu' },
      });
      fireEvent.change(screen.getByLabelText(/Password/i), {
        target: { value: 'password123' },
      });
      fireEvent.change(screen.getByLabelText(/Anon Key/i), {
        target: { value: 'test-anon-key' },
      });

      const button = screen.getByRole('button', {
        name: /Fetch Scanners from Bloom/i,
      });
      fireEvent.click(button);

      await waitFor(() => {
        expect(mockConfigAPI.fetchScanners).toHaveBeenCalled();
      });
    });

    it('should show loading state while fetching', async () => {
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
        },
        hasCredentials: false,
      });

      // Delay the resolution to capture loading state
      mockConfigAPI.fetchScanners.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  success: true,
                  scanners: [{ id: 1, name: 'FastScanner' }],
                }),
              100
            )
          )
      );

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Fetch Scanners from Bloom/i })
        ).toBeInTheDocument();
      });

      // Fill in all credentials to enable button
      fireEvent.change(screen.getByLabelText(/Username/i), {
        target: { value: 'user@salk.edu' },
      });
      fireEvent.change(screen.getByLabelText(/Password/i), {
        target: { value: 'password123' },
      });
      fireEvent.change(screen.getByLabelText(/Anon Key/i), {
        target: { value: 'test-anon-key' },
      });

      const button = screen.getByRole('button', {
        name: /Fetch Scanners from Bloom/i,
      });
      fireEvent.click(button);

      // Should show loading text
      await waitFor(() => {
        expect(screen.getByText(/Fetching scanners.../i)).toBeInTheDocument();
      });
    });

    it('should show success message after successful fetch', async () => {
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
        },
        hasCredentials: false,
      });

      mockConfigAPI.fetchScanners.mockResolvedValue({
        success: true,
        scanners: [
          { id: 1, name: 'FastScanner' },
          { id: 2, name: 'SlowScanner' },
          { id: 3, name: 'Unknown' },
        ],
      });

      render(<MachineConfiguration />);

      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: /Fetch Scanners from Bloom/i })
        ).toBeInTheDocument();
      });

      // Fill in all credentials to enable button
      fireEvent.change(screen.getByLabelText(/Username/i), {
        target: { value: 'user@salk.edu' },
      });
      fireEvent.change(screen.getByLabelText(/Password/i), {
        target: { value: 'password123' },
      });
      fireEvent.change(screen.getByLabelText(/Anon Key/i), {
        target: { value: 'test-anon-key' },
      });

      const button = screen.getByRole('button', {
        name: /Fetch Scanners from Bloom/i,
      });
      fireEvent.click(button);

      await waitFor(() => {
        expect(screen.getByText(/Found 3 scanners/i)).toBeInTheDocument();
      });
    });
  });
});

describe('MachineConfiguration color palette', () => {
  it('uses focus:ring-lime-500 on text inputs, not blue', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Scanner Name/i)).toBeInTheDocument();
    });

    const cameraIp = screen.getByLabelText(/Camera IP/i);
    const scansDir = screen.getByLabelText(/Scans Directory/i);
    const username = screen.getByLabelText(/Username/i);
    const apiUrl = screen.getByLabelText(/API URL/i);

    [cameraIp, scansDir, username, apiUrl].forEach((el) => {
      expect(el.className).toContain('focus:ring-lime-500');
      expect(el.className).not.toContain('focus:ring-blue-500');
    });
  });

  it('uses lime on the checkboxes and primary buttons, not blue', async () => {
    mockConfigAPI.get.mockResolvedValue({
      config: {
        scanner_mode: 'cylinderscan',
        scanner_name: 'PBIOBScanner',
        camera_ip_address: '10.0.0.50',
        scans_dir: '/data/scans',
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        bloom_scanner_username: 'test@salk.edu',
        bloom_scanner_password: '********',
        bloom_anon_key: 'testkey123',
      },
      hasCredentials: true,
    });

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Save Configuration/i })
      ).toBeInTheDocument();
    });

    const saveButton = screen.getByRole('button', {
      name: /Save Configuration/i,
    });
    expect(saveButton.className).toContain('bg-lime-700');
    expect(saveButton.className).not.toContain('bg-blue-600');

    const fetchButton = screen.getByRole('button', {
      name: /Fetch Scanners from Bloom/i,
    });
    expect(fetchButton.className).toContain('bg-lime-700');
    expect(fetchButton.className).not.toContain('bg-blue-600');
  });
});

describe('MachineConfiguration scanner-mode radio color', () => {
  it('uses text-lime-700 (accent color) on the scanner-mode radio buttons, not blue', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('CylinderScan')).toBeInTheDocument();
    });

    const cylinderRadio = screen.getByDisplayValue('cylinderscan');
    const graviRadio = screen.getByDisplayValue('graviscan');

    [cylinderRadio, graviRadio].forEach((el) => {
      expect(el.className).toContain('text-lime-700');
      expect(el.className).not.toContain('text-blue-600');
    });
  });
});

describe('MachineConfiguration Hardware section — camera detection (#338)', () => {
  it('(a) detects cameras on mount and always includes the mock camera in the dropdown', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(mockCameraAPI.detectCameras).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByText('Mock Camera')).toBeInTheDocument();
    });
  });

  it('the manual "Detect Cameras" button re-triggers detection on demand', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(mockCameraAPI.detectCameras).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: /Detect Cameras/i }));

    await waitFor(() => {
      expect(mockCameraAPI.detectCameras).toHaveBeenCalledTimes(2);
    });
  });

  it('shows a camera-detection error message when detection fails, distinct from zero-cameras-found', async () => {
    mockCameraAPI.detectCameras.mockResolvedValue({
      success: false,
      cameras: [],
      error: 'Camera subprocess unavailable',
    });

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(
        screen.getByText('Camera subprocess unavailable')
      ).toBeInTheDocument();
    });
  });

  it('(b) selecting a detected camera sets camera_ip_address and Test Connection targets it', async () => {
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
        {
          ip_address: '10.0.0.77',
          model_name: 'acA2000-50gm',
          serial_number: 'SN123',
          mac_address: '00:11:22:33:44:55',
          user_defined_name: '',
          friendly_name: 'acA2000-50gm (10.0.0.77)',
          is_mock: false,
        },
      ],
    });

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('acA2000-50gm (10.0.0.77)')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Camera IP/i), {
      target: { value: '10.0.0.77' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

    await waitFor(() => {
      expect(mockConfigAPI.testCamera).toHaveBeenCalledWith('10.0.0.77');
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Save Configuration/i })
    );

    await waitFor(() => {
      expect(mockConfigAPI.set).toHaveBeenCalledWith(
        expect.objectContaining({ camera_ip_address: '10.0.0.77' })
      );
    });
  });

  it('(c) choosing Manual Entry reveals a free-text input that still saves via config.set', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByText('Mock Camera')).toBeInTheDocument();
    });

    fireEvent.change(screen.getByLabelText(/Camera IP/i), {
      target: { value: 'manual' },
    });

    const manualInput = await screen.findByLabelText(/Camera IP/i);
    fireEvent.change(manualInput, { target: { value: '10.0.0.99' } });

    fireEvent.click(
      screen.getByRole('button', { name: /Save Configuration/i })
    );

    await waitFor(() => {
      expect(mockConfigAPI.set).toHaveBeenCalledWith(
        expect.objectContaining({ camera_ip_address: '10.0.0.99' })
      );
    });
  });

  it('(d) zero detected cameras falls back to manual entry', async () => {
    mockCameraAPI.detectCameras.mockResolvedValue({
      success: true,
      cameras: [],
    });

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(mockCameraAPI.detectCameras).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Camera IP/i)).toHaveAttribute(
        'type',
        'text'
      );
    });
  });

  it('(e) a rejected camera:detect-cameras promise also falls back to manual entry without throwing', async () => {
    mockCameraAPI.detectCameras.mockRejectedValue(new Error('IPC failure'));

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(mockCameraAPI.detectCameras).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Camera IP/i)).toHaveAttribute(
        'type',
        'text'
      );
    });
  });

  it('(f) a previously-saved camera IP not in the detected list pre-fills manual entry, not blank or mock', async () => {
    mockConfigAPI.get.mockResolvedValue({
      config: {
        scanner_mode: 'cylinderscan',
        scanner_name: '',
        camera_ip_address: '10.0.0.55',
        scans_dir: '~/.bloom/scans',
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        bloom_scanner_username: '',
        bloom_scanner_password: '',
        bloom_anon_key: '',
      },
      hasCredentials: false,
    });

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(mockCameraAPI.detectCameras).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getByLabelText(/Camera IP/i)).toHaveValue('10.0.0.55');
    });
  });

  it('(g) a previously-saved camera IP matching a detected camera pre-selects it in the dropdown', async () => {
    mockConfigAPI.get.mockResolvedValue({
      config: {
        scanner_mode: 'cylinderscan',
        scanner_name: '',
        camera_ip_address: '10.0.0.77',
        scans_dir: '~/.bloom/scans',
        bloom_api_url: 'https://api.bloom.salk.edu/proxy',
        bloom_scanner_username: '',
        bloom_scanner_password: '',
        bloom_anon_key: '',
      },
      hasCredentials: false,
    });
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
        {
          ip_address: '10.0.0.77',
          model_name: 'acA2000-50gm',
          serial_number: 'SN123',
          mac_address: '00:11:22:33:44:55',
          user_defined_name: '',
          friendly_name: 'acA2000-50gm (10.0.0.77)',
          is_mock: false,
        },
      ],
    });

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Camera IP/i)).toHaveValue('10.0.0.77');
    });

    expect(screen.getByLabelText(/Camera IP/i).tagName).toBe('SELECT');
  });
});

describe('MachineConfiguration Hardware Diagnostics (#339)', () => {
  it('(h) Check Hardware invokes python:check-hardware and displays the result', async () => {
    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Check Hardware/i })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Check Hardware/i }));

    await waitFor(() => {
      expect(mockPythonAPI.checkHardware).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(screen.getAllByText(/device\(s\) found/i).length).toBeGreaterThan(
        0
      );
    });
  });

  it('(i) Restart Python confirms before restarting, and only restarts if confirmed', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Restart Python/i })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Restart Python/i }));

    expect(confirmSpy).toHaveBeenCalled();
    expect(mockPythonAPI.restart).not.toHaveBeenCalled();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: /Restart Python/i }));

    await waitFor(() => {
      expect(mockPythonAPI.restart).toHaveBeenCalled();
    });

    confirmSpy.mockRestore();
  });

  it('surfaces an error when python:check-hardware rejects', async () => {
    mockPythonAPI.checkHardware.mockRejectedValue(new Error('IPC failure'));

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Check Hardware/i })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Check Hardware/i }));

    await waitFor(() => {
      expect(screen.getByText('IPC failure')).toBeInTheDocument();
    });
  });

  it('surfaces an error when python:restart rejects', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockPythonAPI.restart.mockRejectedValue(new Error('restart IPC failure'));

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Restart Python/i })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Restart Python/i }));

    await waitFor(() => {
      expect(screen.getByText('restart IPC failure')).toBeInTheDocument();
    });

    confirmSpy.mockRestore();
  });

  it('surfaces an error when python:restart resolves with success: false', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockPythonAPI.restart.mockResolvedValue({
      success: false,
      error: 'Python executable not found',
    });

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Restart Python/i })
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /Restart Python/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Python executable not found')
      ).toBeInTheDocument();
    });

    confirmSpy.mockRestore();
  });

  it('Test Connection targets the manually-entered IP when in manual-entry mode', async () => {
    mockCameraAPI.detectCameras.mockResolvedValue({
      success: true,
      cameras: [],
    });

    render(<MachineConfiguration />);

    await waitFor(() => {
      expect(screen.getByLabelText(/Camera IP/i)).toHaveAttribute(
        'type',
        'text'
      );
    });

    fireEvent.change(screen.getByLabelText(/Camera IP/i), {
      target: { value: '10.0.0.88' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Test Connection/i }));

    await waitFor(() => {
      expect(mockConfigAPI.testCamera).toHaveBeenCalledWith('10.0.0.88');
    });
  });
});
