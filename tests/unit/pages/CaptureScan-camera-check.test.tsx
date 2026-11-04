/**
 * Unit tests: Capture Scan and the experiment's camera settings (#483).
 *
 * With an experiment and phenotyper chosen, Capture Scan asks for a check of the
 * experiment's camera settings unless this phenotyper checked them today. Start Scan
 * waits for it, and the scan uses the experiment's settings, never the station's.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import '@testing-library/jest-dom';
import { CaptureScan } from '../../../src/renderer/CaptureScan';
import { CameraSettings } from '../../../src/renderer/CameraSettings';

// The live preview needs the camera streaming API; it is not under test here
vi.mock('../../../src/components/Streamer', () => ({
  Streamer: () => null,
}));
import { toIsoDate } from '../../../src/utils/wave-dates';
import {
  CHECKED_TODAY_STATUS,
  experimentCameraSettingsMock,
} from '../helpers/experiment-camera-settings-mock';
import type { ExperimentCameraSettingsStatus } from '../../../src/types/experiment-camera-settings';

/** Local "YYYY-MM-DD" `days` ago, by calendar arithmetic so DST can't shift it. */
const sownDaysAgo = (days: number) => {
  const now = new Date();
  return toIsoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  );
};

const PLANT_BARCODE = 'PLANT-001';

let cameraApi = experimentCameraSettingsMock(CHECKED_TODAY_STATUS);
const mockScannerOnComplete = vi.fn();
const mockScannerInitialize = vi.fn();
const mockScannerScan = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockScannerOnComplete.mockReturnValue(vi.fn());
  mockScannerInitialize.mockResolvedValue({ success: true, initialized: true });
  // Leave the scan pending: the outcome arrives via the onComplete event
  mockScannerScan.mockReturnValue(new Promise(() => {}));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron = {
    ...win.electron,
    session: {
      checkIdleReset: vi.fn().mockResolvedValue(false),
      onIdleReset: vi.fn().mockReturnValue(vi.fn()),
      get: vi.fn().mockResolvedValue({
        phenotyperId: 'pheno-1',
        experimentId: 'exp-1',
        waveNumber: 1,
        plantAgeDays: 14,
        accessionName: null,
      }),
      set: vi.fn().mockResolvedValue(undefined),
    },
    config: {
      ...win.electron?.config,
      get: vi.fn().mockResolvedValue({
        config: { scanner_name: 'Test Scanner', scans_dir: '/scans' },
      }),
    },
    database: {
      ...win.electron?.database,
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
        ...win.electron?.database?.scans,
        getRecent: vi.fn().mockResolvedValue({ success: true, data: [] }),
        getMostRecentScanDate: vi
          .fn()
          .mockResolvedValue({ success: true, data: null }),
        checkDuplicate: vi
          .fn()
          .mockResolvedValue({ success: true, data: false }),
      },
      experimentCameraSettings: cameraApi,
      experiments: {
        list: vi.fn().mockResolvedValue({ success: true, data: [] }),
        get: vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'exp-1', name: 'KCS', accession: { id: 'acc-1' } },
        }),
      },
      accessions: {
        ...win.electron?.database?.accessions,
        getPlantBarcodes: vi
          .fn()
          .mockResolvedValue({ success: true, data: [PLANT_BARCODE] }),
        getAccessionNameByBarcode: vi
          .fn()
          .mockResolvedValue({ success: true, data: 'Col-0' }),
      },
    },
    camera: {
      // The station Camera Settings page streams too.
      startStream: vi.fn().mockResolvedValue({ success: true }),
      stopStream: vi.fn().mockResolvedValue({ success: true }),
      onFrame: vi.fn(() => () => undefined),
      offFrame: vi.fn(),
      removeAllListeners: vi.fn(),
      getStatus: vi.fn().mockResolvedValue({ connected: true }),
      getSettings: vi
        .fn()
        // The station's saved settings: scans must not use these (#483).
        .mockResolvedValue({ exposure_time: 12000, gain: 120, gamma: 1.2 }),
    },
    scanner: {
      initialize: mockScannerInitialize,
      scan: mockScannerScan,
      onProgress: vi.fn().mockReturnValue(vi.fn()),
      onFrame: vi.fn().mockReturnValue(vi.fn()),
      onComplete: mockScannerOnComplete,
      onError: vi.fn().mockReturnValue(vi.fn()),
    },
  };
});

// Start Scan only enables after session, experiment, barcode-list, duplicate
// and camera-status loads all resolve; 1s (the waitFor default) is too short
// on slow CI runners
const START_ENABLED_TIMEOUT_MS = 5000;

const KCS_SETTINGS = {
  ...CHECKED_TODAY_STATUS.current!,
  id: 'cam-kcs',
  exposure_time: 7400,
  gain: 250,
  gamma: 1,
};
const NOT_CHECKED_TODAY: ExperimentCameraSettingsStatus = {
  current: {
    ...KCS_SETTINGS,
    last_confirmed_at: null,
    last_confirmed_by_name: null,
  },
  confirmedToday: false,
  changedToday: null,
};
const CHECKED_TODAY: ExperimentCameraSettingsStatus = {
  current: KCS_SETTINGS,
  confirmedToday: true,
  changedToday: null,
};

/** Capture Scan, with Camera Settings one link away, as in the app. */
function renderPage() {
  render(
    <MemoryRouter initialEntries={['/capture-scan']}>
      <Routes>
        <Route path="/capture-scan" element={<CaptureScan />} />
        <Route path="/camera-settings" element={<CameraSettings />} />
      </Routes>
    </MemoryRouter>
  );
}

const SETTINGS_LINK = '/camera-settings?experiment=exp-1&phenotyper=pheno-1';

async function enterBarcode() {
  const barcodeInput = await screen.findByTestId('plant-barcode-input');
  await waitFor(
    () =>
      expect(
        window.electron.database.accessions.getPlantBarcodes
      ).toHaveBeenCalled(),
    { timeout: START_ENABLED_TIMEOUT_MS }
  );
  fireEvent.change(barcodeInput, { target: { value: PLANT_BARCODE } });
}

const startButton = () => screen.getByRole('button', { name: 'Start Scan' });

/** The experiment camera settings API this test's page sees. */
function setCameraApi(status: ExperimentCameraSettingsStatus) {
  cameraApi = experimentCameraSettingsMock(status);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).electron.database.experimentCameraSettings = cameraApi;
  return cameraApi;
}

describe('Capture Scan and the experiment camera settings (#483)', () => {
  it("asks for a check on Camera Settings when this phenotyper hasn't checked them today, and Start Scan waits", async () => {
    setCameraApi(NOT_CHECKED_TODAY);
    renderPage();
    await enterBarcode();

    // KCS has settings, not checked today by this phenotyper: Verify.
    await waitFor(() =>
      expect(screen.getByTestId('experiment-camera-summary')).toHaveTextContent(
        'Camera not verified today · Verify'
      )
    );
    expect(await screen.findByRole('link', { name: 'Verify' })).toHaveAttribute(
      'href',
      SETTINGS_LINK
    );
    expect(cameraApi.status).toHaveBeenCalledWith('exp-1', 'pheno-1');
    // Long enough for every other check to have passed.
    await new Promise((r) => setTimeout(r, 300));
    expect(startButton()).toBeDisabled();
    expect(
      screen.getByText('Set or verify the camera settings first')
    ).toBeInTheDocument();
    // The check happens on Camera Settings, not on this page.
    expect(
      screen.queryByTestId('camera-settings-check-panel')
    ).not.toBeInTheDocument();
  });

  it("checks them on Camera Settings, comes back, and scans with the experiment's settings, not the station's", async () => {
    setCameraApi(NOT_CHECKED_TODAY);
    cameraApi.status
      .mockResolvedValueOnce({ success: true, data: NOT_CHECKED_TODAY })
      .mockResolvedValue({ success: true, data: CHECKED_TODAY });
    cameraApi.confirm.mockResolvedValue({ success: true, data: CHECKED_TODAY });
    renderPage();

    fireEvent.click(await screen.findByRole('link', { name: 'Verify' }));
    expect(
      await screen.findByRole('heading', { name: 'Camera settings for KCS' })
    ).toBeInTheDocument();
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'Confirm and return to Capture Scan',
      })
    );
    await waitFor(() =>
      expect(cameraApi.confirm).toHaveBeenCalledWith({
        experimentId: 'exp-1',
        phenotyperId: 'pheno-1',
        currentSettingsId: 'cam-kcs',
        exposure_time: 7400,
        gain: 250,
        gamma: 1,
        note: '',
      })
    );

    // Back on Capture Scan, with the experiment still chosen.
    await enterBarcode();
    await waitFor(() => expect(startButton()).toBeEnabled(), {
      timeout: START_ENABLED_TIMEOUT_MS,
    });
    expect(screen.getByTestId('experiment-camera-summary')).toHaveTextContent(
      /Camera set: 7,400 µs · Gain 250 · Gamma 1\.0 · Edit/
    );

    fireEvent.click(startButton());
    await waitFor(() => expect(mockScannerInitialize).toHaveBeenCalled());
    expect(mockScannerInitialize.mock.calls[0][0].camera).toMatchObject({
      exposure_time: 7400,
      gain: 250,
      gamma: 1,
    });
  });

  it('goes straight to scanning when this phenotyper checked them today, with Edit linking to Camera Settings', async () => {
    setCameraApi(CHECKED_TODAY);
    renderPage();
    await enterBarcode();

    await waitFor(() => expect(startButton()).toBeEnabled(), {
      timeout: START_ENABLED_TIMEOUT_MS,
    });
    // Who checked them, and when, is in the tooltip.
    expect(screen.getByTestId('experiment-camera-summary')).toHaveAttribute(
      'title',
      expect.stringMatching(/^Checked today .* by Demo Phenotyper$/)
    );
    expect(screen.getByRole('link', { name: 'Edit' })).toHaveAttribute(
      'href',
      SETTINGS_LINK
    );
  });

  it('goes back to Capture Scan without saving from Camera Settings', async () => {
    setCameraApi(CHECKED_TODAY);
    renderPage();
    fireEvent.click(await screen.findByRole('link', { name: 'Edit' }));
    fireEvent.click(
      await screen.findByRole('link', { name: 'Back to Capture Scan' })
    );
    // Back on Capture Scan, with the experiment's settings still in use.
    await waitFor(() =>
      expect(screen.getByTestId('experiment-camera-summary')).toHaveTextContent(
        'Camera set: 7,400 µs'
      )
    );
    expect(cameraApi.confirm).not.toHaveBeenCalled();
  });

  it('shows why the settings could not be loaded, with Retry', async () => {
    setCameraApi(CHECKED_TODAY);
    cameraApi.status
      .mockResolvedValueOnce({ success: false, error: 'database is locked' })
      .mockResolvedValue({ success: true, data: CHECKED_TODAY });
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'database is locked'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() =>
      expect(screen.getByTestId('experiment-camera-summary')).toHaveTextContent(
        'Camera set: 7,400 µs'
      )
    );
  });

  it('asks to set camera settings for an experiment that has none yet', async () => {
    setCameraApi({ current: null, confirmedToday: false, changedToday: null });
    renderPage();
    await waitFor(() =>
      expect(screen.getByTestId('experiment-camera-summary')).toHaveTextContent(
        'Camera settings not configuredAdd camera settings →'
      )
    );
    expect(
      await screen.findByRole('link', { name: 'Add camera settings →' })
    ).toHaveAttribute('href', SETTINGS_LINK);
  });

  it('opens the chosen experiment from the sidebar, with a link to the station page', async () => {
    setCameraApi(CHECKED_TODAY);
    render(
      <MemoryRouter initialEntries={['/camera-settings']}>
        <Routes>
          <Route path="/camera-settings" element={<CameraSettings />} />
        </Routes>
      </MemoryRouter>
    );
    // The session has exp-1 and pheno-1 chosen on Capture Scan.
    expect(
      await screen.findByRole('heading', { name: 'Camera settings for KCS' })
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole('link', { name: 'Station camera settings' })
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Camera Settings & Live Preview',
      })
    ).toBeInTheDocument();
  });

  it('opens the station page from the sidebar when nothing is chosen', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).electron.session.get = vi.fn().mockResolvedValue({
      phenotyperId: null,
      experimentId: 'exp-1',
      waveNumber: null,
      plantAgeDays: null,
      accessionName: null,
    });
    render(
      <MemoryRouter initialEntries={['/camera-settings']}>
        <Routes>
          <Route path="/camera-settings" element={<CameraSettings />} />
        </Routes>
      </MemoryRouter>
    );
    expect(
      await screen.findByRole('heading', {
        name: 'Camera Settings & Live Preview',
      })
    ).toBeInTheDocument();
  });
});
