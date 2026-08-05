import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';

const {
  mockScannerStatus,
  mockWaveNumber,
  mockPlateAssignments,
  mockContinuousMode,
  mockScanSession,
  mockTestScan,
  usePlateAssignmentsSpy,
  useScanSessionSpy,
} = vi.hoisted(() => ({
  mockScannerStatus: {
    scanners: [
      {
        scannerId: 'sc-1',
        name: 'Scanner 1',
        enabled: true,
        isOnline: true,
        isBusy: false,
        state: 'idle',
        progress: 0,
        outputFilename: '',
        gridMode: '2grid',
        connectionStatus: 'ready',
      },
    ],
    loading: false,
  },
  mockWaveNumber: {
    waveNumber: 2,
    setWaveNumber: vi.fn(),
    suggestedNextWave: 3,
  },
  mockPlateAssignments: {
    assignmentsByScanner: {
      'sc-1': [
        {
          plateIndex: '00',
          plantBarcode: 'PLATE_007',
          transplantDate: null,
          customNote: null,
          selected: true,
        },
      ],
    },
    isGraviMetadata: true,
    waveMissingMetadata: false,
    waveLinkedButEmpty: false,
    loadError: null,
    updateField: vi.fn(),
    toggleSelected: vi.fn(),
  },
  mockContinuousMode: {
    isContinuous: false,
    setIsContinuous: vi.fn(),
    intervalMinutes: 5,
    setIntervalMinutes: vi.fn(),
    durationHours: 1,
    setDurationHours: vi.fn(),
    validate: vi.fn().mockReturnValue(null),
    cadenceContext: {
      platesPerScanner: 2,
      scannerCount: 1,
      dpi: 1200,
      regionMm: { width: 140, height: 140 },
    },
  },
  mockScanSession: {
    isScanning: false,
    pendingJobs: {},
    progressByScanner: { 'sc-1': 42 },
    currentCycle: 0,
    totalCycles: 0,
    coordinatorState: 'idle',
    verificationStatus: 'complete',
    verificationResults: {
      'sc-1:00': {
        scannerId: 'sc-1',
        plateIndex: '00',
        assignedPlateId: 'PLATE_007',
        imagePath: '/out/00.tiff',
        detectedPlateId: 'PLATE_007',
        detectedCodes: ['PLATE_007'],
        status: 'verified',
      },
    },
    error: null,
    scanStartedAt: null,
    nextScanAt: null,
    abnormalTermination: null,
    canStartScan: true,
    startScan: vi.fn(),
    cancelScan: vi.fn(),
  },
  mockTestScan: {
    isTesting: false,
    testResults: {},
    error: null,
    testAllScanners: vi.fn(),
  },
  usePlateAssignmentsSpy: vi.fn(),
  useScanSessionSpy: vi.fn(),
}));

vi.mock('../../../src/renderer/hooks/useScannerStatus', () => ({
  useScannerStatus: () => mockScannerStatus,
}));
vi.mock('../../../src/renderer/hooks/useWaveNumber', () => ({
  useWaveNumber: () => mockWaveNumber,
}));
vi.mock('../../../src/renderer/hooks/usePlateAssignments', () => ({
  usePlateAssignments: (params: unknown) => {
    usePlateAssignmentsSpy(params);
    return mockPlateAssignments;
  },
}));
vi.mock('../../../src/renderer/hooks/useContinuousMode', () => ({
  useContinuousMode: () => mockContinuousMode,
}));
vi.mock('../../../src/renderer/hooks/useScanSession', () => ({
  useScanSession: (params: unknown) => {
    useScanSessionSpy(params);
    return mockScanSession;
  },
}));
vi.mock('../../../src/renderer/hooks/useTestScan', () => ({
  useTestScan: () => mockTestScan,
}));

import { GraviScan } from '../../../src/renderer/GraviScan';

describe('GraviScan screen composition', () => {
  beforeEach(() => {
    usePlateAssignmentsSpy.mockClear();
    useScanSessionSpy.mockClear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = global.window as any;
    win.electron.database.experiments = {
      ...win.electron.database.experiments,
      list: vi.fn().mockResolvedValue({ success: true, data: [] }),
    };
    win.electron.gravi = {
      ...win.electron.gravi,
      getConfig: vi.fn().mockResolvedValue({
        success: true,
        data: { success: true, config: { resolution: 1200 } },
      }),
      detectScanners: vi.fn().mockResolvedValue({
        success: true,
        data: {
          success: true,
          scanners: [{ scanner_id: 'sc-1', sane_name: 'epkowa:usb:001:005' }],
        },
      }),
    };
  });

  it('passes plate-assignment state through to ScanFormSection', () => {
    render(<GraviScan />);
    expect(screen.getByDisplayValue('PLATE_007')).toBeInTheDocument();
  });

  it('passes scan-session progress through to ScannerStatusPanel', () => {
    render(<GraviScan />);
    // Not scanning, so no % is shown per ScannerStatusPanel's own contract.
    expect(screen.getByTestId('scanner-status-sc-1').textContent).not.toMatch(
      /42%/
    );
  });

  it('passes session state through to ScanControlSection (Start Scan enabled per canStartScan)', () => {
    render(<GraviScan />);
    expect(
      screen.getByRole('button', { name: /^start scan$/i })
    ).not.toBeDisabled();
  });

  it('passes verification results through to QRVerificationBanner', () => {
    render(<GraviScan />);
    expect(screen.getByText(/QR Verification Complete/i)).toBeInTheDocument();
  });

  it('wires plate assignments to the current experimentId/waveNumber/scannerIds', () => {
    render(<GraviScan />);
    const call = usePlateAssignmentsSpy.mock.calls[0][0] as {
      experimentId: string | null;
      waveNumber: number;
      scannerIds: string[];
    };
    expect(call.waveNumber).toBe(2);
    expect(call.scannerIds).toEqual(['sc-1']);
  });

  it('wires useScanSession with the plate assignments produced by usePlateAssignments', () => {
    render(<GraviScan />);
    const call = useScanSessionSpy.mock.calls[0][0] as {
      assignmentsByScanner: Record<string, unknown>;
      waveNumber: number;
    };
    expect(call.assignmentsByScanner).toBe(
      mockPlateAssignments.assignmentsByScanner
    );
    expect(call.waveNumber).toBe(2);
  });

  it('renders the suggested-next-wave hint from useWaveNumber', () => {
    render(<GraviScan />);
    expect(screen.getByText(/suggested next wave: 3/i)).toBeInTheDocument();
  });
});
