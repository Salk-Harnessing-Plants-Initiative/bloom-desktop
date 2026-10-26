import { describe, it, expect, vi } from 'vitest';
import {
  backfillSowingDates,
  type SowingDateBackfillDbLike,
} from '../../src/main/sowing-date-backfill';

type Scan = {
  id: string;
  experiment_id: string;
  wave_number: number;
  plant_id: string;
  accession_name: string | null;
  phenotyper_id: string;
  scanner_name: string;
  path: string;
  capture_date: Date;
  plant_age_days: number;
};

let nextScan = 0;
const on = (day: number, age: number, wave = 1, plant = 'PLANT_001'): Scan => ({
  id: `scan-${++nextScan}`,
  experiment_id: 'exp-A',
  wave_number: wave,
  plant_id: plant,
  accession_name: 'Accession_A',
  phenotyper_id: 'ph-1',
  scanner_name: 'Scanner1',
  path: `2026-10-${day}/${plant}/uuid`,
  capture_date: new Date(2026, 9, day, 10),
  plant_age_days: age,
});
/** `n` scans like `s`, each with its own id. */
const times = (n: number, s: Scan) =>
  Array.from({ length: n }, (_, i) => ({ ...s, id: `${s.id}-${i}` }));

/** Image upload statuses per scan id; scans not listed have none. */
let imageStatuses: Record<string, string[]> = {};

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
    phenotyper: {
      findMany: vi.fn(async () => [{ id: 'ph-1', name: 'Demo Phenotyper' }]),
    },
    image: {
      groupBy: vi.fn(async ({ where }) =>
        (where.scan_id.in as string[]).flatMap((scanId) => {
          const counts = new Map<string, number>();
          for (const s of imageStatuses[scanId] ?? [])
            counts.set(s, (counts.get(s) ?? 0) + 1);
          return [...counts].map(([status, n]) => ({
            scan_id: scanId,
            status,
            _count: { _all: n },
          }));
        })
      ),
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
    const wrong = on(23, 21, 1, 'PLANT_031');
    imageStatuses = {
      [wrong.id]: [...Array(70).fill('uploaded'), 'pending', 'failed'],
    };
    const fake = fakeDb([...times(9, on(23, 14)), wrong]);
    const result = await backfillSowingDates(fake.db, () => {});
    // Everything needed to find the scan here and in Bloom, and to decide the fix.
    expect(result.ageMismatches).toEqual([
      {
        scan_id: wrong.id,
        experiment_id: 'exp-A',
        experiment: 'Sorghum_GWAS_Group1',
        wave_number: 1,
        plant_id: 'PLANT_031',
        accession_name: 'Accession_A',
        phenotyper: 'Demo Phenotyper',
        scanner_name: 'Scanner1',
        path: '2026-10-23/PLANT_031/uuid',
        capture_date: new Date(2026, 9, 23, 10).toISOString(),
        captured: '2026-10-23',
        typed_age: 21,
        age_from_date: 14,
        implied_start_date: '2026-10-02',
        wave_start_date: '2026-10-09',
        wave_disputed: false,
        images_uploaded: 70,
        images_total: 72,
      },
    ]);
    // The fake has no way to change a scan, and the backfill uses none.
    expect(Object.keys(fake.raw.scan)).toEqual(['findMany']);
  });

  it('marks mismatches from a wave whose scans disagreed', async () => {
    const fake = fakeDb([
      ...times(6, on(24, 12, 2)),
      ...times(4, on(27, 12, 2)),
    ]);
    const result = await backfillSowingDates(fake.db, () => {});
    expect(result.ageMismatches).toHaveLength(4);
    expect(result.ageMismatches.every((m) => m.wave_disputed)).toBe(true);
  });

  it('looks up images and phenotypers in chunks, and only for mismatched scans', async () => {
    imageStatuses = {};
    const fake = fakeDb([
      ...times(1200, on(23, 14)),
      ...times(1100, on(23, 2)),
    ]);
    const result = await backfillSowingDates(fake.db, () => {});
    expect(result.ageMismatches).toHaveLength(1100);
    const asked = fake.raw.image.groupBy.mock.calls.map(
      (c) => c[0].where.scan_id.in.length
    );
    expect(asked).toEqual([500, 500, 100]);
    expect(result.ageMismatches[0]).toMatchObject({
      images_uploaded: 0,
      images_total: 0,
    });
  });

  it("makes no lookups when there's nothing mismatched", async () => {
    const fake = fakeDb(times(10, on(23, 14)));
    await backfillSowingDates(fake.db, () => {});
    expect(fake.raw.image.groupBy).not.toHaveBeenCalled();
    expect(fake.raw.phenotyper.findMany).not.toHaveBeenCalled();
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
