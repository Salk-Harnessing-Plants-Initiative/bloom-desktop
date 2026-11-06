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

  /** "YYYY-MM-DD HH:MM:SS" as the pilot app wrote it, in local time. */
  const pilotText = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:00:00`;

  it('counts scans per experiment, with text and number dates and without deleted ones', async () => {
    addScan('a', 'weep', new Date(2026, 9, 28, 10).getTime());
    addScan('b', 'weep', pilotText(new Date(2026, 4, 18, 10)));
    addScan('c', 'weep', new Date(2026, 9, 28, 11).getTime(), true);
    addScan('d', 'alf', new Date(2026, 9, 1, 9).getTime());

    const result = await listExperimentScanCounts({ db: prisma });
    expect(result).toEqual({
      success: true,
      data: [
        { experiment_id: 'alf', experiment_name: 'Alfalfa', scan_count: 1 },
        { experiment_id: 'weep', experiment_name: 'weep6-MBZ', scan_count: 2 },
      ],
    });
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
});
