import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  MAX_WAVES_SHOWN,
  MISMATCH_COLUMNS,
  backfillHadProblems,
  mismatchesCsv,
  parseSowingDateBackfillArgs,
  runSowingDateBackfill,
  summarizeSowingDateBackfill,
  type SowingDateBackfillOutcome,
} from '../../src/main/sowing-date-backfill-run';
import type { SowingDateBackfillDbLike } from '../../src/main/sowing-date-backfill';

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
const on = (
  day: number,
  age: number,
  wave: number,
  plant = 'PLANT_001'
): Scan => ({
  id: `scan-${++nextScan}`,
  experiment_id: 'exp-A',
  wave_number: wave,
  plant_id: plant,
  accession_name: null,
  phenotyper_id: 'ph-1',
  scanner_name: 'Scanner1',
  path: `2026-10-${day}/${plant}/uuid`,
  capture_date: new Date(2026, 9, day, 10),
  plant_age_days: age,
});
/** `n` scans like `s`, each with its own id. */
const times = (n: number, s: Scan) =>
  Array.from({ length: n }, (_, i) => ({ ...s, id: `${s.id}-${i}` }));

/**
 * Wave 1's scans agree (sown 9 Oct) but one plant's age was typed wrongly; wave 2's
 * disagree (8 on 12 Oct, 2 on 15 Oct). Created waves are remembered.
 */
function fakeDb() {
  const scans = [
    ...times(10, on(23, 14, 1)),
    on(23, 21, 1, 'PLANT_031'),
    ...times(8, on(24, 12, 2)),
    ...times(2, on(27, 12, 2)),
  ];
  const dated: { experiment_id: string; wave_number: number }[] = [];
  const create = vi.fn(async ({ data }) => {
    dated.push(data);
    return { id: `w${dated.length}` };
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
      findMany: vi.fn(async () => [{ id: 'ph-1', name: 'Demo, Phenotyper' }]),
    },
    image: { groupBy: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn) =>
      fn({
        cylinderWave: { create },
        cylinderWaveSowingDateChange: { create: vi.fn(async () => ({})) },
      })
    ),
  };
  return { db: db as unknown as SowingDateBackfillDbLike, raw: db, create };
}

let logsDir: string;
beforeEach(() => {
  logsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sowing-backfill-'));
});
afterEach(() => fs.rmSync(logsDir, { recursive: true, force: true }));

const deps = (db: SowingDateBackfillDbLike, dir = logsDir) => ({
  db,
  databasePath: '/station/bloom.db',
  logsDir: dir,
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
    ).toEqual({
      dryRun: false,
    });
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
    const { db, raw } = fakeDb();
    const outcome = await runSowingDateBackfill({ dryRun: true }, deps(db));
    expect(raw.$transaction).not.toHaveBeenCalled();
    expect(path.basename(outcome.reportPath!)).toBe(
      'sowing-date-backfill-20261023-140512-dry-run.json'
    );
    expect(JSON.parse(fs.readFileSync(outcome.reportPath!, 'utf-8'))).toEqual(
      outcome.report
    );
    expect(outcome.report).toMatchObject({
      dryRun: true,
      appVersion: '0.2.2',
      databasePath: '/station/bloom.db',
      set: [
        expect.objectContaining({
          wave_number: 1,
          sowingDate: '2026-10-09',
          disputed: false,
        }),
        expect.objectContaining({
          wave_number: 2,
          sowingDate: '2026-10-12',
          disputed: true,
        }),
      ],
      failed: [],
      // PLANT_031's typed age, and wave 2's two scans that point to 15 Oct.
      ageMismatches: [
        expect.objectContaining({
          wave_number: 1,
          plant_id: 'PLANT_031',
          typed_age: 21,
          age_from_date: 14,
        }),
        expect.objectContaining({
          wave_number: 2,
          captured: '2026-10-27',
          typed_age: 12,
          age_from_date: 15,
        }),
        expect.objectContaining({
          wave_number: 2,
          captured: '2026-10-27',
          typed_age: 12,
          age_from_date: 15,
        }),
      ],
    });
    expect(backfillHadProblems(outcome)).toBe(false);
  });

  it('sets every wave, and finds nothing more to do the second time', async () => {
    const { db, create } = fakeDb();
    const first = await runSowingDateBackfill({ dryRun: false }, deps(db));
    expect(create).toHaveBeenCalledTimes(2);
    expect(path.basename(first.reportPath!)).toBe(
      'sowing-date-backfill-20261023-140512.json'
    );
    const second = await runSowingDateBackfill({ dryRun: false }, deps(db));
    expect(create).toHaveBeenCalledTimes(2);
    expect(second.report.set).toEqual([]);
  });

  it('still saves the report when a wave fails, and says there was a problem', async () => {
    const { db, raw } = fakeDb();
    raw.$transaction.mockRejectedValueOnce(new Error('database is locked'));
    const outcome = await runSowingDateBackfill({ dryRun: false }, deps(db));
    expect(outcome.report.failed).toEqual([
      expect.objectContaining({ wave_number: 1, error: 'database is locked' }),
    ]);
    expect(fs.existsSync(outcome.reportPath!)).toBe(true);
    expect(backfillHadProblems(outcome)).toBe(true);
  });

  it("keeps the result when the report can't be saved, and says why", async () => {
    const { db } = fakeDb();
    // A file where the logs directory should be, so it can't be created.
    const blocked = path.join(logsDir, 'not-a-dir');
    fs.writeFileSync(blocked, 'x');
    const outcome = await runSowingDateBackfill(
      { dryRun: false },
      deps(db, blocked)
    );
    expect(outcome.reportPath).toBeNull();
    expect(outcome.reportError).toBeTruthy();
    expect(outcome.report.set).toHaveLength(2);
    expect(backfillHadProblems(outcome)).toBe(true);
  });
});

describe('the age-mismatch CSV', () => {
  it('is saved next to the report, one row per scan, with everything needed to fix it', async () => {
    const { db } = fakeDb();
    const outcome = await runSowingDateBackfill({ dryRun: true }, deps(db));
    expect(path.basename(outcome.mismatchesPath!)).toBe(
      'sowing-date-backfill-20261023-140512-dry-run-age-mismatches.csv'
    );
    const lines = fs
      .readFileSync(outcome.mismatchesPath!, 'utf-8')
      .trimEnd()
      .split('\r\n');
    expect(lines[0]).toBe(MISMATCH_COLUMNS.join(','));
    expect(lines).toHaveLength(4);
    const first = lines[1].split(',');
    expect(first.slice(0, 4)).toEqual([
      'Sorghum_GWAS_Group1',
      'exp-A',
      '1',
      'PLANT_031',
    ]);
    // A value with a comma is quoted.
    expect(lines[1]).toContain('"Demo, Phenotyper"');
  });

  it('is not written when nothing is mismatched', async () => {
    const outcome = await runSowingDateBackfill(
      { dryRun: true },
      deps({
        ...fakeDb().db,
        scan: { findMany: vi.fn(async () => times(5, on(23, 14, 1))) },
      } as unknown as SowingDateBackfillDbLike)
    );
    expect(outcome.mismatchesPath).toBeNull();
    expect(fs.readdirSync(logsDir)).toEqual([
      'sowing-date-backfill-20261023-140512-dry-run.json',
    ]);
  });

  it('quotes values with commas, quotes or line breaks', () => {
    const csv = mismatchesCsv([
      {
        scan_id: 's1',
        experiment_id: 'e1',
        experiment: 'Exp "A", 2026',
        wave_number: 1,
        plant_id: 'P1',
        accession_name: null,
        phenotyper: 'Line\nbreak',
        scanner_name: 'S',
        path: 'p',
        capture_date: '2026-10-23T17:00:00.000Z',
        captured: '2026-10-23',
        typed_age: 21,
        age_from_date: 14,
        implied_start_date: '2026-10-02',
        wave_start_date: '2026-10-09',
        wave_disputed: false,
        images_uploaded: 72,
        images_total: 72,
      },
    ]);
    const row = csv.split('\r\n')[1];
    expect(row.startsWith('"Exp ""A"", 2026",e1,1,P1,,s1,')).toBe(true);
    expect(row).toContain('"Line\nbreak"');
  });
});

describe('summarizeSowingDateBackfill', () => {
  it('lists the waves set, the disputed ones with their other dates, the mismatches and the report', async () => {
    const { db } = fakeDb();
    const outcome = await runSowingDateBackfill({ dryRun: true }, deps(db));
    const text = summarizeSowingDateBackfill(outcome);
    expect(text).toContain(
      'Would set the start date of 2 wave(s) from their earlier scans. In 1 of them the scans disagree; the other dates are logged with the wave on the Experiments page.'
    );
    expect(text).toContain(
      '  Sorghum_GWAS_Group1, wave 1: 2026-10-09 (10 of 11 scans)'
    );
    expect(text).toContain(
      '  Sorghum_GWAS_Group1, wave 2: 2026-10-12 (8 of 10 scans); others: 2026-10-15 (2)'
    );
    expect(text).toContain(
      "3 scan(s) in 2 wave(s) have a typed age that doesn't match their wave's date, so it was probably typed wrongly. They are listed in the report, with what's needed to find each one here and in Bloom; nothing was changed."
    );
    expect(text).toMatch(
      /Report: .+sowing-date-backfill-20261023-140512-dry-run\.json$/
    );
  });

  const empty = (
    overrides: Partial<SowingDateBackfillOutcome['report']> = {}
  ): SowingDateBackfillOutcome => ({
    report: {
      ranAt: '',
      dryRun: false,
      appVersion: '0.2.2',
      databasePath: '',
      set: [],
      failed: [],
      ageMismatches: [],
      ...overrides,
    },
    reportPath: '/logs/r.json',
  });

  it('says there is nothing to do when every wave has a date', () => {
    expect(summarizeSowingDateBackfill(empty())).toBe(
      'Every wave with scans already has a start date. Nothing to do.\n\nReport: /logs/r.json'
    );
  });

  it("doesn't say 'nothing to do' when every wave failed", () => {
    const text = summarizeSowingDateBackfill(
      empty({
        failed: [
          {
            experiment: 'Sorghum_GWAS_Group1',
            wave_number: 3,
            error: 'database is locked',
          },
        ],
      })
    );
    expect(text).not.toContain('Nothing to do');
    expect(text).toContain(
      "Couldn't set 1 wave(s). Run this again to retry them:"
    );
    expect(text).toContain('  Sorghum_GWAS_Group1, wave 3: database is locked');
  });

  it('lists at most MAX_WAVES_SHOWN waves, then points to the report', () => {
    const set = Array.from({ length: MAX_WAVES_SHOWN + 5 }, (_, i) => ({
      experiment: 'Sorghum_GWAS_Group1',
      wave_number: i + 1,
      scanCount: 1,
      agreeing: 1,
      sowingDate: '2026-10-09',
      disputed: false,
      candidates: [{ date: '2026-10-09', count: 1 }],
    }));
    const text = summarizeSowingDateBackfill(empty({ set }));
    expect(
      text.split('\n').filter((l) => l.startsWith('  Sorghum_GWAS_Group1'))
    ).toHaveLength(MAX_WAVES_SHOWN);
    expect(text).toContain('  …and 5 more (see the report)');
  });

  it("says the waves were still set when the report couldn't be saved", () => {
    const outcome = { ...empty(), reportPath: null, reportError: 'EACCES' };
    expect(summarizeSowingDateBackfill(outcome)).toMatch(
      /The report couldn't be saved \(EACCES\)\. The waves above were still set\.$/
    );
  });
});
