/**
 * Unit tests: Export Scans' experiment and day lists (#436).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  listExperimentScanCounts,
  listExperimentScanDays,
  registerScanGroupsHandlers,
  type ScanGroupsDbLike,
} from '../../src/main/scan-groups-handlers';

interface FakeScan {
  experiment_id: string;
  capture_date: Date;
  deleted: boolean;
}

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
    scan: {
      groupBy: vi.fn(async () => {
        const counts = new Map<string, number>();
        for (const s of scans.filter((s) => !s.deleted)) {
          counts.set(s.experiment_id, (counts.get(s.experiment_id) ?? 0) + 1);
        }
        return [...counts].map(([experiment_id, n]) => ({
          experiment_id,
          _count: { _all: n },
        }));
      }),
      findMany: vi.fn(
        async (args: { where: { experiment_id: string; deleted: false } }) =>
          scans
            .filter(
              (s) => s.experiment_id === args.where.experiment_id && !s.deleted
            )
            .map((s) => ({ capture_date: s.capture_date }))
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

const scan = (
  experiment_id: string,
  capture_date: Date,
  deleted = false
): FakeScan => ({ experiment_id, capture_date, deleted });

describe('listExperimentScanCounts', () => {
  it('counts non-deleted scans per experiment, sorted by name', async () => {
    const { db } = fakeDb([
      scan('kcs', local(1, 9)),
      scan('kcs', local(2, 9)),
      scan('kcs', local(2, 10), true),
      scan('weep', local(28, 10)),
      scan('alf', local(5, 9)),
    ]);
    expect(await listExperimentScanCounts({ db })).toEqual({
      success: true,
      data: [
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
        {
          experiment_id: 'weep',
          experiment_name: 'weep6-MBZ-Interaction-EXP1',
          scan_count: 1,
        },
      ],
    });
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
    raw.scan.groupBy.mockRejectedValue(new Error('database is locked'));
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

describe('registerScanGroupsHandlers', () => {
  it('registers both requests', async () => {
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
  });
});
