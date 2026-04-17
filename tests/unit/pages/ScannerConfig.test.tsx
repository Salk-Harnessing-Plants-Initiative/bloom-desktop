/**
 * Unit tests for ScannerConfig page (GraviScan Section 9)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock useScannerConfig hook
const mockHandleDetectScanners = vi.fn();
const mockHandleScannerGridMode = vi.fn();
const mockSetResolution = vi.fn();
const mockHandleToggleScannerEnabled = vi.fn();
const mockHandleScannerAssignment = vi.fn();
const mockHandleResetScannerConfig = vi.fn();

const defaultHookReturn = {
  platformInfo: {
    supported: true,
    backend: 'sane' as const,
    mock_enabled: false,
  },
  platformLoading: false,
  detectedScanners: [
    {
      name: 'Epson V850',
      scanner_id: 'scanner-1',
      usb_bus: 1,
      usb_device: 2,
      usb_port: '1-2',
      is_available: true,
      vendor_id: '04b8',
      product_id: '0130',
    },
    {
      name: 'Epson V800',
      scanner_id: 'scanner-2',
      usb_bus: 1,
      usb_device: 3,
      usb_port: '1-3',
      is_available: true,
      vendor_id: '04b8',
      product_id: '0131',
    },
  ],
  detectingScanner: false,
  detectionError: null,
  scannerAssignments: [
    {
      slot: 'Scanner 1',
      scannerId: 'scanner-1',
      usbPort: '1-2',
      gridMode: '2grid' as const,
    },
  ],
  config: null,
  resolution: 1200,
  setResolution: mockSetResolution,
  configSaved: false,
  isConfigCollapsed: false,
  sessionValidated: false,
  isValidating: false,
  validationWarning: null,
  configStatus: 'no-config' as const,
  configValidationMessage: '',
  missingScanners: [],
  newScanners: [],
  matchedScanners: [],
  resolutionRef: { current: 1200 },
  handleDetectScanners: mockHandleDetectScanners,
  handleResetScannerConfig: mockHandleResetScannerConfig,
  handleScannerAssignment: mockHandleScannerAssignment,
  handleScannerGridMode: mockHandleScannerGridMode,
  handleAddScannerSlot: vi.fn(),
  handleRemoveScannerSlot: vi.fn(),
  handleToggleConfigCollapse: vi.fn(),
  handleToggleScannerEnabled: mockHandleToggleScannerEnabled,
  clearValidationWarning: vi.fn(),
};

let mockHookReturn = { ...defaultHookReturn };

vi.mock('../../../src/renderer/hooks/useScannerConfig', () => ({
  useScannerConfig: () => mockHookReturn,
}));

// Mock react-router-dom navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Import after mocks
import { ScannerConfig } from '../../../src/renderer/graviscan/ScannerConfig';

function renderPage() {
  return render(
    <MemoryRouter>
      <ScannerConfig />
    </MemoryRouter>
  );
}

describe('ScannerConfig page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHookReturn = { ...defaultHookReturn };
  });

  it('renders detected scanners with status indicators', () => {
    renderPage();
    expect(screen.getByText('Epson V850')).toBeInTheDocument();
    expect(screen.getByText('Epson V800')).toBeInTheDocument();
    // Available scanners should show a status indicator
    expect(screen.getAllByText(/available/i).length).toBeGreaterThanOrEqual(1);
  });

  it('shows grid_mode selector with 2grid/4grid radio buttons', () => {
    renderPage();
    const radio2 = screen.getByRole('radio', { name: /2.?grid/i });
    const radio4 = screen.getByRole('radio', { name: /4.?grid/i });
    expect(radio2).toBeInTheDocument();
    expect(radio4).toBeInTheDocument();
  });

  it('calls handleScannerGridMode when grid mode is changed', () => {
    renderPage();
    const radio4 = screen.getByRole('radio', { name: /4.?grid/i });
    fireEvent.click(radio4);
    expect(mockHandleScannerGridMode).toHaveBeenCalledWith(0, '4grid');
  });

  it('shows resolution selector from GRAVISCAN_RESOLUTIONS', () => {
    renderPage();
    const resolutionSelect = screen.getByLabelText(/resolution/i);
    expect(resolutionSelect).toBeInTheDocument();
    // Check that some standard resolutions appear as options
    expect(screen.getByText('1200 DPI')).toBeInTheDocument();
    expect(screen.getByText('600 DPI')).toBeInTheDocument();
  });

  it('Save button calls saveConfig and saveScannersToDB', async () => {
    const mockSaveConfig = vi.fn().mockResolvedValue({ success: true });
    const mockSaveScannersToDB = vi
      .fn()
      .mockResolvedValue({ success: true, scanners: [] });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).electron.gravi.saveConfig = mockSaveConfig;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).electron.gravi.saveScannersToDB = mockSaveScannersToDB;

    renderPage();
    const saveButton = screen.getByRole('button', { name: /save/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalled();
      expect(mockSaveScannersToDB).toHaveBeenCalled();
    });
  });

  it('Re-detect button triggers new detection', () => {
    renderPage();
    const redetectButton = screen.getByRole('button', {
      name: /re-detect|detect/i,
    });
    fireEvent.click(redetectButton);
    expect(mockHandleDetectScanners).toHaveBeenCalled();
  });

  it('shows empty state when no scanners detected', () => {
    mockHookReturn = {
      ...defaultHookReturn,
      detectedScanners: [],
    };
    renderPage();
    expect(screen.getByText(/no scanners detected/i)).toBeInTheDocument();
  });

  it('shows platform info display (SANE/TWAIN status)', () => {
    renderPage();
    expect(screen.getByText(/sane/i)).toBeInTheDocument();
    expect(screen.getByText(/supported/i)).toBeInTheDocument();
  });

  it('shows TWAIN backend when on Windows', () => {
    mockHookReturn = {
      ...defaultHookReturn,
      platformInfo: {
        supported: true,
        backend: 'twain',
        mock_enabled: false,
      },
    };
    renderPage();
    expect(screen.getByText(/twain/i)).toBeInTheDocument();
  });

  it('shows validation status display', () => {
    mockHookReturn = {
      ...defaultHookReturn,
      configStatus: 'valid',
      configValidationMessage: 'Scanners ready',
    };
    renderPage();
    expect(screen.getByText('Scanners ready')).toBeInTheDocument();
  });

  it('shows validation warning when config has mismatch', () => {
    mockHookReturn = {
      ...defaultHookReturn,
      configStatus: 'mismatch',
      configValidationMessage: 'Scanner configuration has changed.',
    };
    renderPage();
    expect(
      screen.getByText('Scanner configuration has changed.')
    ).toBeInTheDocument();
  });

  it('shows loading spinner while detecting scanners', () => {
    mockHookReturn = {
      ...defaultHookReturn,
      detectingScanner: true,
      detectedScanners: [],
    };
    renderPage();
    expect(screen.getByText('Detecting scanners...')).toBeInTheDocument();
  });

  it('shows detection error message', () => {
    mockHookReturn = {
      ...defaultHookReturn,
      detectionError: 'USB permission denied',
    };
    renderPage();
    expect(screen.getByText('USB permission denied')).toBeInTheDocument();
  });
});
