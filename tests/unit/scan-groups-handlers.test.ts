/**
 * Unit tests: Export Scans' experiment and day lists (#436).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  listDayScans,
  listExperimentScanCounts,
  listExperimentScanDays,
  readFilter,
  registerScanGroupsHandlers,
  type ScanGroupsDbLike,
} from '../../src/main/scan-groups-handlers';

interface FakeScan {
  id: string;
  experiment_id: string;
  capture_date: Date;
  deleted: boolean;
  phenotyper_id: string;
  plant_id: string;
}

const PHENOTYPERS: Record<string, string> = {
  emily: 'Emily Smith',
  ana: 'Ana Lopez',
};

const EXPERIMENTS = [
  { id: 'kcs', name: 'KCS-drought-2026' },
  { id: 'weep', name: 'weep6-MBZ-Interaction-EXP1' },
  { id: 'alf', name: 'Alfalfa-wave3' },
];

/** A local time, so the day boundaries are the station's. */
const local = (day: number, hour: number, minute = 0) =>
  new Date(2026, 9, day, hour, minute);

function fakeDb(scans: FakeScan[]) {
  const db = {
    // The grouped count: one row per experiment with non-deleted scans, its count
    // (SQLite's COUNT comes back as a BigInt) and its most recent capture in ms.
    // The ids near one day: an experiment's non-deleted scans in [fromMs, toMs).
    $queryRawUnsafe: vi.fn(async (sql: string, ...values: unknown[]) => {
      if (sql.includes('SELECT "id"')) {
        const [experimentId, fromMs, toMs] = values as [string, number, number];
        return scans
          .filter(
            (s) =>
              !s.deleted &&
              s.experiment_id === experimentId &&
              s.capture_date.getTime() >= fromMs &&
              s.capture_date.getTime() < toMs
          )
          .map((s) => ({ id: s.id }));
      }
      const groups = new Map<string, { n: number; latest: number }>();
      for (const s of scans.filter((s) => !s.deleted)) {
        const g = groups.get(s.experiment_id) ?? { n: 0, latest: 0 };
        g.n += 1;
        g.latest = Math.max(g.latest, s.capture_date.getTime());
        groups.set(s.experiment_id, g);
      }
      return [...groups].map(([experiment_id, g]) => ({
        experiment_id,
        scan_count: BigInt(g.n),
        latest_ms: g.latest,
      }));
    }),
    scan: {
      findMany: vi.fn(
        async (args: {
          where: { experiment_id?: string; id?: { in: string[] } };
        }) =>
          scans
            .filter(
              (s) =>
                !s.deleted &&
                (!args.where.experiment_id ||
                  s.experiment_id === args.where.experiment_id) &&
                (!args.where.id || args.where.id.in.includes(s.id))
            )
            .map((s) => ({
              id: s.id,
              experiment_id: s.experiment_id,
              plant_id: s.plant_id,
              capture_date: s.capture_date,
              scanner_name: 'SlowScanner',
              experiment: {
                name: EXPERIMENTS.find((e) => e.id === s.experiment_id)!.name,
              },
              phenotyper: { name: PHENOTYPERS[s.phenotyper_id] },
            }))
      ),
    },
    experiment: {
      findMany: vi.fn(async (args: { where: { id: { in: string[] } } }) =>
        EXPERIMENTS.filter((e) => args.where.id.in.includes(e.id))
      ),
    },
  };
  return { db: db as ScanGroupsDbLike, raw: db };
}

let nextId = 0;
const scan = (
  experiment_id: string,
  capture_date: Date,
  deleted = false,
  phenotyper_id = 'emily',
  plant_id = 'PLANT-1'
): FakeScan => ({
  id: `scan-${++nextId}`,
  experiment_id,
  capture_date,
  deleted,
  phenotyper_id,
  plant_id,
});

describe('listExperimentScanCounts', () => {
  it('counts non-deleted scans per experiment, most recent scan first', async () => {
    const { db } = fakeDb([
      scan('kcs', local(1, 9)),
      scan('kcs', local(2, 9)),
      // Deleted: neither counted nor used for the order.
      scan('kcs', local(30, 10), true),
      scan('weep', local(28, 10)),
      scan('alf', local(5, 9)),
    ]);
    expect(await listExperimentScanCounts({ db })).toEqual({
      success: true,
      data: [
        {
          experiment_id: 'weep',
          experiment_name: 'weep6-MBZ-Interaction-EXP1',
          scan_count: 1,
        },
        {
          experiment_id: 'alf',
          experiment_name: 'Alfalfa-wave3',
          scan_count: 1,
        },
        {
          experiment_id: 'kcs',
          experiment_name: 'KCS-drought-2026',
          scan_count: 2,
        },
      ],
    });
  });

  it('orders experiments with the same most recent scan time by name', async () => {
    const { db } = fakeDb([
      scan('weep', local(28, 10)),
      scan('kcs', local(28, 10)),
      scan('alf', local(28, 10)),
    ]);
    const result = await listExperimentScanCounts({ db });
    expect(result.data?.map((e) => e.experiment_id)).toEqual([
      'alf',
      'kcs',
      'weep',
    ]);
  });

  it('leaves out experiments whose scans are all deleted', async () => {
    const { db } = fakeDb([
      scan('kcs', local(1, 9)),
      scan('weep', local(28, 10), true),
    ]);
    const result = await listExperimentScanCounts({ db });
    expect(result.data?.map((e) => e.experiment_id)).toEqual(['kcs']);
  });

  it('returns an empty list with no scans', async () => {
    const { db } = fakeDb([]);
    expect(await listExperimentScanCounts({ db })).toEqual({
      success: true,
      data: [],
    });
  });

  it('reports a database error', async () => {
    const { db, raw } = fakeDb([]);
    raw.$queryRawUnsafe.mockRejectedValue(new Error('database is locked'));
    expect(await listExperimentScanCounts({ db })).toEqual({
      success: false,
      error: 'database is locked',
    });
  });
});

describe('listExperimentScanDays', () => {
  it('lists local days with their counts, newest first, without deleted scans', async () => {
    const { db } = fakeDb([
      scan('weep', local(28, 10)),
      scan('weep', local(28, 11)),
      scan('weep', local(4, 9)),
      scan('weep', local(4, 9, 30), true),
      scan('kcs', local(28, 10)),
    ]);
    expect(await listExperimentScanDays({ db }, 'weep')).toEqual({
      success: true,
      data: [
        { day: '2026-10-28', scan_count: 2 },
        { day: '2026-10-04', scan_count: 1 },
      ],
    });
  });

  it('splits days at local midnight', async () => {
    const { db } = fakeDb([
      scan('weep', local(27, 23, 59)),
      scan('weep', local(28, 0, 1)),
    ]);
    const result = await listExperimentScanDays({ db }, 'weep');
    expect(result.data).toEqual([
      { day: '2026-10-28', scan_count: 1 },
      { day: '2026-10-27', scan_count: 1 },
    ]);
  });

  it('returns no days for an experiment with no scans', async () => {
    const { db } = fakeDb([scan('kcs', local(1, 9))]);
    expect(await listExperimentScanDays({ db }, 'weep')).toEqual({
      success: true,
      data: [],
    });
  });

  it('rejects a missing experiment id without reading', async () => {
    const { db, raw } = fakeDb([]);
    expect((await listExperimentScanDays({ db }, ' ')).success).toBe(false);
    expect(raw.scan.findMany).not.toHaveBeenCalled();
  });

  it('reports a database error', async () => {
    const { db, raw } = fakeDb([]);
    raw.scan.findMany.mockRejectedValue(new Error('disk I/O error'));
    expect(await listExperimentScanDays({ db }, 'weep')).toEqual({
      success: false,
      error: 'disk I/O error',
    });
  });
});

describe('filters (#471)', () => {
  const SCANS = () => [
    scan('weep', local(20, 11), false, 'emily', 'ECQM33-005-1-10'),
    scan('weep', local(20, 23, 30), false, 'ana', 'ECQM33-001-1-2'),
    scan('weep', local(19, 9), false, 'emily', 'WT-SEM-3'),
    scan('kcs', local(20, 10), false, 'ana', 'KCS-1'),
    scan('kcs', local(20, 10, 5), true, 'emily', 'KCS-2'),
    scan('alf', local(1, 9), false, 'emily', 'ALF-1'),
  ];

  it('counts only matching scans, most recent matching scan first', async () => {
    const { db } = fakeDb(SCANS());
    const result = await listExperimentScanCounts({ db }, { search: 'emily' });
    expect(result.data).toEqual([
      {
        experiment_id: 'weep',
        experiment_name: 'weep6-MBZ-Interaction-EXP1',
        scan_count: 2,
      },
      { experiment_id: 'alf', experiment_name: 'Alfalfa-wave3', scan_count: 1 },
    ]);
  });

  it('uses the grouped query only without a filter', async () => {
    const { db, raw } = fakeDb(SCANS());
    await listExperimentScanCounts({ db }, {});
    expect(raw.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    await listExperimentScanCounts({ db }, { search: 'emily' });
    expect(raw.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it.each([
    [{ search: 'emi' }],
    [{ search: 'Oct 20, 2026' }],
    [{ search: '005-1' }],
    [{ search: 'weep' }],
    [{ search: 'ana' }],
    [{ search: 'kcs' }],
    [{ search: 'oct 2026' }],
    [{ dateFrom: '2026-10-20', dateTo: '2026-10-20' }],
    [{ search: 'emily', dateFrom: '2026-10-19' }],
  ])(
    'with %j, each count equals its days, and each day what opening it lists',
    async (filter) => {
      const { db } = fakeDb(SCANS());
      const counts = (await listExperimentScanCounts({ db }, filter)).data!;
      expect(counts.length).toBeGreaterThan(0);
      for (const exp of counts) {
        const days = (
          await listExperimentScanDays({ db }, exp.experiment_id, filter)
        ).data!;
        expect(days.reduce((n, d) => n + d.scan_count, 0)).toBe(exp.scan_count);
        for (const d of days) {
          const listed = (
            await listDayScans({ db }, exp.experiment_id, d.day, filter)
          ).data!;
          expect(listed).toHaveLength(d.scan_count);
        }
      }
    }
  );

  it('matches a typed date by local day, late in the evening too', async () => {
    const { db } = fakeDb(SCANS());
    const days = await listExperimentScanDays({ db }, 'weep', {
      search: 'Oct 20, 2026',
    });
    expect(days.data).toEqual([{ day: '2026-10-20', scan_count: 2 }]);
  });

  it("lists a day's matching scans newest first, as summaries", async () => {
    const { db } = fakeDb(SCANS());
    const result = await listDayScans({ db }, 'weep', '2026-10-20', {});
    expect(result.data?.map((s) => s.plant_id)).toEqual([
      'ECQM33-001-1-2',
      'ECQM33-005-1-10',
    ]);
    expect(result.data?.[0]).toEqual({
      id: expect.any(String),
      experiment_id: 'weep',
      plant_id: 'ECQM33-001-1-2',
      capture_date: local(20, 23, 30),
      scanner_name: 'SlowScanner',
      experiment: { name: 'weep6-MBZ-Interaction-EXP1' },
    });
  });

  it('reads only the scans near a day, not the whole experiment', async () => {
    const { db, raw } = fakeDb([
      scan('weep', local(1, 9)),
      scan('weep', local(19, 23, 59)),
      scan('weep', local(20, 0, 0)),
      scan('weep', local(20, 23, 59)),
      scan('weep', local(21, 0, 0)),
      scan('weep', local(28, 9)),
    ]);
    const result = await listDayScans({ db }, 'weep', '2026-10-20', {});
    expect(result.data?.map((s) => s.capture_date)).toEqual([
      local(20, 23, 59),
      local(20, 0, 0),
    ]);
    const asked = raw.scan.findMany.mock.calls[0][0].where.id?.in ?? [];
    expect(asked).toHaveLength(4); // the day itself, and the two neighbours
  });

  it("with no day, lists every day's matching scans in one read, newest first", async () => {
    const { db, raw } = fakeDb(SCANS());
    const result = await listDayScans({ db }, 'weep', null, {
      search: 'emily',
    });
    expect(result.data?.map((s) => s.plant_id)).toEqual([
      'ECQM33-005-1-10',
      'WT-SEM-3',
    ]);
    expect(raw.scan.findMany).toHaveBeenCalledTimes(1);
  });

  it('never lists deleted scans', async () => {
    const { db } = fakeDb(SCANS());
    const result = await listDayScans({ db }, 'kcs', '2026-10-20', {
      search: 'KCS-2',
    });
    expect(result.data).toEqual([]);
  });

  it('rejects a bad day or filter without reading', async () => {
    const { db, raw } = fakeDb(SCANS());
    expect((await listDayScans({ db }, 'weep', 'Oct 20')).success).toBe(false);
    expect((await listDayScans({ db }, 'weep', undefined)).success).toBe(false);
    expect((await listExperimentScanCounts({ db }, 'soy')).success).toBe(false);
    expect(
      (await listExperimentScanCounts({ db }, { dateFrom: '2026-13-01' }))
        .success
    ).toBe(false);
    expect(
      (await listExperimentScanDays({ db }, 'weep', { search: 5 })).success
    ).toBe(false);
    expect(raw.scan.findMany).not.toHaveBeenCalled();
  });
});

describe('readFilter', () => {
  it('keeps set parts and drops empty ones', () => {
    expect(readFilter(undefined)).toEqual({});
    expect(readFilter({ search: '', dateFrom: '' })).toEqual({});
    expect(
      readFilter({ search: 'soy', dateFrom: '2026-11-01', other: 1 })
    ).toEqual({ search: 'soy', dateFrom: '2026-11-01' });
  });

  it('refuses wrong types and dates', () => {
    expect(readFilter('soy')).toBe('filter must be an object');
    expect(readFilter({ search: 5 })).toBe('search must be a string');
    expect(readFilter({ dateTo: '11/20/2026' })).toBe(
      'dateTo must be a date (YYYY-MM-DD)'
    );
  });
});

describe('registerScanGroupsHandlers', () => {
  it('registers the three requests', async () => {
    const { db } = fakeDb([scan('weep', local(28, 10))]);
    const handlers = new Map<string, (...args: unknown[]) => unknown>();
    registerScanGroupsHandlers({
      db,
      ipcMain: {
        handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
          handlers.set(channel, fn);
        },
      } as never,
    });
    expect(await handlers.get('db:scans:experimentCounts')!({})).toMatchObject({
      success: true,
    });
    expect(await handlers.get('db:scans:experimentDays')!({}, 'weep')).toEqual({
      success: true,
      data: [{ day: '2026-10-28', scan_count: 1 }],
    });
    expect(
      await handlers.get('db:scans:dayScans')!({}, 'weep', '2026-10-28', {
        search: 'oct 28',
      })
    ).toMatchObject({ success: true, data: [{ experiment_id: 'weep' }] });
  });
});
