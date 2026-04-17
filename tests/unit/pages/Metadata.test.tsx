/**
 * Unit tests for Metadata page (GraviScan Section 10)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock navigate
const mockNavigate = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Mock usePlateAssignments
const mockHandleTogglePlate = vi.fn();
const mockHandlePlateBarcode = vi.fn();
const defaultPlateAssignmentsReturn = {
  scannerPlateAssignments: {
    'scanner-1': [
      {
        plateIndex: '00',
        plantBarcode: null,
        transplantDate: null,
        customNote: null,
        selected: true,
      },
      {
        plateIndex: '01',
        plantBarcode: null,
        transplantDate: null,
        customNote: null,
        selected: true,
      },
    ],
  },
  scannerPlateAssignmentsRef: { current: {} },
  loadingPlateAssignments: false,
  availableBarcodes: ['PLATE_001', 'PLATE_002'],
  loadingBarcodes: false,
  barcodeGenotypes: {},
  isGraviMetadata: false,
  availablePlates: [],
  handleTogglePlate: mockHandleTogglePlate,
  handlePlateBarcode: mockHandlePlateBarcode,
};

let mockPlateAssignmentsReturn = { ...defaultPlateAssignmentsReturn };

vi.mock('../../../src/renderer/hooks/usePlateAssignments', () => ({
  usePlateAssignments: () => mockPlateAssignmentsReturn,
}));

// Mock useWaveNumber
const mockSetWaveNumber = vi.fn();
const defaultWaveNumberReturn = {
  waveNumber: 3,
  setWaveNumber: mockSetWaveNumber,
  suggestedWaveNumber: 3,
  barcodeWaveConflicts: {},
  waveRestoredRef: { current: false },
};

let mockWaveNumberReturn = { ...defaultWaveNumberReturn };

vi.mock('../../../src/renderer/hooks/useWaveNumber', () => ({
  useWaveNumber: () => mockWaveNumberReturn,
}));

// Import after mocks
import { Metadata } from '../../../src/renderer/graviscan/Metadata';

// Helper to set up gravi.getConfig mock with a valid config
function setGraviConfig(gridMode: '2grid' | '4grid' = '2grid') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).electron.gravi.getConfig = vi.fn().mockResolvedValue({
    success: true,
    config: {
      id: 'cfg-1',
      grid_mode: gridMode,
      resolution: 1200,
      format: 'tiff',
      usb_signature: null,
      updatedAt: new Date(),
    },
  });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <Metadata />
    </MemoryRouter>
  );
}

describe('Metadata page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPlateAssignmentsReturn = { ...defaultPlateAssignmentsReturn };
    mockWaveNumberReturn = { ...defaultWaveNumberReturn };

    // Default: valid config exists
    setGraviConfig('2grid');

    // Mock experiment/phenotyper list calls
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).electron.database.experiments.list = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: [
          {
            id: 'exp-1',
            name: 'GraviExperiment',
            species: 'Arabidopsis',
            accession_id: null,
          },
        ],
      });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).electron.database.phenotypers.list = vi
      .fn()
      .mockResolvedValue({
        success: true,
        data: [{ id: 'phen-1', name: 'Jane Doe' }],
      });
  });

  it('loads config and shows page heading', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/metadata/i)).toBeInTheDocument();
    });
  });

  it('shows experiment dropdown populated from database', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText(/experiment/i)).toBeInTheDocument();
    });
    expect(screen.getByText('GraviExperiment')).toBeInTheDocument();
  });

  it('shows phenotyper dropdown populated from database', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText(/phenotyper/i)).toBeInTheDocument();
    });
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
  });

  it('shows wave number with auto-increment', async () => {
    renderPage();
    await waitFor(() => {
      const waveInput = screen.getByLabelText(/wave/i);
      expect(waveInput).toBeInTheDocument();
      expect(waveInput).toHaveValue(3);
    });
  });

  it('renders PlateGridEditor with correct plate count for 2grid (2)', async () => {
    renderPage();
    await waitFor(() => {
      // 2grid has plates "00" and "01"
      expect(screen.getByText(/A\(00\)/)).toBeInTheDocument();
      expect(screen.getByText(/B\(01\)/)).toBeInTheDocument();
    });
  });

  it('renders PlateGridEditor with correct plate count for 4grid (4)', async () => {
    setGraviConfig('4grid');
    mockPlateAssignmentsReturn = {
      ...defaultPlateAssignmentsReturn,
      scannerPlateAssignments: {
        'scanner-1': [
          {
            plateIndex: '00',
            plantBarcode: null,
            transplantDate: null,
            customNote: null,
            selected: true,
          },
          {
            plateIndex: '01',
            plantBarcode: null,
            transplantDate: null,
            customNote: null,
            selected: true,
          },
          {
            plateIndex: '10',
            plantBarcode: null,
            transplantDate: null,
            customNote: null,
            selected: true,
          },
          {
            plateIndex: '11',
            plantBarcode: null,
            transplantDate: null,
            customNote: null,
            selected: true,
          },
        ],
      },
    };
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/A\(00\)/)).toBeInTheDocument();
      expect(screen.getByText(/B\(01\)/)).toBeInTheDocument();
      expect(screen.getByText(/C\(10\)/)).toBeInTheDocument();
      expect(screen.getByText(/D\(11\)/)).toBeInTheDocument();
    });
  });

  it('Continue button navigates to /graviscan', async () => {
    renderPage();
    await waitFor(() => {
      const continueBtn = screen.getByRole('button', { name: /continue/i });
      expect(continueBtn).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(mockNavigate).toHaveBeenCalledWith('/graviscan');
  });

  it('shows redirect message when no config exists', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).electron.gravi.getConfig = vi.fn().mockResolvedValue({
      success: true,
      config: null,
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/configure scanners first/i)).toBeInTheDocument();
    });
  });

  it('handles toggle plate via PlateGridEditor', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/A\(00\)/)).toBeInTheDocument();
    });
    // Click the checkbox for plate A(00)
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(mockHandleTogglePlate).toHaveBeenCalled();
  });
});
