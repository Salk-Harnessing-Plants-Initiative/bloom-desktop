import { useCallback, useMemo, useState } from 'react';
import {
  MIN_SCAN_INTERVAL_MINUTES,
  createPlateAssignments,
  type ScannerPanelState,
} from '../../types/graviscan';
import type { CadenceEstimatorInput } from '../utils/cadenceEstimator';

export interface UseContinuousModeParams {
  scannerStates: ScannerPanelState[];
  dpi: number;
  regionMm: { width: number; height: number };
}

export interface UseContinuousModeResult {
  isContinuous: boolean;
  setIsContinuous: (value: boolean) => void;
  intervalMinutes: number;
  setIntervalMinutes: (value: number) => void;
  durationMinutes: number;
  setDurationMinutes: (value: number) => void;
  /** Real-time validation error, or `null` if the current interval is
   * safe to start a continuous scan with. Checked before `startScan()`
   * is ever called — the screen does not rely solely on an upstream
   * form-level minimum-interval clamp (design.md known-bug-avoidance:
   * divide-by-zero guard). */
  validate: () => string | null;
  cadenceContext: CadenceEstimatorInput;
}

/**
 * Continuous/interval scan form state for the Capture Scan screen.
 * `cadenceContext.platesPerScanner` is derived from each assigned
 * scanner's real `gridMode` (design.md Decision 7) — the worst case
 * (max) across scanners, not a hardcoded constant.
 */
export function useContinuousMode(
  params: UseContinuousModeParams
): UseContinuousModeResult {
  const { scannerStates, dpi, regionMm } = params;

  const [isContinuous, setIsContinuous] = useState(false);
  const [intervalMinutes, setIntervalMinutes] = useState(
    MIN_SCAN_INTERVAL_MINUTES
  );
  const [durationMinutes, setDurationMinutes] = useState(60);

  const validate = useCallback((): string | null => {
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) {
      return 'Interval must be a positive number of minutes.';
    }
    return null;
  }, [intervalMinutes]);

  const cadenceContext = useMemo<CadenceEstimatorInput>(() => {
    const platesPerScanner = scannerStates.length
      ? Math.max(
          ...scannerStates.map(
            (s) =>
              createPlateAssignments(s.gridMode as '2grid' | '4grid').length
          )
        )
      : 0;
    return {
      platesPerScanner,
      scannerCount: scannerStates.length,
      dpi,
      regionMm,
    };
  }, [scannerStates, dpi, regionMm]);

  return {
    isContinuous,
    setIsContinuous,
    intervalMinutes,
    setIntervalMinutes,
    durationMinutes,
    setDurationMinutes,
    validate,
    cadenceContext,
  };
}
