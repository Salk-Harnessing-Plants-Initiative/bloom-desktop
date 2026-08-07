import { useCallback, useEffect, useState } from 'react';

export interface UseWaveNumberResult {
  waveNumber: number;
  /** Rejects negative input — the wave number is left unchanged rather
   * than accepting a value that would fail the already-accepted "Wave
   * Number Zero Validation" spec's non-negative-integer contract. */
  setWaveNumber: (value: number) => void;
  /** `getMaxWaveNumber(experimentId) + 1` — `0` for an experiment with no
   * prior GraviScan rows (`getMaxWaveNumber` returns `-1` in that case). */
  suggestedNextWave: number | null;
}

/**
 * Selected wave number for the Capture Scan screen, plus a "suggested
 * next wave" surfaced from the experiment's own scan history.
 */
export function useWaveNumber(
  experimentId: string | null
): UseWaveNumberResult {
  const [waveNumber, setWaveNumberState] = useState(0);
  const [suggestedNextWave, setSuggestedNextWave] = useState<number | null>(
    null
  );

  const setWaveNumber = useCallback((value: number) => {
    if (!Number.isInteger(value) || value < 0) return;
    setWaveNumberState(value);
  }, []);

  useEffect(() => {
    if (!experimentId) {
      setSuggestedNextWave(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const result =
        await window.electron.database.graviscans.getMaxWaveNumber(
          experimentId
        );
      if (cancelled) return;
      if (result.success) {
        setSuggestedNextWave(result.data + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [experimentId]);

  return { waveNumber, setWaveNumber, suggestedNextWave };
}
