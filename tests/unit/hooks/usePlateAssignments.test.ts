import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { usePlateAssignments } from '../../../src/renderer/hooks/usePlateAssignments';
import type { ScannerAssignment } from '../../../src/types/graviscan';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = global.window as any;

// Shorthand references to mocks we configure per-test
const mockExperimentsGet = vi.fn();
const mockGetMappings = vi.fn();
const mockPlateAssignmentsList = vi.fn();
const mockPlateAssignmentsUpsertMany = vi.fn();
const mockPlateAssignmentsUpsert = vi.fn();
const mockGraviPlateAccessionsList = vi.fn();

function makeScannerAssignment(
  overrides: Partial<ScannerAssignment> = {}
): ScannerAssignment {
  return {
    slot: 'Scanner 1',
    scannerId: 'scanner-1',
    usbPort: '1-1',
    gridMode: '2grid',
    ...overrides,
  };
}

const noopSetError: React.Dispatch<React.SetStateAction<string | null>> =
  vi.fn();

beforeEach(() => {
  vi.clearAllMocks();

  // Default: experiment with accession
  mockExperimentsGet.mockResolvedValue({
    success: true,
    data: { id: 'exp-1', accession_id: 'acc-1' },
  });
  // Default: no CylScan mappings
  mockGetMappings.mockResolvedValue({ success: true, data: [] });
  // Default: no saved plate assignments
  mockPlateAssignmentsList.mockResolvedValue({ success: true, data: [] });
  mockPlateAssignmentsUpsertMany.mockResolvedValue({
    success: true,
    data: [],
  });
  mockPlateAssignmentsUpsert.mockResolvedValue({ success: true, data: {} });
  // Default: no gravi plate accessions
  mockGraviPlateAccessionsList.mockResolvedValue({ success: true, data: [] });

  // Wire mocks into the global window.electron.database
  if (win?.electron?.database) {
    win.electron.database.experiments.get = mockExperimentsGet;
    win.electron.database.accessions.getMappings = mockGetMappings;
    win.electron.database.graviscanPlateAssignments.list =
      mockPlateAssignmentsList;
    win.electron.database.graviscanPlateAssignments.upsertMany =
      mockPlateAssignmentsUpsertMany;
    win.electron.database.graviscanPlateAssignments.upsert =
      mockPlateAssignmentsUpsert;
    win.electron.database.graviPlateAccessions.list =
      mockGraviPlateAccessionsList;
  }
});

describe('usePlateAssignments', () => {
  // ---------------------------------------------------------------
  // Load plate assignments per scanner/experiment
  // ---------------------------------------------------------------
  describe('loading plate assignments', () => {
    it('loads saved plate assignments from database for each scanner', async () => {
      const dbRecords = [
        {
          plate_index: '00',
          plate_barcode: 'BC-1',
          selected: true,
          transplant_date: null,
          custom_note: null,
        },
        {
          plate_index: '01',
          plate_barcode: null,
          selected: false,
          transplant_date: null,
          custom_note: null,
        },
      ];
      mockPlateAssignmentsList.mockResolvedValue({
        success: true,
        data: dbRecords,
      });

      // Stable references to avoid infinite re-render loops in renderHook
      const scanners = [makeScannerAssignment({ scannerId: 'scanner-1' })];
      const { result } = renderHook(() =>
        usePlateAssignments({
          selectedExperiment: 'exp-1',
          scannerAssignments: scanners,
          setScanError: noopSetError,
        })
      );

      await waitFor(() => {
        expect(result.current.loadingPlateAssignments).toBe(false);
      });

      expect(mockPlateAssignmentsList).toHaveBeenCalledWith(
        'exp-1',
        'scanner-1'
      );
      const assignments = result.current.scannerPlateAssignments['scanner-1'];
      expect(assignments).toBeDefined();
      // First plate should have barcode from DB
      const plate00 = assignments.find((a) => a.plateIndex === '00');
      expect(plate00?.plantBarcode).toBe('BC-1');
      expect(plate00?.selected).toBe(true);
    });
  });

  // ---------------------------------------------------------------
  // Save via upsertMany
  // ---------------------------------------------------------------
  describe('save via upsertMany', () => {
    it('saves default plate assignments to database when none exist', async () => {
      mockPlateAssignmentsList.mockResolvedValue({ success: true, data: [] });

      const scanners = [makeScannerAssignment({ scannerId: 'scanner-1' })];
      const { result } = renderHook(() =>
        usePlateAssignments({
          selectedExperiment: 'exp-1',
          scannerAssignments: scanners,
          setScanError: noopSetError,
        })
      );

      await waitFor(() => {
        expect(result.current.loadingPlateAssignments).toBe(false);
      });

      // upsertMany should have been called with default 2grid assignments
      expect(mockPlateAssignmentsUpsertMany).toHaveBeenCalledWith(
        'exp-1',
        'scanner-1',
        expect.arrayContaining([
          expect.objectContaining({ plate_index: '00', selected: true }),
          expect.objectContaining({ plate_index: '01', selected: true }),
        ])
      );
    });
  });

  // ---------------------------------------------------------------
  // Barcode autocomplete from CylScan accession mappings
  // ---------------------------------------------------------------
  describe('barcode autocomplete', () => {
    it('loads barcodes from CylScan accession mappings', async () => {
      mockGetMappings.mockResolvedValue({
        success: true,
        data: [
          { plant_barcode: 'QR-001', accession_name: 'Col-0' },
          { plant_barcode: 'QR-002', accession_name: 'Ws-2' },
        ],
      });

      const scanners = [makeScannerAssignment()];
      const { result } = renderHook(() =>
        usePlateAssignments({
          selectedExperiment: 'exp-1',
          scannerAssignments: scanners,
          setScanError: noopSetError,
        })
      );

      await waitFor(() => {
        expect(result.current.loadingBarcodes).toBe(false);
      });

      expect(result.current.availableBarcodes).toEqual(['QR-001', 'QR-002']);
      expect(result.current.barcodeGenotypes['QR-001']).toBe('Col-0');
      expect(result.current.isGraviMetadata).toBe(false);
    });

    it('falls back to GraviScan plate accessions when no CylScan mappings', async () => {
      mockGetMappings.mockResolvedValue({ success: true, data: [] });
      mockGraviPlateAccessionsList.mockResolvedValue({
        success: true,
        data: [
          {
            id: 'gpa-1',
            plate_id: 'PLATE-001',
            accession: 'Ara-1',
            custom_note: 'note',
            sections: [
              { plate_section_id: 's1', plant_qr: 'QR-A' },
              { plate_section_id: 's2', plant_qr: 'QR-B' },
            ],
          },
        ],
      });

      const scanners = [makeScannerAssignment()];
      const { result } = renderHook(() =>
        usePlateAssignments({
          selectedExperiment: 'exp-1',
          scannerAssignments: scanners,
          setScanError: noopSetError,
        })
      );

      await waitFor(() => {
        expect(result.current.loadingBarcodes).toBe(false);
      });

      expect(result.current.isGraviMetadata).toBe(true);
      expect(result.current.availableBarcodes).toEqual(['PLATE-001']);
      expect(result.current.availablePlates).toHaveLength(1);
      expect(result.current.availablePlates[0].plate_id).toBe('PLATE-001');
      expect(result.current.barcodeGenotypes['PLATE-001']).toBe('Ara-1');
    });
  });

  // ---------------------------------------------------------------
  // Toggle plate selection
  // ---------------------------------------------------------------
  describe('handleTogglePlate', () => {
    it('toggles selected flag and persists via upsert', async () => {
      mockPlateAssignmentsList.mockResolvedValue({
        success: true,
        data: [
          {
            plate_index: '00',
            plate_barcode: null,
            selected: true,
            transplant_date: null,
            custom_note: null,
          },
          {
            plate_index: '01',
            plate_barcode: null,
            selected: true,
            transplant_date: null,
            custom_note: null,
          },
        ],
      });

      const scanners = [makeScannerAssignment({ scannerId: 'scanner-1' })];
      const { result } = renderHook(() =>
        usePlateAssignments({
          selectedExperiment: 'exp-1',
          scannerAssignments: scanners,
          setScanError: noopSetError,
        })
      );

      await waitFor(() => {
        expect(result.current.loadingPlateAssignments).toBe(false);
      });

      // Toggle plate 00 off
      act(() => {
        result.current.handleTogglePlate('scanner-1', '00');
      });

      const plate00 = result.current.scannerPlateAssignments['scanner-1'].find(
        (a) => a.plateIndex === '00'
      );
      expect(plate00?.selected).toBe(false);

      // Should persist via upsert
      expect(mockPlateAssignmentsUpsert).toHaveBeenCalledWith(
        'exp-1',
        'scanner-1',
        '00',
        { selected: false }
      );
    });
  });

  // ---------------------------------------------------------------
  // Barcode uniqueness enforcement
  // ---------------------------------------------------------------
  describe('barcode uniqueness enforcement', () => {
    it('warns and prevents duplicate barcode assignment across scanners', async () => {
      const setScanError = vi.fn();

      // Two scanners, first has BC-1 assigned to plate 00
      mockPlateAssignmentsList
        .mockResolvedValueOnce({
          success: true,
          data: [
            {
              plate_index: '00',
              plate_barcode: 'BC-1',
              selected: true,
              transplant_date: null,
              custom_note: null,
            },
            {
              plate_index: '01',
              plate_barcode: null,
              selected: true,
              transplant_date: null,
              custom_note: null,
            },
          ],
        })
        .mockResolvedValueOnce({
          success: true,
          data: [
            {
              plate_index: '00',
              plate_barcode: null,
              selected: true,
              transplant_date: null,
              custom_note: null,
            },
            {
              plate_index: '01',
              plate_barcode: null,
              selected: true,
              transplant_date: null,
              custom_note: null,
            },
          ],
        });

      const scanners = [
        makeScannerAssignment({ slot: 'Scanner 1', scannerId: 'scanner-1' }),
        makeScannerAssignment({ slot: 'Scanner 2', scannerId: 'scanner-2' }),
      ];

      const { result } = renderHook(() =>
        usePlateAssignments({
          selectedExperiment: 'exp-1',
          scannerAssignments: scanners,
          setScanError,
        })
      );

      await waitFor(() => {
        expect(result.current.loadingPlateAssignments).toBe(false);
      });

      // Try to assign same barcode BC-1 to scanner-2 plate 00
      act(() => {
        result.current.handlePlateBarcode('scanner-2', '00', 'BC-1');
      });

      expect(setScanError).toHaveBeenCalledWith(
        expect.stringContaining('BC-1')
      );

      // scanner-2 plate 00 should still be null (not assigned)
      const plate = result.current.scannerPlateAssignments['scanner-2'].find(
        (a) => a.plateIndex === '00'
      );
      expect(plate?.plantBarcode).toBeNull();
    });
  });

  // ---------------------------------------------------------------
  // Empty state — no experiment selected
  // ---------------------------------------------------------------
  describe('empty state', () => {
    it('returns empty assignments when no experiment is selected', async () => {
      const emptyScanners: ScannerAssignment[] = [];
      const { result } = renderHook(() =>
        usePlateAssignments({
          selectedExperiment: '',
          scannerAssignments: emptyScanners,
          setScanError: noopSetError,
        })
      );

      await waitFor(() => {
        expect(result.current.loadingPlateAssignments).toBe(false);
      });

      expect(result.current.scannerPlateAssignments).toEqual({});
      expect(result.current.availableBarcodes).toEqual([]);
      expect(result.current.barcodeGenotypes).toEqual({});
      expect(result.current.isGraviMetadata).toBe(false);
      expect(result.current.availablePlates).toEqual([]);
      expect(mockExperimentsGet).not.toHaveBeenCalled();
    });
  });
});
