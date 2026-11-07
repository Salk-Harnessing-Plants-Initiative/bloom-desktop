/**
 * Integration test: the migration that adds GraviScanner.grid_mode (#491).
 *
 * The earlier migrations are replayed on an in-memory database, scanners and
 * the rows that reference them are saved as a station without the column
 * would have them, then the new migration runs. It rebuilds the table, so the
 * test checks every column is copied and the references still hold. The column must match the GraviScan rig build's
 * (`TEXT NOT NULL DEFAULT '4grid'`), whose databases already have it.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';

const MIGRATIONS_DIR = path.join(__dirname, '../../prisma/migrations');
const GRID_MODE_MIGRATION = '20261106120000_add_scanner_grid_mode';

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
    .filter((name) => name < GRID_MODE_MIGRATION);
}

interface ColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
}

describe('add_scanner_grid_mode migration', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    for (const name of earlierMigrations()) db.exec(migrationSql(name));
    db.pragma('foreign_keys = ON');
  });

  function addScanner(id: string, port: string): void {
    db.prepare(
      `INSERT INTO "GraviScanner" ("id", "name", "usb_port", "updatedAt")
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(id, `Scanner ${id}`, port);
  }

  it('adds grid_mode as TEXT NOT NULL DEFAULT 4grid, as on the rig', () => {
    db.exec(migrationSql(GRID_MODE_MIGRATION));

    const column = (
      db.prepare(`PRAGMA table_info("GraviScanner")`).all() as ColumnInfo[]
    ).find((c) => c.name === 'grid_mode');

    expect(column).toEqual(
      expect.objectContaining({
        type: 'TEXT',
        notnull: 1,
        dflt_value: "'4grid'",
      })
    );
  });

  it('keeps every existing scanner column and the scans and plate assignments that point to it', () => {
    // The migration rebuilds the table (copy, drop, rename), so every column
    // must be copied and the child rows must still resolve afterwards.
    db.exec(`
      INSERT INTO "Phenotyper" ("id", "name", "email") VALUES ('ph', 'Ana', 'ana@example.org');
      INSERT INTO "Experiment" ("id", "name", "species") VALUES ('exp', 'exp', 'Arabidopsis');
    `);
    db.prepare(
      `INSERT INTO "GraviScanner" ("id", "name", "display_name", "vendor_id", "product_id",
         "usb_port", "usb_bus", "usb_device", "enabled", "createdAt", "updatedAt")
       VALUES ('a', 'Scanner a', 'Top left', '04b8', '013a', '1-1', 3, 7, 0,
         '2026-01-01 00:00:00', '2026-01-02 00:00:00')`
    ).run();
    addScanner('b', '1-2');
    db.exec(`
      INSERT INTO "GraviScanPlateAssignment" ("id", "experiment_id", "scanner_id", "plate_index", "updatedAt")
        VALUES ('pa', 'exp', 'a', '00', CURRENT_TIMESTAMP);
      INSERT INTO "GraviScan" ("id", "experiment_id", "phenotyper_id", "scanner_id", "path",
        "grid_mode", "plate_index", "resolution")
        VALUES ('gs', 'exp', 'ph', 'a', '/scans/a_00.tif', '2grid', '00', 1200);
    `);

    db.exec(migrationSql(GRID_MODE_MIGRATION));

    expect(
      db.prepare(`SELECT * FROM "GraviScanner" ORDER BY "id"`).all()
    ).toEqual([
      {
        id: 'a',
        name: 'Scanner a',
        display_name: 'Top left',
        vendor_id: '04b8',
        product_id: '013a',
        usb_port: '1-1',
        usb_bus: 3,
        usb_device: 7,
        enabled: 0,
        createdAt: '2026-01-01 00:00:00',
        updatedAt: '2026-01-02 00:00:00',
        grid_mode: '4grid',
      },
      expect.objectContaining({ id: 'b', enabled: 1, grid_mode: '4grid' }),
    ]);
    expect(
      db
        .prepare(`SELECT "id", "scanner_id" FROM "GraviScanPlateAssignment"`)
        .all()
    ).toEqual([{ id: 'pa', scanner_id: 'a' }]);
    expect(
      db.prepare(`SELECT "id", "scanner_id" FROM "GraviScan"`).all()
    ).toEqual([{ id: 'gs', scanner_id: 'a' }]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('stores a different grid mode per scanner after it runs', () => {
    db.exec(migrationSql(GRID_MODE_MIGRATION));
    addScanner('a', '1-1');
    addScanner('b', '1-2');

    db.prepare(
      `UPDATE "GraviScanner" SET "grid_mode" = '2grid' WHERE "id" = 'a'`
    ).run();

    const rows = db
      .prepare(`SELECT "id", "grid_mode" FROM "GraviScanner" ORDER BY "id"`)
      .all();
    expect(rows).toEqual([
      { id: 'a', grid_mode: '2grid' },
      { id: 'b', grid_mode: '4grid' },
    ]);
  });
});
