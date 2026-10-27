import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  changeDates,
  createWave,
  listWaves,
  registerCylinderWaveHandlers,
} from '../../src/main/cylinder-wave-handlers';

import {
  fakeCylinderDb,
  SET_AT,
  EDITED_AT,
  type FakeWave as Row,
} from './helpers/fake-cylinder-db';

const fakeDb = (rows: Row[], scanCounts: Record<number, number> = {}) =>
  fakeCylinderDb(rows, scanCounts);

const now = () => new Date(2026, 2, 10, 12);
const wave1: Row = {
  id: 'w1',
  experiment_id: 'exp',
  wave_number: 1,
  dates_per_plant: false,
  germination_date: '2025-11-26',
  sowing_date: '2025-10-01',
  transfer_date: null,
  germ_day_color: null,
  note: null,
  set_by_phenotyper_id: 'ph-1',
  updatedAt: SET_AT,
};

describe('listWaves', () => {
  it('lists the experiment waves with who set the date, when, and their scan counts', async () => {
    const { db } = fakeDb([{ ...wave1 }], { 1: 72 });
    const result = await listWaves({ db, now }, 'exp');
    expect(result).toEqual({
      success: true,
      data: [
        {
          id: 'w1',
          wave_number: 1,
          dates_per_plant: false,
          germination_date: '2025-11-26',
          sowing_date: '2025-10-01',
          transfer_date: null,
          germ_day_color: null,
          note: null,
          set_by_name: 'Demo Phenotyper',
          set_at: SET_AT.toISOString(),
          scanCount: 72,
          // None of the 72 was saved under one of its plants (taken with its dates).
          datedScanCount: 0,
          changes: [],
          plantsWithOwnDates: [],
        },
      ],
    });
  });

  it('rejects a missing experiment id', async () => {
    const { db } = fakeDb([]);
    expect((await listWaves({ db, now }, ' ')).success).toBe(false);
  });

  it("asks for the waves in order, and counts only the wave's live scans", async () => {
    // The fake sorts and filters by itself, so check what the real queries ask for.
    const { db, raw } = fakeDb([{ ...wave1 }], { 1: 72 });
    await listWaves({ db, now }, 'exp');
    expect(raw.cylinderWave.findMany).toHaveBeenCalledWith({
      where: { experiment_id: 'exp' },
      orderBy: { wave_number: 'asc' },
    });
    // One query for all the waves' live scans.
    expect(raw.scan.groupBy).toHaveBeenCalledTimes(1);
    expect(raw.scan.groupBy).toHaveBeenCalledWith({
      by: ['experiment_id', 'wave_number'],
      where: {
        experiment_id: { in: ['exp'] },
        wave_number: { in: [1] },
        deleted: false,
      },
      _count: { _all: true },
    });
    expect(raw.cylinderWaveDateChange.findMany).toHaveBeenCalledWith({
      where: { wave_id: { in: ['w1'] } },
      orderBy: { changedAt: 'asc' },
    });
  });

  it('returns a database error instead of throwing', async () => {
    const { db, raw } = fakeDb([{ ...wave1 }]);
    raw.scan.groupBy.mockRejectedValue(new Error('database is locked'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await listWaves({ db, now }, 'exp')).toEqual({
      success: false,
      error: 'database is locked',
    });
  });
});

describe('listWaves: the change log', () => {
  it('lists every change to the date, oldest first, with who and why', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const deps = { db: fake.db, now };
    await changeDates(deps, {
      waveId: 'w1',
      germinationDate: '2025-11-27',
      sowingDate: '2025-10-01',
      reason: 'Typo',
      phenotyperId: 'ph-2',
    });
    await changeDates(deps, {
      waveId: 'w1',
      germinationDate: '2025-11-25',
      sowingDate: '2025-10-01',
      reason: 'Checked the seed log',
      phenotyperId: 'ph-1',
    });
    const result = await listWaves(deps, 'exp');
    expect(result.data?.[0].germination_date).toBe('2025-11-25');
    expect(result.data?.[0].changes).toEqual([
      {
        id: 'c1',
        old_germination_date: '2025-11-26',
        new_germination_date: '2025-11-27',
        old_sowing_date: '2025-10-01',
        new_sowing_date: '2025-10-01',
        old_transfer_date: null,
        new_transfer_date: null,
        old_germ_day_color: null,
        new_germ_day_color: null,
        reason: 'Typo',
        changed_by_name: 'Second Phenotyper',
        changed_at: EDITED_AT.toISOString(),
      },
      {
        id: 'c2',
        old_germination_date: '2025-11-27',
        new_germination_date: '2025-11-25',
        old_sowing_date: '2025-10-01',
        new_sowing_date: '2025-10-01',
        old_transfer_date: null,
        new_transfer_date: null,
        old_germ_day_color: null,
        new_germ_day_color: null,
        reason: 'Checked the seed log',
        changed_by_name: 'Demo Phenotyper',
        changed_at: EDITED_AT.toISOString(),
      },
    ]);
  });
});

describe('listWaves: who set the date', () => {
  it('names a date set with no phenotyper (the backfill) as set by admin', async () => {
    const { db, raw } = fakeDb([{ ...wave1, set_by_phenotyper_id: null }]);
    const result = await listWaves({ db, now }, 'exp');
    expect(result.data?.[0].set_by_name).toBe('admin');
    expect(raw.phenotyper.findMany).not.toHaveBeenCalled();
  });
});

describe('createWave', () => {
  let fake: ReturnType<typeof fakeDb>;
  beforeEach(() => {
    fake = fakeDb([{ ...wave1 }]);
  });
  const create = (input: Record<string, unknown>) =>
    createWave({ db: fake.db, now }, {
      experimentId: 'exp',
      waveNumber: 2,
      germinationDate: '2026-02-20',
      sowingDate: '2025-12-01',
      phenotyperId: 'ph-1',
      ...input,
    } as never);

  it('saves the germination colour with the dates, cleaned, and logs it (#429)', async () => {
    const result = await create({ germDayColor: 'germ red' });
    expect(result.data?.germ_day_color).toBe('GermRed');
    expect(fake.changes[0]).toMatchObject({
      old_germ_day_color: null,
      new_germ_day_color: 'GermRed',
    });
  });

  it('saves the next wave with who set it', async () => {
    const result = await create({ phenotyperId: 'ph-1' });
    expect(result.success).toBe(true);
    expect(fake.lastTx.cylinderWave.create).toHaveBeenCalledWith({
      data: {
        experiment_id: 'exp',
        dates_per_plant: false,
        wave_number: 2,
        germination_date: '2026-02-20',
        sowing_date: '2025-12-01',
        transfer_date: null,
        germ_day_color: null,
        note: null,
        set_by_phenotyper_id: 'ph-1',
      },
    });
  });

  it('logs the first date too, in the same transaction, so the history shows who set it', async () => {
    const result = await create({
      phenotyperId: 'ph-1',
      germinationDate: '2026-02-20',
      sowingDate: '2025-12-01',
    });
    expect(fake.raw.$transaction).toHaveBeenCalledTimes(1);
    expect(fake.changes).toEqual([
      {
        id: 'c1',
        wave_id: 'w2',
        old_germination_date: null,
        new_germination_date: '2026-02-20',
        old_sowing_date: null,
        new_sowing_date: '2025-12-01',
        old_transfer_date: null,
        new_transfer_date: null,
        old_germ_day_color: null,
        new_germ_day_color: null,
        reason: null,
        changed_by_phenotyper_id: 'ph-1',
      },
    ]);
    expect(result.data?.changes).toEqual([
      {
        id: 'c1',
        old_germination_date: null,
        new_germination_date: '2026-02-20',
        old_sowing_date: null,
        new_sowing_date: '2025-12-01',
        old_transfer_date: null,
        new_transfer_date: null,
        old_germ_day_color: null,
        new_germ_day_color: null,
        reason: null,
        changed_by_name: 'Demo Phenotyper',
        changed_at: EDITED_AT.toISOString(),
      },
    ]);
  });

  it("logs the first date's note as its reason", async () => {
    await create({
      germinationDate: '2025-11-26',
      sowingDate: '2025-10-01',
      note: 'Sown the same day, scanned later',
    });
    expect(fake.changes[0]).toMatchObject({
      reason: 'Sown the same day, scanned later',
    });
  });

  it('saves nothing if the date or its log entry fails', async () => {
    // The wave is written first, then its log entry fails: the wave mustn't stay.
    const before = fake.rows.length;
    fake.onTransaction((tx) =>
      tx.cylinderWaveDateChange.create.mockRejectedValue(
        new Error('database is locked')
      )
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await create({})).toEqual({
      success: false,
      error: 'database is locked',
    });
    expect(fake.rows).toHaveLength(before);
    expect(fake.changes).toHaveLength(0);
  });

  it('refuses a future date', async () => {
    expect(
      await create({ germinationDate: '2026-03-11', sowingDate: '2025-12-01' })
    ).toEqual({
      success: false,
      error: "The germination date can't be in the future.",
    });
    expect(fake.raw.$transaction).not.toHaveBeenCalled();
  });

  it('needs a note for a date on or before wave 1, and saves it with one', async () => {
    const without = await create({
      germinationDate: '2025-11-26',
      sowingDate: '2025-10-01',
    });
    expect(without.success).toBe(false);
    expect(without.error).toMatch(/Add a note to proceed/);
    const withNote = await create({
      germinationDate: '2025-11-26',
      sowingDate: '2025-10-01',
      note: ' Sown the same day, scanned later ',
    });
    expect(withNote.success).toBe(true);
    expect(fake.rows.at(-1)?.note).toBe('Sown the same day, scanned later');
  });

  it('needs a note to proceed with a wave number that skips ahead', async () => {
    expect((await create({ waveNumber: 5 })).error).toMatch(
      /^Is the wave number correct\? Previous wave: wave 1\. Are you sure you want to scan wave 5\? Add a note to proceed\.$/
    );
    const withNote = await create({
      waveNumber: 5,
      note: 'Waves 2 to 4 were scanned on another PC',
    });
    expect(withNote.success).toBe(true);
    expect(fake.rows.at(-1)?.note).toBe(
      'Waves 2 to 4 were scanned on another PC'
    );
  });

  it('refuses a wave that already has its dates', async () => {
    expect((await create({ waveNumber: 1 })).error).toBe(
      'Wave 1 already has its dates.'
    );
  });

  it('refuses bad input', async () => {
    for (const bad of [
      { experimentId: '' },
      { waveNumber: -1 },
      { waveNumber: 1.5 },
      { note: 'x'.repeat(501) },
    ]) {
      expect((await create(bad)).success).toBe(false);
    }
  });

  it('returns a database error instead of throwing', async () => {
    fake.raw.cylinderWave.findMany.mockRejectedValue(
      new Error('database is locked')
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await create({})).toEqual({
      success: false,
      error: 'database is locked',
    });
  });
});

describe('a phenotyper is required to set or change a date', () => {
  it('refuses to create a wave without a phenotyper, or with an unknown one', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const base = {
      experimentId: 'exp',
      waveNumber: 2,
      germinationDate: '2026-02-20',
      sowingDate: '2025-12-01',
    };
    expect(
      await createWave({ db: fake.db, now }, { ...base, phenotyperId: ' ' })
    ).toEqual({ success: false, error: 'Choose the phenotyper first.' });
    expect(
      (
        await createWave(
          { db: fake.db, now },
          { ...base, phenotyperId: 'ph-9' }
        )
      ).error
    ).toBe('That phenotyper no longer exists.');
    expect(fake.raw.$transaction).not.toHaveBeenCalled();
  });

  it('refuses to change a date without a phenotyper, and logs nothing', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await changeDates(
      { db: fake.db, now },
      {
        waveId: 'w1',
        germinationDate: '2025-11-27',
        sowingDate: '2025-10-01',
        phenotyperId: '',
      }
    );
    expect(result).toEqual({
      success: false,
      error: 'Choose the phenotyper first.',
    });
    expect(fake.changes).toHaveLength(0);
  });
});

describe('changeDates', () => {
  it('changes the date freely before the wave has scans, and records it', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await changeDates(
      { db: fake.db, now },
      {
        phenotyperId: 'ph-1',
        waveId: 'w1',
        germinationDate: '2025-11-27',
        sowingDate: '2025-10-01',
      }
    );
    expect(result.success).toBe(true);
    expect(result.data?.germination_date).toBe('2025-11-27');
    expect(fake.changes).toEqual([
      {
        id: 'c1',
        wave_id: 'w1',
        old_germination_date: '2025-11-26',
        new_germination_date: '2025-11-27',
        old_sowing_date: '2025-10-01',
        new_sowing_date: '2025-10-01',
        old_transfer_date: null,
        new_transfer_date: null,
        old_germ_day_color: null,
        new_germ_day_color: null,
        reason: null,
        changed_by_phenotyper_id: 'ph-1',
      },
    ]);
  });

  it('records the editor as the new setter, with the edit time', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await changeDates(
      { db: fake.db, now },
      {
        waveId: 'w1',
        germinationDate: '2025-11-27',
        sowingDate: '2025-10-01',
        phenotyperId: 'ph-2',
      }
    );
    expect(result.data).toMatchObject({
      germination_date: '2025-11-27',
      set_by_name: 'Second Phenotyper',
      set_at: EDITED_AT.toISOString(),
    });
    expect(fake.changes[0]).toMatchObject({
      old_germination_date: '2025-11-26',
      changed_by_phenotyper_id: 'ph-2',
    });
  });

  it("refuses to change a wave's dates once it has scans taken with them, whatever the reason", async () => {
    // SB_001 was scanned (3 times) with wave 1's dates.
    const fake = fakeCylinderDb(
      [{ ...wave1 }],
      { 1: 3 },
      [
        {
          id: 'p1',
          wave_id: 'w1',
          plant_barcode: 'SB_001',
          germination_date: '2025-11-26',
          sowing_date: '2025-10-01',
          transfer_date: null,
          germ_day_color: null,
          uses_wave_dates: true,
          reason: null,
          set_by_phenotyper_id: 'ph-1',
          updatedAt: SET_AT,
        },
      ],
      { p1: 3 }
    );
    const result = await changeDates(
      { db: fake.db, now },
      {
        waveId: 'w1',
        germinationDate: '2025-11-27',
        sowingDate: '2025-10-01',
        reason: 'Typo',
        phenotyperId: 'ph-2',
      }
    );
    expect(result).toEqual({
      success: false,
      error: "Wave 1 already has scans, so its dates can't be changed.",
    });
    expect(fake.rows[0].germination_date).toBe('2025-11-26');
    expect(fake.changes).toHaveLength(0);
  });

  it('still allows a change when the only scans are from before the dates were recorded', async () => {
    // 50 scans of wave 1 from before its dates were recorded: none used these dates.
    const fake = fakeDb([{ ...wave1 }], { 1: 50 });
    const result = await changeDates(
      { db: fake.db, now },
      {
        waveId: 'w1',
        germinationDate: '2025-11-27',
        sowingDate: '2025-10-01',
        phenotyperId: 'ph-1',
      }
    );
    expect(result.success).toBe(true);
    expect(fake.rows[0].germination_date).toBe('2025-11-27');
  });

  it('needs a reason when the new date conflicts with another wave', async () => {
    const wave2: Row = {
      ...wave1,
      id: 'w2',
      wave_number: 2,
      germination_date: '2026-02-20',
    };
    const fake = fakeDb([{ ...wave1 }, wave2]);
    const result = await changeDates(
      { db: fake.db, now },
      {
        phenotyperId: 'ph-1',
        waveId: 'w2',
        germinationDate: '2025-11-01',
        sowingDate: '2025-10-01',
      }
    );
    expect(result.error).toMatch(
      /^Are you sure about wave 2's dates\? .+ Give a reason for the change\.$/
    );
  });

  it('returns the error when the change cannot be saved', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    // The log entry is written, then the wave's update fails: neither stays.
    fake.onTransaction((tx) => {
      tx.cylinderWave.update = vi
        .fn()
        .mockRejectedValue(new Error('database is locked'));
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await changeDates(
        { db: fake.db, now },
        {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          germinationDate: '2025-11-27',
          sowingDate: '2025-10-01',
        }
      )
    ).toEqual({ success: false, error: 'database is locked' });
    expect(fake.rows[0].germination_date).toBe('2025-11-26');
    expect(fake.changes).toHaveLength(0);
  });

  it('returns a database error from looking up the wave instead of throwing', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    fake.raw.cylinderWave.findUnique.mockRejectedValue(
      new Error('disk I/O error')
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await changeDates(
        { db: fake.db, now },
        {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          germinationDate: '2025-11-27',
          sowingDate: '2025-10-01',
        }
      )
    ).toEqual({ success: false, error: 'disk I/O error' });
    expect(fake.raw.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an unknown wave, the same date and a future date', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const deps = { db: fake.db, now };
    expect(
      (
        await changeDates(deps, {
          phenotyperId: 'ph-1',
          waveId: 'nope',
          germinationDate: '2025-11-27',
          sowingDate: '2025-10-01',
        })
      ).error
    ).toBe('That wave no longer exists.');
    expect(
      (
        await changeDates(deps, {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          germinationDate: '2025-11-26',
          sowingDate: '2025-10-01',
        })
      ).error
    ).toBe("Those are already the wave's dates.");
    expect(
      (
        await changeDates(deps, {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          germinationDate: '2026-04-01',
          sowingDate: '2025-10-01',
        })
      ).error
    ).toMatch(/future/);
  });
});

describe('the three dates', () => {
  const newWave = {
    experimentId: 'exp',
    waveNumber: 2,
    germinationDate: '2026-02-20',
    sowingDate: '2026-02-16',
    phenotyperId: 'ph-1',
  };

  it('saves the sowing date, and a transfer on the germination day as null ("same day")', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const deps = { db: fake.db, now };
    const sameDay = await createWave(deps, {
      ...newWave,
      transferDate: '2026-02-20',
    });
    expect(sameDay.data).toMatchObject({
      germination_date: '2026-02-20',
      sowing_date: '2026-02-16',
      transfer_date: null,
      germ_day_color: null,
    });
    expect(fake.changes[0]).toMatchObject({
      old_germination_date: null,
      new_germination_date: '2026-02-20',
      old_sowing_date: null,
      new_sowing_date: '2026-02-16',
      new_transfer_date: null,
      old_germ_day_color: null,
      new_germ_day_color: null,
    });
  });

  it('saves a transfer date on another day', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await createWave(
      { db: fake.db, now },
      { ...newWave, transferDate: ' 2026-02-22 ' }
    );
    expect(result.data).toMatchObject({ transfer_date: '2026-02-22' });
  });

  it('refuses a missing sowing date, or one after germination, and saves nothing', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const deps = { db: fake.db, now };
    expect(await createWave(deps, { ...newWave, sowingDate: '' })).toEqual({
      success: false,
      error: 'Enter the sowing date.',
    });
    expect(
      await createWave(deps, { ...newWave, sowingDate: '2026-02-21' })
    ).toEqual({
      success: false,
      error: 'The sowing date must be before the germination date.',
    });
    expect(fake.raw.$transaction).not.toHaveBeenCalled();
  });

  it('can change only the sowing or transfer date, logging each date before and after', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await changeDates(
      { db: fake.db, now },
      {
        phenotyperId: 'ph-1',
        waveId: 'w1',
        germinationDate: '2025-11-26',
        sowingDate: '2025-10-03',
        transferDate: '2025-11-28',
      }
    );
    expect(result.success).toBe(true);
    expect(fake.rows[0]).toMatchObject({
      germination_date: '2025-11-26',
      sowing_date: '2025-10-03',
      transfer_date: '2025-11-28',
      germ_day_color: null,
    });
    expect(fake.changes).toEqual([
      expect.objectContaining({
        old_germination_date: '2025-11-26',
        new_germination_date: '2025-11-26',
        old_sowing_date: '2025-10-01',
        new_sowing_date: '2025-10-03',
        old_transfer_date: null,
        new_transfer_date: '2025-11-28',
        old_germ_day_color: null,
        new_germ_day_color: null,
      }),
    ]);
  });

  it('refuses a change that keeps all three dates', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    expect(
      await changeDates(
        { db: fake.db, now },
        {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          germinationDate: '2025-11-26',
          sowingDate: '2025-10-01',
        }
      )
    ).toEqual({ success: false, error: "Those are already the wave's dates." });
  });

  it('needs a sowing date when changing a backfilled wave that has none', async () => {
    const fake = fakeDb([{ ...wave1, sowing_date: null }]);
    expect(
      await changeDates(
        { db: fake.db, now },
        {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          germinationDate: '2025-11-27',
          sowingDate: '',
        }
      )
    ).toEqual({ success: false, error: 'Enter the sowing date.' });
    expect(fake.changes).toEqual([]);
  });
});

describe('waves whose dates are per plant, and plants following the wave', () => {
  const plant = (
    id: string,
    barcode: string,
    usesWaveDates: boolean,
    germination: string
  ) => ({
    id,
    wave_id: 'w1',
    plant_barcode: barcode,
    germination_date: germination,
    sowing_date: '2025-10-01',
    transfer_date: null,
    germ_day_color: null,
    uses_wave_dates: usesWaveDates,
    reason: usesWaveDates ? null : 'Germinated late',
    set_by_phenotyper_id: 'ph-1',
    updatedAt: SET_AT,
  });

  it('saves a per-plant wave with no dates, logged as set up', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await createWave(
      { db: fake.db, now },
      {
        experimentId: 'exp',
        waveNumber: 2,
        datesPerPlant: true,
        phenotyperId: 'ph-1',
      }
    );
    expect(result.data).toMatchObject({
      dates_per_plant: true,
      germination_date: null,
      sowing_date: null,
      transfer_date: null,
      germ_day_color: null,
    });
    expect(fake.changes[0]).toMatchObject({
      old_germination_date: null,
      new_germination_date: null,
    });
  });

  it('still needs a note for a per-plant wave whose number skips ahead', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const deps = { db: fake.db, now };
    const input = {
      experimentId: 'exp',
      waveNumber: 4,
      datesPerPlant: true,
      phenotyperId: 'ph-1',
    };
    expect((await createWave(deps, input)).error).toMatch(
      /^Is the wave number correct\? .+ Add a note to proceed\.$/
    );
    expect(
      (await createWave(deps, { ...input, note: 'Waves 2 and 3 elsewhere' }))
        .success
    ).toBe(true);
  });

  it("refuses to change a per-plant wave's dates", async () => {
    const fake = fakeDb([
      {
        ...wave1,
        dates_per_plant: true,
        germination_date: null,
        sowing_date: null,
      },
    ]);
    expect(
      await changeDates(
        { db: fake.db, now },
        {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          germinationDate: '2025-11-27',
          sowingDate: '2025-10-01',
        }
      )
    ).toEqual({
      success: false,
      error: "This wave's dates are per plant: change them for each plant.",
    });
  });

  it("passes a correction on to plants still on the wave's dates, not to plants with their own", async () => {
    const plants = [
      plant('p1', 'SB_001', true, '2025-11-26'),
      plant('p2', 'SB_002', false, '2025-11-29'),
    ];
    const fake = fakeCylinderDb([{ ...wave1 }], {}, plants);
    const result = await changeDates(
      { db: fake.db, now },
      {
        phenotyperId: 'ph-1',
        waveId: 'w1',
        germinationDate: '2025-11-27',
        sowingDate: '2025-10-01',
      }
    );
    expect(result.success).toBe(true);
    expect(fake.plants[0].germination_date).toBe('2025-11-27');
    expect(fake.plants[1].germination_date).toBe('2025-11-29');
    // The plant that followed the correction has it in its own history too.
    expect(fake.plantChanges).toEqual([
      expect.objectContaining({
        plant_id: 'p1',
        old_germination_date: '2025-11-26',
        new_germination_date: '2025-11-27',
        reason: "Wave 1's dates changed",
        changed_by_phenotyper_id: 'ph-1',
      }),
    ]);
  });

  it('lists the plants with their own dates under each wave', async () => {
    const fake = fakeCylinderDb([{ ...wave1 }], {}, [
      plant('p1', 'SB_001', true, '2025-11-26'),
      plant('p2', 'SB_002', false, '2025-11-29'),
    ]);
    const result = await listWaves({ db: fake.db, now }, 'exp');
    expect(result.data?.[0].plantsWithOwnDates).toEqual([
      expect.objectContaining({
        plant_barcode: 'SB_002',
        germination_date: '2025-11-29',
        reason: 'Germinated late',
        set_by_name: 'Demo Phenotyper',
      }),
    ]);
  });
});

describe('registerCylinderWaveHandlers', () => {
  it('registers the three channels', () => {
    const handle = vi.fn();
    registerCylinderWaveHandlers({
      ipcMain: { handle },
      db: fakeDb([]).db,
      now,
    });
    expect(handle.mock.calls.map((c) => c[0])).toEqual([
      'db:cylinderWaves:list',
      'db:cylinderWaves:create',
      'db:cylinderWaves:changeDates',
    ]);
  });
});
