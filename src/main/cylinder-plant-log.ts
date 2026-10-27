/**
 * The CylinderScan plant change log (#428): every set and change of a plant's dates,
 * with the dates before and after, who and why. Besides a plant's own dates being set
 * or changed, this covers what happens to a plant through its wave: its row created
 * from the wave's dates at its first scan, a correction to the wave's dates passed on
 * to it, and the wave going per plant (it keeps the wave's dates as its own).
 */

import type {
  CylinderWaveTxLike,
  DateColumns,
  PlantRow,
} from './cylinder-wave-db';

type PlantLogTx = Pick<CylinderWaveTxLike, 'cylinderPlantDateChange'>;

/** The dates a plant row holds. */
export function plantDateColumns(plant: DateColumns): DateColumns {
  return {
    germination_date: plant.germination_date,
    sowing_date: plant.sowing_date,
    transfer_date: plant.transfer_date,
  };
}

/** Logs a plant's dates going from `before` (null when first set) to `after`. */
export async function logPlantDates(
  tx: PlantLogTx,
  plantId: string,
  before: DateColumns | null,
  after: DateColumns,
  reason: string | null,
  phenotyperId: string | null
): Promise<void> {
  await tx.cylinderPlantDateChange.create({
    data: {
      plant_id: plantId,
      old_germination_date: before?.germination_date ?? null,
      new_germination_date: after.germination_date,
      old_sowing_date: before?.sowing_date ?? null,
      new_sowing_date: after.sowing_date,
      old_transfer_date: before?.transfer_date ?? null,
      new_transfer_date: after.transfer_date,
      reason,
      changed_by_phenotyper_id: phenotyperId,
    },
  });
}

/**
 * Logs a wave change for each plant still on the wave's dates, before they're updated:
 * their dates go to `after`, or stay as they are when `after` is null. Returns them.
 */
export async function logPlantsOnWaveDates(
  tx: PlantLogTx & Pick<CylinderWaveTxLike, 'cylinderPlant'>,
  waveId: string,
  after: DateColumns | null,
  reason: string,
  phenotyperId: string
): Promise<PlantRow[]> {
  const plants = await tx.cylinderPlant.findMany({
    where: { wave_id: { in: [waveId] }, uses_wave_dates: true },
    orderBy: { updatedAt: 'desc' },
  });
  for (const plant of plants) {
    const before = plantDateColumns(plant);
    await logPlantDates(
      tx,
      plant.id,
      before,
      after ?? before,
      reason,
      phenotyperId
    );
  }
  return plants;
}
