import { describe, it, expect, vi } from 'vitest';
import {
  backfillSowingDates,
  earlierScans,
  registerSowingDateBackfillHandlers,
  type SowingDateBackfillDbLike,
} from '../../src/main/sowing-date-backfill';

type Scan = {
  experiment_id: string;
  wave_number: number;
  capture_date: Date;
  plant_age_days: number;
};

const on = (
  day: number,
  age: number,
  wave = 1,
  experiment = 'exp-A'
): Scan => ({
  experiment_id: experiment,
  wave_number: wave,
  capture_date: new Date(2026, 9, day, 10),
  plant_age_days: age,
});
const times = (n: number, s: Scan) =>
  Array.from({ length: n }, () => ({ ...s }));

/** A fake of the tables the backfill reads and writes. */
function fakeDb(
  scans: Scan[],
  dated: { experiment_id: string; wave_number: number }[] = []
) {
  const created: Record<string, unknown>[] = [];
  const db = {
    scan: {
      findMany: vi.fn(async ({ where }) =>
        scans.filter(
          (s) => !where.experiment_id || s.experiment_id === where.experiment_id
        )
      ),
    },
    cylinderWave: {
      findMany: vi.fn(async (args) =>
        dated.filter(
          (w) => !args?.where || w.experiment_id === args.where.experiment_id
        )
      ),
      create: vi.fn(async ({ data }) => {
        if (
          dated.some(
            (w) =>
              w.experiment_id === data.experiment_id &&
              w.wave_number === data.wave_number
          )
        ) {
          throw new Error('Unique constraint failed');
        }
        created.push(data);
        return data;
      }),
    },
    experiment: {
      findMany: vi.fn(async () => [
        { id: 'exp-A', name: 'Sorghum_GWAS_Group1' },
        { id: 'exp-B', name: 'Sorghum_GWAS_Group2' },
      ]),
    },
  };
  return { db: db as unknown as SowingDateBackfillDbLike, raw: db, created };
}

describe('backfillSowingDates', () => {
  it('sets each undated wave whose earlier scans agree, with a note and no phenotyper', async () => {
    // Wave 1 sown 9 Oct: day 9 and day 12 scans.
    const fake = fakeDb([...times(50, on(18, 9)), ...times(50, on(21, 12))]);
    const result = await backfillSowingDates(fake.db, () => {});
    expect(fake.created).toEqual([
      {
        experiment_id: 'exp-A',
        wave_number: 1,
        sowing_date: '2026-10-09',
        note: 'Worked out from 100 of 100 earlier scans.',
        set_by_phenotyper_id: null,
      },
    ]);
    expect(result.set).toEqual([
      expect.objectContaining({
        experiment: 'Sorghum_GWAS_Group1',
        wave_number: 1,
        sowingDate: '2026-10-09',
      }),
    ]);
    expect(result.leftForOperator).toEqual([]);
  });

  it('leaves a wave whose scans disagree for the operator, with its candidates', async () => {
    const fake = fakeDb([
      ...times(80, on(24, 12, 2)),
      ...times(20, on(27, 12, 2)),
    ]);
    const result = await backfillSowingDates(fake.db, () => {});
    expect(fake.created).toEqual([]);
    expect(result.leftForOperator).toEqual([
      {
        experiment: 'Sorghum_GWAS_Group1',
        wave_number: 2,
        scanCount: 100,
        agreeing: 80,
        sowingDate: null,
        candidates: [
          { date: '2026-10-12', count: 80 },
          { date: '2026-10-15', count: 20 },
        ],
      },
    ]);
  });

  it('writes nothing in a dry run, but reports what it would set', async () => {
    const fake = fakeDb(times(10, on(23, 14)));
    const result = await backfillSowingDates(fake.db, () => {}, {
      dryRun: true,
    });
    expect(fake.raw.cylinderWave.create).not.toHaveBeenCalled();
    expect(result.set.map((w) => w.sowingDate)).toEqual(['2026-10-09']);
  });

  it('never touches a wave that already has a date', async () => {
    const fake = fakeDb(times(10, on(23, 14)), [
      { experiment_id: 'exp-A', wave_number: 1 },
    ]);
    const result = await backfillSowingDates(fake.db, () => {});
    expect(fake.raw.cylinderWave.create).not.toHaveBeenCalled();
    expect(result).toEqual({ set: [], leftForOperator: [] });
  });

  it('only reads non-deleted CylinderScan scans', async () => {
    const fake = fakeDb([]);
    await backfillSowingDates(fake.db, () => {});
    expect(fake.raw.scan.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          deleted: false,
          experiment: { experiment_type: 'cylinderscan' },
        },
      })
    );
  });

  it('keeps going when a wave was dated meanwhile, and logs it', async () => {
    const fake = fakeDb([
      ...times(5, on(23, 14, 1)),
      ...times(5, on(23, 14, 2)),
    ]);
    fake.raw.cylinderWave.create.mockRejectedValueOnce(
      new Error('Unique constraint failed')
    );
    const log = vi.fn();
    const result = await backfillSowingDates(fake.db, log);
    expect(result.set.map((w) => w.wave_number)).toEqual([2]);
    expect(log).toHaveBeenCalledWith(
      expect.stringMatching(
        /^\[SowingDateBackfill\] Skipped wave 1 of Sorghum_GWAS_Group1/
      )
    );
  });
});

describe('earlierScans', () => {
  it("describes an undated wave's earlier scans and every scanned wave number", async () => {
    const fake = fakeDb(
      [
        ...times(80, on(24, 12, 2)),
        ...times(20, on(27, 12, 2)),
        ...times(3, on(23, 14, 1)),
      ],
      [{ experiment_id: 'exp-A', wave_number: 1 }]
    );
    expect(await earlierScans(fake.db, 'exp-A', 2)).toEqual({
      scanCount: 100,
      agreeing: 80,
      candidates: [
        { date: '2026-10-12', count: 80 },
        { date: '2026-10-15', count: 20 },
      ],
      scannedWaveNumbers: [1, 2],
    });
  });

  it('has nothing for a wave without earlier scans', async () => {
    const fake = fakeDb(times(3, on(23, 14, 1)));
    expect(await earlierScans(fake.db, 'exp-A', 3)).toEqual({
      scanCount: 0,
      agreeing: 0,
      candidates: [],
      scannedWaveNumbers: [1],
    });
  });
});

describe('registerSowingDateBackfillHandlers', () => {
  it('answers db:cylinderWaves:earlierScans and checks its input', async () => {
    const handle = vi.fn();
    registerSowingDateBackfillHandlers({
      ipcMain: { handle },
      db: fakeDb([]).db,
    });
    expect(handle).toHaveBeenCalledWith(
      'db:cylinderWaves:earlierScans',
      expect.any(Function)
    );
    const handler = handle.mock.calls[0][1];
    expect((await handler({}, 'exp-A', 1)).success).toBe(true);
    expect((await handler({}, ' ', 1)).success).toBe(false);
    expect((await handler({}, 'exp-A', -1)).success).toBe(false);
  });

  it('returns a database error instead of throwing', async () => {
    const handle = vi.fn();
    const fake = fakeDb([]);
    fake.raw.scan.findMany.mockRejectedValue(new Error('database is locked'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    registerSowingDateBackfillHandlers({ ipcMain: { handle }, db: fake.db });
    expect(await handle.mock.calls[0][1]({}, 'exp-A', 1)).toEqual({
      success: false,
      error: 'database is locked',
    });
  });
});
