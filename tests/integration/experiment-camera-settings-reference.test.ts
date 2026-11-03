/**
 * Integration test: "Used before in this experiment" on a real database, through the
 * real Prisma client (#484 review). Scans from the pilot app may store capture_date as
 * text, which SQLite sorts after any date stored as a number, whatever the actual date.
 * The list must still show each setting's real latest scan.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { PrismaClient } from '@prisma/client';
import {
  listReference,
  type CameraSettingsDbLike,
} from '../../src/main/experiment-camera-settings-handlers';

const MIGRATIONS_DIR = path.join(__dirname, '../../prisma/migrations');

const OCT_1 = Date.UTC(2026, 9, 1, 16);
const OCT_20 = Date.UTC(2026, 9, 20, 16);

describe('listReference on a real database', () => {
  let dir: string;
  let dbPath: string;
  let prisma: PrismaClient;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bloom-camera-reference-'));
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
      INSERT INTO "Experiment" ("id", "name", "species") VALUES ('kcs', 'KCS', 'Soybean');
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
    captured: number | string,
    exposure: number,
    extra: { deleted?: boolean } = {}
  ) {
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO "Scan" ("id", "experiment_id", "phenotyper_id", "scanner_name", "plant_id",
        "path", "capture_date", "num_frames", "exposure_time", "gain", "brightness",
        "contrast", "gamma", "seconds_per_rot", "wave_number", "plant_age_days", "deleted")
       VALUES (?, 'kcs', 'ph', 'PBIOBScanner', 'plant', ?, ?, 72, ?, 250, 0, 0, 1, 7, 0, 10, ?)`
    ).run(id, `scans/${id}`, captured, exposure, extra.deleted ? 1 : 0);
    const addImage = db.prepare(
      `INSERT INTO "Image" ("id", "scan_id", "frame_number", "path") VALUES (?, ?, ?, ?)`
    );
    addImage.run(`${id}-2`, id, 2, `scans/${id}/2.png`);
    addImage.run(`${id}-1`, id, 1, `scans/${id}/1.png`);
    db.close();
  }

  const list = () =>
    listReference({ db: prisma as unknown as CameraSettingsDbLike }, 'kcs');

  it("shows a setting's newest scan when an older pilot scan stores its date as text", async () => {
    addScan('pilot', '2025-03-01 10:00:00', 7400); // older, text
    addScan('new', OCT_20, 7400); // newer, milliseconds
    addScan('other', OCT_1, 7000);

    const result = await list();
    expect(result.success).toBe(true);
    expect(result.data?.map((l) => l.exposure_time)).toEqual([7400, 7000]);
    expect(result.data?.[0]).toMatchObject({
      scan_count: 2,
      first_captured: new Date('2025-03-01T10:00:00Z').toISOString(),
      last_captured: new Date(OCT_20).toISOString(),
      latest_image_path: 'scans/new/1.png',
    });
  });

  it('leaves out deleted scans and 0 / 0 self-tests', async () => {
    addScan('kept', OCT_1, 7400);
    addScan('deleted', OCT_20, 9000, { deleted: true });
    addScan('selftest', OCT_20, 0);

    const result = await list();
    expect(result.data?.map((l) => [l.exposure_time, l.scan_count])).toEqual([
      [7400, 1],
    ]);
  });
});
