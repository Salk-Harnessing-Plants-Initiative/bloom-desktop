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
  configure,
} from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { CaptureScan } from '../../src/renderer/CaptureScan';
import { toIsoDate } from '../../src/utils/wave-dates';

// Capture Scan loads the session, config, waves and plants in a chain, which can take
// longer than the default 1 s to settle (and a test longer than 5 s) when the whole
// suite runs in parallel.
configure({ asyncUtilTimeout: 5000 });
vi.setConfig({ testTimeout: 15000 });

/** Local "YYYY-MM-DD" `days` ago, by calendar arithmetic so DST can't shift it. */
const sownDaysAgo = (days: number) => {
  const now = new Date();
  return toIsoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  );
};

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
const mockCheckDuplicate = vi.fn();
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
      scanner_mode: 'cylinderscan',
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
  mockCheckDuplicate.mockResolvedValue({ success: true, data: false });
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
      cylinderWaves: {
        // Wave 1 sown 14 days ago, so the calculated age matches the tests' 14.
        list: vi.fn().mockResolvedValue({
          success: true,
          data: [
            {
              id: 'wave-1',
              wave_number: 1,
              dates_per_plant: false,
              germination_date: sownDaysAgo(14),
              sowing_date: sownDaysAgo(20),
              transfer_date: null,
              note: null,
              set_by_name: 'Demo Phenotyper',
              set_at: '2026-01-02T09:00:00.000Z',
              scanCount: 0,
              changes: [],
              plantsWithOwnDates: [],
            },
          ],
        }),
        create: vi.fn(),
        changeDates: vi.fn(),
      },
      cylinderPlants: {
        // No plant has its own dates: every plant uses wave 1's.
        list: vi.fn().mockResolvedValue({ success: true, data: [] }),
        setDates: vi.fn(),
        useWaveDates: vi.fn(),
      },
      scans: {
        getRecent: mockGetRecentScans,
        checkDuplicate: mockCheckDuplicate,
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

  // Assert the component registered the callback before returning
  await waitFor(() => expect(idleResetCallback).not.toBeNull());

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

  // Regression guard: live idle-reset consumes the flag so navigation-away
  // mount check does not show a stale second banner.
  it('onIdleReset callback calls checkIdleReset() to consume the navigation-away flag', async () => {
    const mockCheckIdleReset = vi.fn().mockResolvedValue(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.session.checkIdleReset = mockCheckIdleReset;

    const { fireIdleReset } = await setupIdleReset();
    // Clear the call from mount
    mockCheckIdleReset.mockClear();

    await fireIdleReset();

    // The live handler must have consumed the flag
    expect(mockCheckIdleReset).toHaveBeenCalledOnce();
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

  // 4.3.1 banner text mentions all cleared fields (strengthened by 9.4.1 to include phenotyper + experiment)
  it('4.3.1 notification banner text mentions wave number, plant age, accession name, phenotyper, and experiment', async () => {
    const { fireIdleReset } = await setupIdleReset();
    await fireIdleReset();

    const banner = screen.getByTestId('idle-reset-notification');
    expect(banner.textContent).toMatch(/wave/i);
    expect(banner.textContent).toMatch(/plant age/i);
    expect(banner.textContent).toMatch(/accession/i);
    // 9.4.1 strengthened: phenotyper and experiment must also be named
    expect(banner.textContent).toMatch(/phenotyper/i);
    expect(banner.textContent).toMatch(/experiment/i);
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

  // 8.1.1 isScanningRef synchronous guard: onIdleReset fired during scan start does not clear metadata
  it('8.1.1 onIdleReset callback fired mid-handleStartScan does NOT clear metadata (isScanningRef synchronous guard)', async () => {
    let idleResetCallback: (() => void) | null = null;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.session.onIdleReset = vi
      .fn()
      .mockImplementation((cb: () => void) => {
        idleResetCallback = cb;
        return vi.fn();
      });

    // Make scanner initialize fire the idle reset callback synchronously when called.
    // scanner.initialize(args) is evaluated synchronously before the await suspends,
    // so the callback fires BEFORE React flushes the setIsScanning(true) effect.
    // Before fix: isScanningRef.current is still false → callback clears metadata.
    // After fix: isScanningRef.current is true (set synchronously at start of handleStartScan).
    mockScannerInitialize.mockImplementationOnce(async () => {
      if (idleResetCallback) idleResetCallback();
      return { success: true, initialized: true };
    });

    renderCaptureScan();

    await waitFor(() => {
      expect(idleResetCallback).not.toBeNull();
      expect(mockSessionGet).toHaveBeenCalled();
    });

    const plantIdInput = await screen.findByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
    });

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /start scan/i })
      ).not.toBeDisabled()
    );

    // Click Start Scan — handleStartScan starts, scanner.initialize fires the callback mid-flight
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start scan/i }));
    });

    // After fix: isScanningRef.current was true when callback fired → banner NOT shown
    // Before fix: isScanningRef.current was false → banner shown (test FAILS)
    expect(
      screen.queryByTestId('idle-reset-notification')
    ).not.toBeInTheDocument();
  });

  // 8.3.1 On-mount checkIdleReset path clears metadata fields (mirrors live IPC handler)
  it('8.3.1 on mount checkIdleReset=true clears metadata fields in addition to showing banner', async () => {
    // Control when checkIdleReset resolves so we can verify fields were populated first
    let resolveCheckIdleReset!: (v: boolean) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.session.checkIdleReset = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<boolean>((res) => {
            resolveCheckIdleReset = res;
          })
      );

    // Session has data — loadSessionState will populate waveNumber, plantAgeDays etc.
    // (Simulates a race where session.get and checkIdleReset resolve concurrently.)
    mockSessionGet.mockResolvedValueOnce({
      phenotyperId: 'pheno-1',
      experimentId: 'exp-1',
      waveNumber: 1,
      plantAgeDays: 14,
      accessionName: 'TestAccession',
    });

    renderCaptureScan();

    // Wait for session state to populate the wave number field
    await waitFor(() => {
      const waveInput = screen.getByPlaceholderText(
        'e.g., 1'
      ) as HTMLInputElement;
      expect(waveInput.value).toBe('1');
    });

    // Now resolve checkIdleReset — should clear fields AND show banner
    await act(async () => {
      resolveCheckIdleReset(true);
    });

    // After fix: fields are cleared to empty
    // Before fix: waveNumber still shows '1' (only banner was shown, not setMetadata)
    const waveInput = screen.getByPlaceholderText(
      'e.g., 1'
    ) as HTMLInputElement;
    expect(waveInput.value).toBe('');

    expect(screen.getByTestId('idle-reset-notification')).toBeInTheDocument();
  });

  // 8.5.1 Unmount-cancelled guard: promise resolving after unmount does not setState
  it('8.5.1 unmounting before checkIdleReset resolves does not show banner', async () => {
    let resolveCheckIdleReset!: (v: boolean) => void;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.session.checkIdleReset = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise<boolean>((res) => {
            resolveCheckIdleReset = res;
          })
      );

    const { unmount } = renderCaptureScan();
    await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());

    // Unmount BEFORE checkIdleReset resolves
    unmount();

    // Resolve after unmount — without the mounted guard, this calls setState on an unmounted component
    await act(async () => {
      resolveCheckIdleReset(true);
    });

    // Component is unmounted; banner should not appear in the (now empty) DOM
    expect(
      screen.queryByTestId('idle-reset-notification')
    ).not.toBeInTheDocument();
  });

  // 8.6.1 Banner copy mentions the 10-minute timeout threshold
  it('8.6.1 notification banner text mentions the 10-minute timeout threshold', async () => {
    const { fireIdleReset } = await setupIdleReset();
    await fireIdleReset();

    const banner = screen.getByTestId('idle-reset-notification');
    expect(banner.textContent).toMatch(/10.?min/i);
  });

  // 9.1.1 After scan initialization error, onIdleReset shows banner (error recovery unblocks idle reset)
  //
  // Note: the synchronous `isScanningRef.current = false` in the catch block closes a real-world
  // race window (IPC arriving after setIsScanning(false) but before the useEffect([isScanning])
  // flush). That specific window cannot be reliably reproduced in unit tests. This test verifies
  // the behavioral contract: after a scan error, idle reset must work normally.
  it('9.1.1 onIdleReset shows banner after scan initialization error (error recovery unblocks idle reset)', async () => {
    let idleResetCallback: (() => void) | null = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global.window as any).electron.session.onIdleReset = vi
      .fn()
      .mockImplementation((cb: () => void) => {
        idleResetCallback = cb;
        return vi.fn();
      });

    // Make scanner.initialize reject to trigger the catch block
    mockScannerInitialize.mockRejectedValueOnce(
      new Error('hardware failure — scanner not ready')
    );

    renderCaptureScan();

    await waitFor(() => {
      expect(idleResetCallback).not.toBeNull();
      expect(mockSessionGet).toHaveBeenCalled();
    });

    const plantIdInput = await screen.findByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
    });

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /start scan/i })
      ).not.toBeDisabled()
    );

    // Trigger handleStartScan — scanner.initialize will reject → catch block runs
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start scan/i }));
    });

    // After error recovery, fire onIdleReset — isScanningRef must be false so banner shows
    await act(async () => {
      idleResetCallback!();
    });

    expect(screen.getByTestId('idle-reset-notification')).toBeInTheDocument();
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
        scanner_mode: 'cylinderscan',
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

/**
 * add-cylinderscan-delete-upload-integrity, tasks.md 4.5/4.8 — the
 * duplicate-scan check now uses db:scans:checkDuplicate with the 4-field
 * key (plant_id, experiment_id, wave_number, plant_age_days), replacing
 * the previous same-day/(plant+experiment)-only check that used
 * db:scans:getMostRecentScanDate (removed as dead code, tasks.md 4.7).
 */
describe('CaptureScan duplicate-scan check', () => {
  it('calls checkDuplicate with plant_id, experiment_id, wave_number, and plant_age_days', async () => {
    await fillFormAndStartScan();

    await waitFor(() => {
      expect(mockCheckDuplicate).toHaveBeenCalledWith(
        'PLANT-001',
        'exp-1',
        1,
        14
      );
    });
  });

  it('shows a warning when checkDuplicate reports a match', async () => {
    mockCheckDuplicate.mockResolvedValue({ success: true, data: true });

    renderCaptureScan();
    await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());

    const plantIdInput = await screen.findByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
    });

    await waitFor(() => {
      expect(screen.getByTestId('duplicate-scan-warning')).toBeInTheDocument();
    });

    const startButton = screen.getByRole('button', { name: /start scan/i });
    expect(startButton).toBeDisabled();
  });

  it('clears the warning when the wave number changes away from a duplicate match', async () => {
    mockCheckDuplicate.mockResolvedValue({ success: true, data: true });

    renderCaptureScan();
    await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());

    const plantIdInput = await screen.findByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
    });
    await waitFor(() => {
      expect(screen.getByTestId('duplicate-scan-warning')).toBeInTheDocument();
    });

    mockCheckDuplicate.mockResolvedValue({ success: true, data: false });
    const waveInput = screen.getByPlaceholderText('e.g., 1');
    await act(async () => {
      fireEvent.change(waveInput, { target: { value: '2' } });
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId('duplicate-scan-warning')
      ).not.toBeInTheDocument();
    });
  });

  it('clears the warning when the plant ID changes away from a duplicate match', async () => {
    mockCheckDuplicate.mockResolvedValue({ success: true, data: true });

    renderCaptureScan();
    await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());

    const plantIdInput = await screen.findByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
    });
    await waitFor(() => {
      expect(screen.getByTestId('duplicate-scan-warning')).toBeInTheDocument();
    });

    mockCheckDuplicate.mockResolvedValue({ success: true, data: false });
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-002' } });
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId('duplicate-scan-warning')
      ).not.toBeInTheDocument();
    });
  });

  it('does not call checkDuplicate when wave number is invalid/unparsed', async () => {
    renderCaptureScan();
    await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());

    const waveInput = screen.getByPlaceholderText('e.g., 1');
    // Wait for the session-restored default ('1', from mockSessionGet's
    // resolved value) to actually land in the DOM before overwriting it.
    // Without this, restoring the session is a race with the fireEvent
    // below: if it resolves after the input is set to 'not-a-number', it
    // silently reverts the field back to a valid '1', producing a fully
    // valid metadata combination that DOES call checkDuplicate —
    // intermittently failing this test for reasons unrelated to the
    // invalid-wave-number behavior actually under test.
    await waitFor(() => expect(waveInput).toHaveValue('1'));
    await act(async () => {
      fireEvent.change(waveInput, { target: { value: 'not-a-number' } });
    });

    const plantIdInput = await screen.findByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
    });

    // Give the polling effect a chance to run before asserting it didn't call.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(mockCheckDuplicate).not.toHaveBeenCalled();
  });

  it('stops polling checkDuplicate after unmount', async () => {
    // A bare `expect(clearIntervalSpy).toHaveBeenCalled()` is satisfied by
    // @testing-library/dom's own internal `waitFor` polling below (it uses
    // the same global setInterval/clearInterval to poll its condition),
    // completely independent of whether CaptureScan's own effect cleans up
    // its 2000ms duplicate-check interval. Identify that specific interval
    // by its distinctive 2000ms delay and assert clearInterval was called
    // with THAT id, not just "called for any reason."
    const setIntervalSpy = vi.spyOn(global, 'setInterval');
    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    const { unmount } = renderCaptureScan();
    await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());

    const duplicateCheckCall = setIntervalSpy.mock.calls.find(
      (call) => call[1] === 2000
    );
    expect(duplicateCheckCall).toBeDefined();
    const duplicateCheckIntervalId =
      setIntervalSpy.mock.results[
        setIntervalSpy.mock.calls.indexOf(duplicateCheckCall!)
      ].value;

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledWith(duplicateCheckIntervalId);
    setIntervalSpy.mockRestore();
    clearIntervalSpy.mockRestore();
  });
});

describe("CaptureScan plant age from the plant's germination date (#407, #428)", () => {
  const wavesList = () =>
    window.electron.database.cylinderWaves.list as ReturnType<typeof vi.fn>;
  const plantsList = () =>
    window.electron.database.cylinderPlants.list as ReturnType<typeof vi.fn>;
  const scanMetadata = () => mockScannerInitialize.mock.calls[0][0].metadata;
  const waveRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'wave-1',
    wave_number: 1,
    dates_per_plant: false,
    germination_date: sownDaysAgo(14),
    sowing_date: sownDaysAgo(20),
    transfer_date: null,
    note: null,
    set_by_name: 'Demo Phenotyper',
    set_at: '2026-01-02T09:00:00.000Z',
    scanCount: 0,
    changes: [],
    plantsWithOwnDates: [],
    ...overrides,
  });
  async function enterPlant(barcode = 'PLANT-001') {
    renderCaptureScan();
    await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());
    const plantIdInput = await screen.findByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: barcode } });
    });
  }

  it("saves the age from the wave's germination date, read-only, with the dates used", async () => {
    await fillFormAndStartScan();
    await waitFor(() => expect(mockScannerInitialize).toHaveBeenCalled());
    expect(scanMetadata()).toMatchObject({
      plant_age_days: 14,
      wave_number: 1,
      germination_date: sownDaysAgo(14),
      sowing_date: sownDaysAgo(20),
      transfer_date: undefined,
    });
    expect(screen.getByLabelText(/Plant Age/)).toHaveAttribute('readonly');
    expect(screen.getByTestId('plant-dates-source')).toHaveTextContent(
      "uses wave 1's dates"
    );
    expect(screen.getByTestId('wave-dates-info')).toHaveTextContent(
      'updated by Demo Phenotyper'
    );
  });

  it("uses a plant's own germination date when it has one", async () => {
    plantsList().mockResolvedValue({
      success: true,
      data: [
        {
          id: 'p1',
          wave_id: 'wave-1',
          plant_barcode: 'PLANT-001',
          germination_date: sownDaysAgo(12),
          sowing_date: sownDaysAgo(20),
          transfer_date: null,
          uses_wave_dates: false,
          reason: 'Germinated two days late',
          set_by_name: 'Demo Phenotyper',
          set_at: '2026-01-03T09:00:00.000Z',
          scanCount: 0,
          changes: [],
        },
      ],
    });
    await enterPlant();
    await waitFor(() =>
      expect(screen.getByLabelText(/Plant Age/)).toHaveValue('12')
    );
    expect(screen.getByTestId('plant-dates')).toHaveTextContent(
      "Plant PLANT-001's own dates"
    );
    expect(screen.getByTestId('plant-dates')).toHaveTextContent(
      'Reason: Germinated two days late'
    );
  });

  it('asks whether all plants share their dates for a new wave, and keeps Start Scan disabled until it is saved', async () => {
    wavesList().mockResolvedValue({ success: true, data: [] });
    await enterPlant();

    expect(await screen.findByTestId('wave-dates-panel')).toHaveTextContent(
      "How are wave 1's dates (sowing date, germination date and transfer to cylinder date) set?"
    );
    expect(screen.getByRole('button', { name: /start scan/i })).toBeDisabled();
    expect(
      screen.getByText(/Save wave 1's dates above to start the scan/)
    ).toBeInTheDocument();
    // The session's age (14) isn't shown for a wave with no dates.
    expect(screen.getByLabelText(/Plant Age/)).toHaveValue('');
  });

  it("asks for each plant's dates in a per-plant wave before its first scan", async () => {
    wavesList().mockResolvedValue({
      success: true,
      data: [
        waveRow({
          dates_per_plant: true,
          germination_date: null,
          sowing_date: null,
        }),
      ],
    });
    await enterPlant();

    // The plant's dates are fields of the form, like the rest of it.
    expect(await screen.findByTestId('plant-dates-box')).toHaveTextContent(
      /^Sowing Date \*Germination Date \*Transfer to CylinderSame day as germination/
    );
    expect(screen.getByRole('button', { name: /start scan/i })).toBeDisabled();
    expect(
      screen.getByText("Enter plant PLANT-001's dates above to start the scan")
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Plant Age/)).toHaveValue('');
  });

  const plantsSetDates = () =>
    window.electron.database.cylinderPlants.setDates as ReturnType<
      typeof vi.fn
    >;
  const perPlantWave = () =>
    wavesList().mockResolvedValue({
      success: true,
      data: [
        waveRow({
          dates_per_plant: true,
          germination_date: null,
          sowing_date: null,
        }),
      ],
    });
  /** In a per-plant wave: the dates first, then the barcode. */
  async function enterPlantDatesThenBarcode() {
    renderCaptureScan();
    await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());
    await screen.findByTestId('plant-dates-box');
    fireEvent.change(screen.getByLabelText('Sowing date'), {
      target: { value: sownDaysAgo(12) },
    });
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: sownDaysAgo(9) },
    });
    const plantIdInput = screen.getByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
    });
    const start = screen.getByRole('button', { name: /start scan/i });
    await waitFor(() => expect(start).not.toBeDisabled());
    return start;
  }

  it("asks for a per-plant wave's plant dates before the age, previews the age, with no save button", async () => {
    perPlantWave();
    renderCaptureScan();
    await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());
    const box = await screen.findByTestId('plant-dates-box');
    expect(box).not.toHaveClass('border-2');
    expect(screen.getByTestId('plant-dates-saved-on-scan')).toHaveTextContent(
      "The plant's dates are saved when the scan starts."
    );
    expect(screen.queryByTestId('plant-dates-save')).not.toBeInTheDocument();
    const age = screen.getByLabelText(/Compute Plant Age \(Days\)/);
    // The session's age isn't shown, the age can't be typed, and a blank age isn't flagged.
    expect(age).toHaveValue('');
    expect(age).toHaveAttribute('readonly');
    expect(screen.queryByText('Plant age is required')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Sowing date'), {
      target: { value: sownDaysAgo(12) },
    });
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: sownDaysAgo(9) },
    });
    // The age they give is shown straight away, in the age field and under the dates.
    await waitFor(() => expect(age).toHaveValue('9'));
    expect(screen.getByTestId('plant-dates-age')).toHaveTextContent(
      'Plant age: 9 days (from the germination date)'
    );

    const plantIdInput = screen.getByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
    });
    // Still what was entered, now for PLANT-001, and the scan can start.
    expect(screen.getByLabelText('Germination date')).toHaveValue(
      sownDaysAgo(9)
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /start scan/i })
      ).not.toBeDisabled()
    );
  });

  it("saves a per-plant wave's plant dates when the scan starts, before scanning", async () => {
    perPlantWave();
    plantsSetDates().mockResolvedValue({ success: true, data: null });
    const start = await enterPlantDatesThenBarcode();
    await act(async () => {
      fireEvent.click(start);
    });
    await waitFor(() => expect(mockScannerInitialize).toHaveBeenCalled());
    expect(plantsSetDates()).toHaveBeenCalledWith(
      expect.objectContaining({
        waveId: 'wave-1',
        plantBarcode: 'PLANT-001',
        germinationDate: sownDaysAgo(9),
        sowingDate: sownDaysAgo(12),
      })
    );
    expect(plantsSetDates().mock.invocationCallOrder[0]).toBeLessThan(
      mockScannerInitialize.mock.invocationCallOrder[0]
    );
    expect(scanMetadata()).toMatchObject({
      plant_age_days: 9,
      germination_date: sownDaysAgo(9),
      sowing_date: sownDaysAgo(12),
    });
  });

  it("doesn't scan when a per-plant wave's plant dates can't be saved", async () => {
    perPlantWave();
    plantsSetDates().mockResolvedValue({
      success: false,
      error: 'database is locked',
    });
    const start = await enterPlantDatesThenBarcode();
    await act(async () => {
      fireEvent.click(start);
    });
    expect(await screen.findByText('database is locked')).toBeInTheDocument();
    expect(mockScannerInitialize).not.toHaveBeenCalled();
  });

  it("never fills in a new plant's dates from another plant's in a per-plant wave", async () => {
    perPlantWave();
    // PLANT-000 already has its dates; PLANT-001 is new.
    plantsList().mockResolvedValue({
      success: true,
      data: [
        {
          id: 'p0',
          wave_id: 'wave-1',
          plant_barcode: 'PLANT-000',
          germination_date: sownDaysAgo(16),
          sowing_date: sownDaysAgo(20),
          transfer_date: null,
          uses_wave_dates: false,
          reason: null,
          set_by_name: 'Demo Phenotyper',
          set_at: '2026-01-03T09:00:00.000Z',
          scanCount: 1,
          changes: [],
        },
      ],
    });
    await enterPlant();

    await screen.findByTestId('plant-dates-box');
    expect(screen.getByLabelText('Sowing date')).toHaveValue('');
    expect(screen.getByLabelText('Germination date')).toHaveValue('');
    expect(screen.getByLabelText(/Plant Age/)).toHaveValue('');
    expect(screen.getByRole('button', { name: /start scan/i })).toBeDisabled();
    expect(
      screen.getByText("Enter plant PLANT-001's dates above to start the scan")
    ).toBeInTheDocument();
  });

  it("scans a per-plant wave's scanned plant at its saved age, with no way to change its dates", async () => {
    perPlantWave();
    // PLANT-001 was scanned before, with germination 16 days ago.
    plantsList().mockResolvedValue({
      success: true,
      data: [
        {
          id: 'p1',
          wave_id: 'wave-1',
          plant_barcode: 'PLANT-001',
          germination_date: sownDaysAgo(16),
          sowing_date: sownDaysAgo(20),
          transfer_date: null,
          uses_wave_dates: false,
          reason: null,
          set_by_name: 'Demo Phenotyper',
          set_at: '2026-01-03T09:00:00.000Z',
          scanCount: 1,
          changes: [],
        },
      ],
    });
    await enterPlant();
    await waitFor(() =>
      expect(screen.getByLabelText(/Plant Age/)).toHaveValue('16')
    );
    // Its dates are final once it has scans.
    expect(screen.queryByTestId('plant-dates-edit')).not.toBeInTheDocument();

    const start = screen.getByRole('button', { name: /start scan/i });
    await waitFor(() => expect(start).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(start);
    });
    await waitFor(() => expect(mockScannerInitialize).toHaveBeenCalled());
    expect(plantsSetDates()).not.toHaveBeenCalled();
    expect(scanMetadata()).toMatchObject({
      plant_age_days: 16,
      germination_date: sownDaysAgo(16),
    });
  });

  it("asks a per-plant wave's plant for its germination colour with its dates, cleaned and sent (#429)", async () => {
    perPlantWave();
    plantsSetDates().mockResolvedValue({ success: true, data: null });
    renderCaptureScan();
    await screen.findByTestId('plant-dates-box');
    // The colour is an optional field next to the dates, with an ⓘ.
    const color = screen.getByLabelText('Germination colour');
    expect(color).toHaveAttribute('placeholder', 'none');
    fireEvent.click(screen.getByTestId('germ-day-color-info'));
    expect(screen.getByTestId('germ-day-color-info-text')).toHaveTextContent(
      "You can add the plant's germination colour, for example Red or GermRed."
    );
    fireEvent.change(color, { target: { value: 'arctic blue' } });
    fireEvent.blur(color);
    expect(color).toHaveValue('ArcticBlue');

    fireEvent.change(screen.getByLabelText('Sowing date'), {
      target: { value: sownDaysAgo(12) },
    });
    fireEvent.change(screen.getByLabelText('Germination date'), {
      target: { value: sownDaysAgo(9) },
    });
    const plantIdInput = screen.getByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
    });
    const start = screen.getByRole('button', { name: /start scan/i });
    await waitFor(() => expect(start).not.toBeDisabled());
    await act(async () => {
      fireEvent.click(start);
    });
    await waitFor(() => expect(mockScannerInitialize).toHaveBeenCalled());
    expect(plantsSetDates()).toHaveBeenCalledWith(
      expect.objectContaining({ germDayColor: 'ArcticBlue' })
    );
    expect(scanMetadata()).toMatchObject({ germ_day_color: 'ArcticBlue' });
  });

  it("shows a same-dates wave's germination colour with its dates, and sends it with the scan", async () => {
    wavesList().mockResolvedValue({
      success: true,
      data: [waveRow({ germ_day_color: 'GermRed' })],
    });
    await fillFormAndStartScan();
    await waitFor(() => expect(mockScannerInitialize).toHaveBeenCalled());
    expect(screen.getByTestId('wave-dates-info')).toHaveTextContent(
      'Germination colour: GermRed'
    );
    expect(scanMetadata()).toMatchObject({ germ_day_color: 'GermRed' });
  });

  it("saves the calculated age, not the session's typed age", async () => {
    // The session remembers 21 from before; wave 1 germinated 14 days ago.
    mockSessionGet.mockResolvedValue({
      phenotyperId: 'pheno-1',
      experimentId: 'exp-1',
      waveNumber: '1',
      plantAgeDays: '21',
      accessionName: '',
    });
    await fillFormAndStartScan();
    await waitFor(() => expect(mockScannerInitialize).toHaveBeenCalled());
    expect(scanMetadata()).toMatchObject({ plant_age_days: 14 });
    expect(screen.getByLabelText(/Plant Age/)).toHaveValue('14');
  });

  it('reloads the waves and plants after a scan', async () => {
    let complete: ((result: unknown) => void) | null = null;
    mockScannerOnComplete.mockImplementation((cb) => {
      complete = cb;
      return () => {};
    });
    await fillFormAndStartScan();
    await waitFor(() => expect(mockScannerInitialize).toHaveBeenCalled());
    const wavesBefore = wavesList().mock.calls.length;
    const plantsBefore = plantsList().mock.calls.length;

    await act(async () => {
      complete!({
        success: true,
        frames_captured: 36,
        output_path: '/scans/x',
        db_saved: true,
      });
    });

    // The wave and plant now have a scan: their dates need a reason to change.
    await waitFor(() =>
      expect(wavesList().mock.calls.length).toBeGreaterThan(wavesBefore)
    );
    expect(plantsList().mock.calls.length).toBeGreaterThan(plantsBefore);
  });

  it("doesn't scan when the scanner refuses the plant age, and says why", async () => {
    const refusal =
      "The plant age (13) isn't the days since this plant's germination date (14).";
    mockScannerInitialize.mockResolvedValue({
      success: false,
      initialized: false,
      error: refusal,
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await fillFormAndStartScan();
    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(mockScannerScan).not.toHaveBeenCalled();
  });
});

describe('CaptureScan: an open date box holds up Start Scan (#407, #428)', () => {
  async function fillPlant() {
    renderCaptureScan();
    await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());
    const plantIdInput = await screen.findByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
    });
    const startButton = screen.getByRole('button', { name: /start scan/i });
    await waitFor(() => expect(startButton).not.toBeDisabled());
    return startButton;
  }

  it("keeps Start Scan disabled while the plant's dates box is open", async () => {
    const startButton = await fillPlant();
    fireEvent.click(screen.getByTestId('plant-dates-different'));
    expect(startButton).toBeDisabled();
    expect(
      screen.getByText(
        "Save or cancel the plant's dates above to start the scan"
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(startButton).not.toBeDisabled());
  });

  it("keeps Start Scan disabled while the wave's Edit box is open", async () => {
    const startButton = await fillPlant();
    fireEvent.click(screen.getByTestId('wave-dates-edit'));
    expect(startButton).toBeDisabled();
    expect(
      screen.getByText(
        "Save or cancel the change to the wave's dates above to start the scan"
      )
    ).toBeInTheDocument();
  });

  it("closes and empties an unsaved plant's dates box when the plant changes", async () => {
    await fillPlant();
    fireEvent.click(screen.getByTestId('plant-dates-different'));
    fireEvent.change(screen.getByTestId('plant-dates-reason'), {
      target: { value: 'Germinated late' },
    });

    const plantIdInput = screen.getByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-002' } });
    });

    expect(screen.queryByTestId('plant-dates-box')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByTestId('plant-dates-different'));
    expect(screen.getByTestId('plant-dates-reason')).toHaveValue('');
  });

  it('tells the operator to restart when the germination dates cannot be loaded', async () => {
    (
      window.electron.database.cylinderWaves.list as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ success: false, error: 'database is locked' });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderCaptureScan();
    await waitFor(() => expect(mockSessionGet).toHaveBeenCalled());
    const plantIdInput = await screen.findByPlaceholderText('e.g., PLANT_001');
    await act(async () => {
      fireEvent.change(plantIdInput, { target: { value: 'PLANT-001' } });
    });

    const error = await screen.findByTestId('wave-dates-load-error');
    expect(error).toHaveTextContent(
      "Couldn't load the wave dates. Close Bloom Desktop and open it again."
    );
    expect(error).toHaveTextContent('Details: database is locked');
    expect(screen.queryByTestId('wave-dates-panel')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start scan/i })).toBeDisabled();
    expect(
      screen.getByText('Restart Bloom Desktop to start the scan')
    ).toBeInTheDocument();
  });
});
