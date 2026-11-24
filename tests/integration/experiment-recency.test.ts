/**
 * Integration test: each experiment's newest scan time on a real database, through
 * the real Prisma client. Pilot scans store capture_date as text, newer ones a
 * number; SQLite ranks any text above any number, so the text must be read as a date.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import { listExperimentLatestScans } from '../../src/main/experiment-recency-handlers';

const MIGRATIONS_DIR = path.join(__dirname, '../../prisma/migrations');

describe('experiment latest scans on a real database', () => {
  let dir: string;
  let dbPath: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-recency-'));
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
      INSERT INTO "Experiment" ("id", "name", "species") VALUES
        ('pilot', 'Pennycress pilot', 'Pennycress'),
        ('stl', 'STL Soy', 'Soybean'),
        ('gone', 'Deleted only', 'Soybean'),
        ('none', 'No scans', 'Soybean'),
        ('mixed', 'Scanned in both apps', 'Canola'),
        ('gravi', 'Gravi plates', 'Arabidopsis');
    `);
    const add = db.prepare(
      `INSERT INTO "Scan" ("id", "experiment_id", "phenotyper_id", "scanner_name", "plant_id",
        "path", "capture_date", "num_frames", "exposure_time", "gain", "brightness",
        "contrast", "gamma", "seconds_per_rot", "wave_number", "plant_age_days", "deleted")
       VALUES (?, ?, 'ph', 'PBIOBScanner', 'plant', ?, ?, 72, 6400, 250, 0, 0, 1, 7, 0, 10, ?)`
    );
    add.run('p1', 'pilot', 'p1', '2025-01-10 10:00:00', 0);
    add.run('p2', 'pilot', 'p2', '2025-01-12 10:00:00', 0);
    add.run('s1', 'stl', 's1', Date.UTC(2026, 10, 20, 18), 0);
    add.run('s2', 'stl', 's2', Date.UTC(2026, 10, 21, 18), 1);
    add.run('g1', 'gone', 'g1', Date.UTC(2026, 10, 22, 18), 1);
    // One experiment scanned in the pilot app (text) and then the new one (a
    // number): SQLite ranks any text above any number, so a raw MAX picks the 2025 one.
    add.run('m1', 'mixed', 'm1', '2025-03-01 10:00:00', 0);
    add.run('m2', 'mixed', 'm2', Date.UTC(2026, 1, 3, 9), 0);
    // GraviScan scans count too; a deleted one doesn't.
    db.pragma('foreign_keys = OFF');
    const addGravi = db.prepare(
      `INSERT INTO "GraviScan" ("id", "experiment_id", "phenotyper_id", "scanner_id", "path",
        "capture_date", "grid_mode", "plate_index", "resolution", "deleted")
       VALUES (?, 'gravi', 'ph', 'scanner-1', ?, ?, '2grid', '00', 1200, ?)`
    );
    addGravi.run('gs1', 'gs1', Date.UTC(2026, 10, 23, 8), 0);
    addGravi.run('gs2', 'gs2', Date.UTC(2026, 10, 24, 8), 1);
    db.close();
    prisma = new PrismaClient({
      datasources: { db: { url: `file:${dbPath}` } },
    });
  });

  afterEach(async () => {
    await prisma.$disconnect();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('gives each experiment its newest non-deleted scan, reading pilot text dates as dates', async () => {
    const result = await listExperimentLatestScans({ db: prisma });
    expect(result.success).toBe(true);
    const byId = new Map(
      result.data!.map((r) => [r.experiment_id, r.latest_ms])
    );
    expect(byId.get('stl')).toBe(Date.UTC(2026, 10, 20, 18));
    expect(byId.get('pilot')).toBe(Date.UTC(2025, 0, 12, 10));
    expect(byId.has('gone')).toBe(false);
    expect(byId.has('none')).toBe(false);
    expect(byId.get('mixed')).toBe(Date.UTC(2026, 1, 3, 9));
    expect(byId.get('gravi')).toBe(Date.UTC(2026, 10, 23, 8));
  });
});
