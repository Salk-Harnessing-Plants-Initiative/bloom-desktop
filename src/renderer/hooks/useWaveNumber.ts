import { useState, useEffect, useRef } from 'react';
import type { PlateAssignment } from '../../types/graviscan';

interface UseWaveNumberParams {
  selectedExperiment: string;
  scannerPlateAssignments: Record<string, PlateAssignment[]>;
  scanCompletionCounter: number;
}

interface UseWaveNumberReturn {
  waveNumber: number;
  setWaveNumber: React.Dispatch<React.SetStateAction<number>>;
  suggestedWaveNumber: number | null;
  barcodeWaveConflicts: Record<string, string>;
  waveRestoredRef: React.MutableRefObject<boolean>;
}

export function useWaveNumber({
  selectedExperiment,
  scannerPlateAssignments,
  scanCompletionCounter,
}: UseWaveNumberParams): UseWaveNumberReturn {
  const [waveNumber, setWaveNumber] = useState<number>(0);
  const [suggestedWaveNumber, setSuggestedWaveNumber] = useState<number | null>(
    null
  );
  const [barcodeWaveConflicts, setBarcodeWaveConflicts] = useState<
    Record<string, string>
  >({});
  const waveRestoredRef = useRef(false);

  // Auto-suggest wave number when experiment changes
  useEffect(() => {
    if (!selectedExperiment) {
      setSuggestedWaveNumber(null);
      setWaveNumber(0);
      setBarcodeWaveConflicts({});
      return;
    }
    // Skip auto-suggest if wave was restored from coordinator (active scan navigated away and back)
    if (waveRestoredRef.current) {
      waveRestoredRef.current = false;
      // Still fetch suggestion for the "Suggested: N" hint, but don't override current wave
      (async () => {
        try {
          const result =
            await window.electron.database.graviscans.getMaxWaveNumber(
              selectedExperiment
            );
          if (result.success && result.data !== undefined) {
            setSuggestedWaveNumber((result.data as number) + 1);
          }
        } catch {
          /* ignore */
        }
      })();
      return;
    }
    (async () => {
      try {
        const result =
          await window.electron.database.graviscans.getMaxWaveNumber(
            selectedExperiment
          );
        if (result.success && result.data !== undefined) {
          const next = (result.data as number) + 1;
          setSuggestedWaveNumber(next);
          setWaveNumber(next);
        } else {
          setSuggestedWaveNumber(0);
          setWaveNumber(0);
        }
      } catch (err) {
        console.warn('[GraviScan] Failed to get max wave number:', err);
        setSuggestedWaveNumber(0);
        setWaveNumber(0);
      }
    })();
  }, [selectedExperiment]);

  // Validate barcode uniqueness per wave per experiment
  useEffect(() => {
    if (!selectedExperiment) {
      setBarcodeWaveConflicts({});
      return;
    }
    const allAssignments = Object.values(scannerPlateAssignments).flat();
    const assignedBarcodes = allAssignments.filter(
      (a) => a.selected && a.plantBarcode
    );
    if (assignedBarcodes.length === 0) {
      setBarcodeWaveConflicts({});
      return;
    }

    let cancelled = false;
    (async () => {
      const conflicts: Record<string, string> = {};
      for (const assignment of assignedBarcodes) {
        try {
          const result =
            await window.electron.database.graviscans.checkBarcodeUniqueInWave({
              experiment_id: selectedExperiment,
              wave_number: waveNumber,
              plate_barcode: assignment.plantBarcode!,
            });
          // data === false means barcode is NOT unique (duplicate exists)
          if (result.success && result.data === false) {
            conflicts[assignment.plateIndex] =
              `Barcode "${assignment.plantBarcode}" already scanned in wave ${waveNumber}`;
          }
        } catch (err) {
          console.warn('[GraviScan] Barcode uniqueness check failed:', err);
        }
      }
      if (!cancelled) {
        setBarcodeWaveConflicts(conflicts);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    selectedExperiment,
    waveNumber,
    scannerPlateAssignments,
    scanCompletionCounter,
  ]);

  return {
    waveNumber,
    setWaveNumber,
    suggestedWaveNumber,
    barcodeWaveConflicts,
    waveRestoredRef,
  };
}
