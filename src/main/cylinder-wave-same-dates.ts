/**
 * Switching how a CylinderScan wave's dates are set (#428): one set of dates for all
 * its plants, or dates per plant. Either way, no scanned plant's dates change.
 */

import type { DatabaseResponse } from '../types/database';
import type {
  CylinderWaveDatesPerPlantInput,
  CylinderWaveSameDatesInput,
} from '../types/cylinder-wave';
import {
  MAX_REASON_LENGTH,
  checkNewWave,
  formatWaveDate,
  warningText,
  waveDatesError,
} from '../utils/wave-dates';
import {
  datesToSave,
  enteredDates,
  fail,
  phenotyperError,
  trimmed,
} from './cylinder-dates-common';
import {
  plantInfos,
  sameDates,
  type CylinderPlantDeps,
} from './cylinder-plant-handlers';

/**
 * Give a per-plant wave one set of dates for all its plants, e.g. when "No" was chosen
 * by mistake. Before the wave's first scan any dates can be used; after it, only when
 * all its plants have the same dates, and the wave takes exactly those, so no scanned
 * plant's dates change. Plants whose dates match then follow the wave's.
 */
export async function useSameDatesForAll(
  deps: CylinderPlantDeps,
  input: CylinderWaveSameDatesInput
): Promise<DatabaseResponse<null>> {
  const waveId = trimmed(input?.waveId);
  const reason = trimmed(input?.reason);
  const phenotyperId = trimmed(input?.phenotyperId);
  const today = (deps.now ?? (() => new Date()))();
  const dates = enteredDates(input);
  const datesError = waveDatesError(dates, today);
  if (datesError) return { success: false, error: datesError };
  if (reason.length > MAX_REASON_LENGTH) {
    return {
      success: false,
      error: `Keep the reason under ${MAX_REASON_LENGTH} characters.`,
    };
  }
  const toSave = datesToSave(dates);
  try {
    const wave = await deps.db.cylinderWave.findUnique({
      where: { id: waveId },
    });
    if (!wave) return { success: false, error: 'That wave no longer exists.' };
    if (!wave.dates_per_plant) {
      return {
        success: false,
        error: 'This wave already has the same dates for all plants.',
      };
    }
    const who = await phenotyperError(deps.db, phenotyperId);
    if (who) return { success: false, error: who };
    const plants = await plantInfos(
      deps.db,
      await deps.db.cylinderPlant.findMany({
        where: { wave_id: { in: [waveId] } },
        orderBy: { updatedAt: 'desc' },
      })
    );
    if (plants.some((p) => p.scanCount > 0)) {
      const first = plants[0];
      if (!plants.every((p) => sameDates(p, first))) {
        return {
          success: false,
          error:
            "This wave's plants have been scanned with different dates, so they can't share one set.",
        };
      }
      if (!sameDates(first, toSave)) {
        return {
          success: false,
          error: `This wave's plants were scanned with these dates: germinated ${formatWaveDate(first.germination_date)}${first.sowing_date ? `, sown ${formatWaveDate(first.sowing_date)}` : ''}. Use the same ones.`,
        };
      }
    }
    const others = (
      await deps.db.cylinderWave.findMany({
        where: { experiment_id: wave.experiment_id },
        orderBy: { wave_number: 'asc' },
      })
    ).filter((w) => w.id !== wave.id);
    const conflict = checkNewWave(
      wave.wave_number,
      dates,
      others,
      today
    ).dateWarning;
    if (conflict && !reason) {
      return {
        success: false,
        error: `${warningText(conflict)} Give a reason for the change.`,
      };
    }
    await deps.db.$transaction(async (tx) => {
      await tx.cylinderWave.update({
        where: { id: waveId },
        data: {
          ...toSave,
          dates_per_plant: false,
          set_by_phenotyper_id: phenotyperId,
        },
      });
      await tx.cylinderWaveDateChange.create({
        data: {
          wave_id: waveId,
          old_germination_date: null,
          new_germination_date: toSave.germination_date,
          old_sowing_date: null,
          new_sowing_date: toSave.sowing_date,
          old_transfer_date: null,
          new_transfer_date: toSave.transfer_date,
          reason: reason || 'Changed to the same dates for all plants',
          changed_by_phenotyper_id: phenotyperId,
        },
      });
      // Plants with these dates follow the wave's from now on.
      for (const plant of plants.filter((p) => sameDates(p, toSave))) {
        await tx.cylinderPlant.update({
          where: {
            wave_id_plant_barcode: {
              wave_id: waveId,
              plant_barcode: plant.plant_barcode,
            },
          },
          data: {
            ...toSave,
            uses_wave_dates: true,
            reason: null,
            set_by_phenotyper_id: phenotyperId,
          },
        });
      }
    });
    return { success: true, data: null };
  } catch (error) {
    return fail(error);
  }
}

/**
 * Make a wave's dates per plant. The plants already on the wave's dates keep them as
 * their own, so no scanned plant's dates change; any other plant's are asked for
 * before its first scan.
 */
export async function useDatesPerPlant(
  deps: CylinderPlantDeps,
  input: CylinderWaveDatesPerPlantInput
): Promise<DatabaseResponse<null>> {
  const waveId = trimmed(input?.waveId);
  const reason = trimmed(input?.reason);
  const phenotyperId = trimmed(input?.phenotyperId);
  if (reason.length > MAX_REASON_LENGTH) {
    return {
      success: false,
      error: `Keep the reason under ${MAX_REASON_LENGTH} characters.`,
    };
  }
  try {
    const wave = await deps.db.cylinderWave.findUnique({
      where: { id: waveId },
    });
    if (!wave) return { success: false, error: 'That wave no longer exists.' };
    if (wave.dates_per_plant) {
      return {
        success: false,
        error: "This wave's dates are already set for each plant.",
      };
    }
    const who = await phenotyperError(deps.db, phenotyperId);
    if (who) return { success: false, error: who };
    // A copy: the old dates are logged after the wave is updated.
    const old = {
      germination_date: wave.germination_date,
      sowing_date: wave.sowing_date,
      transfer_date: wave.transfer_date,
    };
    await deps.db.$transaction(async (tx) => {
      // Plants on the wave's dates keep them as their own.
      await tx.cylinderPlant.updateMany({
        where: { wave_id: waveId, uses_wave_dates: true },
        data: { uses_wave_dates: false },
      });
      await tx.cylinderWave.update({
        where: { id: waveId },
        data: {
          germination_date: null,
          sowing_date: null,
          transfer_date: null,
          dates_per_plant: true,
          set_by_phenotyper_id: phenotyperId,
        },
      });
      await tx.cylinderWaveDateChange.create({
        data: {
          wave_id: waveId,
          old_germination_date: old.germination_date,
          new_germination_date: null,
          old_sowing_date: old.sowing_date,
          new_sowing_date: null,
          old_transfer_date: old.transfer_date,
          new_transfer_date: null,
          reason: reason || 'Changed to dates per plant',
          changed_by_phenotyper_id: phenotyperId,
        },
      });
    });
    return { success: true, data: null };
  } catch (error) {
    return fail(error);
  }
}
