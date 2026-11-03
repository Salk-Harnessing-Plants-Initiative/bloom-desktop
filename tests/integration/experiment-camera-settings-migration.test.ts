/**
 * Integration test: the migration that adds ExperimentCameraSettings (#483) gives each
 * experiment with scans a first row, copied from its latest real scan.
 *
 * The earlier migrations are replayed on an in-memory database, scans are added as a
 * station would have them (some from the pilot app, with text dates), then the new
 * migration runs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

const MIGRATIONS_DIR = path.join(__dirname, '../../prisma/migrations');
const CAMERA_SETTINGS_MIGRATION =
  '20261103120000_add_experiment_camera_settings';

function migrationSql(name: string): string {
  return fs.readFileSync(
    path.join(MIGRATIONS_DIR, name, 'migration.sql'),
    'utf8'
  );
}

function earlierMigrations(): string[] {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{14}_/.test(name))
    .sort()
    .filter((name) => name < CAMERA_SETTINGS_MIGRATION);
}

interface SeedScan {
  id: string;
  experiment: string;
  captured: number | string;
  exposure: number;
  gain?: number;
  gamma?: number;
  deleted?: boolean;
}

describe('add_experiment_camera_settings migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    for (const name of earlierMigrations()) db.exec(migrationSql(name));
    db.exec(
      `INSERT INTO "Phenotyper" ("id", "name", "email") VALUES ('ph', 'Ana', 'ana@example.org')`
    );
  });

  function seed(experiments: string[], scans: SeedScan[]): void {
    const addExperiment = db.prepare(
      `INSERT INTO "Experiment" ("id", "name", "species") VALUES (?, ?, 'Soybean')`
    );
    for (const id of experiments) addExperiment.run(id, id);
    const addScan = db.prepare(`
      INSERT INTO "Scan" ("id", "experiment_id", "phenotyper_id", "scanner_name", "plant_id",
        "path", "capture_date", "num_frames", "exposure_time", "gain", "brightness",
        "contrast", "gamma", "seconds_per_rot", "wave_number", "plant_age_days", "deleted")
      VALUES (?, ?, 'ph', 'PBIOBScanner', 'plant', 'scan', ?, 72, ?, ?, 0, 0, ?, 7, 0, 10, ?)`);
    for (const s of scans) {
      addScan.run(
        s.id,
        s.experiment,
        s.captured,
        s.exposure,
        s.gain ?? (s.exposure > 0 ? 250 : 0),
        s.gamma ?? (s.exposure > 0 ? 1 : 0),
        s.deleted ? 1 : 0
      );
    }
  }

  function settingsRows() {
    return db
      .prepare(
        `SELECT "experiment_id", "exposure_time", "gain", "gamma", "note",
           typeof("createdAt") AS "createdAtType", "set_by_phenotyper_id",
           "last_confirmed_at", "last_confirmed_by_phenotyper_id", "id"
         FROM "ExperimentCameraSettings" ORDER BY "experiment_id"`
      )
      .all() as Array<Record<string, unknown>>;
  }

  const OCT_1 = Date.UTC(2026, 9, 1, 16);
  const OCT_20 = Date.UTC(2026, 9, 20, 16);
  const OCT_21 = Date.UTC(2026, 9, 21, 16);

  it("copies each experiment's latest scan settings, unconfirmed and set by no one", () => {
    seed(
      ['KCS'],
      [
        { id: 'k1', experiment: 'KCS', captured: OCT_1, exposure: 7000 },
        { id: 'k2', experiment: 'KCS', captured: OCT_20, exposure: 7400 },
      ]
    );
    db.exec(migrationSql(CAMERA_SETTINGS_MIGRATION));

    const [row] = settingsRows();
    expect(row).toMatchObject({
      experiment_id: 'KCS',
      exposure_time: 7400,
      gain: 250,
      gamma: 1,
      set_by_phenotyper_id: null,
      last_confirmed_at: null,
      last_confirmed_by_phenotyper_id: null,
    });
    expect(row.note).toMatch(/^Copied from latest scan \(2026-10-2[01]\)$/);
    expect(row.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  });

  it('writes createdAt in milliseconds, as Prisma does, so later rows sort after it', () => {
    seed(
      ['KCS'],
      [{ id: 'k1', experiment: 'KCS', captured: OCT_20, exposure: 7400 }]
    );
    db.exec(migrationSql(CAMERA_SETTINGS_MIGRATION));
    expect(settingsRows()[0].createdAtType).toBe('integer');
  });

  it('skips deleted scans and 0 / 0 deploy self-tests when picking the latest scan', () => {
    seed(
      ['KCS'],
      [
        { id: 'k1', experiment: 'KCS', captured: OCT_1, exposure: 7400 },
        {
          id: 'k2',
          experiment: 'KCS',
          captured: OCT_20,
          exposure: 9000,
          deleted: true,
        },
        { id: 'k3', experiment: 'KCS', captured: OCT_21, exposure: 0 },
      ]
    );
    db.exec(migrationSql(CAMERA_SETTINGS_MIGRATION));
    expect(settingsRows().map((r) => r.exposure_time)).toEqual([7400]);
  });

  it('adds no row for experiments without a usable scan', () => {
    seed(
      ['NoScans', 'SelfTestOnly', 'DeletedOnly'],
      [
        { id: 's1', experiment: 'SelfTestOnly', captured: OCT_20, exposure: 0 },
        {
          id: 'd1',
          experiment: 'DeletedOnly',
          captured: OCT_20,
          exposure: 8000,
          deleted: true,
        },
      ]
    );
    db.exec(migrationSql(CAMERA_SETTINGS_MIGRATION));
    expect(settingsRows()).toEqual([]);
  });

  it('compares text dates from the pilot app with millisecond dates by time', () => {
    seed(
      ['Pilot', 'Mixed'],
      [
        {
          id: 'p1',
          experiment: 'Pilot',
          captured: '2025-03-01 10:00:00',
          exposure: 6400,
        },
        {
          id: 'p2',
          experiment: 'Pilot',
          captured: '2025-03-05T10:00:00.000Z',
          exposure: 6500,
        },
        // The newer one is text: a plain comparison would put any number first.
        {
          id: 'm1',
          experiment: 'Mixed',
          captured: '2026-10-30 10:00:00',
          exposure: 5000,
        },
        { id: 'm2', experiment: 'Mixed', captured: OCT_20, exposure: 5100 },
      ]
    );
    db.exec(migrationSql(CAMERA_SETTINGS_MIGRATION));
    expect(
      settingsRows().map((r) => [r.experiment_id, r.exposure_time])
    ).toEqual([
      ['Mixed', 5000],
      ['Pilot', 6500],
    ]);
  });

  it('gives each experiment its own row', () => {
    seed(
      ['KCS', 'Alfalfa'],
      [
        { id: 'k1', experiment: 'KCS', captured: OCT_20, exposure: 7400 },
        { id: 'a1', experiment: 'Alfalfa', captured: OCT_1, exposure: 8800 },
      ]
    );
    db.exec(migrationSql(CAMERA_SETTINGS_MIGRATION));
    expect(
      settingsRows().map((r) => [r.experiment_id, r.exposure_time])
    ).toEqual([
      ['Alfalfa', 8800],
      ['KCS', 7400],
    ]);
  });
});
