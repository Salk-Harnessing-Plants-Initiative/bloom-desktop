import { useCallback, useEffect, useState } from 'react';
import { validateWaveNumber } from '../../utils/metadata-validation';
import { plantAgeDays } from '../../utils/sowing-date';
import type {
  CylinderWaveCreateInput,
  CylinderWaveInfo,
} from '../../types/cylinder-wave';
import type { DatabaseResponse } from '../../types/database';

/** An age the operator changed for one scan, with their reason. */
export interface PlantAgeChange {
  age: number;
  reason: string;
}

export interface UseWaveSowingDateResult {
  /** The experiment's waves, once loaded. */
  waves: CylinderWaveInfo[];
  /** The entered wave, when it has a sowing date. */
  wave: CylinderWaveInfo | null;
  /** The entered wave number, when it is valid. */
  waveNumber: number | null;
  /** The entered wave has no sowing date yet: it must be set before scanning. */
  needsSowingDate: boolean;
  /** Still looking up the experiment's waves: scanning waits for the answer. */
  loading: boolean;
  /** Calendar days from the wave's sowing date to today. */
  calculatedAge: number | null;
  /** The age the operator changed for this scan, if any. */
  change: PlantAgeChange | null;
  /** The age the scan will be saved with. */
  ageToUse: number | null;
  setChange: (change: PlantAgeChange | null) => void;
  saveWave: (
    input: Omit<CylinderWaveCreateInput, 'experimentId' | 'waveNumber'>
  ) => Promise<DatabaseResponse<CylinderWaveInfo>>;
  /** Change the entered wave's sowing date, then reload the waves. */
  changeDate: (
    sowingDate: string,
    reason?: string
  ) => Promise<DatabaseResponse<CylinderWaveInfo>>;
  /** Reload the waves, e.g. after a scan so the scan counts are current. */
  reload: () => Promise<void>;
}

/**
 * The entered wave's sowing date and the plant age calculated from it (#407).
 * A changed age applies to one scan: it is dropped when the experiment, wave,
 * plant or phenotyper changes, or when the caller clears it after a scan.
 */
export function useWaveSowingDate(
  experimentId: string,
  waveNumberText: string,
  plantQrCode: string,
  phenotyperId = ''
): UseWaveSowingDateResult {
  const [waves, setWaves] = useState<CylinderWaveInfo[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [change, setChange] = useState<PlantAgeChange | null>(null);

  const load = useCallback(async (id: string) => {
    try {
      const result = await window.electron.database.cylinderWaves.list(id);
      setWaves(result.success && result.data ? result.data : []);
    } catch (error) {
      console.error('[useWaveSowingDate] list() failed:', error);
      setWaves([]);
    }
    setLoadedFor(id);
  }, []);

  useEffect(() => {
    setWaves([]);
    setLoadedFor(null);
    if (experimentId) void load(experimentId);
  }, [experimentId, load]);

  useEffect(() => {
    setChange(null);
  }, [experimentId, waveNumberText, plantQrCode, phenotyperId]);

  const parsed = validateWaveNumber(waveNumberText);
  const waveNumber = parsed.isValid ? parsed.value! : null;
  const ready = Boolean(experimentId) && waveNumber !== null;
  const loading = ready && loadedFor !== experimentId;
  const wave = ready
    ? (waves.find((w) => w.wave_number === waveNumber) ?? null)
    : null;
  const calculatedAge = wave
    ? plantAgeDays(wave.sowing_date, new Date())
    : null;

  const saveWave = useCallback<UseWaveSowingDateResult['saveWave']>(
    async (input) => {
      if (!experimentId || waveNumber === null) {
        return {
          success: false,
          error: 'Choose the experiment and wave first.',
        };
      }
      const result = await window.electron.database.cylinderWaves.create({
        ...input,
        experimentId,
        waveNumber,
      });
      if (result.success) await load(experimentId);
      return result;
    },
    [experimentId, waveNumber, load]
  );

  const changeDate = useCallback<UseWaveSowingDateResult['changeDate']>(
    async (sowingDate, reason) => {
      if (!wave)
        return { success: false, error: 'This wave has no sowing date yet.' };
      const result =
        await window.electron.database.cylinderWaves.changeSowingDate({
          waveId: wave.id,
          sowingDate,
          reason,
          phenotyperId: phenotyperId || undefined,
        });
      if (result.success) await load(experimentId);
      return result;
    },
    [wave, phenotyperId, experimentId, load]
  );

  const reload = useCallback(async () => {
    if (experimentId) await load(experimentId);
  }, [experimentId, load]);

  return {
    waves,
    wave,
    waveNumber,
    needsSowingDate: ready && !loading && wave === null,
    loading,
    calculatedAge,
    change,
    ageToUse: change ? change.age : calculatedAge,
    setChange,
    saveWave,
    changeDate,
    reload,
  };
}
