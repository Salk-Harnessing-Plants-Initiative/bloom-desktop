/**
 * The plant a CylinderScan scan is for, and its age (#428): checked before a scan starts
 * (the age must be the days since the plant's germination date) and used when the scan
 * is saved (the plant's row is created from its wave's dates at its first scan).
 */

import { plantAgeDays } from '../utils/wave-dates';
import { waveDatesForPlants } from './cylinder-plant-handlers';
import { logPlantDates, plantDateColumns } from './cylinder-plant-log';
import type {
  CylinderWaveDbLike,
  CylinderWaveTxLike,
  DateColumns,
  PlantRow,
  WaveRow,
} from './cylinder-wave-db';

/** A plant's wave, its own row if it has one, and the dates its age comes from. */
export interface PlantForScan {
  wave: WaveRow;
  plant: PlantRow | null;
  /** Null when the wave's dates are per plant and this plant's aren't set yet. */
  dates: DateColumns | null;
}

/** Look up the wave and plant a scan is for; null when the wave has no dates set. */
export async function plantForScan(
  db: Pick<CylinderWaveDbLike, 'cylinderWave' | 'cylinderPlant'>,
  experimentId: string,
  waveNumber: number,
  plantBarcode: string
): Promise<PlantForScan | null> {
  const wave = (
    await db.cylinderWave.findMany({
      where: { experiment_id: experimentId },
      orderBy: { wave_number: 'asc' },
    })
  ).find((w) => w.wave_number === waveNumber);
  if (!wave) return null;
  const plant = await db.cylinderPlant.findUnique({
    where: {
      wave_id_plant_barcode: { wave_id: wave.id, plant_barcode: plantBarcode },
    },
  });
  return { wave, plant, dates: plant ?? waveDatesForPlants(wave) };
}

/**
 * Why a scan can't start with this plant age, or null: the wave and the plant's dates
 * must be set, and the age must be the days since the plant's germination date.
 * Checked in the main process before anything is captured.
 */
export async function plantAgeError(
  db: Pick<CylinderWaveDbLike, 'cylinderWave' | 'cylinderPlant'>,
  scan: {
    experiment_id: string;
    wave_number: number;
    plant_id: string;
    plant_age_days: number;
  },
  now: Date
): Promise<string | null> {
  const found = await plantForScan(
    db,
    scan.experiment_id,
    scan.wave_number,
    scan.plant_id
  );
  if (!found) return `Set wave ${scan.wave_number}'s dates first.`;
  if (!found.dates) return `Set plant ${scan.plant_id}'s dates first.`;
  const expected = plantAgeDays(found.dates.germination_date, now);
  return scan.plant_age_days === expected
    ? null
    : `The plant age (${scan.plant_age_days}) isn't the days since this plant's germination date (${expected}).`;
}

/**
 * The plant a scan is saved under: its row, created from the wave's dates at its first
 * scan (and logged, so its history starts there).
 */
export async function plantRowForScan(
  tx: Pick<CylinderWaveTxLike, 'cylinderPlant' | 'cylinderPlantDateChange'>,
  found: PlantForScan,
  plantBarcode: string,
  phenotyperId: string
): Promise<PlantRow> {
  if (found.plant) return found.plant;
  if (!found.dates) {
    throw new Error(`Plant ${plantBarcode} has no dates set.`);
  }
  const dates = plantDateColumns(found.dates);
  const plant = await tx.cylinderPlant.create({
    data: {
      ...dates,
      wave_id: found.wave.id,
      plant_barcode: plantBarcode,
      uses_wave_dates: true,
      reason: null,
      set_by_phenotyper_id: phenotyperId,
    },
  });
  await logPlantDates(
    tx,
    plant.id,
    null,
    dates,
    `From wave ${found.wave.wave_number}'s dates, at the plant's first scan`,
    phenotyperId
  );
  return plant;
}
