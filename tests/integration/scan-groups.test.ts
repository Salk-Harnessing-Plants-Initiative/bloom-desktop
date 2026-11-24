/**
 * Integration test: Export Scans' experiment and day lists on a real database,
 * through the real Prisma client (#436). Scans from the pilot app may store
 * capture_date as text while newer ones store a number; both must be counted, on
 * the right local day.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import {
  listDayScans,
  listExperimentScanCounts,
  listExperimentScanDays,
} from '../../src/main/scan-groups-handlers';

const MIGRATIONS_DIR = path.join(__dirname, '../../prisma/migrations');

describe('scan groups on a real database', () => {
  let dir: string;
  let dbPath: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-scan-groups-'));
    dbPath = path.join(dir, 'bloom.db');
    const db = new Database(dbPath);
    for (const name of fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((n) => /^\d{14}_/.test(n))
      .sort()) {
      db.exec(
        fs.readFileSync(
          path.join(MIGRATIONS_DIR, name, 'migration.sql'),
          'utf8'
        )
      );
    }
    db.exec(`
      INSERT INTO "Phenotyper" ("id", "name", "email") VALUES ('ph', 'Ana', 'ana@example.org');
      INSERT INTO "Experiment" ("id", "name", "species") VALUES ('weep', 'weep6-MBZ', 'Arabidopsis');
      INSERT INTO "Experiment" ("id", "name", "species") VALUES ('alf', 'Alfalfa', 'Alfalfa');
    `);
    db.close();
    prisma = new PrismaClient({
      datasources: { db: { url: `file:${dbPath}` } },
    });
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function addScan(
    id: string,
    experiment: string,
    captured: number | string,
    deleted = false
  ) {
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO "Scan" ("id", "experiment_id", "phenotyper_id", "scanner_name", "plant_id",
        "path", "capture_date", "num_frames", "exposure_time", "gain", "brightness",
        "contrast", "gamma", "seconds_per_rot", "wave_number", "plant_age_days", "deleted")
       VALUES (?, ?, 'ph', 'PBIOBScanner', 'plant', ?, ?, 72, 6400, 250, 0, 0, 1, 7, 0, 10, ?)`
    ).run(id, experiment, `scans/${id}`, captured, deleted ? 1 : 0);
    db.close();
  }

  function db3Experiment(id: string, name: string) {
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO "Experiment" ("id", "name", "species") VALUES (?, ?, 'Arabidopsis')`
    ).run(id, name);
    db.close();
  }

  /**
   * "YYYY-MM-DD HH:MM:SS" as the pilot app's database wrote it: SQLite's
   * DEFAULT CURRENT_TIMESTAMP, which is UTC.
   */
  const pilotText = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ');

  it('counts scans per experiment, most recent first, with text and number dates and without deleted ones', async () => {
    addScan('a', 'weep', new Date(2026, 9, 28, 10).getTime());
    addScan('b', 'weep', pilotText(new Date(2026, 4, 18, 10)));
    addScan('c', 'weep', new Date(2026, 9, 28, 11).getTime(), true);
    addScan('d', 'alf', new Date(2026, 9, 1, 9).getTime());

    const result = await listExperimentScanCounts({ db: prisma });
    expect(result).toEqual({
      success: true,
      data: [
        { experiment_id: 'weep', experiment_name: 'weep6-MBZ', scan_count: 2 },
        { experiment_id: 'alf', experiment_name: 'Alfalfa', scan_count: 1 },
      ],
    });
  });

  it('places an experiment with only pilot text dates by its real date, not after every number date', async () => {
    // SQLite ranks any text above any number, so MAX over the raw column would put
    // this 2025 pilot experiment first. It must come after the 2026 one.
    addScan('a', 'alf', pilotText(new Date(2025, 5, 2, 10)));
    addScan('b', 'weep', new Date(2026, 10, 20, 11).getTime());
    // A newer pilot text date still wins over an older number date.
    db3Experiment('kcs', 'KCS');
    addScan('c', 'kcs', pilotText(new Date(2026, 10, 21, 9)));

    const result = await listExperimentScanCounts({ db: prisma });
    expect(result.data?.map((e) => e.experiment_id)).toEqual([
      'kcs',
      'weep',
      'alf',
    ]);
  });

  it('lists the days of an experiment with mixed text and number dates, newest first', async () => {
    addScan('a', 'weep', new Date(2026, 9, 28, 10).getTime());
    addScan('b', 'weep', new Date(2026, 9, 28, 11).getTime());
    // From the pilot app: text, and older. SQLite sorts text after numbers, so
    // ordering by the column would put it first; the days must still be in date order.
    addScan('c', 'weep', pilotText(new Date(2026, 4, 18, 10)));
    addScan('d', 'weep', new Date(2026, 10, 4, 9).getTime());

    const result = await listExperimentScanDays({ db: prisma }, 'weep');
    expect(result).toEqual({
      success: true,
      data: [
        { day: '2026-11-04', scan_count: 1 },
        { day: '2026-10-28', scan_count: 2 },
        { day: '2026-05-18', scan_count: 1 },
      ],
    });
  });

  it('files scans by the local day near midnight, for number and pilot text dates', async () => {
    // On Pacific time these are all on a different UTC day; a UTC day would move them.
    addScan('a', 'weep', new Date(2026, 10, 20, 0, 30).getTime());
    addScan('b', 'weep', new Date(2026, 10, 20, 23, 30).getTime());
    addScan('c', 'weep', pilotText(new Date(2025, 10, 20, 23, 30)));
    addScan('d', 'weep', pilotText(new Date(2025, 10, 21, 0, 30)));

    const days = await listExperimentScanDays({ db: prisma }, 'weep');
    expect(days.data).toEqual([
      { day: '2026-11-20', scan_count: 2 },
      { day: '2025-11-21', scan_count: 1 },
      { day: '2025-11-20', scan_count: 1 },
    ]);
    const byDay = async (day: string) =>
      (await listDayScans({ db: prisma }, 'weep', day)).data!.map((s) => s.id);
    expect(await byDay('2026-11-20')).toEqual(['b', 'a']);
    expect(await byDay('2025-11-20')).toEqual(['c']);
    expect(await byDay('2025-11-21')).toEqual(['d']);
    expect(await byDay('2026-11-21')).toEqual([]);
  });

  it('searches by phenotyper, name and dates, with pilot text dates, consistently at every level', async () => {
    const db = new Database(dbPath);
    db.exec(
      `INSERT INTO "Phenotyper" ("id", "name", "email") VALUES ('em', 'Emily', 'emily@example.org');`
    );
    db.close();
    addScan('a', 'weep', new Date(2026, 10, 20, 11).getTime());
    addScan('b', 'weep', pilotText(new Date(2025, 10, 20, 10)));
    addScan('c', 'alf', new Date(2026, 10, 19, 9).getTime());
    addScan('d', 'alf', new Date(2026, 10, 20, 9).getTime(), true);
    // Emily's scan: same columns, other phenotyper.
    const raw = new Database(dbPath);
    raw.exec(`UPDATE "Scan" SET "phenotyper_id" = 'em' WHERE "id" = 'c'`);
    raw.close();

    const deps = { db: prisma };
    const cases: Array<[object, string[]]> = [
      [{ search: 'Nov 20' }, ['a', 'b']],
      [{ search: 'Nov 20, 2025' }, ['b']],
      [{ search: 'emily' }, ['c']],
      [{ search: 'Nov 2026' }, ['a', 'c']],
      [{ dateFrom: '2026-11-19', dateTo: '2026-11-20' }, ['a', 'c']],
      [{ dateTo: '2025-12-31' }, ['b']],
      [{ search: 'weep6', dateFrom: '2026-01-01' }, ['a']],
      [{ search: 'weep6' }, ['a', 'b']],
    ];
    for (const [filter, expected] of cases) {
      const ids: string[] = [];
      const counts = (await listExperimentScanCounts(deps, filter)).data!;
      for (const exp of counts) {
        const days = (
          await listExperimentScanDays(deps, exp.experiment_id, filter)
        ).data!;
        expect(days.reduce((n, d) => n + d.scan_count, 0)).toBe(exp.scan_count);
        for (const d of days) {
          const scans = (
            await listDayScans(deps, exp.experiment_id, d.day, filter)
          ).data!;
          expect(scans).toHaveLength(d.scan_count);
          ids.push(...scans.map((s) => s.id));
        }
      }
      expect({ filter, ids: ids.sort() }).toEqual({ filter, ids: expected });
    }
  });
});
