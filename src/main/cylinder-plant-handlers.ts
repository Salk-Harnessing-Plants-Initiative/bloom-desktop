/**
 * CylinderScan plants and their dates (#428). Each plant in a wave (its wave plus its
 * barcode) has its own sowing, germination and transfer dates, and the plant age is
 * computed from its germination date. A plant starts with its wave's dates, created at
 * its first scan; "Different dates for this plant" sets its own, with a reason. In a
 * wave whose dates are per plant, each plant's are set before its first scan. Every set
 * and change is logged, and saved scans keep the age they were saved with.
 */

import type { IpcMain } from 'electron';
import type { DatabaseResponse } from '../types/database';
import type {
  CylinderPlantDatesInput,
  CylinderPlantInfo,
  CylinderPlantUseWaveDatesInput,
  CylinderWaveDatesPerPlantInput,
  CylinderWaveSameDatesInput,
} from '../types/cylinder-wave';
import {
  useDatesPerPlant,
  useSameDatesForAll,
} from './cylinder-wave-same-dates';
import { logPlantDates, plantDateColumns } from './cylinder-plant-log';
import {
  MAX_REASON_LENGTH,
  scannedPlantError,
  waveDatesError,
} from '../utils/wave-dates';
import {
  datesToSave,
  enteredDates,
  fail,
  phenotyperError,
  phenotyperNames,
  trimmed,
} from './cylinder-dates-common';
import type {
  CylinderWaveDbLike,
  DateColumns,
  PlantRow,
  WaveRow,
} from './cylinder-wave-db';

export interface CylinderPlantDeps {
  db: CylinderWaveDbLike;
  /** Today's date; injectable for tests. */
  now?: () => Date;
}

/** The wave's dates as a plant's, or null when the dates are per plant. */
export function waveDatesForPlants(wave: WaveRow): DateColumns | null {
  return wave.dates_per_plant || wave.germination_date === null
    ? null
    : {
        germination_date: wave.germination_date,
        sowing_date: wave.sowing_date,
        transfer_date: wave.transfer_date,
      };
}

export function sameDates(a: DateColumns, b: DateColumns): boolean {
  return (
    a.germination_date === b.germination_date &&
    a.sowing_date === b.sowing_date &&
    a.transfer_date === b.transfer_date
  );
}

/** Plants with their scan counts, who set their dates, and their change logs. */
export async function plantInfos(
  db: CylinderWaveDbLike,
  rows: PlantRow[]
): Promise<CylinderPlantInfo[]> {
  if (rows.length === 0) return [];
  const changes = await db.cylinderPlantDateChange.findMany({
    where: { plant_id: { in: rows.map((r) => r.id) } },
    orderBy: { changedAt: 'asc' },
  });
  const nameOf = await phenotyperNames(db, [
    ...rows.map((r) => r.set_by_phenotyper_id),
    ...changes.map((c) => c.changed_by_phenotyper_id),
  ]);
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      wave_id: row.wave_id,
      plant_barcode: row.plant_barcode,
      germination_date: row.germination_date,
      sowing_date: row.sowing_date,
      transfer_date: row.transfer_date,
      uses_wave_dates: row.uses_wave_dates,
      reason: row.reason,
      set_by_name: nameOf(row.set_by_phenotyper_id),
      set_at: row.updatedAt.toISOString(),
      scanCount: await db.scan.count({
        where: { cylinder_plant_id: { in: [row.id] }, deleted: false },
      }),
      changes: changes
        .filter((c) => c.plant_id === row.id)
        .map((c) => ({
          id: c.id,
          old_germination_date: c.old_germination_date,
          new_germination_date: c.new_germination_date,
          old_sowing_date: c.old_sowing_date,
          new_sowing_date: c.new_sowing_date,
          old_transfer_date: c.old_transfer_date,
          new_transfer_date: c.new_transfer_date,
          reason: c.reason,
          changed_by_name: nameOf(c.changed_by_phenotyper_id),
          changed_at: c.changedAt.toISOString(),
        })),
    }))
  );
}

/** A wave's plants, most recently changed first (Capture Scan fills a new plant's dates from the first). */
export async function listPlants(
  deps: CylinderPlantDeps,
  waveId: string
): Promise<DatabaseResponse<CylinderPlantInfo[]>> {
  if (!trimmed(waveId)) {
    return { success: false, error: 'waveId must be a non-empty string' };
  }
  try {
    const rows = await deps.db.cylinderPlant.findMany({
      where: { wave_id: { in: [waveId] } },
      orderBy: { updatedAt: 'desc' },
    });
    return { success: true, data: await plantInfos(deps.db, rows) };
  } catch (error) {
    return fail(error);
  }
}

async function findPlant(
  db: CylinderWaveDbLike,
  waveId: string,
  plantBarcode: string
): Promise<PlantRow | null> {
  return db.cylinderPlant.findUnique({
    where: {
      wave_id_plant_barcode: { wave_id: waveId, plant_barcode: plantBarcode },
    },
  });
}

/** Set a plant's own dates: "Different dates for this plant", or a plant in a per-plant wave. */
export async function setPlantDates(
  deps: CylinderPlantDeps,
  input: CylinderPlantDatesInput
): Promise<DatabaseResponse<CylinderPlantInfo>> {
  const waveId = trimmed(input?.waveId);
  const plantBarcode = trimmed(input?.plantBarcode);
  const reason = trimmed(input?.reason);
  const phenotyperId = trimmed(input?.phenotyperId);
  if (!waveId || !plantBarcode) {
    return { success: false, error: 'Choose the wave and plant first.' };
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return {
      success: false,
      error: `Keep the reason under ${MAX_REASON_LENGTH} characters.`,
    };
  }
  const dates = enteredDates(input);
  const datesError = waveDatesError(dates, (deps.now ?? (() => new Date()))());
  if (datesError) return { success: false, error: datesError };
  const toSave = datesToSave(dates);
  try {
    const wave = await deps.db.cylinderWave.findUnique({
      where: { id: waveId },
    });
    if (!wave) return { success: false, error: 'That wave no longer exists.' };
    const who = await phenotyperError(deps.db, phenotyperId);
    if (who) return { success: false, error: who };
    const plant = await findPlant(deps.db, waveId, plantBarcode);
    const waveDates = waveDatesForPlants(wave);
    // A copy: the old dates are logged after the row is written.
    const before: DateColumns | null = plant
      ? plantDateColumns(plant)
      : waveDates;
    if (before && sameDates(before, toSave)) {
      return {
        success: false,
        error: plant
          ? "Those are already this plant's dates."
          : "Those are the wave's dates already.",
      };
    }
    const [current] = plant ? await plantInfos(deps.db, [plant]) : [];
    // Once a plant has scans, its dates are final.
    if ((current?.scanCount ?? 0) > 0) {
      return { success: false, error: scannedPlantError(plantBarcode) };
    }
    // Differing from the wave needs a reason; a per-plant wave's plant doesn't.
    if (!wave.dates_per_plant && !reason) {
      return {
        success: false,
        error: "Say why this plant's dates differ from the wave's.",
      };
    }
    const data = {
      ...toSave,
      uses_wave_dates: waveDates !== null && sameDates(waveDates, toSave),
      reason: reason || null,
      set_by_phenotyper_id: phenotyperId,
    };
    const saved = await deps.db.$transaction(async (tx) => {
      const row = plant
        ? await tx.cylinderPlant.update({
            where: {
              wave_id_plant_barcode: {
                wave_id: waveId,
                plant_barcode: plantBarcode,
              },
            },
            data,
          })
        : await tx.cylinderPlant.create({
            data: { ...data, wave_id: waveId, plant_barcode: plantBarcode },
          });
      await logPlantDates(
        tx,
        row.id,
        before,
        toSave,
        reason || null,
        phenotyperId
      );
      return row;
    });
    const [info] = await plantInfos(deps.db, [saved]);
    return { success: true, data: info };
  } catch (error) {
    return fail(error);
  }
}

/** Put a plant with its own dates back on its wave's dates. */
export async function usePlantWaveDates(
  deps: CylinderPlantDeps,
  input: CylinderPlantUseWaveDatesInput
): Promise<DatabaseResponse<CylinderPlantInfo>> {
  const waveId = trimmed(input?.waveId);
  const plantBarcode = trimmed(input?.plantBarcode);
  const reason = trimmed(input?.reason);
  const phenotyperId = trimmed(input?.phenotyperId);
  try {
    const wave = await deps.db.cylinderWave.findUnique({
      where: { id: waveId },
    });
    const waveDates = wave ? waveDatesForPlants(wave) : null;
    if (!wave || !waveDates) {
      return { success: false, error: "This wave's dates are per plant." };
    }
    const plant = await findPlant(deps.db, waveId, plantBarcode);
    if (!plant || plant.uses_wave_dates) {
      return {
        success: false,
        error: "This plant already uses the wave's dates.",
      };
    }
    const who = await phenotyperError(deps.db, phenotyperId);
    if (who) return { success: false, error: who };
    // A copy: the old dates are logged after the row is updated.
    const old = plantDateColumns(plant);
    const [current] = await plantInfos(deps.db, [plant]);
    // Once a plant has scans, its dates are final.
    if (current.scanCount > 0) {
      return { success: false, error: scannedPlantError(plantBarcode) };
    }
    const saved = await deps.db.$transaction(async (tx) => {
      const row = await tx.cylinderPlant.update({
        where: {
          wave_id_plant_barcode: {
            wave_id: waveId,
            plant_barcode: plantBarcode,
          },
        },
        data: {
          ...waveDates,
          uses_wave_dates: true,
          reason: null,
          set_by_phenotyper_id: phenotyperId,
        },
      });
      await logPlantDates(
        tx,
        row.id,
        old,
        waveDates,
        reason || "Back to the wave's dates",
        phenotyperId
      );
      return row;
    });
    const [info] = await plantInfos(deps.db, [saved]);
    return { success: true, data: info };
  } catch (error) {
    return fail(error);
  }
}

export function registerCylinderPlantHandlers(
  deps: CylinderPlantDeps & { ipcMain: Pick<IpcMain, 'handle'> }
): void {
  deps.ipcMain.handle('db:cylinderPlants:list', (_event, waveId: string) =>
    listPlants(deps, waveId)
  );
  deps.ipcMain.handle(
    'db:cylinderPlants:setDates',
    (_event, input: CylinderPlantDatesInput) => setPlantDates(deps, input)
  );
  deps.ipcMain.handle(
    'db:cylinderPlants:useWaveDates',
    (_event, input: CylinderPlantUseWaveDatesInput) =>
      usePlantWaveDates(deps, input)
  );
  deps.ipcMain.handle(
    'db:cylinderWaves:useSameDates',
    (_event, input: CylinderWaveSameDatesInput) =>
      useSameDatesForAll(deps, input)
  );
  deps.ipcMain.handle(
    'db:cylinderWaves:useDatesPerPlant',
    (_event, input: CylinderWaveDatesPerPlantInput) =>
      useDatesPerPlant(deps, input)
  );
}
