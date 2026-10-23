import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  parseSowingDateBackfillArgs,
  runSowingDateBackfill,
  summarizeSowingDateBackfill,
} from '../../src/main/sowing-date-backfill-run';
import type { SowingDateBackfillDbLike } from '../../src/main/sowing-date-backfill';

type Scan = {
  experiment_id: string;
  wave_number: number;
  capture_date: Date;
  plant_age_days: number;
};

const on = (day: number, age: number, wave: number): Scan => ({
  experiment_id: 'exp-A',
  wave_number: wave,
  capture_date: new Date(2026, 9, day, 10),
  plant_age_days: age,
});
const times = (n: number, s: Scan) =>
  Array.from({ length: n }, () => ({ ...s }));

/** Wave 1's scans agree (sown 9 Oct); wave 2's don't. Created waves are remembered. */
function fakeDb() {
  const scans = [
    ...times(10, on(23, 14, 1)),
    ...times(8, on(24, 12, 2)),
    ...times(2, on(27, 12, 2)),
  ];
  const dated: { experiment_id: string; wave_number: number }[] = [];
  const create = vi.fn(async ({ data }) => {
    dated.push(data);
    return data;
  });
  const db = {
    scan: { findMany: vi.fn(async () => scans) },
    cylinderWave: { findMany: vi.fn(async () => dated), create },
    experiment: {
      findMany: vi.fn(async () => [
        { id: 'exp-A', name: 'Sorghum_GWAS_Group1' },
      ]),
    },
  };
  return { db: db as unknown as SowingDateBackfillDbLike, create };
}

let logsDir: string;
beforeEach(() => {
  logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sowing-backfill-'));
});
afterEach(() => fs.rmSync(logsDir, { recursive: true, force: true }));

const deps = (db: SowingDateBackfillDbLike) => ({
  db,
  databasePath: '/station/bloom.db',
  logsDir,
  appVersion: '0.2.2',
  now: () => new Date(2026, 9, 23, 14, 5, 12),
  log: () => {},
});

describe('parseSowingDateBackfillArgs', () => {
  it('is null for a normal start', () => {
    expect(parseSowingDateBackfillArgs(['Bloom Desktop.exe'])).toBeNull();
  });

  it('reads the dry-run flag', () => {
    expect(
      parseSowingDateBackfillArgs([
        'Bloom Desktop.exe',
        '--backfill-sowing-dates',
      ])
    ).toEqual({ dryRun: false });
    expect(
      parseSowingDateBackfillArgs([
        'Bloom Desktop.exe',
        '--backfill-sowing-dates',
        '--dry-run',
      ])
    ).toEqual({ dryRun: true });
  });
});

describe('runSowingDateBackfill', () => {
  it('previews without writing to the database, and keeps a report', async () => {
    const { db, create } = fakeDb();
    const { report, reportPath } = await runSowingDateBackfill(
      { dryRun: true },
      deps(db)
    );
    expect(create).not.toHaveBeenCalled();
    expect(path.basename(reportPath)).toBe(
      'sowing-date-backfill-20261023-140512-dry-run.json'
    );
    expect(JSON.parse(fs.readFileSync(reportPath, 'utf-8'))).toEqual(report);
    expect(report).toMatchObject({
      dryRun: true,
      appVersion: '0.2.2',
      databasePath: '/station/bloom.db',
      set: [
        expect.objectContaining({ wave_number: 1, sowingDate: '2026-10-09' }),
      ],
      leftForOperator: [
        expect.objectContaining({ wave_number: 2, sowingDate: null }),
      ],
    });
  });

  it('sets the agreeing waves, and finds nothing more to do the second time', async () => {
    const { db, create } = fakeDb();
    const first = await runSowingDateBackfill({ dryRun: false }, deps(db));
    expect(create).toHaveBeenCalledTimes(1);
    expect(path.basename(first.reportPath)).toBe(
      'sowing-date-backfill-20261023-140512.json'
    );
    expect(first.report.set.map((w) => w.sowingDate)).toEqual(['2026-10-09']);

    const second = await runSowingDateBackfill({ dryRun: false }, deps(db));
    expect(create).toHaveBeenCalledTimes(1);
    expect(second.report.set).toEqual([]);
    // Wave 2 stays for the operator until they set it on Capture Scan.
    expect(second.report.leftForOperator.map((w) => w.wave_number)).toEqual([
      2,
    ]);
  });
});

describe('summarizeSowingDateBackfill', () => {
  it('lists the waves set and the ones left for the operator, and the report', async () => {
    const { db } = fakeDb();
    const { report, reportPath } = await runSowingDateBackfill(
      { dryRun: true },
      deps(db)
    );
    const text = summarizeSowingDateBackfill(report, reportPath);
    expect(text).toContain(
      'Would set the start date of 1 wave(s) from their earlier scans.'
    );
    expect(text).toContain(
      '  Sorghum_GWAS_Group1, wave 1: 2026-10-09 (10 of 10 scans)'
    );
    expect(text).toContain(
      '1 wave(s) left for the operator (earlier scans disagree):'
    );
    expect(text).toContain(
      '  Sorghum_GWAS_Group1, wave 2: 2026-10-12 (8), 2026-10-15 (2)'
    );
    expect(text).toMatch(
      /Report: .+sowing-date-backfill-20261023-140512-dry-run\.json$/
    );
  });

  it('says there is nothing to do when every wave has a date', () => {
    const text = summarizeSowingDateBackfill(
      {
        ranAt: '',
        dryRun: false,
        appVersion: '0.2.2',
        databasePath: '',
        set: [],
        leftForOperator: [],
      },
      '/logs/r.json'
    );
    expect(text).toBe(
      'Every wave with scans already has a start date. Nothing to do.\n\nReport: /logs/r.json'
    );
  });
});
