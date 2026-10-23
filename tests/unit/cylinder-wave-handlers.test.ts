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
      create: vi.fn(async ({ data }) => {
        const row = { id: `w${rows.length + 1}`, ...data, updatedAt: SET_AT };
        rows.push(row);
        return row;
      }),
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
      reason: 'Typo',
      phenotyperId: 'ph-2',
    });
    await changeSowingDate(deps, {
      waveId: 'w1',
      sowingDate: '2025-11-25',
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
        reason: 'Typo',
        changed_by_name: 'Second Phenotyper',
        changed_at: EDITED_AT.toISOString(),
      },
      {
        id: 'c2',
        old_sowing_date: '2025-11-27',
        new_sowing_date: '2025-11-25',
        reason: 'Checked the seed log',
        changed_by_name: 'Demo Phenotyper',
        changed_at: EDITED_AT.toISOString(),
      },
    ]);
  });
});

describe('listWaves: who set the date', () => {
  it('has no name when the setter is unknown', async () => {
    const { db, raw } = fakeDb([{ ...wave1, set_by_phenotyper_id: null }]);
    const result = await listWaves({ db, now }, 'exp');
    expect(result.data?.[0].set_by_name).toBeNull();
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
        note: null,
        set_by_phenotyper_id: 'ph-1',
      },
    });
  });

  it('refuses a future date', async () => {
    expect(await create({ sowingDate: '2026-03-11' })).toEqual({
      success: false,
      error: "The start date can't be in the future.",
    });
    expect(fake.raw.cylinderWave.create).not.toHaveBeenCalled();
  });

  it('needs a note for a date on or before wave 1, and saves it with one', async () => {
    const without = await create({ sowingDate: '2025-11-26' });
    expect(without.success).toBe(false);
    expect(without.error).toMatch(/Add a note/);
    const withNote = await create({
      sowingDate: '2025-11-26',
      note: ' Sown the same day, scanned later ',
    });
    expect(withNote.success).toBe(true);
    expect(fake.rows.at(-1)?.note).toBe('Sown the same day, scanned later');
  });

  it('needs the operator to confirm a wave number that skips ahead', async () => {
    expect((await create({ waveNumber: 5 })).error).toMatch(
      /Is this really wave 5\?/
    );
    expect((await create({ waveNumber: 5, waveConfirmed: true })).success).toBe(
      true
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
      { waveId: 'w1', sowingDate: '2025-11-27', phenotyperId: '' }
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
      { phenotyperId: 'ph-1', waveId: 'w1', sowingDate: '2025-11-27' }
    );
    expect(result.success).toBe(true);
    expect(result.data?.sowing_date).toBe('2025-11-27');
    expect(fake.changes).toEqual([
      {
        id: 'c1',
        wave_id: 'w1',
        old_sowing_date: '2025-11-26',
        new_sowing_date: '2025-11-27',
        reason: null,
        changed_by_phenotyper_id: 'ph-1',
      },
    ]);
  });

  it('records the editor as the new setter, with the edit time', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    const result = await changeSowingDate(
      { db: fake.db, now },
      { waveId: 'w1', sowingDate: '2025-11-27', phenotyperId: 'ph-2' }
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
      { phenotyperId: 'ph-1', waveId: 'w1', sowingDate: '2025-11-27' }
    );
    expect(without.error).toMatch(/give a reason/);
    expect(fake.changes).toHaveLength(0);
    const withReason = await changeSowingDate(
      { db: fake.db, now },
      {
        waveId: 'w1',
        sowingDate: '2025-11-27',
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
      { phenotyperId: 'ph-1', waveId: 'w2', sowingDate: '2025-11-01' }
    );
    expect(result.error).toMatch(/^Wave 1's start date is/);
  });

  it('returns the error when the change cannot be saved', async () => {
    const fake = fakeDb([{ ...wave1 }]);
    fake.raw.$transaction.mockRejectedValue(new Error('database is locked'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(
      await changeSowingDate(
        { db: fake.db, now },
        { phenotyperId: 'ph-1', waveId: 'w1', sowingDate: '2025-11-27' }
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
        { phenotyperId: 'ph-1', waveId: 'w1', sowingDate: '2025-11-27' }
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
        })
      ).error
    ).toBe('That wave no longer exists.');
    expect(
      (
        await changeSowingDate(deps, {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          sowingDate: '2025-11-26',
        })
      ).error
    ).toBe('That is already the start date.');
    expect(
      (
        await changeSowingDate(deps, {
          phenotyperId: 'ph-1',
          waveId: 'w1',
          sowingDate: '2026-04-01',
        })
      ).error
    ).toMatch(/future/);
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
