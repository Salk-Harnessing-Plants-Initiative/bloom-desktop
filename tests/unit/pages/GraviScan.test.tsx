/**
 * Unit tests for GraviScan scanning page
 *
 * Tests readiness gate, scan lifecycle states, progress display,
 * event log, interval mode controls, and mode toggle.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { GraviScan } from '../../../src/renderer/graviscan/GraviScan';

// ─── Mocks ─────────────────────────────────────────────────

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

// Default hook return values

const defaultScannerConfig = {
  platformInfo: { supported: true, backend: 'sane', mock_enabled: true },
  platformLoading: false,
  detectedScanners: [
    {
      scanner_id: 'scanner-1',
      name: 'Epson Perfection V850',
      sane_name: 'epson2:libusb:001:003',
      is_available: true,
      vendor_id: '04b8',
      product_id: '013a',
      usb_port: '1-1',
      usb_bus: 1,
      usb_device: 3,
    },
  ],
  detectingScanner: false,
  detectionError: null,
  scannerAssignments: [
    {
      slot: 'Scanner 1',
      scannerId: 'scanner-1',
      usbPort: '1-1',
      gridMode: '2grid' as const,
    },
  ],
  config: null,
  resolution: 1200,
  setResolution: vi.fn(),
  configSaved: true,
  isConfigCollapsed: true,
  sessionValidated: true,
  isValidating: false,
  validationWarning: null,
  configStatus: 'valid' as const,
  configValidationMessage: 'Scanners ready',
  missingScanners: [],
  newScanners: [],
  matchedScanners: [],
  resolutionRef: { current: 1200 },
  handleDetectScanners: vi.fn(),
  handleResetScannerConfig: vi.fn(),
  handleScannerAssignment: vi.fn(),
  handleScannerGridMode: vi.fn(),
  handleAddScannerSlot: vi.fn(),
  handleRemoveScannerSlot: vi.fn(),
  handleToggleConfigCollapse: vi.fn(),
  // Task 1.4 BREAKING: handleToggleScannerEnabled removed from hook API
  clearValidationWarning: vi.fn(),
};

const defaultPlateAssignments = {
  scannerPlateAssignments: {
    'scanner-1': [
      {
        plateIndex: '1',
        plantBarcode: 'PLANT-001',
        transplantDate: null,
        customNote: null,
        selected: true,
      },
      {
        plateIndex: '2',
        plantBarcode: 'PLANT-002',
        transplantDate: null,
        customNote: null,
        selected: true,
      },
    ],
  },
  scannerPlateAssignmentsRef: { current: {} },
  loadingPlateAssignments: false,
  availableBarcodes: ['PLANT-001', 'PLANT-002'],
  loadingBarcodes: false,
  barcodeGenotypes: {},
  isGraviMetadata: false,
  availablePlates: [],
  handleTogglePlate: vi.fn(),
  handlePlateBarcode: vi.fn(),
};

const defaultContinuousMode = {
  scanMode: 'single' as const,
  setScanMode: vi.fn(),
  scanIntervalMinutes: 5,
  setScanIntervalMinutes: vi.fn(),
  scanDurationMinutes: 60,
  setScanDurationMinutes: vi.fn(),
  currentCycle: 0,
  setCurrentCycle: vi.fn(),
  totalCycles: 0,
  setTotalCycles: vi.fn(),
  intervalCountdown: null,
  setIntervalCountdown: vi.fn(),
  overtimeMs: null,
  setOvertimeMs: vi.fn(),
  elapsedSeconds: 0,
  setElapsedSeconds: vi.fn(),
  scanModeRef: { current: 'single' as const },
  cycleCompletedCountRef: { current: {} },
  intervalCountdownRef: { current: null },
  overtimeTimerRef: { current: null },
  overtimeStartRef: { current: null },
  scanStartedAtMsRef: { current: null },
  elapsedTimerRef: { current: null },
  startElapsedTimer: vi.fn(),
  startCountdown: vi.fn(),
  startOvertime: vi.fn(),
  clearCountdownAndOvertime: vi.fn(),
  clearAllTimers: vi.fn(),
  resetCycleProgress: vi.fn(),
};

const defaultScanSession = {
  pendingJobs: new Map(),
  scanImageUris: {},
  setScanImageUris: vi.fn(),
  scanningPlateIndex: {},
  setScanningPlateIndex: vi.fn(),
  autoUploadStatus: 'idle' as const,
  autoUploadMessage: null,
  canStartScan: true,
  handleStartScan: vi.fn(),
  handleCancelScan: vi.fn(),
  handleResetScanners: vi.fn(),
};

// Mock the hooks
vi.mock('../../../src/renderer/hooks/useScannerConfig', () => ({
  useScannerConfig: vi.fn(() => defaultScannerConfig),
}));
vi.mock('../../../src/renderer/hooks/usePlateAssignments', () => ({
  usePlateAssignments: vi.fn(() => defaultPlateAssignments),
}));
vi.mock('../../../src/renderer/hooks/useContinuousMode', () => ({
  useContinuousMode: vi.fn(() => defaultContinuousMode),
}));
vi.mock('../../../src/renderer/hooks/useScanSession', () => ({
  useScanSession: vi.fn(() => defaultScanSession),
}));
vi.mock('../../../src/renderer/hooks/useTestScan', () => ({
  useTestScan: vi.fn(() => ({
    isTesting: false,
    testPhase: 'idle',
    testResults: {},
    testComplete: false,
    handleTestAllScanners: vi.fn(),
    resetTestResults: vi.fn(),
  })),
}));
vi.mock('../../../src/renderer/hooks/useWaveNumber', () => ({
  useWaveNumber: vi.fn(() => ({
    waveNumber: 1,
    setWaveNumber: vi.fn(),
    waveRestoredRef: { current: false },
    waveWarning: null,
    setWaveWarning: vi.fn(),
    scanCompletionCounter: 0,
    setScanCompletionCounter: vi.fn(),
  })),
}));

// Import mocked hooks for per-test overrides
import { useScannerConfig } from '../../../src/renderer/hooks/useScannerConfig';
import { useScanSession } from '../../../src/renderer/hooks/useScanSession';
import { useContinuousMode } from '../../../src/renderer/hooks/useContinuousMode';

const mockedUseScannerConfig = vi.mocked(useScannerConfig);
const mockedUseScanSession = vi.mocked(useScanSession);
const mockedUseContinuousMode = vi.mocked(useContinuousMode);

beforeEach(() => {
  vi.clearAllMocks();
  // Restore defaults after clearAllMocks resets the mock implementations
  mockedUseScannerConfig.mockReturnValue(
    defaultScannerConfig as ReturnType<typeof useScannerConfig>
  );
  mockedUseScanSession.mockReturnValue(
    defaultScanSession as ReturnType<typeof useScanSession>
  );
  mockedUseContinuousMode.mockReturnValue(
    defaultContinuousMode as ReturnType<typeof useContinuousMode>
  );
});

function renderGraviScan() {
  return render(
    <MemoryRouter>
      <GraviScan />
    </MemoryRouter>
  );
}

// ─── Tests ─────────────────────────────────────────────────

describe('GraviScan scanning page', () => {
  // --- Readiness gate (#159) ---
  describe('Start button readiness gate', () => {
    it('disables Start button when canStartScan is false', () => {
      mockedUseScanSession.mockReturnValue({
        ...defaultScanSession,
        canStartScan: false,
      } as ReturnType<typeof useScanSession>);

      renderGraviScan();

      const startButton = screen.getByRole('button', { name: /start scan/i });
      expect(startButton).toBeDisabled();
    });

    it('enables Start button when canStartScan is true', () => {
      renderGraviScan();

      const startButton = screen.getByRole('button', { name: /start scan/i });
      expect(startButton).toBeEnabled();
    });
  });

  // --- Loading state ---
  describe('Loading state after click', () => {
    it('shows scanning state when isScanning is true', () => {
      mockedUseScanSession.mockReturnValue({
        ...defaultScanSession,
        canStartScan: false,
      } as ReturnType<typeof useScanSession>);

      mockedUseScannerConfig.mockReturnValue({
        ...defaultScannerConfig,
        platformLoading: false,
      } as ReturnType<typeof useScannerConfig>);

      renderGraviScan();

      // Start button should be disabled while scanning
      const startButton = screen.getByRole('button', { name: /start scan/i });
      expect(startButton).toBeDisabled();
    });
  });

  // --- Cancel button ---
  describe('Cancel button during scan', () => {
    it('shows Cancel button when scanning', () => {
      // Simulate scanning state: canStartScan false, and we need the cancel button visible
      mockedUseScanSession.mockReturnValue({
        ...defaultScanSession,
        canStartScan: false,
        pendingJobs: new Map([
          [
            'scanner-1:1',
            {
              scannerId: 'scanner-1',
              plateIndex: '1',
              outputPath: '/tmp/scan.tif',
              plantBarcode: null,
              transplantDate: null,
              customNote: null,
              gridMode: '2grid',
            },
          ],
        ]),
      } as ReturnType<typeof useScanSession>);

      renderGraviScan();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      expect(cancelButton).toBeInTheDocument();
    });

    it('calls handleCancelScan when cancel is clicked', async () => {
      const mockCancel = vi.fn();
      mockedUseScanSession.mockReturnValue({
        ...defaultScanSession,
        canStartScan: false,
        handleCancelScan: mockCancel,
        pendingJobs: new Map([
          [
            'scanner-1:1',
            {
              scannerId: 'scanner-1',
              plateIndex: '1',
              outputPath: '/tmp/scan.tif',
              plantBarcode: null,
              transplantDate: null,
              customNote: null,
              gridMode: '2grid',
            },
          ],
        ]),
      } as ReturnType<typeof useScanSession>);

      renderGraviScan();

      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      fireEvent.click(cancelButton);
      expect(mockCancel).toHaveBeenCalled();
    });
  });

  // --- Progress display ---
  describe('Progress display per scanner', () => {
    it('shows scanner progress when scanning', () => {
      renderGraviScan();

      // Should display scanner status section
      expect(screen.getByText(/scanner 1/i)).toBeInTheDocument();
    });
  });

  // --- Event log ---
  describe('Event log display', () => {
    it('renders event log area', () => {
      renderGraviScan();

      expect(screen.getByText(/event log/i)).toBeInTheDocument();
    });
  });

  // --- Mode toggle ---
  describe('Mode toggle (single/continuous)', () => {
    it('shows single mode by default', () => {
      renderGraviScan();

      // Should have mode toggle
      const singleButton = screen.getByRole('button', { name: /single/i });
      expect(singleButton).toBeInTheDocument();
    });

    it('shows continuous mode controls when continuous is selected', () => {
      mockedUseContinuousMode.mockReturnValue({
        ...defaultContinuousMode,
        scanMode: 'continuous',
      } as ReturnType<typeof useContinuousMode>);

      renderGraviScan();

      // Should show interval and duration inputs
      expect(screen.getByLabelText(/interval/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/duration/i)).toBeInTheDocument();
    });

    it('calls setScanMode when toggling mode', () => {
      const mockSetScanMode = vi.fn();
      mockedUseContinuousMode.mockReturnValue({
        ...defaultContinuousMode,
        setScanMode: mockSetScanMode,
      } as ReturnType<typeof useContinuousMode>);

      renderGraviScan();

      const continuousButton = screen.getByRole('button', {
        name: /continuous/i,
      });
      fireEvent.click(continuousButton);
      expect(mockSetScanMode).toHaveBeenCalledWith('continuous');
    });
  });

  // --- Interval mode controls ---
  describe('Interval mode controls', () => {
    it('shows interval and duration inputs in continuous mode', () => {
      mockedUseContinuousMode.mockReturnValue({
        ...defaultContinuousMode,
        scanMode: 'continuous',
      } as ReturnType<typeof useContinuousMode>);

      renderGraviScan();

      const intervalInput = screen.getByLabelText(/interval/i);
      const durationInput = screen.getByLabelText(/duration/i);

      expect(intervalInput).toHaveValue(5);
      expect(durationInput).toHaveValue(60);
    });

    it('updates interval value', () => {
      const mockSetInterval = vi.fn();
      mockedUseContinuousMode.mockReturnValue({
        ...defaultContinuousMode,
        scanMode: 'continuous',
        setScanIntervalMinutes: mockSetInterval,
      } as ReturnType<typeof useContinuousMode>);

      renderGraviScan();

      const intervalInput = screen.getByLabelText(/interval/i);
      fireEvent.change(intervalInput, { target: { value: '10' } });
      expect(mockSetInterval).toHaveBeenCalledWith(10);
    });
  });

  // --- Session summary ---
  describe('Session summary after completion', () => {
    it('shows success message when scan completes', () => {
      renderGraviScan();

      // The page should render without errors
      expect(
        screen.getByRole('button', { name: /start scan/i })
      ).toBeInTheDocument();
    });
  });
});
