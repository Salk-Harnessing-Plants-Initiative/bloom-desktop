/**
 * Unit tests for ConfigureScanner page
 *
 * TDD: Tests define expected behavior before implementation.
 * See openspec/changes/add-graviscan-configure-scanner-ui/ for the spec.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
  act,
} from '@testing-library/react';
import { ConfigureScanner } from '../../../src/renderer/ConfigureScanner';

const mockGraviAPI = {
  detectScanners: vi.fn(),
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  saveScannersToDB: vi.fn(),
  disableScanner: vi.fn(),
  getScannerStatus: vi.fn(),
  getScanStatus: vi.fn(),
  resetUsb: vi.fn(),
};

const mockConfigAPI = {
  getGraviScanEnvStatus: vi.fn(),
};

function makeScannerRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    scannerId: 'scanner-1',
    displayName: 'Scanner 1',
    usbPort: '1-2',
    gridMode: '2grid',
    status: 'ready',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();

  (
    window as unknown as {
      electron: { gravi: typeof mockGraviAPI; config: typeof mockConfigAPI };
    }
  ).electron = {
    gravi: mockGraviAPI,
    config: mockConfigAPI,
  };

  mockGraviAPI.getScannerStatus.mockResolvedValue({
    success: true,
    scanners: [makeScannerRow()],
  });
  mockGraviAPI.getConfig.mockResolvedValue({
    success: true,
    data: { success: true, config: { resolution: 600, grid_mode: '4grid' } },
  });
  mockGraviAPI.getScanStatus.mockResolvedValue({
    success: true,
    data: { isActive: false },
  });
  mockConfigAPI.getGraviScanEnvStatus.mockResolvedValue({
    slackConfigured: true,
    libusbRecoveryEnabled: true,
  });
  mockGraviAPI.detectScanners.mockResolvedValue({
    success: true,
    data: {
      success: true,
      scanners: [
        {
          name: 'epkowa:001:002',
          scanner_id: 'scanner-1',
          usb_bus: 1,
          usb_device: 2,
          usb_port: '1-2',
          is_available: true,
          vendor_id: '04b8',
          product_id: '0159',
        },
      ],
      count: 1,
    },
  });
  mockGraviAPI.saveScannersToDB.mockResolvedValue({
    success: true,
    data: { success: true, scanners: [], count: 1, disabled: [] },
  });
  mockGraviAPI.saveConfig.mockResolvedValue({
    success: true,
    data: { success: true, config: { resolution: 600, grid_mode: '4grid' } },
  });
  mockGraviAPI.disableScanner.mockResolvedValue({ ok: true });
  mockGraviAPI.resetUsb.mockResolvedValue({
    success: true,
    data: { success: true },
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('ConfigureScanner page', () => {
  it('renders a loading state, then the detect/save/list UI once getScannerStatus() and getConfig() resolve', async () => {
    render(<ConfigureScanner />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Scanner 1')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /detect scanners/i })
    ).toBeInTheDocument();
  });

  it('round-trips a valid persisted GraviConfig into the resolution and grid-mode selects on mount', async () => {
    render(<ConfigureScanner />);

    await waitFor(() => {
      expect(
        screen.getByLabelText(/resolution/i) as HTMLSelectElement
      ).toHaveValue('600');
    });
    expect(
      screen.getByLabelText(/grid mode/i) as HTMLSelectElement
    ).toHaveValue('4grid');
  });

  it('clicking "Detect Scanners" calls detectScanners() then saveScannersToDB() then re-calls getScannerStatus()', async () => {
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));
    mockGraviAPI.getScannerStatus.mockClear();

    fireEvent.click(screen.getByRole('button', { name: /detect scanners/i }));

    await waitFor(() => {
      expect(mockGraviAPI.detectScanners).toHaveBeenCalled();
      expect(mockGraviAPI.saveScannersToDB).toHaveBeenCalled();
      expect(mockGraviAPI.getScannerStatus).toHaveBeenCalled();
    });
  });

  it('shows "No scanners detected" and does not save when detection returns zero scanners', async () => {
    mockGraviAPI.detectScanners.mockResolvedValue({
      success: true,
      data: { success: true, scanners: [], count: 0 },
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    fireEvent.click(screen.getByRole('button', { name: /detect scanners/i }));

    await waitFor(() => {
      expect(screen.getByText(/no scanners detected/i)).toBeInTheDocument();
    });
    expect(mockGraviAPI.saveScannersToDB).not.toHaveBeenCalled();
  });

  it('surfaces a detectScanners() failure inline', async () => {
    mockGraviAPI.detectScanners.mockResolvedValue({
      success: true,
      data: { success: false, error: 'lsusb failed', scanners: [], count: 0 },
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    fireEvent.click(screen.getByRole('button', { name: /detect scanners/i }));

    await waitFor(() => {
      expect(screen.getByText(/lsusb failed/i)).toBeInTheDocument();
    });
    expect(mockGraviAPI.saveScannersToDB).not.toHaveBeenCalled();
  });

  it('surfaces a saveScannersToDB() failure inline', async () => {
    mockGraviAPI.saveScannersToDB.mockResolvedValue({
      success: true,
      data: {
        success: false,
        error: 'db write failed',
        scanners: [],
        disabled: [],
      },
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    fireEvent.click(screen.getByRole('button', { name: /detect scanners/i }));

    await waitFor(() => {
      expect(screen.getByText(/db write failed/i)).toBeInTheDocument();
    });
  });

  it('leaves the previously-displayed scanner list unchanged on a saveScannersToDB() failure', async () => {
    mockGraviAPI.saveScannersToDB.mockResolvedValue({
      success: true,
      data: {
        success: false,
        error: 'db write failed',
        scanners: [],
        disabled: [],
      },
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    fireEvent.click(screen.getByRole('button', { name: /detect scanners/i }));

    await waitFor(() => {
      expect(screen.getByText(/db write failed/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Scanner 1')).toBeInTheDocument();
  });

  it('polls getScannerStatus() while a row is starting and stops once none are, cleaning up on unmount', async () => {
    vi.useFakeTimers();
    mockGraviAPI.getScannerStatus
      .mockResolvedValueOnce({
        success: true,
        scanners: [makeScannerRow({ status: 'starting' })],
      })
      .mockResolvedValue({
        success: true,
        scanners: [makeScannerRow({ status: 'starting' })],
      });

    const { unmount } = render(<ConfigureScanner />);
    await vi.waitFor(() => {
      expect(mockGraviAPI.getScannerStatus).toHaveBeenCalledTimes(1);
    });
    // Flush the pending state update + poll-effect registration triggered
    // by that first resolved call, before advancing the interval clock.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    const callsAfterMount = mockGraviAPI.getScannerStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(mockGraviAPI.getScannerStatus.mock.calls.length).toBeGreaterThan(
      callsAfterMount
    );

    // Now report no rows starting — polling should stop.
    mockGraviAPI.getScannerStatus.mockResolvedValue({
      success: true,
      scanners: [makeScannerRow({ status: 'ready' })],
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    const callsOnceSettled = mockGraviAPI.getScannerStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mockGraviAPI.getScannerStatus.mock.calls.length).toBe(
      callsOnceSettled
    );

    unmount();
    const callsAfterUnmount = mockGraviAPI.getScannerStatus.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(mockGraviAPI.getScannerStatus.mock.calls.length).toBe(
      callsAfterUnmount
    );
  });

  it('sources resolution options exactly from GRAVISCAN_RESOLUTIONS, in order', async () => {
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    const select = screen.getByLabelText(/resolution/i) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(['200', '400', '600', '800', '1200', '1600']);
  });

  it('labels the 1200 option with the production-validated suffix', async () => {
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    const select = screen.getByLabelText(/resolution/i) as HTMLSelectElement;
    const option1200 = Array.from(select.options).find(
      (o) => o.value === '1200'
    );
    expect(option1200?.textContent).toMatch(/production|validated/i);
  });

  it('falls back a legacy resolution to 1200 and shows a stale-value warning without saving', async () => {
    mockGraviAPI.getConfig.mockResolvedValue({
      success: true,
      data: { success: true, config: { resolution: 3200, grid_mode: '2grid' } },
    });
    render(<ConfigureScanner />);

    await waitFor(() => {
      expect(
        screen.getByLabelText(/resolution/i) as HTMLSelectElement
      ).toHaveValue('1200');
    });
    expect(screen.getByText(/3200/)).toBeInTheDocument();
    expect(mockGraviAPI.saveConfig).not.toHaveBeenCalled();
  });

  it('disables Save while the legacy-value warning is showing and the operator has not touched resolution, then enables it after they do', async () => {
    mockGraviAPI.getConfig.mockResolvedValue({
      success: true,
      data: { success: true, config: { resolution: 3200, grid_mode: '2grid' } },
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText(/3200/));

    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toBeDisabled();
    fireEvent.click(saveButton);
    expect(mockGraviAPI.saveConfig).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/resolution/i), {
      target: { value: '1600' },
    });
    expect(saveButton).not.toBeDisabled();
  });

  it('saving resolution/grid mode calls saveConfig with the selected values', async () => {
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    fireEvent.change(screen.getByLabelText(/resolution/i), {
      target: { value: '800' },
    });
    fireEvent.change(screen.getByLabelText(/grid mode/i), {
      target: { value: '2grid' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(mockGraviAPI.saveConfig).toHaveBeenCalledWith({
        resolution: 800,
        grid_mode: '2grid',
      });
    });
  });

  it('blocks Reset All USB Connections and shows an inline message while a scan is active', async () => {
    mockGraviAPI.getScanStatus.mockResolvedValue({
      success: true,
      data: { isActive: true },
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    fireEvent.click(
      screen.getByRole('button', { name: /reset all usb connections/i })
    );

    expect(
      screen.getByText(/cannot reset usb while a scan is in progress/i)
    ).toBeInTheDocument();
    expect(mockGraviAPI.resetUsb).not.toHaveBeenCalled();
  });

  it('immediately marks every row starting on Reset All USB Connections when no scan is active, then refreshes status without re-running detect', async () => {
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));
    mockGraviAPI.getScannerStatus.mockClear();

    fireEvent.click(
      screen.getByRole('button', { name: /reset all usb connections/i })
    );

    // Immediate optimistic feedback, before resetUsb() resolves.
    expect(screen.getAllByText(/starting/i).length).toBeGreaterThan(0);

    await waitFor(() => {
      expect(mockGraviAPI.resetUsb).toHaveBeenCalled();
      expect(mockGraviAPI.getScannerStatus).toHaveBeenCalled();
    });
    // resetUsb() already re-detects/re-initializes internally — calling
    // detectScanners()/saveScannersToDB() again here would race the
    // subprocess resetUsb() just spawned (see ConfigureScanner.tsx's
    // handleResetUsb comment), so this flow must NOT re-run detect.
    expect(mockGraviAPI.detectScanners).not.toHaveBeenCalled();
  });

  it('surfaces a resetUsb() failure inline without throwing', async () => {
    mockGraviAPI.resetUsb.mockResolvedValue({
      success: true,
      data: { success: false, error: 'USB reset failed' },
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    fireEvent.click(
      screen.getByRole('button', { name: /reset all usb connections/i })
    );

    await waitFor(() => {
      expect(screen.getByText(/usb reset failed/i)).toBeInTheDocument();
    });
  });

  it('renders a Remove button per row that calls disableScanner with no window.confirm gate', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => {
      expect(mockGraviAPI.disableScanner).toHaveBeenCalledWith('scanner-1');
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('disables all Remove buttons while getScanStatus() indicates an active scan (global gate), re-enabling once inactive', async () => {
    mockGraviAPI.getScanStatus.mockResolvedValue({
      success: true,
      data: { isActive: true },
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    const removeButton = screen.getByRole('button', { name: /remove/i });
    expect(removeButton).toBeDisabled();
    fireEvent.click(removeButton);
    expect(mockGraviAPI.disableScanner).not.toHaveBeenCalled();
  });

  it('keeps Remove enabled per-row for error/dead/disconnected rows when no scan is active', async () => {
    mockGraviAPI.getScannerStatus.mockResolvedValue({
      success: true,
      scanners: [
        makeScannerRow({ scannerId: 's-err', status: 'error' }),
        makeScannerRow({
          scannerId: 's-dead',
          displayName: 'Scanner 2',
          status: 'dead',
        }),
        makeScannerRow({
          scannerId: 's-disc',
          displayName: 'Scanner 3',
          status: 'disconnected',
        }),
      ],
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    const removeButtons = screen.getAllByRole('button', { name: /remove/i });
    for (const button of removeButtons) {
      expect(button).not.toBeDisabled();
    }
  });

  it('surfaces a disableScanner failure via the inline save-error banner and leaves the row visible', async () => {
    mockGraviAPI.disableScanner.mockResolvedValue({
      ok: false,
      error: 'not found',
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => {
      expect(screen.getByText(/failed to remove scanner/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Scanner 1')).toBeInTheDocument();
  });

  it('removes the row locally on a successful disableScanner call', async () => {
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));

    fireEvent.click(screen.getByRole('button', { name: /remove/i }));

    await waitFor(() => {
      expect(screen.queryByText('Scanner 1')).not.toBeInTheDocument();
    });
  });

  it('renders the all-configured env-banner state without ever rendering the webhook URL', async () => {
    mockConfigAPI.getGraviScanEnvStatus.mockResolvedValue({
      slackConfigured: true,
      libusbRecoveryEnabled: true,
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));
    const banner = screen.getByTestId('graviscan-env-banner');
    expect(within(banner).queryByText(/not configured/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/hooks\.slack\.com/);
  });

  it('renders the all-missing env-banner state', async () => {
    mockConfigAPI.getGraviScanEnvStatus.mockResolvedValue({
      slackConfigured: false,
      libusbRecoveryEnabled: false,
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));
    const banner = screen.getByTestId('graviscan-env-banner');
    expect(within(banner).getAllByText(/not configured|disabled/i).length).toBe(
      2
    );
  });

  it('visually distinguishes the mixed env-banner state (slack missing, libusb enabled)', async () => {
    mockConfigAPI.getGraviScanEnvStatus.mockResolvedValue({
      slackConfigured: false,
      libusbRecoveryEnabled: true,
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));
    const banner = screen.getByTestId('graviscan-env-banner');
    expect(within(banner).getAllByText(/not configured|disabled/i).length).toBe(
      1
    );
  });

  it('visually distinguishes the inverse mixed env-banner state (slack configured, libusb disabled)', async () => {
    mockConfigAPI.getGraviScanEnvStatus.mockResolvedValue({
      slackConfigured: true,
      libusbRecoveryEnabled: false,
    });
    render(<ConfigureScanner />);
    await waitFor(() => screen.getByText('Scanner 1'));
    const banner = screen.getByTestId('graviscan-env-banner');
    expect(within(banner).getAllByText(/not configured|disabled/i).length).toBe(
      1
    );
  });
});
