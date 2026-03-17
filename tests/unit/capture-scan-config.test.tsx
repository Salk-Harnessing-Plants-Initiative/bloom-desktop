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
