/**
 * Unit Tests: CaptureScan Config Integration (fix-camera-scan-params 1.8)
 *
 * TDD: Verifies that CaptureScan reads num_frames and seconds_per_rot
 * from machine config and passes them into scanner.initialize() via DAQ settings.
 *
 * These tests mock window.electron and verify the wiring between
 * config:get and the scanner initialization call.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { CaptureScan } from '../../src/renderer/CaptureScan';

// Mocks for window.electron APIs
const mockConfigGet = vi.fn();
const mockCameraGetStatus = vi.fn();
const mockCameraGetSettings = vi.fn();
const mockScannerInitialize = vi.fn();
const mockScannerScan = vi.fn();
const mockScannerOnProgress = vi.fn().mockReturnValue(() => {});
const mockScannerOnComplete = vi.fn().mockReturnValue(() => {});
const mockScannerOnError = vi.fn().mockReturnValue(() => {});
const mockSessionGet = vi.fn();
const mockSessionSet = vi.fn();
const mockGetRecentScans = vi.fn();
const mockGetMostRecentScanDate = vi.fn();
const mockDetectCameras = vi.fn();
const mockExperimentGet = vi.fn();
const mockExperimentGetAccession = vi.fn();
const mockGetPlantBarcodes = vi.fn();
const mockGetAccessionNameByBarcode = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();

  // Default: config returns scan params
  mockConfigGet.mockResolvedValue({
    config: {
      scanner_name: 'TestScanner',
      scans_dir: '~/.bloom/scans',
      camera_ip_address: 'mock',
      num_frames: 36,
      seconds_per_rot: 5.0,
    },
  });

  mockCameraGetStatus.mockResolvedValue({ connected: true });
  mockCameraGetSettings.mockResolvedValue({
    exposure_time: 10000,
    gain: 100,
    camera_ip_address: 'mock',
    gamma: 1.0,
  });
  mockScannerInitialize.mockResolvedValue({ success: true, initialized: true });
  mockScannerScan.mockResolvedValue({
    success: true,
    frames_captured: 36,
    output_path: '/tmp/scan',
  });
  // Pre-fill session with valid metadata so the form is valid
  mockSessionGet.mockResolvedValue({
    phenotyperId: 'pheno-1',
    experimentId: 'exp-1',
    waveNumber: '1',
    plantAgeDays: '14',
    accessionName: '',
  });
  mockSessionSet.mockResolvedValue(undefined);
  mockGetRecentScans.mockResolvedValue({ success: true, data: [] });
  mockGetMostRecentScanDate.mockResolvedValue({ success: false });
  mockDetectCameras.mockResolvedValue({ success: true, cameras: [] });
  // Provide experiment with accession so barcode validation passes
  mockExperimentGet.mockResolvedValue({
    success: true,
    data: {
      id: 'exp-1',
      accession: { id: 'acc-1', name: 'TestAccession' },
    },
  });
  mockExperimentGetAccession.mockResolvedValue({
    success: true,
    data: { id: 'acc-1', name: 'TestAccession', plant_barcodes: ['PLANT-001'] },
  });
  mockGetPlantBarcodes.mockResolvedValue({
    success: true,
    data: ['PLANT-001', 'PLANT-002'],
  });
  mockGetAccessionNameByBarcode.mockResolvedValue({
    success: true,
    data: 'TestAccession',
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron = {
    config: { get: mockConfigGet },
    camera: {
      getStatus: mockCameraGetStatus,
      getSettings: mockCameraGetSettings,
      detectCameras: mockDetectCameras,
      onFrame: vi.fn().mockReturnValue(() => {}),
      startStream: vi.fn().mockResolvedValue({ success: true }),
      stopStream: vi.fn().mockResolvedValue({ success: true }),
    },
    scanner: {
      initialize: mockScannerInitialize,
      scan: mockScannerScan,
      onProgress: mockScannerOnProgress,
      onComplete: mockScannerOnComplete,
      onError: mockScannerOnError,
    },
    session: {
      get: mockSessionGet,
      set: mockSessionSet,
      onIdleReset: vi.fn().mockReturnValue(() => {}),
      checkIdleReset: vi.fn().mockResolvedValue(false),
    },
    database: {
      scans: {
        getRecent: mockGetRecentScans,
        getMostRecentScanDate: mockGetMostRecentScanDate,
      },
      experiments: {
        get: mockExperimentGet,
        getAccession: mockExperimentGetAccession,
        list: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
      accessions: {
        getPlantBarcodes: mockGetPlantBarcodes,
        getAccessionNameByBarcode: mockGetAccessionNameByBarcode,
      },
      phenotypers: {
        list: vi.fn().mockResolvedValue({ success: true, data: [] }),
      },
    },
  };

  // Mock crypto.randomUUID
  vi.stubGlobal('crypto', { randomUUID: () => 'test-uuid-1234' });
});

function renderCaptureScan() {
  return render(
    <MemoryRouter>
      <CaptureScan />
    </MemoryRouter>
  );
}

/**
 * Helper: wait for the component to fully load (config, session, camera status),
 * fill in the plant QR code (only field not pre-filled by session), and click Start Scan.
 */
async function fillFormAndStartScan() {
  renderCaptureScan();

  // Wait for config, session, and camera to load
  await waitFor(() => {
    expect(mockConfigGet).toHaveBeenCalled();
    expect(mockSessionGet).toHaveBeenCalled();
    expect(mockCameraGetSettings).toHaveBeenCalled();
  });

  // Fill plant QR code with a value that exists in the accession
  const plantIdInput = await screen.findByPlaceholderText('e.g., PLANT_001');
  await act(async () => {
    fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
  });

  // Wait for barcode validation to complete
  await waitFor(() => {
    const startButton = screen.getByRole('button', { name: /start scan/i });
    expect(startButton).not.toBeDisabled();
  });

  // Click "Start Scan"
  const startButton = screen.getByRole('button', { name: /start scan/i });
  await act(async () => {
    fireEvent.click(startButton);
  });
}

/**
 * Helper: render CaptureScan with a capturable onIdleReset mock.
 * Returns a function that fires the idle reset callback and the cleanup mock.
 */
async function setupIdleReset() {
  let idleResetCallback: (() => void) | null = null;
  const mockCleanup = vi.fn();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global.window as any).electron.session.onIdleReset = vi
    .fn()
    .mockImplementation((cb: () => void) => {
      idleResetCallback = cb;
      return mockCleanup;
    });

  const result = renderCaptureScan();
  await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());

  return {
    fireIdleReset: async () => {
      await act(async () => {
        idleResetCallback!();
      });
    },
    mockCleanup,
    unmount: result.unmount,
  };
}

describe('CaptureScan Idle Reset Notification', () => {
  // 6.5 Regression guard: banner is NOT shown on initial render
  // Note: showIdleResetBanner initializes to false — this guards against future
  // regressions where the initial state is accidentally changed to true.
  it('6.5 idle-reset-notification is not in the DOM on initial render', async () => {
    renderCaptureScan();
    await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());

    expect(
      screen.queryByTestId('idle-reset-notification')
    ).not.toBeInTheDocument();
  });

  // 3.7.1 idle reset callback clears metadata AND shows notification banner
  it('3.7.1 triggers idle reset callback, clears metadata, and shows notification banner', async () => {
    const { fireIdleReset } = await setupIdleReset();
    await fireIdleReset();

    // Notification banner should appear
    expect(screen.getByTestId('idle-reset-notification')).toBeInTheDocument();

    // 4.1.1 metadata inputs should be cleared
    const phenotyperSelect = screen.queryByDisplayValue('pheno-1');
    expect(phenotyperSelect).not.toBeInTheDocument();
    const experimentSelect = screen.queryByDisplayValue('exp-1');
    expect(experimentSelect).not.toBeInTheDocument();
  });

  // 3.6.1 dismiss button has accessible name
  it('3.6.1 dismiss button has an accessible aria-label', async () => {
    const { fireIdleReset } = await setupIdleReset();
    await fireIdleReset();

    const dismissBtn = screen.getByTestId('idle-reset-dismiss');
    expect(dismissBtn).toHaveAttribute('aria-label');
    expect(dismissBtn.getAttribute('aria-label')).not.toBe('');
  });

  // 3.7.2 dismiss button hides the notification
  it('3.7.2 clicking dismiss hides the notification banner', async () => {
    const { fireIdleReset } = await setupIdleReset();
    await fireIdleReset();

    expect(screen.getByTestId('idle-reset-notification')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('idle-reset-dismiss'));
    });

    expect(
      screen.queryByTestId('idle-reset-notification')
    ).not.toBeInTheDocument();
  });

  // 4.2.1 cleanup is called on unmount; callback after unmount does not show banner
  it('4.2.1 cleanup function is called on unmount and callback after unmount is a no-op', async () => {
    const { fireIdleReset, mockCleanup, unmount } = await setupIdleReset();

    // Unmount the component
    unmount();

    // Cleanup should have been called
    expect(mockCleanup).toHaveBeenCalledTimes(1);

    // Firing the callback after unmount should not throw or show the banner
    await fireIdleReset();
    expect(
      screen.queryByTestId('idle-reset-notification')
    ).not.toBeInTheDocument();
  });

  // 6.2.1 Regression guard: idle reset does NOT clear metadata or show banner when isScanning is true
  // Note: mockScannerOnComplete never fires its callback, so isScanning stays true after Start Scan.
  it('6.2.1 idle reset is a no-op when a scan is in progress (isScanning guard)', async () => {
    const { fireIdleReset } = await setupIdleReset();

    // Fill plant QR code (only field not pre-filled by session)
    const plantIdInput = await screen.findByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /start scan/i })
      ).not.toBeDisabled()
    );

    // Click Start Scan — isScanning becomes true
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start scan/i }));
    });

    // Confirm isScanning is active (button shows "Scanning...")
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /scanning/i })
      ).toBeInTheDocument()
    );

    // Fire idle reset while scan is in progress — should be a no-op
    await fireIdleReset();

    // Banner must NOT appear
    expect(
      screen.queryByTestId('idle-reset-notification')
    ).not.toBeInTheDocument();
  });

  // 4.3.1 banner text mentions all cleared fields
  it('4.3.1 notification banner text mentions wave number, plant age, and accession name', async () => {
    const { fireIdleReset } = await setupIdleReset();
    await fireIdleReset();

    const banner = screen.getByTestId('idle-reset-notification');
    expect(banner.textContent).toMatch(/wave/i);
    expect(banner.textContent).toMatch(/plant age/i);
    expect(banner.textContent).toMatch(/accession/i);
  });

  // 6.3.1 Regression guard: banner text mentions plant QR code
  it('6.3.1 notification banner text mentions plant QR code', async () => {
    const { fireIdleReset } = await setupIdleReset();
    await fireIdleReset();

    const banner = screen.getByTestId('idle-reset-notification');
    expect(banner.textContent).toMatch(/plant qr code|plant id|qr code/i);
  });

  // 5.2.1 banner is cleared when the user starts a new scan (strong test — no fallback branch)
  it('5.2.1 idle reset banner is cleared when the user starts a new scan', async () => {
    // Override list mocks so phenotyper/experiment choosers have actual options to select
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.database.phenotypers.list = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: [
          { id: 'pheno-1', name: 'Test Phenotyper', email: 'test@test.com' },
        ],
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.database.experiments.list = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: [
          {
            id: 'exp-1',
            name: 'Test Experiment',
            accession: { id: 'acc-1', name: 'TestAccession' },
          },
        ],
      });

    const { fireIdleReset } = await setupIdleReset();
    await fireIdleReset();

    expect(screen.getByTestId('idle-reset-notification')).toBeInTheDocument();

    // Wait for camera and choosers to finish loading (enabled = not loading)
    await waitFor(() => {
      expect(mockCameraGetSettings).toHaveBeenCalled();
      // Choosers are enabled once their list mocks resolve
      const phenotyperSel = document.getElementById(
        'phenotyper-chooser'
      ) as HTMLSelectElement;
      const experimentSel = document.getElementById(
        'experiment-chooser'
      ) as HTMLSelectElement;
      expect(phenotyperSel).not.toBeNull();
      expect(phenotyperSel.disabled).toBe(false);
      expect(experimentSel).not.toBeNull();
      expect(experimentSel.disabled).toBe(false);
    });

    // Re-fill all fields cleared by idle reset.
    // Experiment change resets plantQrCode, so QR must be filled last.

    // Phenotyper dropdown — option 'pheno-1' now exists in the list
    await act(async () => {
      const phenotyperSel = document.getElementById(
        'phenotyper-chooser'
      ) as HTMLSelectElement;
      fireEvent.change(phenotyperSel, { target: { value: 'pheno-1' } });
    });

    // Experiment dropdown — option 'exp-1' now exists in the list
    await act(async () => {
      const experimentSel = document.getElementById(
        'experiment-chooser'
      ) as HTMLSelectElement;
      fireEvent.change(experimentSel, { target: { value: 'exp-1' } });
    });

    // Wait for experiment's accession fetch to complete (needed for barcode validation)
    await waitFor(() => {
      expect(mockExperimentGet).toHaveBeenCalledWith('exp-1');
    });

    // Wave number and plant age
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('e.g., 1'), {
        target: { value: '1' },
      });
      fireEvent.change(screen.getByPlaceholderText('e.g., 14'), {
        target: { value: '14' },
      });
    });

    // Plant QR code last (barcode validation uses accession loaded from experiment)
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('e.g., PLANT_001'), {
        target: { value: 'PLANT-001' },
      });
    });

    // Wait for Start Scan button to become enabled (all validation passed)
    await waitFor(() => {
      const startBtn = screen.getByRole('button', { name: /start scan/i });
      expect(startBtn).not.toBeDisabled();
    });

    // Click Start Scan
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start scan/i }));
    });

    // Banner must be gone — cleared by handleStartScan (not the early-return fallback)
    expect(
      screen.queryByTestId('idle-reset-notification')
    ).not.toBeInTheDocument();
  });

  // 7.2.3 Regression guard: banner shown on mount when checkIdleReset() returns true
  it('7.2.3 shows idle reset banner on mount when checkIdleReset returns true (navigation-away case)', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.session.checkIdleReset = vi
      .fn()
      .mockResolvedValue(true);

    renderCaptureScan();

    await waitFor(() =>
      expect(screen.getByTestId('idle-reset-notification')).toBeInTheDocument()
    );
  });
});

describe('CaptureScan Config Integration', () => {
  it('1.8.1 calls config:get on mount and stores num_frames and seconds_per_rot', async () => {
    renderCaptureScan();

    await waitFor(() => {
      expect(mockConfigGet).toHaveBeenCalled();
    });
  });

  it('1.8.2 handleStartScan passes num_frames from config into scanner.initialize()', async () => {
    await fillFormAndStartScan();

    await waitFor(() => {
      expect(mockScannerInitialize).toHaveBeenCalled();
    });

    const initArgs = mockScannerInitialize.mock.calls[0][0];
    // num_frames=36 comes from config mock, not hardcoded 72
    expect(initArgs.daq.num_frames).toBe(36);
    expect(initArgs.num_frames).toBe(36);
  });

  it('1.8.3 handleStartScan passes seconds_per_rot from config into scanner.initialize()', async () => {
    await fillFormAndStartScan();

    await waitFor(() => {
      expect(mockScannerInitialize).toHaveBeenCalled();
    });

    const initArgs = mockScannerInitialize.mock.calls[0][0];
    // seconds_per_rot=5.0 comes from config mock, not default 7.0
    expect(initArgs.daq.seconds_per_rot).toBe(5.0);
  });

  it('1.8.4 falls back to defaults when config returns no num_frames', async () => {
    mockConfigGet.mockResolvedValue({
      config: {
        scanner_name: 'TestScanner',
        scans_dir: '~/.bloom/scans',
        camera_ip_address: 'mock',
        // num_frames and seconds_per_rot are NOT in config
      },
    });

    await fillFormAndStartScan();

    await waitFor(() => {
      expect(mockScannerInitialize).toHaveBeenCalled();
    });

    const initArgs = mockScannerInitialize.mock.calls[0][0];
    // Should fall back to defaults: 72 frames, 7.0 seconds
    expect(initArgs.daq.num_frames).toBe(72);
    expect(initArgs.daq.seconds_per_rot).toBe(7.0);
  });
});
