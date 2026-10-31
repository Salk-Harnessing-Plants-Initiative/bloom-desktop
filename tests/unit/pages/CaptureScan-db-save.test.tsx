/**
 * Unit tests: CaptureScan scan-outcome messages (#392)
 *
 * Mounts CaptureScan with a filled-in session and a configured camera, starts
 * a scan, then delivers a scanner:complete payload through the registered
 * onComplete listener. A result with db_saved: false must show the
 * "not saved to the database" warning with the folder path, never
 * "Scan completed successfully!".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  render,
  screen,
  waitFor,
  fireEvent,
  act,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { CaptureScan } from '../../../src/renderer/CaptureScan';

// The live preview needs the camera streaming API; it is not under test here
vi.mock('../../../src/components/Streamer', () => ({
  Streamer: () => null,
}));
import type { ScanResult } from '../../../src/types/scanner';
import { toIsoDate } from '../../../src/utils/wave-dates';

/** Local "YYYY-MM-DD" `days` ago, by calendar arithmetic so DST can't shift it. */
const sownDaysAgo = (days: number) => {
  const now = new Date();
  return toIsoDate(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  );
};

const PLANT_BARCODE = 'PLANT-001';
const OUTPUT_PATH = '/scans/2026-10-12/PLANT-001/uuid-1';
const SUCCESS_TEXT = 'Scan completed successfully!';

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
      experiments: {
        list: vi.fn().mockResolvedValue({ success: true, data: [] }),
        get: vi.fn().mockResolvedValue({
          success: true,
          data: { id: 'exp-1', accession: { id: 'acc-1' } },
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
      getStatus: vi.fn().mockResolvedValue({ connected: true }),
      getSettings: vi
        .fn()
        .mockResolvedValue({ exposure_time: 10000, gain: 100, gamma: 1.0 }),
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

/** Fill the barcode, start a scan, and return the registered onComplete listener. */
async function startScan(): Promise<(result: ScanResult) => void> {
  render(
    <MemoryRouter>
      <CaptureScan />
    </MemoryRouter>
  );

  const barcodeInput = await screen.findByTestId('plant-barcode-input');
  // Type the barcode once the experiment's barcode list has loaded
  await waitFor(
    () =>
      expect(
        window.electron.database.accessions.getPlantBarcodes
      ).toHaveBeenCalled(),
    { timeout: START_ENABLED_TIMEOUT_MS }
  );
  fireEvent.change(barcodeInput, { target: { value: PLANT_BARCODE } });

  const startButton = screen.getByRole('button', { name: 'Start Scan' });
  await waitFor(() => expect(startButton).toBeEnabled(), {
    timeout: START_ENABLED_TIMEOUT_MS,
  });
  fireEvent.click(startButton);

  await waitFor(() => expect(mockScannerOnComplete).toHaveBeenCalled());
  const calls = mockScannerOnComplete.mock.calls;
  return calls[calls.length - 1][0];
}

describe('CaptureScan scan outcome (#392)', () => {
  it('shows a not-saved warning with the folder path instead of success when the DB save failed', async () => {
    const onComplete = await startScan();

    act(() => {
      onComplete({
        success: true,
        frames_captured: 72,
        output_path: OUTPUT_PATH,
        db_saved: false,
        db_save_error: 'database is locked',
      });
    });

    const warning = await screen.findByTestId('scan-not-saved-warning');
    expect(warning).toHaveTextContent(/NOT saved to the database/);
    expect(warning).toHaveTextContent('database is locked');
    expect(screen.getByTestId('scan-not-saved-path')).toHaveTextContent(
      OUTPUT_PATH
    );
    expect(screen.queryByText(SUCCESS_TEXT)).not.toBeInTheDocument();
    // Recent scans marks it as failed, since it is not in the database
    expect(screen.getByText(/✗ 72 frames/)).toBeInTheDocument();
  });

  it('keeps the warning until dismissed, and clears it when the next scan starts', async () => {
    const onComplete = await startScan();
    act(() => {
      onComplete({
        success: true,
        frames_captured: 72,
        output_path: OUTPUT_PATH,
        db_saved: false,
      });
    });
    await screen.findByTestId('scan-not-saved-warning');

    // Barcode is kept and the scan can be retried
    const startButton = screen.getByRole('button', { name: 'Start Scan' });
    await waitFor(() => expect(startButton).toBeEnabled(), {
      timeout: START_ENABLED_TIMEOUT_MS,
    });
    fireEvent.click(startButton);

    await waitFor(() =>
      expect(
        screen.queryByTestId('scan-not-saved-warning')
      ).not.toBeInTheDocument()
    );
    expect(mockScannerInitialize).toHaveBeenCalledTimes(2);
  });

  it('dismiss button hides the warning', async () => {
    const onComplete = await startScan();
    act(() => {
      onComplete({
        success: true,
        frames_captured: 72,
        output_path: OUTPUT_PATH,
        db_saved: false,
      });
    });
    await screen.findByTestId('scan-not-saved-warning');

    fireEvent.click(
      screen.getByRole('button', { name: 'Dismiss scan not saved warning' })
    );

    expect(
      screen.queryByTestId('scan-not-saved-warning')
    ).not.toBeInTheDocument();
  });

  it('shows the success message when the scan was saved', async () => {
    const onComplete = await startScan();

    act(() => {
      onComplete({
        success: true,
        frames_captured: 72,
        output_path: OUTPUT_PATH,
        scan_id: 'scan-123',
        db_saved: true,
      });
    });

    expect(await screen.findByText(SUCCESS_TEXT)).toBeInTheDocument();
    expect(
      screen.queryByTestId('scan-not-saved-warning')
    ).not.toBeInTheDocument();
  });
});
