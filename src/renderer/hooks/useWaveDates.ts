import { useCallback, useEffect, useRef, useState } from 'react';
import { validateWaveNumber } from '../../utils/metadata-validation';
import { plantAgeDays } from '../../utils/wave-dates';
import type {
  CylinderPlantDatesInput,
  CylinderPlantInfo,
  CylinderWaveCreateInput,
  CylinderWaveDateChangeInput,
  CylinderWaveInfo,
  CylinderWaveSameDatesInput,
} from '../../types/cylinder-wave';
import type { DatabaseResponse } from '../../types/database';

/** A plant's dates: "YYYY-MM-DD"; a null transfer date is the germination day. */
export interface PlantDates {
  germination_date: string;
  sowing_date: string | null;
  transfer_date: string | null;
  /** The germination colour (#429), which goes with the dates; null for none. */
  germ_day_color: string | null;
}

export interface UseWaveDatesResult {
  /** The experiment's waves, once loaded. */
  waves: CylinderWaveInfo[];
  /** The entered wave, once it's been set up (its dates, or "per plant"). */
  wave: CylinderWaveInfo | null;
  /** The entered wave number, when it is valid. */
  waveNumber: number | null;
  /** The entered wave hasn't been set up yet: it must be before scanning. */
  needsWaveDates: boolean;
  /** Still looking up the experiment's waves or the wave's plants: scanning waits. */
  loading: boolean;
  /** The waves couldn't be read: scanning waits, and the operator is told to restart. */
  loadError: string | null;
  /** The entered plant's row, when it has one (it's been scanned, or has its own dates). */
  plant: CylinderPlantInfo | null;
  /** The entered plant's dates: its own, or else its wave's. Null until they're set. */
  plantDates: PlantDates | null;
  /** The wave's dates are per plant and this plant's aren't set yet. */
  needsPlantDates: boolean;
  /** Calendar days from the plant's germination date to today. */
  calculatedAge: number | null;
  /**
   * A per-plant wave can go back to one set of dates for all its plants: before its
   * first scan, or when all its plants have the same dates.
   */
  canUseSameDates: boolean;
  /** The dates all the wave's plants share, when they do (and there are any). */
  sharedPlantDates: PlantDates | null;
  /** Make the entered wave's dates per plant, then reload. */
  useDatesPerPlant: (reason?: string) => Promise<DatabaseResponse<null>>;
  /** The entered wave's plants that have rows, most recently changed first. */
  plants: CylinderPlantInfo[];
  /** Give the entered per-plant wave one set of dates for all its plants, then reload. */
  useSameDates: (
    input: Omit<CylinderWaveSameDatesInput, 'waveId' | 'phenotyperId'>
  ) => Promise<DatabaseResponse<null>>;
  saveWave: (
    input: Omit<CylinderWaveCreateInput, 'experimentId' | 'waveNumber'>
  ) => Promise<DatabaseResponse<CylinderWaveInfo>>;
  /** Change the entered wave's dates, then reload. */
  changeDate: (
    change: Omit<CylinderWaveDateChangeInput, 'waveId' | 'phenotyperId'>
  ) => Promise<DatabaseResponse<CylinderWaveInfo>>;
  /** Set the entered plant's own dates, then reload. */
  savePlantDates: (
    input: Omit<
      CylinderPlantDatesInput,
      'waveId' | 'plantBarcode' | 'phenotyperId'
    >
  ) => Promise<DatabaseResponse<CylinderPlantInfo>>;
  /** Put the entered plant back on its wave's dates, then reload. */
  usePlantWaveDates: (
    reason?: string
  ) => Promise<DatabaseResponse<CylinderPlantInfo>>;
  /** Reload the waves and plants, e.g. after a scan so the scan counts are current. */
  reload: () => Promise<void>;
}

const NOT_READY = { success: false, error: 'Choose the wave and plant first.' };

/**
 * The entered wave and plant, their dates, and the plant age computed from the plant's
 * germination date (#407, #428).
 */
export function useWaveDates(
  experimentId: string,
  waveNumberText: string,
  plantQrCode: string,
  phenotyperId = ''
): UseWaveDatesResult {
  const [waves, setWaves] = useState<CylinderWaveInfo[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [plants, setPlants] = useState<CylinderPlantInfo[]>([]);
  const [plantsFor, setPlantsFor] = useState<string | null>(null);
  // Only the latest request's answer is used: an older one (e.g. for the
  // experiment chosen before this one) is ignored.
  const latestRequest = useRef(0);
  const latestPlantsRequest = useRef(0);

  const load = useCallback(async (id: string) => {
    const request = ++latestRequest.current;
    let rows: CylinderWaveInfo[] = [];
    let error: string | null = null;
    try {
      const result = await window.electron.database.cylinderWaves.list(id);
      if (result.success && result.data) rows = result.data;
      else error = result.error ?? 'Unknown error';
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : 'Unknown error';
    }
    if (request !== latestRequest.current) return;
    if (error) console.error('[useWaveDates] list() failed:', error);
    setWaves(rows);
    setLoadError(error);
    setLoadedFor(id);
  }, []);

  const loadPlants = useCallback(async (waveId: string) => {
    const request = ++latestPlantsRequest.current;
    let rows: CylinderPlantInfo[] = [];
    let error: string | null = null;
    try {
      const result = await window.electron.database.cylinderPlants.list(waveId);
      if (result.success && result.data) rows = result.data;
      else error = result.error ?? 'Unknown error';
    } catch (thrown) {
      error = thrown instanceof Error ? thrown.message : 'Unknown error';
    }
    if (request !== latestPlantsRequest.current) return;
    if (error) console.error('[useWaveDates] plants list() failed:', error);
    setPlants(rows);
    if (error) setLoadError(error);
    setPlantsFor(waveId);
  }, []);

  useEffect(() => {
    setWaves([]);
    setLoadedFor(null);
    setLoadError(null);
    if (experimentId) void load(experimentId);
  }, [experimentId, load]);

  const parsed = validateWaveNumber(waveNumberText);
  const waveNumber = parsed.isValid ? parsed.value! : null;
  const ready = Boolean(experimentId) && waveNumber !== null;
  const wave = ready
    ? (waves.find((w) => w.wave_number === waveNumber) ?? null)
    : null;
  const waveId = wave?.id ?? null;

  useEffect(() => {
    setPlants([]);
    setPlantsFor(null);
    if (waveId) void loadPlants(waveId);
  }, [waveId, loadPlants]);

  const loading =
    ready &&
    (loadedFor !== experimentId || (waveId !== null && plantsFor !== waveId));
  const barcode = plantQrCode.trim();
  const plant = barcode
    ? (plants.find((p) => p.plant_barcode === barcode) ?? null)
    : null;
  const waveDates: PlantDates | null =
    wave && !wave.dates_per_plant && wave.germination_date
      ? {
          germination_date: wave.germination_date,
          sowing_date: wave.sowing_date,
          transfer_date: wave.transfer_date,
          germ_day_color: wave.germ_day_color,
        }
      : null;
  const plantDates = plant ?? waveDates;
  const calculatedAge = plantDates
    ? plantAgeDays(plantDates.germination_date, new Date())
    : null;
  const first = plants[0];
  const sharedPlantDates: PlantDates | null =
    first &&
    plants.every(
      (p) =>
        p.germination_date === first.germination_date &&
        p.sowing_date === first.sowing_date &&
        p.transfer_date === first.transfer_date &&
        p.germ_day_color === first.germ_day_color
    )
      ? {
          germination_date: first.germination_date,
          sowing_date: first.sowing_date,
          transfer_date: first.transfer_date,
          germ_day_color: first.germ_day_color,
        }
      : null;
  const canUseSameDates =
    Boolean(wave?.dates_per_plant) &&
    (wave?.scanCount === 0 || sharedPlantDates !== null);

  const reload = useCallback(async () => {
    if (experimentId) await load(experimentId);
    if (waveId) await loadPlants(waveId);
  }, [experimentId, waveId, load, loadPlants]);

  const useDatesPerPlant = useCallback<UseWaveDatesResult['useDatesPerPlant']>(
    async (reason) => {
      if (!wave)
        return { success: false, error: 'This wave has no dates yet.' };
      const result =
        await window.electron.database.cylinderWaves.useDatesPerPlant({
          waveId: wave.id,
          reason,
          phenotyperId,
        });
      if (result.success) await reload();
      return result;
    },
    [wave, phenotyperId, reload]
  );

  const useSameDates = useCallback<UseWaveDatesResult['useSameDates']>(
    async (input) => {
      if (!wave)
        return { success: false, error: 'This wave has no dates yet.' };
      const result = await window.electron.database.cylinderWaves.useSameDates({
        ...input,
        waveId: wave.id,
        phenotyperId,
      });
      if (result.success) await reload();
      return result;
    },
    [wave, phenotyperId, reload]
  );

  const saveWave = useCallback<UseWaveDatesResult['saveWave']>(
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

  const changeDate = useCallback<UseWaveDatesResult['changeDate']>(
    async (change) => {
      if (!wave)
        return { success: false, error: 'This wave has no dates yet.' };
      const result = await window.electron.database.cylinderWaves.changeDates({
        ...change,
        waveId: wave.id,
        phenotyperId,
      });
      if (result.success) await reload();
      return result;
    },
    [wave, phenotyperId, reload]
  );

  const savePlantDates = useCallback<UseWaveDatesResult['savePlantDates']>(
    async (input) => {
      if (!wave || !barcode) return NOT_READY;
      const result = await window.electron.database.cylinderPlants.setDates({
        ...input,
        waveId: wave.id,
        plantBarcode: barcode,
        phenotyperId,
      });
      if (result.success) await reload();
      return result;
    },
    [wave, barcode, phenotyperId, reload]
  );

  const usePlantWaveDates = useCallback<
    UseWaveDatesResult['usePlantWaveDates']
  >(
    async (reason) => {
      if (!wave || !barcode) return NOT_READY;
      const result = await window.electron.database.cylinderPlants.useWaveDates(
        {
          waveId: wave.id,
          plantBarcode: barcode,
          reason,
          phenotyperId,
        }
      );
      if (result.success) await reload();
      return result;
    },
    [wave, barcode, phenotyperId, reload]
  );

  return {
    waves,
    wave,
    waveNumber,
    // A failed read isn't "no dates": the operator is told to restart instead.
    needsWaveDates: ready && !loading && !loadError && wave === null,
    loading,
    loadError: ready ? loadError : null,
    plant,
    plantDates,
    needsPlantDates:
      Boolean(wave?.dates_per_plant) && !loading && !!barcode && plant === null,
    calculatedAge,
    canUseSameDates,
    sharedPlantDates,
    useSameDates,
    useDatesPerPlant,
    plants,
    saveWave,
    changeDate,
    savePlantDates,
    usePlantWaveDates,
    reload,
  };
}
