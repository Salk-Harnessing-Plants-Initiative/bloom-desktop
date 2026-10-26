import { describe, it, expect, vi } from 'vitest';
import {
  backfillSowingDates,
  type SowingDateBackfillDbLike,
} from '../../src/main/sowing-date-backfill';

type Scan = {
  experiment_id: string;
  wave_number: number;
  plant_id: string;
  capture_date: Date;
  plant_age_days: number;
};

const on = (day: number, age: number, wave = 1, plant = 'PLANT_001'): Scan => ({
  experiment_id: 'exp-A',
  wave_number: wave,
  plant_id: plant,
  capture_date: new Date(2026, 9, day, 10),
  plant_age_days: age,
});
const times = (n: number, s: Scan) =>
  Array.from({ length: n }, () => ({ ...s }));

/** A fake of the tables the backfill reads and writes. Writes are remembered. */
function fakeDb(
  scans: Scan[],
  dated: { experiment_id: string; wave_number: number }[] = []
) {
  const waves: Record<string, unknown>[] = [];
  const changes: Record<string, unknown>[] = [];
  const createWave = vi.fn(async ({ data }) => {
    const row = { id: `w${waves.length + 1}`, ...data };
    waves.push(row);
    dated.push(data);
    return row;
  });
  const createChange = vi.fn(async ({ data }) => {
    changes.push(data);
    return data;
  });
  const db = {
    scan: { findMany: vi.fn(async () => scans) },
    cylinderWave: { findMany: vi.fn(async () => dated) },
    experiment: {
      findMany: vi.fn(async () => [
        { id: 'exp-A', name: 'Sorghum_GWAS_Group1' },
      ]),
    },
    $transaction: vi.fn(async (fn) =>
      fn({
        cylinderWave: { create: createWave },
        cylinderWaveSowingDateChange: { create: createChange },
      })
    ),
  };
  return {
    db: db as unknown as SowingDateBackfillDbLike,
    raw: db,
    waves,
    changes,
    createWave,
  };
}

describe('backfillSowingDates', () => {
  it('sets an agreeing wave, logged as set by admin with how it was worked out', async () => {
    // Wave 1 sown 9 Oct: day 9 and day 12 scans.
    const fake = fakeDb([...times(50, on(18, 9)), ...times(50, on(21, 12))]);
    const result = await backfillSowingDates(fake.db, () => {});
    expect(fake.waves).toEqual([
      {
        id: 'w1',
        experiment_id: 'exp-A',
        wave_number: 1,
        sowing_date: '2026-10-09',
        note: null,
        set_by_phenotyper_id: null,
      },
    ]);
    expect(fake.changes).toEqual([
      {
        wave_id: 'w1',
        old_sowing_date: null,
        new_sowing_date: '2026-10-09',
        reason: expect.stringMatching(
          /^Set from earlier scans .+: 100 of 100 point to /
        ),
        changed_by_phenotyper_id: null,
      },
    ]);
    expect(result.set).toEqual([
      expect.objectContaining({
        experiment: 'Sorghum_GWAS_Group1',
        wave_number: 1,
        sowingDate: '2026-10-09',
        disputed: false,
      }),
    ]);
    expect(result.failed).toEqual([]);
  });

  it('sets a disputed wave to its most common date, and logs the others', async () => {
    const fake = fakeDb([
      ...times(60, on(24, 12, 2)),
      ...times(40, on(27, 12, 2)),
    ]);
    const result = await backfillSowingDates(fake.db, () => {});
    expect(result.set).toEqual([
      expect.objectContaining({
        wave_number: 2,
        sowingDate: '2026-10-12',
        disputed: true,
      }),
    ]);
    expect(fake.changes[0]).toMatchObject({
      reason: expect.stringMatching(
        /60 of 100 point to .+; others point to .+ \(40 scans\)\.$/
      ),
    });
  });

  it('lists scans whose typed age does not fit, and changes no scan', async () => {
    const fake = fakeDb([...times(9, on(23, 14)), on(23, 21, 1, 'PLANT_031')]);
    const result = await backfillSowingDates(fake.db, () => {});
    expect(result.ageMismatches).toEqual([
      {
        experiment: 'Sorghum_GWAS_Group1',
        wave_number: 1,
        plant_id: 'PLANT_031',
        captured: '2026-10-23',
        typed_age: 21,
        age_from_date: 14,
      },
    ]);
    // The fake has no way to change a scan, and the backfill uses none.
    expect(Object.keys(fake.raw.scan)).toEqual(['findMany']);
  });

  it('writes nothing in a dry run, but reports what it would set and the mismatches', async () => {
    const fake = fakeDb([...times(9, on(23, 14)), on(23, 21)]);
    const result = await backfillSowingDates(fake.db, () => {}, {
      dryRun: true,
    });
    expect(fake.raw.$transaction).not.toHaveBeenCalled();
    expect(result.set.map((w) => w.sowingDate)).toEqual(['2026-10-09']);
    expect(result.ageMismatches).toHaveLength(1);
  });

  it('never touches a wave that already has a date', async () => {
    const fake = fakeDb(times(10, on(23, 14)), [
      { experiment_id: 'exp-A', wave_number: 1 },
    ]);
    const result = await backfillSowingDates(fake.db, () => {});
    expect(fake.raw.$transaction).not.toHaveBeenCalled();
    expect(result).toEqual({ set: [], failed: [], ageMismatches: [] });
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

  it('reports a wave that could not be set, and carries on with the rest', async () => {
    const fake = fakeDb([
      ...times(5, on(23, 14, 1)),
      ...times(5, on(23, 14, 2)),
    ]);
    fake.raw.$transaction.mockRejectedValueOnce(
      new Error('database is locked')
    );
    const log = vi.fn();
    const result = await backfillSowingDates(fake.db, log);
    expect(result.failed).toEqual([
      {
        experiment: 'Sorghum_GWAS_Group1',
        wave_number: 1,
        error: 'database is locked',
      },
    ]);
    expect(result.set.map((w) => w.wave_number)).toEqual([2]);
    expect(log).toHaveBeenCalledWith(
      "[SowingDateBackfill] Couldn't set wave 1 of Sorghum_GWAS_Group1: database is locked"
    );
  });

  it('writes the date and its log entry together: a failed log entry fails the wave', async () => {
    const fake = fakeDb(times(5, on(23, 14)));
    // As Prisma does, the transaction fails if anything inside it fails.
    fake.raw.$transaction.mockImplementationOnce(async () => {
      throw new Error('log entry rejected');
    });
    const result = await backfillSowingDates(fake.db, () => {});
    expect(result.set).toEqual([]);
    expect(result.failed[0].error).toBe('log entry rejected');
  });

  it('finds nothing more to do the second time', async () => {
    const fake = fakeDb(times(10, on(23, 14)));
    await backfillSowingDates(fake.db, () => {});
    const again = await backfillSowingDates(fake.db, () => {});
    expect(again).toEqual({ set: [], failed: [], ageMismatches: [] });
    expect(fake.createWave).toHaveBeenCalledTimes(1);
  });
});
