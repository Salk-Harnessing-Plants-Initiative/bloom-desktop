import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWaveNumber } from '../../../src/renderer/hooks/useWaveNumber';
import type { PlateAssignment } from '../../../src/types/graviscan';

// Access the global mocks from setup.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const win = global.window as any;
const mockGetMaxWaveNumber = vi.fn();
const mockCheckBarcodeUniqueInWave = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockGetMaxWaveNumber.mockResolvedValue({ success: true, data: 0 });
  mockCheckBarcodeUniqueInWave.mockResolvedValue({
    success: true,
    data: true,
  });

  if (win?.electron?.database?.graviscans) {
    win.electron.database.graviscans.getMaxWaveNumber = mockGetMaxWaveNumber;
    win.electron.database.graviscans.checkBarcodeUniqueInWave =
      mockCheckBarcodeUniqueInWave;
  }
});

const emptyAssignments: Record<string, PlateAssignment[]> = {};

function makePlateAssignment(
  overrides: Partial<PlateAssignment> = {}
): PlateAssignment {
  return {
    plateIndex: '00',
    plantBarcode: null,
    transplantDate: null,
    customNote: null,
    selected: false,
    ...overrides,
  };
}

describe('useWaveNumber', () => {
  describe('wave auto-increment from DB max', () => {
    it('sets waveNumber to max+1 when DB returns a max wave number', async () => {
      mockGetMaxWaveNumber.mockResolvedValue({ success: true, data: 3 });

      const { result } = renderHook(() =>
        useWaveNumber({
          selectedExperiment: 'exp-1',
          scannerPlateAssignments: emptyAssignments,
          scanCompletionCounter: 0,
        })
      );

      await waitFor(() => {
        expect(result.current.waveNumber).toBe(4);
      });

      expect(result.current.suggestedWaveNumber).toBe(4);
      expect(mockGetMaxWaveNumber).toHaveBeenCalledWith('exp-1');
    });

    it('sets waveNumber to 0 when DB returns unsuccessful result', async () => {
      mockGetMaxWaveNumber.mockResolvedValue({ success: false });

      const { result } = renderHook(() =>
        useWaveNumber({
          selectedExperiment: 'exp-1',
          scannerPlateAssignments: emptyAssignments,
          scanCompletionCounter: 0,
        })
      );

      await waitFor(() => {
        expect(result.current.suggestedWaveNumber).toBe(0);
      });

      expect(result.current.waveNumber).toBe(0);
    });

    it('resets to 0 when no experiment is selected', async () => {
      mockGetMaxWaveNumber.mockResolvedValue({ success: true, data: 5 });

      const { result } = renderHook(() =>
        useWaveNumber({
          selectedExperiment: '',
          scannerPlateAssignments: emptyAssignments,
          scanCompletionCounter: 0,
        })
      );

      // Should not call DB at all
      expect(mockGetMaxWaveNumber).not.toHaveBeenCalled();
      expect(result.current.waveNumber).toBe(0);
      expect(result.current.suggestedWaveNumber).toBeNull();
    });
  });

  describe('suggested wave number updates when experiment changes', () => {
    it('re-fetches max wave on experiment change', async () => {
      mockGetMaxWaveNumber
        .mockResolvedValueOnce({ success: true, data: 2 })
        .mockResolvedValueOnce({ success: true, data: 7 });

      const { result, rerender } = renderHook(
        (props) =>
          useWaveNumber({
            selectedExperiment: props.exp,
            scannerPlateAssignments: emptyAssignments,
            scanCompletionCounter: 0,
          }),
        { initialProps: { exp: 'exp-A' } }
      );

      await waitFor(() => {
        expect(result.current.waveNumber).toBe(3);
      });

      rerender({ exp: 'exp-B' });

      await waitFor(() => {
        expect(result.current.waveNumber).toBe(8);
      });

      expect(result.current.suggestedWaveNumber).toBe(8);
      expect(mockGetMaxWaveNumber).toHaveBeenCalledTimes(2);
    });
  });

  describe('barcode uniqueness check per wave', () => {
    it('calls checkBarcodeUniqueInWave for selected barcodes', async () => {
      mockGetMaxWaveNumber.mockResolvedValue({ success: true, data: 1 });
      mockCheckBarcodeUniqueInWave.mockResolvedValue({
        success: true,
        data: true, // unique
      });

      const assignments: Record<string, PlateAssignment[]> = {
        'scanner-1': [
          makePlateAssignment({
            plateIndex: '00',
            plantBarcode: 'BC-001',
            selected: true,
          }),
        ],
      };

      renderHook(() =>
        useWaveNumber({
          selectedExperiment: 'exp-1',
          scannerPlateAssignments: assignments,
          scanCompletionCounter: 0,
        })
      );

      await waitFor(() => {
        expect(mockCheckBarcodeUniqueInWave).toHaveBeenCalledWith({
          experiment_id: 'exp-1',
          wave_number: 2, // max(1) + 1
          plate_barcode: 'BC-001',
        });
      });
    });

    it('does not check barcodes when no experiment selected', async () => {
      const assignments: Record<string, PlateAssignment[]> = {
        'scanner-1': [
          makePlateAssignment({
            plateIndex: '00',
            plantBarcode: 'BC-001',
            selected: true,
          }),
        ],
      };

      renderHook(() =>
        useWaveNumber({
          selectedExperiment: '',
          scannerPlateAssignments: assignments,
          scanCompletionCounter: 0,
        })
      );

      // Give effects time to run
      await waitFor(() => {
        expect(mockCheckBarcodeUniqueInWave).not.toHaveBeenCalled();
      });
    });
  });

  describe('conflict detection and display', () => {
    it('populates barcodeWaveConflicts when barcode is a duplicate', async () => {
      mockGetMaxWaveNumber.mockResolvedValue({ success: true, data: 1 });
      // data: false means NOT unique (duplicate exists)
      mockCheckBarcodeUniqueInWave.mockResolvedValue({
        success: true,
        data: false,
      });

      const assignments: Record<string, PlateAssignment[]> = {
        'scanner-1': [
          makePlateAssignment({
            plateIndex: '00',
            plantBarcode: 'BC-DUP',
            selected: true,
          }),
        ],
      };

      const { result } = renderHook(() =>
        useWaveNumber({
          selectedExperiment: 'exp-1',
          scannerPlateAssignments: assignments,
          scanCompletionCounter: 0,
        })
      );

      await waitFor(() => {
        expect(Object.keys(result.current.barcodeWaveConflicts).length).toBe(1);
      });

      expect(result.current.barcodeWaveConflicts['00']).toContain('BC-DUP');
      expect(result.current.barcodeWaveConflicts['00']).toContain('wave 2');
    });

    it('clears conflicts when all barcodes are unique', async () => {
      mockGetMaxWaveNumber.mockResolvedValue({ success: true, data: 0 });
      mockCheckBarcodeUniqueInWave.mockResolvedValue({
        success: true,
        data: true, // unique
      });

      const assignments: Record<string, PlateAssignment[]> = {
        'scanner-1': [
          makePlateAssignment({
            plateIndex: '00',
            plantBarcode: 'BC-OK',
            selected: true,
          }),
        ],
      };

      const { result } = renderHook(() =>
        useWaveNumber({
          selectedExperiment: 'exp-1',
          scannerPlateAssignments: assignments,
          scanCompletionCounter: 0,
        })
      );

      await waitFor(() => {
        expect(mockCheckBarcodeUniqueInWave).toHaveBeenCalled();
      });

      expect(result.current.barcodeWaveConflicts).toEqual({});
    });
  });

  describe('wave restoration across navigation', () => {
    it('does not override waveNumber when waveRestoredRef is true', async () => {
      mockGetMaxWaveNumber.mockResolvedValue({ success: true, data: 5 });

      const { result, rerender } = renderHook(
        (props) =>
          useWaveNumber({
            selectedExperiment: props.exp,
            scannerPlateAssignments: emptyAssignments,
            scanCompletionCounter: 0,
          }),
        { initialProps: { exp: 'exp-1' } }
      );

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.waveNumber).toBe(6);
      });

      // Simulate navigation: user manually sets wave to 3, then sets waveRestoredRef
      act(() => {
        result.current.setWaveNumber(3);
        result.current.waveRestoredRef.current = true;
      });

      // Re-fetch from a different max
      mockGetMaxWaveNumber.mockResolvedValue({ success: true, data: 10 });

      // Trigger experiment change to re-run the effect
      rerender({ exp: 'exp-2' });

      // The suggested wave should update but waveNumber should stay at 3
      await waitFor(() => {
        expect(result.current.suggestedWaveNumber).toBe(11);
      });

      // waveNumber should NOT be overridden to 11
      expect(result.current.waveNumber).toBe(3);
    });

    it('resets waveRestoredRef after restoration', async () => {
      mockGetMaxWaveNumber.mockResolvedValue({ success: true, data: 2 });

      const { result, rerender } = renderHook(
        (props) =>
          useWaveNumber({
            selectedExperiment: props.exp,
            scannerPlateAssignments: emptyAssignments,
            scanCompletionCounter: 0,
          }),
        { initialProps: { exp: 'exp-1' } }
      );

      await waitFor(() => {
        expect(result.current.waveNumber).toBe(3);
      });

      act(() => {
        result.current.waveRestoredRef.current = true;
      });

      rerender({ exp: 'exp-2' });

      await waitFor(() => {
        expect(result.current.suggestedWaveNumber).toBe(3);
      });

      // waveRestoredRef should be reset to false
      expect(result.current.waveRestoredRef.current).toBe(false);
    });
  });
});
