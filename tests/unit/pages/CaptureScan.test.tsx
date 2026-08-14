/**
 * Unit tests: CaptureScan color palette (Tier 4 style/UX parity)
 *
 * This is the first real RTL mount of CaptureScan.tsx (the existing
 * CaptureScan-event-cleanup.test.tsx is entirely describe.skip'd and never
 * mounts the component — it re-implements isolated hook logic instead).
 * Mounting for real requires a wide mock surface: session.checkIdleReset/
 * onIdleReset, database.scans.getMostRecentScanDate (polled), config.get,
 * database.scans.getRecent, session.get/set, camera.getStatus/getSettings,
 * scanner.onProgress/onComplete/onError, and — easy to miss —
 * database.experiments.list(), because CaptureScan unconditionally renders
 * MetadataForm -> ExperimentChooser, which calls it on mount and isn't
 * covered by tests/unit/setup.ts's global mock.
 *
 * Scope: only the two blue-to-lime color conversions (the "Go to Camera
 * Settings" link and "Configure Camera" button, both shown only when the
 * camera isn't configured) plus a regression guard on the amber warning
 * banners. Not a general behavioral test of the whole page.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import { CaptureScan } from '../../../src/renderer/CaptureScan';

const mockCheckIdleReset = vi.fn().mockResolvedValue(false);
const mockOnIdleReset = vi.fn().mockReturnValue(vi.fn());
const mockSessionGet = vi.fn().mockResolvedValue({
  phenotyperId: null,
  experimentId: null,
  waveNumber: null,
  plantAgeDays: null,
  accessionName: null,
});
const mockSessionSet = vi.fn().mockResolvedValue(undefined);
const mockConfigGet = vi.fn().mockResolvedValue({
  config: {
    scanner_name: 'Test Scanner',
    scans_dir: '~/.bloom/scans',
    num_frames: 72,
    seconds_per_rot: 7.0,
  },
});
const mockGetRecent = vi.fn().mockResolvedValue({ success: true, data: [] });
const mockGetMostRecentScanDate = vi
  .fn()
  .mockResolvedValue({ success: true, data: null });
const mockCheckDuplicate = vi
  .fn()
  .mockResolvedValue({ success: true, data: false });
const mockExperimentsList = vi.fn().mockResolvedValue({
  success: true,
  data: [],
});
const mockCameraGetStatus = vi.fn().mockResolvedValue({ connected: false });
const mockCameraGetSettings = vi.fn().mockResolvedValue(null);
const mockScannerOnProgress = vi.fn().mockReturnValue(vi.fn());
const mockScannerOnComplete = vi.fn().mockReturnValue(vi.fn());
const mockScannerOnError = vi.fn().mockReturnValue(vi.fn());

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckIdleReset.mockResolvedValue(false);
  mockOnIdleReset.mockReturnValue(vi.fn());
  mockSessionGet.mockResolvedValue({
    phenotyperId: null,
    experimentId: null,
    waveNumber: null,
    plantAgeDays: null,
    accessionName: null,
  });
  mockConfigGet.mockResolvedValue({
    config: {
      scanner_name: 'Test Scanner',
      scans_dir: '~/.bloom/scans',
      num_frames: 72,
      seconds_per_rot: 7.0,
    },
  });
  mockGetRecent.mockResolvedValue({ success: true, data: [] });
  mockGetMostRecentScanDate.mockResolvedValue({ success: true, data: null });
  mockCheckDuplicate.mockResolvedValue({ success: true, data: false });
  mockExperimentsList.mockResolvedValue({ success: true, data: [] });
  mockCameraGetStatus.mockResolvedValue({ connected: false });
  mockCameraGetSettings.mockResolvedValue(null);
  mockScannerOnProgress.mockReturnValue(vi.fn());
  mockScannerOnComplete.mockReturnValue(vi.fn());
  mockScannerOnError.mockReturnValue(vi.fn());

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const win = global.window as any;
  win.electron = {
    ...win.electron,
    session: {
      checkIdleReset: mockCheckIdleReset,
      onIdleReset: mockOnIdleReset,
      get: mockSessionGet,
      set: mockSessionSet,
    },
    config: {
      ...win.electron?.config,
      get: mockConfigGet,
    },
    database: {
      ...win.electron?.database,
      scans: {
        ...win.electron?.database?.scans,
        getRecent: mockGetRecent,
        getMostRecentScanDate: mockGetMostRecentScanDate,
        checkDuplicate: mockCheckDuplicate,
      },
      experiments: {
        list: mockExperimentsList,
      },
    },
    camera: {
      getStatus: mockCameraGetStatus,
      getSettings: mockCameraGetSettings,
    },
    scanner: {
      onProgress: mockScannerOnProgress,
      onComplete: mockScannerOnComplete,
      onError: mockScannerOnError,
    },
  };
});

function renderCaptureScan() {
  return render(
    <MemoryRouter>
      <CaptureScan />
    </MemoryRouter>
  );
}

describe('CaptureScan color palette (camera-not-configured state)', () => {
  it('uses lime on the "Configure Camera" button, not blue', async () => {
    renderCaptureScan();

    await waitFor(() => {
      expect(mockCameraGetStatus).toHaveBeenCalled();
    });

    const configureButton = await screen.findByText('Configure Camera');
    expect(configureButton.className).toContain('bg-lime-700');
    expect(configureButton.className).toContain('hover:bg-lime-800');
    expect(configureButton.className).not.toMatch(
      /bg-blue-600|hover:bg-blue-700/
    );
  });

  it('uses lime on the "Go to Camera Settings" link, not blue', async () => {
    renderCaptureScan();

    await waitFor(() => {
      expect(mockCameraGetStatus).toHaveBeenCalled();
    });

    // The link lives inside the collapsible "Camera Settings" panel
    const toggle = await screen.findByText(/Camera Settings/);
    fireEvent.click(toggle);

    const link = await screen.findByText('Go to Camera Settings →');
    expect(link.className).toContain('text-lime-700');
    expect(link.className).toContain('hover:text-lime-800');
    expect(link.className).not.toMatch(/text-blue-600|hover:text-blue-800/);
  });

  it('leaves the amber warning banners and green Start Scan button unchanged (regression guard)', async () => {
    mockCheckIdleReset.mockResolvedValue(true);
    renderCaptureScan();

    await waitFor(() => {
      expect(screen.getByTestId('idle-reset-notification')).toBeInTheDocument();
    });
    expect(screen.getByTestId('idle-reset-notification').className).toContain(
      'bg-amber-50'
    );

    const startButton = screen.getByText(/Start Scan|Scanning/);
    expect(startButton.className).toMatch(/bg-green-600|bg-gray-300/);
  });
});
