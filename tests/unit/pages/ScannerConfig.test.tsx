/**
 * Unit tests for ScannerConfig page (GraviScan Section 9 + fix-scanner-config-save-flow)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock useScannerConfig hook
const mockHandleDetectScanners = vi.fn();
const mockHandleScannerGridMode = vi.fn();
const mockSetResolution = vi.fn();
const mockHandleScannerAssignment = vi.fn();
const mockHandleResetScannerConfig = vi.fn();

const DEFAULT_DETECTED = [
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
];

// Task 1.1(j2): default scannerAssignments is length 2, matching detectedScanners
const DEFAULT_ASSIGNMENTS = [
  {
    slot: 'Scanner 1',
    scannerId: 'scanner-1',
    usbPort: '1-2',
    gridMode: '2grid' as const,
  },
  {
    slot: 'Scanner 2',
    scannerId: 'scanner-2',
    usbPort: '1-3',
    gridMode: '2grid' as const,
  },
];

const defaultHookReturn = {
  platformInfo: {
    supported: true,
    backend: 'sane' as const,
    mock_enabled: false,
  },
  platformLoading: false,
  detectedScanners: DEFAULT_DETECTED,
  detectingScanner: false,
  detectionError: null,
  scannerAssignments: DEFAULT_ASSIGNMENTS,
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
  // Task 1.1(j): BREAKING — handleToggleScannerEnabled removed from mocked return
  clearValidationWarning: vi.fn(),
};

let mockHookReturn: typeof defaultHookReturn = { ...defaultHookReturn };

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

function setupSaveMocks(opts?: {
  saveConfig?: { success: boolean; error?: string };
  saveScannersToDB?: {
    success: boolean;
    error?: string;
    scanners?: unknown[];
  };
  disableMissingScanners?: { success: boolean; error?: string };
}) {
  const saveConfigResult = opts?.saveConfig ?? { success: true };
  const saveScannersResult = opts?.saveScannersToDB ?? {
    success: true,
    scanners: [],
  };
  const disableMissingResult = opts?.disableMissingScanners ?? {
    success: true,
  };

  const mockSaveConfig = vi.fn().mockResolvedValue(saveConfigResult);
  const mockSaveScannersToDB = vi.fn().mockResolvedValue(saveScannersResult);
  const mockDisableMissingScanners = vi
    .fn()
    .mockResolvedValue(disableMissingResult);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).electron.gravi.saveConfig = mockSaveConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).electron.gravi.saveScannersToDB = mockSaveScannersToDB;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).electron.gravi.disableMissingScanners =
    mockDisableMissingScanners;

  return { mockSaveConfig, mockSaveScannersToDB, mockDisableMissingScanners };
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
    expect(screen.getByText('1200 DPI')).toBeInTheDocument();
    expect(screen.getByText('600 DPI')).toBeInTheDocument();
  });

  // ─── Section 1.1: Save flow tests (new, replacing the weak test) ───

  it('(a) Save calls saveScannersToDB with an array of length N equal to enabled scanners', async () => {
    const { mockSaveScannersToDB } = setupSaveMocks();
    renderPage();

    fireEvent.click(
      screen.getByRole('button', { name: /save configuration/i })
    );

    await waitFor(() => {
      expect(mockSaveScannersToDB).toHaveBeenCalledTimes(1);
    });
    const payload = mockSaveScannersToDB.mock.calls[0][0];
    expect(Array.isArray(payload)).toBe(true);
    expect(payload).toHaveLength(2);
  });

  it('(b) Save payload entries have full shape and exclude scanner_id', async () => {
    const { mockSaveScannersToDB } = setupSaveMocks();
    renderPage();

    fireEvent.click(
      screen.getByRole('button', { name: /save configuration/i })
    );

    await waitFor(() => {
      expect(mockSaveScannersToDB).toHaveBeenCalled();
    });
    const payload = mockSaveScannersToDB.mock.calls[0][0] as unknown[];
    for (const entry of payload) {
      expect(entry).toEqual(
        expect.objectContaining({
          name: expect.any(String),
          vendor_id: expect.any(String),
          product_id: expect.any(String),
          usb_port: expect.any(String),
          usb_bus: expect.any(Number),
          usb_device: expect.any(Number),
        })
      );
      // display_name MUST be present (may be undefined or string)
      expect(entry).toHaveProperty('display_name');
      // scanner_id MUST NOT leak into the payload
      expect(entry).not.toHaveProperty('scanner_id');
    }
  });

  it('(c) Unchecking one of two scanners produces a Save payload of length 1', async () => {
    // Simulate one scanner unchecked: scannerAssignments[1].scannerId = null
    mockHookReturn = {
      ...defaultHookReturn,
      scannerAssignments: [
        DEFAULT_ASSIGNMENTS[0],
        { ...DEFAULT_ASSIGNMENTS[1], scannerId: null },
      ],
    };
    const { mockSaveScannersToDB } = setupSaveMocks();
    renderPage();

    fireEvent.click(
      screen.getByRole('button', { name: /save configuration/i })
    );

    await waitFor(() => {
      expect(mockSaveScannersToDB).toHaveBeenCalled();
    });
    const payload = mockSaveScannersToDB.mock.calls[0][0] as Array<{
      name: string;
    }>;
    expect(payload).toHaveLength(1);
    expect(payload[0].name).toBe('Epson V850');
  });

  it('(d) With all scanners unchecked, Save button is disabled and no IPC call is made', async () => {
    mockHookReturn = {
      ...defaultHookReturn,
      scannerAssignments: DEFAULT_ASSIGNMENTS.map((a) => ({
        ...a,
        scannerId: null,
      })),
    };
    const { mockSaveConfig, mockSaveScannersToDB } = setupSaveMocks();
    renderPage();

    const saveButton = screen.getByRole('button', {
      name: /save configuration/i,
    });
    expect(saveButton).toBeDisabled();

    fireEvent.click(saveButton);
    // Give it a tick — nothing should fire
    await new Promise((r) => setTimeout(r, 50));
    expect(mockSaveConfig).not.toHaveBeenCalled();
    expect(mockSaveScannersToDB).not.toHaveBeenCalled();
  });

  it('(e) With all scanners unchecked, helper text explains at least one scanner must be enabled', () => {
    mockHookReturn = {
      ...defaultHookReturn,
      scannerAssignments: DEFAULT_ASSIGNMENTS.map((a) => ({
        ...a,
        scannerId: null,
      })),
    };
    renderPage();
    expect(
      screen.getByText(/at least one scanner must be enabled/i)
    ).toBeInTheDocument();
  });

  it('(f) After successful save, green banner references scanner count, grid mode, and DPI', async () => {
    setupSaveMocks();
    renderPage();

    fireEvent.click(
      screen.getByRole('button', { name: /save configuration/i })
    );

    const banner = await screen.findByRole('status');
    expect(banner).toHaveClass('bg-green-50');
    expect(banner).toHaveClass('border-green-200');
    expect(banner).toHaveClass('text-green-800');
    expect(banner.textContent).toMatch(/2 scanners/i);
    expect(banner.textContent).toMatch(/2-Grid|4-Grid/);
    expect(banner.textContent).toMatch(/1200 DPI/);
  });

  it('(g) After saveScannersToDB error, red banner contains the error message', async () => {
    setupSaveMocks({
      saveScannersToDB: { success: false, error: 'DB locked' },
    });
    renderPage();

    fireEvent.click(
      screen.getByRole('button', { name: /save configuration/i })
    );

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveClass('bg-red-50');
    expect(banner).toHaveClass('border-red-200');
    expect(banner).toHaveClass('text-red-800');
    expect(banner.textContent).toMatch(/DB locked/);
  });

  it('(h) Partial failure (saveConfig ok, saveScannersToDB fails) shows both outcomes and re-arms Save', async () => {
    setupSaveMocks({
      saveConfig: { success: true },
      saveScannersToDB: { success: false, error: 'Unique constraint failed' },
    });
    renderPage();

    const saveButton = screen.getByRole('button', {
      name: /save configuration/i,
    });
    fireEvent.click(saveButton);

    const banner = await screen.findByRole('alert');
    expect(banner.textContent).toMatch(/Config saved/i);
    expect(banner.textContent).toMatch(/Scanner save failed/i);
    expect(banner.textContent).toMatch(/Unique constraint failed/);

    // Save button should be re-enabled for retry
    await waitFor(() => {
      expect(saveButton).not.toBeDisabled();
    });
  });

  it('(i) Rapid double-click on Save triggers exactly one IPC round-trip', async () => {
    const { mockSaveConfig, mockSaveScannersToDB } = setupSaveMocks();
    // Delay the resolution so we can fire a second click mid-flight
    let resolveSave: (v: { success: boolean }) => void;
    mockSaveScannersToDB.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        })
    );
    renderPage();

    const saveButton = screen.getByRole('button', {
      name: /save configuration/i,
    });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    // Resolve the in-flight call
    await waitFor(() => {
      expect(mockSaveScannersToDB).toHaveBeenCalledTimes(1);
    });
    resolveSave!({ success: true });
    await waitFor(() => {
      expect(mockSaveConfig).toHaveBeenCalledTimes(1);
    });
  });

  it('(i2) After successful save resolves, a subsequent Save click fires a second IPC round-trip', async () => {
    const { mockSaveScannersToDB } = setupSaveMocks();
    renderPage();

    const saveButton = screen.getByRole('button', {
      name: /save configuration/i,
    });
    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(mockSaveScannersToDB).toHaveBeenCalledTimes(1);
    });

    // Wait for success banner to confirm resolution completed
    await screen.findByRole('status');

    fireEvent.click(saveButton);
    await waitFor(() => {
      expect(mockSaveScannersToDB).toHaveBeenCalledTimes(2);
    });
  });

  it('calls disableMissingScanners after successful save with enabled scanner identities', async () => {
    const { mockDisableMissingScanners } = setupSaveMocks();
    renderPage();

    fireEvent.click(
      screen.getByRole('button', { name: /save configuration/i })
    );

    await waitFor(() => {
      expect(mockDisableMissingScanners).toHaveBeenCalledTimes(1);
    });
    const identities = mockDisableMissingScanners.mock.calls[0][0] as Array<{
      usb_port: string;
    }>;
    expect(identities).toHaveLength(2);
    expect(identities[0]).toHaveProperty('usb_port');
    expect(identities[0]).toHaveProperty('vendor_id');
    expect(identities[0]).toHaveProperty('product_id');
    expect(identities[0]).toHaveProperty('name');
    expect(identities[0]).toHaveProperty('usb_bus');
    expect(identities[0]).toHaveProperty('usb_device');
  });

  it('clicking Enabled checkbox sets scannerAssignments[i].scannerId to null', () => {
    renderPage();
    const checkboxes = screen.getAllByRole('checkbox', { name: /enabled/i });
    fireEvent.click(checkboxes[0]);
    // handleScannerAssignment is called with (slotIndex, null) to uncheck
    expect(mockHandleScannerAssignment).toHaveBeenCalledWith(0, null);
  });

  // ─── Preserved legacy tests ───

  it('Re-detect button triggers new detection', () => {
    renderPage();
    const redetectButton = screen.getByRole('button', {
      name: /re-detect|detect scanners/i,
    });
    fireEvent.click(redetectButton);
    expect(mockHandleDetectScanners).toHaveBeenCalled();
  });

  it('shows empty state when no scanners detected', () => {
    mockHookReturn = {
      ...defaultHookReturn,
      detectedScanners: [],
      scannerAssignments: [],
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
      scannerAssignments: [],
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
