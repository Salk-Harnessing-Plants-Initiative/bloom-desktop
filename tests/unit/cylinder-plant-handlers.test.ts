/**
 * Unit tests for a CylinderScan plant's own dates (#428): setting them, going back to
 * the wave's, the scanner's age check, and the plant row a scan is saved under.
 */

import { describe, it, expect } from 'vitest';
import {
  listPlants,
  registerCylinderPlantHandlers,
  setPlantDates,
  usePlantWaveDates,
} from '../../src/main/cylinder-plant-handlers';
import {
  useDatesPerPlant,
  useSameDatesForAll,
} from '../../src/main/cylinder-wave-same-dates';
import {
  plantAgeError,
  plantForScan,
  plantRowForScan,
} from '../../src/main/cylinder-plant-scan';
import {
  fakeCylinderDb,
  SET_AT,
  type FakePlant,
  type FakeWave,
} from './helpers/fake-cylinder-db';

const now = () => new Date(2026, 2, 10, 12);
const wave: FakeWave = {
  id: 'w1',
  experiment_id: 'exp',
  wave_number: 1,
  dates_per_plant: false,
  germination_date: '2026-03-01',
  sowing_date: '2026-02-26',
  transfer_date: null,
  note: null,
  set_by_phenotyper_id: 'ph-1',
  updatedAt: SET_AT,
};
const perPlantWave: FakeWave = {
  ...wave,
  dates_per_plant: true,
  germination_date: null,
  sowing_date: null,
};
const ownPlant: FakePlant = {
  id: 'p1',
  wave_id: 'w1',
  plant_barcode: 'SB_001',
  germination_date: '2026-03-03',
  sowing_date: '2026-02-26',
  transfer_date: null,
  uses_wave_dates: false,
  reason: 'Germinated two days late',
  set_by_phenotyper_id: 'ph-1',
  updatedAt: SET_AT,
};
const input = {
  waveId: 'w1',
  plantBarcode: 'SB_001',
  germinationDate: '2026-03-03',
  sowingDate: '2026-02-26',
  phenotyperId: 'ph-1',
};

describe('setPlantDates: a plant in a wave whose plants share their dates', () => {
  it('gives the plant its own dates, with a reason, logged from the wave’s', async () => {
    const fake = fakeCylinderDb([{ ...wave }]);
    const result = await setPlantDates(
      { db: fake.db, now },
      { ...input, reason: ' Germinated two days late ' }
    );
    expect(result.data).toMatchObject({
      plant_barcode: 'SB_001',
      germination_date: '2026-03-03',
      uses_wave_dates: false,
      reason: 'Germinated two days late',
      set_by_name: 'Demo Phenotyper',
    });
    expect(fake.plantChanges).toEqual([
      expect.objectContaining({
        old_germination_date: '2026-03-01',
        new_germination_date: '2026-03-03',
        reason: 'Germinated two days late',
      }),
    ]);
  });

  it('needs a reason, and refuses the wave’s own dates', async () => {
    const fake = fakeCylinderDb([{ ...wave }]);
    const deps = { db: fake.db, now };
    expect(await setPlantDates(deps, input)).toEqual({
      success: false,
      error: "Say why this plant's dates differ from the wave's.",
    });
    expect(
      await setPlantDates(deps, {
        ...input,
        germinationDate: '2026-03-01',
        reason: 'x',
      })
    ).toEqual({ success: false, error: "Those are the wave's dates already." });
    expect(fake.plants).toEqual([]);
  });

  it('checks the dates like a wave’s', async () => {
    const fake = fakeCylinderDb([{ ...wave }]);
    expect(
      await setPlantDates(
        { db: fake.db, now },
        { ...input, sowingDate: '2026-03-04', reason: 'x' }
      )
    ).toEqual({
      success: false,
      error: 'The sowing date must be before the germination date.',
    });
  });

  it('changes a plant’s own dates, and refuses the same dates again', async () => {
    const fake = fakeCylinderDb([{ ...wave }], {}, [{ ...ownPlant }]);
    const deps = { db: fake.db, now };
    expect(await setPlantDates(deps, { ...input, reason: 'x' })).toEqual({
      success: false,
      error: "Those are already this plant's dates.",
    });
    const changed = await setPlantDates(deps, {
      ...input,
      germinationDate: '2026-03-04',
      reason: 'Checked the plate',
    });
    expect(changed.data?.germination_date).toBe('2026-03-04');
    expect(fake.plantChanges[0]).toMatchObject({
      old_germination_date: '2026-03-03',
      new_germination_date: '2026-03-04',
    });
  });
});

describe('setPlantDates: a wave whose dates are per plant', () => {
  it('sets a plant’s first dates with no reason, logged with no old dates', async () => {
    const fake = fakeCylinderDb([{ ...perPlantWave }]);
    const result = await setPlantDates({ db: fake.db, now }, input);
    expect(result.data).toMatchObject({
      germination_date: '2026-03-03',
      uses_wave_dates: false,
      reason: null,
    });
    expect(fake.plantChanges[0]).toMatchObject({
      old_germination_date: null,
      new_germination_date: '2026-03-03',
    });
  });

  it('needs a reason to change the dates of a plant that has scans', async () => {
    const fake = fakeCylinderDb([{ ...perPlantWave }], {}, [{ ...ownPlant }], {
      p1: 2,
    });
    expect(
      await setPlantDates(
        { db: fake.db, now },
        { ...input, germinationDate: '2026-03-04' }
      )
    ).toEqual({
      success: false,
      error: 'This plant already has scans: give a reason for the change.',
    });
  });
});

describe('usePlantWaveDates', () => {
  it('puts a plant back on its wave’s dates, logged', async () => {
    const fake = fakeCylinderDb([{ ...wave }], {}, [{ ...ownPlant }]);
    const result = await usePlantWaveDates(
      { db: fake.db, now },
      { waveId: 'w1', plantBarcode: 'SB_001', phenotyperId: 'ph-1' }
    );
    expect(result.data).toMatchObject({
      germination_date: '2026-03-01',
      uses_wave_dates: true,
      reason: null,
    });
    expect(fake.plantChanges[0]).toMatchObject({
      old_germination_date: '2026-03-03',
      new_germination_date: '2026-03-01',
      reason: "Back to the wave's dates",
    });
  });

  it('needs a reason once the plant has scans', async () => {
    const fake = fakeCylinderDb([{ ...wave }], {}, [{ ...ownPlant }], {
      p1: 1,
    });
    expect(
      (
        await usePlantWaveDates(
          { db: fake.db, now },
          { waveId: 'w1', plantBarcode: 'SB_001', phenotyperId: 'ph-1' }
        )
      ).error
    ).toBe('This plant already has scans: give a reason for the change.');
  });

  it('refuses in a per-plant wave, or for a plant already on the wave’s dates', async () => {
    const perPlant = fakeCylinderDb([{ ...perPlantWave }], {}, [
      { ...ownPlant },
    ]);
    const args = { waveId: 'w1', plantBarcode: 'SB_001', phenotyperId: 'ph-1' };
    expect(
      (await usePlantWaveDates({ db: perPlant.db, now }, args)).error
    ).toBe("This wave's dates are per plant.");
    const onWave = fakeCylinderDb([{ ...wave }], {}, [
      { ...ownPlant, uses_wave_dates: true },
    ]);
    expect((await usePlantWaveDates({ db: onWave.db, now }, args)).error).toBe(
      "This plant already uses the wave's dates."
    );
  });
});

describe('listPlants', () => {
  it('lists the wave’s plants with their scan counts', async () => {
    const fake = fakeCylinderDb([{ ...wave }], {}, [{ ...ownPlant }], {
      p1: 3,
    });
    const result = await listPlants({ db: fake.db, now }, 'w1');
    expect(result.data).toEqual([
      expect.objectContaining({ plant_barcode: 'SB_001', scanCount: 3 }),
    ]);
    expect((await listPlants({ db: fake.db, now }, ' ')).success).toBe(false);
  });
});

describe('the scanner: the age check and the plant a scan is saved under', () => {
  const scan = (age: number, barcode = 'SB_001') => ({
    experiment_id: 'exp',
    wave_number: 1,
    plant_id: barcode,
    plant_age_days: age,
  });

  it('accepts the days since the plant’s germination date: its own, or the wave’s', async () => {
    const fake = fakeCylinderDb([{ ...wave }], {}, [{ ...ownPlant }]);
    // Own dates: germinated 3 Mar, scanned 10 Mar.
    expect(await plantAgeError(fake.db, scan(7), now())).toBeNull();
    // SB_002 has no row: the wave's germination date, 1 Mar.
    expect(await plantAgeError(fake.db, scan(9, 'SB_002'), now())).toBeNull();
  });

  it('refuses another age, a wave with no dates, or a per-plant wave’s plant without them', async () => {
    const fake = fakeCylinderDb([{ ...wave }]);
    expect(await plantAgeError(fake.db, scan(10), now())).toBe(
      "The plant age (10) isn't the days since this plant's germination date (9)."
    );
    expect(
      await plantAgeError(fake.db, { ...scan(9), wave_number: 2 }, now())
    ).toBe("Set wave 2's dates first.");
    const perPlant = fakeCylinderDb([{ ...perPlantWave }]);
    expect(await plantAgeError(perPlant.db, scan(9), now())).toBe(
      "Set plant SB_001's dates first."
    );
  });

  it('creates the plant’s row from the wave’s dates at its first scan, and reuses it after', async () => {
    const fake = fakeCylinderDb([{ ...wave }]);
    const found = await plantForScan(fake.db, 'exp', 1, 'SB_002');
    const row = await plantRowForScan(fake.tx, found!, 'SB_002', 'ph-1');
    expect(row).toMatchObject({
      plant_barcode: 'SB_002',
      germination_date: '2026-03-01',
      uses_wave_dates: true,
    });
    const again = await plantForScan(fake.db, 'exp', 1, 'SB_002');
    expect(await plantRowForScan(fake.tx, again!, 'SB_002', 'ph-1')).toBe(row);
    expect(fake.plants).toHaveLength(1);
    // Its history starts with the wave's dates, logged once.
    expect(fake.plantChanges).toEqual([
      expect.objectContaining({
        plant_id: row.id,
        old_germination_date: null,
        new_germination_date: '2026-03-01',
        reason: "From wave 1's dates, at the plant's first scan",
        changed_by_phenotyper_id: 'ph-1',
      }),
    ]);
  });
});

describe("plantRowForScan: the plant's germination colour (#429)", () => {
  it('saves the colour typed for the first scan on the new row', async () => {
    const fake = fakeCylinderDb([{ ...wave }]);
    const found = await plantForScan(fake.db, 'exp', 1, 'SB_002');
    const row = await plantRowForScan(
      fake.tx,
      found!,
      'SB_002',
      'ph-1',
      'GermRed'
    );
    expect(row.germ_day_color).toBe('GermRed');
  });

  it("changes a plant's colour only when a different one is typed", async () => {
    const fake = fakeCylinderDb([{ ...wave }]);
    const first = await plantForScan(fake.db, 'exp', 1, 'SB_002');
    await plantRowForScan(fake.tx, first!, 'SB_002', 'ph-1', 'Red');

    const same = await plantForScan(fake.db, 'exp', 1, 'SB_002');
    const tx = fake.tx;
    await plantRowForScan(tx, same!, 'SB_002', 'ph-1', 'Red');
    expect(tx.cylinderPlant.update).not.toHaveBeenCalled();

    const changed = await plantForScan(fake.db, 'exp', 1, 'SB_002');
    const row = await plantRowForScan(fake.tx, changed!, 'SB_002', 'ph-1', '');
    // Cleared: no colour (sent to Bloom as "none").
    expect(row.germ_day_color).toBeNull();
    expect(fake.plants).toHaveLength(1);
  });
});

describe('useSameDatesForAll: a per-plant wave going back to one set of dates', () => {
  const same = {
    waveId: 'w1',
    germinationDate: '2026-03-03',
    sowingDate: '2026-02-26',
    phenotyperId: 'ph-1',
  };

  it('takes any dates before the first scan, and plants with those dates follow it', async () => {
    const other = {
      ...ownPlant,
      id: 'p2',
      plant_barcode: 'SB_002',
      germination_date: '2026-03-02',
    };
    const fake = fakeCylinderDb([{ ...perPlantWave }], {}, [
      { ...ownPlant },
      other,
    ]);
    expect(await useSameDatesForAll({ db: fake.db, now }, same)).toEqual({
      success: true,
      data: null,
    });
    expect(fake.rows[0]).toMatchObject({
      dates_per_plant: false,
      germination_date: '2026-03-03',
    });
    expect(fake.changes[0]).toMatchObject({
      new_germination_date: '2026-03-03',
      reason: 'Changed to the same dates for all plants',
    });
    // SB_001 had these dates: it follows the wave now. SB_002 keeps its own.
    expect(fake.plants[0]).toMatchObject({
      uses_wave_dates: true,
      reason: null,
    });
    expect(fake.plants[1]).toMatchObject({ uses_wave_dates: false });
  });

  it('after scans, takes only the dates all the plants share', async () => {
    const scanned = fakeCylinderDb(
      [{ ...perPlantWave }],
      {},
      [{ ...ownPlant }],
      {
        p1: 2,
      }
    );
    expect(
      (
        await useSameDatesForAll(
          { db: scanned.db, now },
          { ...same, germinationDate: '2026-03-04' }
        )
      ).error
    ).toMatch(
      /^This wave's plants were scanned with these dates: germinated .+, sown .+\. Use the same ones\.$/
    );
    expect(
      (await useSameDatesForAll({ db: scanned.db, now }, same)).success
    ).toBe(true);
  });

  it('refuses after scans when the plants have different dates', async () => {
    const fake = fakeCylinderDb(
      [{ ...perPlantWave }],
      {},
      [
        { ...ownPlant },
        {
          ...ownPlant,
          id: 'p2',
          plant_barcode: 'SB_002',
          germination_date: '2026-03-02',
        },
      ],
      { p1: 1 }
    );
    expect((await useSameDatesForAll({ db: fake.db, now }, same)).error).toBe(
      "This wave's plants have been scanned with different dates, so they can't share one set."
    );
    expect(fake.rows[0].dates_per_plant).toBe(true);
  });

  it('refuses a wave that already has the same dates for all plants', async () => {
    const fake = fakeCylinderDb([{ ...wave }]);
    expect((await useSameDatesForAll({ db: fake.db, now }, same)).error).toBe(
      'This wave already has the same dates for all plants.'
    );
  });
});

describe('useDatesPerPlant: a wave with the same dates going per plant', () => {
  it("clears the wave's dates, keeps plants on them as their own, and logs it", async () => {
    const fake = fakeCylinderDb([{ ...wave }], {}, [
      { ...ownPlant, uses_wave_dates: true, germination_date: '2026-03-01' },
    ]);
    expect(
      await useDatesPerPlant(
        { db: fake.db, now },
        { waveId: 'w1', phenotyperId: 'ph-1' }
      )
    ).toEqual({ success: true, data: null });
    expect(fake.rows[0]).toMatchObject({
      dates_per_plant: true,
      germination_date: null,
      sowing_date: null,
    });
    expect(fake.plants[0]).toMatchObject({
      uses_wave_dates: false,
      germination_date: '2026-03-01',
    });
    expect(fake.changes[0]).toMatchObject({
      old_germination_date: '2026-03-01',
      new_germination_date: null,
      reason: 'Changed to dates per plant',
    });
    // The plant's own history says why it now has its own dates.
    expect(fake.plantChanges).toEqual([
      expect.objectContaining({
        plant_id: fake.plants[0].id,
        old_germination_date: '2026-03-01',
        new_germination_date: '2026-03-01',
        reason:
          "Wave 1's dates now set for each plant; keeps the wave's dates as its own",
        changed_by_phenotyper_id: 'ph-1',
      }),
    ]);
  });

  it('refuses a wave that is already per plant', async () => {
    const fake = fakeCylinderDb([{ ...perPlantWave }]);
    expect(
      (
        await useDatesPerPlant(
          { db: fake.db, now },
          { waveId: 'w1', phenotyperId: 'ph-1' }
        )
      ).error
    ).toBe("This wave's dates are already set for each plant.");
  });
});

describe('registerCylinderPlantHandlers', () => {
  it('registers the plant channels and the same-dates switch', () => {
    const channels: string[] = [];
    registerCylinderPlantHandlers({
      db: fakeCylinderDb([]).db,
      ipcMain: { handle: (channel: string) => void channels.push(channel) },
    } as unknown as Parameters<typeof registerCylinderPlantHandlers>[0]);
    expect(channels).toEqual([
      'db:cylinderPlants:list',
      'db:cylinderPlants:setDates',
      'db:cylinderPlants:useWaveDates',
      'db:cylinderWaves:useSameDates',
      'db:cylinderWaves:useDatesPerPlant',
    ]);
  });
});
