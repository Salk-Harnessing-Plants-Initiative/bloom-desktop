import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  changeSowingDate,
  createWave,
  listWaves,
  registerCylinderWaveHandlers,
  type CylinderWaveDbLike,
} from '../../src/main/cylinder-wave-handlers';

interface Row {
  id: string;
  experiment_id: string;
  wave_number: number;
  sowing_date: string;
  start_date_basis: string | null;
  start_date_basis_other: string | null;
  note: string | null;
  set_by_phenotyper_id: string | null;
  updatedAt: Date;
}

const SET_AT = new Date(2026, 0, 2, 9);
const EDITED_AT = new Date(2026, 2, 10, 12);
const phenotypers = [
  { id: 'ph-1', name: 'Demo Phenotyper' },
  { id: 'ph-2', name: 'Second Phenotyper' },
];

/** An in-memory fake of the tables the handlers use. */
function fakeDb(rows: Row[], scanCounts: Record<number, number> = {}) {
  const changes: Record<string, unknown>[] = [];
  const createWaveRow = vi.fn(async ({ data }) => {
    const row = { id: `w${rows.length + 1}`, ...data, updatedAt: SET_AT };
    rows.push(row);
    return row;
  });
  const db = {
    cylinderWave: {
      findMany: vi.fn(async ({ where }) =>
        rows
          .filter((r) => r.experiment_id === where.experiment_id)
          .sort((a, b) => a.wave_number - b.wave_number)
      ),
      findUnique: vi.fn(
        async ({ where }) => rows.find((r) => r.id === where.id) ?? null
      ),
      create: createWaveRow,
    },
    scan: {
      groupBy: vi.fn(async ({ where }) =>
        Object.entries(scanCounts)
          .map(([wave, n]) => ({
            experiment_id: 'exp',
            wave_number: Number(wave),
            _count: { _all: n },
          }))
          .filter((c) => where.wave_number.in.includes(c.wave_number))
      ),
    },
    cylinderWaveSowingDateChange: {
      findMany: vi.fn(async ({ where }) =>
        changes
          .filter((c) => where.wave_id.in.includes(c.wave_id))
          .map((c) => ({ changedAt: EDITED_AT, ...c }))
      ),
    },
    phenotyper: {
      findMany: vi.fn(async ({ where }) =>
        phenotypers.filter((p) => where.id.in.includes(p.id))
      ),
    },
    $transaction: vi.fn(async (fn) =>
      fn({
        cylinderWave: {
          create: createWaveRow,
          update: async ({
            where,
            data,
          }: {
            where: { id: string };
            data: { sowing_date: string; set_by_phenotyper_id?: string };
          }) => {
            const row = rows.find((r) => r.id === where.id)!;
            Object.assign(row, data, { updatedAt: EDITED_AT });
            return row;
          },
        },
        cylinderWaveSowingDateChange: {
          create: async ({ data }: { data: Record<string, unknown> }) => {
            changes.push({ id: `c${changes.length + 1}`, ...data });
            return data;
          },
        },
      })
    ),
  };
  return { db: db as unknown as CylinderWaveDbLike, raw: db, rows, changes };
}

const now = () => new Date(2026, 2, 10, 12);
const wave1: Row = {
  id: 'w1',
  experiment_id: 'exp',
  wave_number: 1,
  sowing_date: '2025-11-26',
  start_date_basis: 'transfer',
  start_date_basis_other: null,
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
          sowing_date: '2025-11-26',
          start_date_basis: 'transfer',
          start_date_basis_other: null,
          note: null,
          set_by_name: 'Demo Phenotyper',
          set_at: SET_AT.toISOString(),
          scanCount: 72,
          changes: [],
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
    expect(raw.cylinderWaveSowingDateChange.findMany).toHaveBeenCalledWith({
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
    const fake = fakeDb([{ ...wave1 }], { 1: 3 });
    const deps = { db: fake.db, now };
    await changeSowingDate(deps, {
      waveId: 'w1',
      sowingDate: '2025-11-27',
      startDateBasis: 'transfer',
      reason: 'Typo',
      phenotyperId: 'ph-2',
    });
    await changeSowingDate(deps, {
      waveId: 'w1',
      sowingDate: '2025-11-25',
      startDateBasis: 'transfer',
      reason: 'Checked the seed log',
      phenotyperId: 'ph-1',
    });
    const result = await listWaves(deps, 'exp');
    expect(result.data?.[0].sowing_date).toBe('2025-11-25');
    expect(result.data?.[0].changes).toEqual([
      {
        id: 'c1',
        old_sowing_date: '2025-11-26',
        new_sowing_date: '2025-11-27',
        start_date_basis: 'transfer',
        start_date_basis_other: null,
        reason: 'Typo',
        changed_by_name: 'Second Phenotyper',
        changed_at: EDITED_AT.toISOString(),
      },
      {
        id: 'c2',
        old_sowing_date: '2025-11-27',
        new_sowing_date: '2025-11-25',
        start_date_basis: 'transfer',
        start_date_basis_other: null,
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
      sowingDate: '2026-02-20',
      startDateBasis: 'transfer',
      phenotyperId: 'ph-1',
      ...input,
    } as never);

  it('saves the next wave with who set it', async () => {
    const result = await create({ phenotyperId: 'ph-1' });
    expect(result.success).toBe(true);
    expect(fake.raw.cylinderWave.create).toHaveBeenCalledWith({
      data: {
        experiment_id: 'exp',
        wave_number: 2,
        sowing_date: '2026-02-20',
        start_date_basis: 'transfer',
        start_date_basis_other: null,
        note: null,
        set_by_phenotyper_id: 'ph-1',
      },
    });
  });

  it('logs the first date too, in the same transaction, so the history shows who set it', async () => {
    const result = await create({
      phenotyperId: 'ph-1',
      sowingDate: '2026-02-20',
      startDateBasis: 'transfer',
    });
    expect(fake.raw.$transaction).toHaveBeenCalledTimes(1);
    expect(fake.changes).toEqual([
      {
        id: 'c1',
        wave_id: 'w2',
        old_sowing_date: null,
        new_sowing_date: '2026-02-20',
        start_date_basis: 'transfer',
        start_date_basis_other: null,
        reason: null,
        changed_by_phenotyper_id: 'ph-1',
      },
    ]);
    expect(result.data?.changes).toEqual([
      {
        id: 'c1',
        old_sowing_date: null,
        new_sowing_date: '2026-02-20',
        start_date_basis: 'transfer',
        start_date_basis_other: null,
        reason: null,
        changed_by_name: 'Demo Phenotyper',
        changed_at: EDITED_AT.toISOString(),
      },
    ]);
  });

  it("logs the first date's note as its reason", async () => {
    await create({
      sowingDate: '2025-11-26',
      startDateBasis: 'transfer',
      note: 'Sown the same day, scanned later',
    });
    expect(fake.changes[0]).toMatchObject({
      reason: 'Sown the same day, scanned later',
    });
  });

  it('saves nothing if the date or its log entry fails', async () => {
    fake.raw.$transaction.mockRejectedValue(new Error('database is locked'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await create({})).toEqual({
      success: false,
      error: 'database is locked',
    });
  });

  it('refuses a future date', async () => {
    expect(
      await create({ sowingDate: '2026-03-11', startDateBasis: 'transfer' })
    ).toEqual({
      success: false,
      error: "The start date can't be in the future.",
    });
    expect(fake.raw.cylinderWave.create).not.toHaveBeenCalled();
  });

  it('needs a note for a date on or before wave 1, and saves it with one', async () => {
    const without = await create({
      sowingDate: '2025-11-26',
      startDateBasis: 'transfer',
    });
    expect(without.success).toBe(false);
    expect(without.error).toMatch(/Add a note to proceed/);
    const withNote = await create({
      sowingDate: '2025-11-26',
      startDateBasis: 'transfer',
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

  it('refuses a wave that already has a sowing date', async () => {
    expect((await create({ waveNumber: 1 })).error).toBe(
      'Wave 1 already has a start date.'
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
      sowingDate: '2026-02-20',
      startDateBasis: 'transfer',
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
    expect(fake.raw.cylinderWave.create).not.toHaveBeenCalled();
  });

  it('refuses to change a date without a phenotyper, and logs nothing', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await changeSowingDate(
      { db: fake.db, now },
      {
        waveId: 'w1',
        sowingDate: '2025-11-27',
        startDateBasis: 'transfer',
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

describe('changeSowingDate', () => {
  it('changes the date freely before the wave has scans, and records it', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await changeSowingDate(
      { db: fake.db, now },
      {
        phenotyperId: 'ph-1',
        waveId: 'w1',
        sowingDate: '2025-11-27',
        startDateBasis: 'transfer',
      }
    );
    expect(result.success).toBe(true);
    expect(result.data?.sowing_date).toBe('2025-11-27');
    expect(fake.changes).toEqual([
      {
        id: 'c1',
        wave_id: 'w1',
        old_sowing_date: '2025-11-26',
        new_sowing_date: '2025-11-27',
        start_date_basis: 'transfer',
        start_date_basis_other: null,
        reason: null,
        changed_by_phenotyper_id: 'ph-1',
      },
    ]);
  });

  it('records the editor as the new setter, with the edit time', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await changeSowingDate(
      { db: fake.db, now },
      {
        waveId: 'w1',
        sowingDate: '2025-11-27',
        startDateBasis: 'transfer',
        phenotyperId: 'ph-2',
      }
    );
    expect(result.data).toMatchObject({
      sowing_date: '2025-11-27',
      set_by_name: 'Second Phenotyper',
      set_at: EDITED_AT.toISOString(),
    });
    expect(fake.changes[0]).toMatchObject({
      old_sowing_date: '2025-11-26',
      changed_by_phenotyper_id: 'ph-2',
    });
  });

  it('needs a reason once the wave has scans', async () => {
    const fake = fakeDb([{ ...wave1 }], { 1: 3 });
    const without = await changeSowingDate(
      { db: fake.db, now },
      {
        phenotyperId: 'ph-1',
        waveId: 'w1',
        sowingDate: '2025-11-27',
        startDateBasis: 'transfer',
      }
    );
    expect(without.error).toMatch(/give a reason/);
    expect(fake.changes).toHaveLength(0);
    const withReason = await changeSowingDate(
      { db: fake.db, now },
      {
        waveId: 'w1',
        sowingDate: '2025-11-27',
        startDateBasis: 'transfer',
        reason: 'Typo',
        phenotyperId: 'ph-2',
      }
    );
    expect(withReason.success).toBe(true);
    expect(fake.changes[0]).toMatchObject({
      reason: 'Typo',
      changed_by_phenotyper_id: 'ph-2',
    });
  });

  it('needs a reason when the new date conflicts with another wave', async () => {
    const wave2: Row = {
      ...wave1,
      id: 'w2',
      wave_number: 2,
      sowing_date: '2026-02-20',
    };
    const fake = fakeDb([{ ...wave1 }, wave2]);
    const result = await changeSowingDate(
      { db: fake.db, now },
      {
        phenotyperId: 'ph-1',
        waveId: 'w2',
        sowingDate: '2025-11-01',
        startDateBasis: 'transfer',
      }
    );
    expect(result.error).toMatch(
      /^Are you sure wave 2's start date is correct\? .+ Give a reason for the change\.$/
    );
  });

  it('returns the error when the change cannot be saved', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    fake.raw.$transaction.mockRejectedValue(new Error('database is locked'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await changeSowingDate(
        { db: fake.db, now },
        {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          sowingDate: '2025-11-27',
          startDateBasis: 'transfer',
        }
      )
    ).toEqual({ success: false, error: 'database is locked' });
    expect(fake.rows[0].sowing_date).toBe('2025-11-26');
  });

  it('returns a database error from looking up the wave instead of throwing', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    fake.raw.cylinderWave.findUnique.mockRejectedValue(
      new Error('disk I/O error')
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await changeSowingDate(
        { db: fake.db, now },
        {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          sowingDate: '2025-11-27',
          startDateBasis: 'transfer',
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
        await changeSowingDate(deps, {
          phenotyperId: 'ph-1',
          waveId: 'nope',
          sowingDate: '2025-11-27',
          startDateBasis: 'transfer',
        })
      ).error
    ).toBe('That wave no longer exists.');
    expect(
      (
        await changeSowingDate(deps, {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          sowingDate: '2025-11-26',
          startDateBasis: 'transfer',
        })
      ).error
    ).toBe('That is already the start date.');
    expect(
      (
        await changeSowingDate(deps, {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          sowingDate: '2026-04-01',
          startDateBasis: 'transfer',
        })
      ).error
    ).toMatch(/future/);
  });
});

describe('what the start date is (its basis)', () => {
  const newWave = {
    experimentId: 'exp',
    waveNumber: 2,
    sowingDate: '2026-02-20',
    phenotyperId: 'ph-1',
  };

  it('is required for a new wave, and "other" needs a description', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const deps = { db: fake.db, now };
    expect(await createWave(deps, { ...newWave, startDateBasis: '' })).toEqual({
      success: false,
      error: 'Choose what the start date is.',
    });
    expect(
      await createWave(deps, { ...newWave, startDateBasis: 'harvest' })
    ).toEqual({ success: false, error: 'Choose what the start date is.' });
    expect(
      await createWave(deps, {
        ...newWave,
        startDateBasis: 'other',
        startDateBasisOther: '  ',
      })
    ).toEqual({ success: false, error: 'Say what the start date is.' });
    expect(fake.raw.cylinderWave.create).not.toHaveBeenCalled();
  });

  it('saves "other" with its description on the wave and its first log entry', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await createWave(
      { db: fake.db, now },
      {
        ...newWave,
        startDateBasis: 'other',
        startDateBasisOther: ' two days after germination ',
      }
    );
    expect(result.data).toMatchObject({
      start_date_basis: 'other',
      start_date_basis_other: 'two days after germination',
    });
    expect(fake.changes[0]).toMatchObject({
      start_date_basis: 'other',
      start_date_basis_other: 'two days after germination',
    });
  });

  it('keeps a description only for "other"', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await createWave(
      { db: fake.db, now },
      { ...newWave, startDateBasis: 'sowing', startDateBasisOther: 'stray' }
    );
    expect(result.data).toMatchObject({
      start_date_basis: 'sowing',
      start_date_basis_other: null,
    });
  });

  it('can change on its own, with the same date, and is logged', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await changeSowingDate(
      { db: fake.db, now },
      {
        phenotyperId: 'ph-1',
        waveId: 'w1',
        sowingDate: '2025-11-26',
        startDateBasis: 'sowing',
      }
    );
    expect(result.success).toBe(true);
    expect(fake.rows[0]).toMatchObject({
      sowing_date: '2025-11-26',
      start_date_basis: 'sowing',
    });
    expect(fake.changes).toEqual([
      expect.objectContaining({
        old_sowing_date: '2025-11-26',
        new_sowing_date: '2025-11-26',
        start_date_basis: 'sowing',
      }),
    ]);
  });

  it('needs a reason to change once the wave has scans', async () => {
    const fake = fakeDb([{ ...wave1 }], { 1: 3 });
    const change = {
      phenotyperId: 'ph-1',
      waveId: 'w1',
      sowingDate: '2025-11-26',
      startDateBasis: 'germination',
    };
    expect(await changeSowingDate({ db: fake.db, now }, change)).toEqual({
      success: false,
      error: 'This wave already has scans: give a reason for the change.',
    });
    expect(
      (
        await changeSowingDate(
          { db: fake.db, now },
          { ...change, reason: 'It was the germination date' }
        )
      ).success
    ).toBe(true);
  });

  it('refuses a change that keeps both the date and the basis', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    expect(
      await changeSowingDate(
        { db: fake.db, now },
        {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          sowingDate: '2025-11-26',
          startDateBasis: 'transfer',
        }
      )
    ).toEqual({ success: false, error: 'That is already the start date.' });
  });

  it('must be chosen when changing a backfilled wave that has none', async () => {
    const fake = fakeDb([{ ...wave1, start_date_basis: null }]);
    expect(
      await changeSowingDate(
        { db: fake.db, now },
        {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          sowingDate: '2025-11-27',
          startDateBasis: '',
        }
      )
    ).toEqual({ success: false, error: 'Choose what the start date is.' });
    expect(fake.changes).toEqual([]);
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
      'db:cylinderWaves:changeSowingDate',
    ]);
  });
});
